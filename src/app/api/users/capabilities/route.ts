import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { UserCapabilities } from "@/lib/types";

export async function PATCH(request: Request) {
  const supabase = await createClient();

  // Check if current user is admin
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { userId, capabilities } = body as { userId: string; capabilities: UserCapabilities };

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  // Validate capabilities object
  const validCapabilities: UserCapabilities = {
    can_auto_expire: capabilities?.can_auto_expire === true,
    can_see_all_peers: capabilities?.can_see_all_peers === true,
    can_use_restricted_ips: capabilities?.can_use_restricted_ips === true,
    can_see_restricted_peers: capabilities?.can_see_restricted_peers === true,
  };

  // Try to use admin client if service role is available (bypasses RLS)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (serviceRoleKey && supabaseUrl) {
    const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { error } = await adminClient
      .from("profiles")
      .update({ capabilities: validCapabilities })
      .eq("id", userId);

    if (error) {
      console.error("Failed to update capabilities with admin client:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, capabilities: validCapabilities });
  }

  // Fallback: Try regular client (may fail due to RLS)
  const { error } = await supabase
    .from("profiles")
    .update({ capabilities: validCapabilities })
    .eq("id", userId);

  if (error) {
    console.error("Failed to update capabilities:", error);
    return NextResponse.json({
      error: error.message,
      hint: "Service role key may be required for updating other users' capabilities"
    }, { status: 500 });
  }

  return NextResponse.json({ success: true, capabilities: validCapabilities });
}
