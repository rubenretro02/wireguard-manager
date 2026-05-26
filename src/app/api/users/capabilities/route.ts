import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { UserCapabilities } from "@/lib/types";

export async function PATCH(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  const canCreateUsers = profile?.capabilities?.can_create_users === true;

  if (!isAdmin && !canCreateUsers) {
    return NextResponse.json(
      { error: "Permission denied. Admin or 'can_create_users' capability required." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { userId, capabilities, username } = body as {
    userId: string;
    capabilities?: UserCapabilities;
    username?: string | null;
  };

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  // Non-admins can only manage users they created themselves
  if (!isAdmin) {
    const { data: target } = await supabase
      .from("profiles")
      .select("created_by_user_id")
      .eq("id", userId)
      .single();
    if (!target || target.created_by_user_id !== user.id) {
      return NextResponse.json(
        { error: "You can only manage users you created" },
        { status: 403 }
      );
    }
  }

  // Validate capabilities object (whitelist known keys)
  const validCapabilities: UserCapabilities | undefined = capabilities
    ? {
        can_auto_expire: capabilities.can_auto_expire === true,
        can_see_all_peers: capabilities.can_see_all_peers === true,
        can_use_restricted_ips: capabilities.can_use_restricted_ips === true,
        can_see_restricted_peers: capabilities.can_see_restricted_peers === true,
        can_create_users: capabilities.can_create_users === true,
        can_manage_user_ips: capabilities.can_manage_user_ips === true,
        can_delete: capabilities.can_delete === true,
        can_see_all_proxies: capabilities.can_see_all_proxies === true,
        can_see_group_peers: capabilities.can_see_group_peers === true,
      }
    : undefined;

  // Build update payload — only include keys that were actually provided
  const updatePayload: Record<string, unknown> = {};
  if (validCapabilities) updatePayload.capabilities = validCapabilities;
  if (username !== undefined) updatePayload.username = username || null;

  if (Object.keys(updatePayload).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Prefer service-role client to bypass RLS reliably (semi-admins can't update
  // other users' rows under typical RLS policies).
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (serviceRoleKey && supabaseUrl) {
    const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await adminClient
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId);

    if (error) {
      console.error("Failed to update profile with admin client:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, capabilities: validCapabilities });
  }

  // Fallback: regular client (will likely fail for non-admins due to RLS)
  const { error } = await supabase
    .from("profiles")
    .update(updatePayload)
    .eq("id", userId);

  if (error) {
    console.error("Failed to update profile:", error);
    return NextResponse.json(
      {
        error: error.message,
        hint: "SUPABASE_SERVICE_ROLE_KEY may be required for non-admins to update other users.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, capabilities: validCapabilities });
}
