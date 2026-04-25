import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Default capabilities for new users
const DEFAULT_CAPABILITIES = {
  can_auto_expire: false,
  can_see_all_peers: false,
  can_use_restricted_ips: false,
};

export async function POST(request: Request) {
  const supabase = await createClient();

  // Check if current user is admin OR has can_create_users capability
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
    return NextResponse.json({ error: "Permission denied. Admin access or 'can_create_users' capability required." }, { status: 403 });
  }

  const body = await request.json();
  const { email, password, username, role, capabilities } = body;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  // Merge provided capabilities with defaults
  const userCapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...(capabilities || {}),
  };

  // Try to use admin client if service role is available
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (serviceRoleKey && supabaseUrl) {
    // Use admin API - this won't auto-login the admin
    const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: username || email.split("@")[0],
      },
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
    }

    // Update the user's profile with role and capabilities
    // Non-admin users can only create regular users, not admins
    const finalRole = isAdmin ? (role || "user") : "user";

    const profileUpdate: Record<string, unknown> = {
      role: finalRole,
      username: username || email.split("@")[0],
      capabilities: userCapabilities
    };

    // If created by a non-admin user with can_create_users, track who created them
    if (!isAdmin && canCreateUsers) {
      profileUpdate.created_by_user_id = user.id;
    }

    const { error: profileError } = await adminClient
      .from("profiles")
      .update(profileUpdate)
      .eq("id", authData.user.id);

    if (profileError) {
      console.error("Failed to update profile:", profileError);
    }

    // If created by a non-admin user with can_create_users, inherit routers and IPs
    if (!isAdmin && canCreateUsers) {
      try {
        // Get the creator's router access
        const { data: creatorRouters } = await adminClient
          .from("user_routers")
          .select("router_id")
          .eq("user_id", user.id);

        if (creatorRouters && creatorRouters.length > 0) {
          // Grant the same router access to the new user
          const routerAccess = creatorRouters.map(r => ({
            user_id: authData.user.id,
            router_id: r.router_id
          }));

          await adminClient
            .from("user_routers")
            .insert(routerAccess);

          // Get the creator's IP access
          const { data: creatorIps } = await adminClient
            .from("user_ip_access")
            .select("router_id, ip_id, can_use")
            .eq("user_id", user.id)
            .eq("can_use", true);

          if (creatorIps && creatorIps.length > 0) {
            // Grant the same IP access to the new user
            const ipAccess = creatorIps.map(ip => ({
              user_id: authData.user.id,
              router_id: ip.router_id,
              ip_id: ip.ip_id,
              can_use: true,
              created_by: user.id
            }));

            await adminClient
              .from("user_ip_access")
              .insert(ipAccess);
          }
        }
      } catch (inheritError) {
        console.error("Failed to inherit router/IP access:", inheritError);
        // Don't fail the user creation, just log the error
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email
      }
    });
  }

  // Service role not configured - return error instead of causing auto-login
  return NextResponse.json({
    error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is required to create users without auto-login. Please configure the service role key in your environment variables.",
    code: "SERVICE_ROLE_REQUIRED"
  }, { status: 500 });
}

export async function DELETE(request: Request) {
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
  const canDelete = profile?.capabilities?.can_delete === true;

  if (!isAdmin && !canDelete) {
    return NextResponse.json({ error: "Permission denied. Admin access or 'can_delete' capability required." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("id");

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  // Prevent self-deletion
  if (userId === user.id) {
    return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
  }

  // Get the target user's info to check permissions
  const { data: targetUser } = await supabase
    .from("profiles")
    .select("role, created_by_user_id")
    .eq("id", userId)
    .single();

  // Non-admins can only delete users they created
  if (!isAdmin && targetUser?.created_by_user_id !== user.id) {
    return NextResponse.json({ error: "You can only delete users you created" }, { status: 403 });
  }

  // Cannot delete admins unless you are an admin
  if (!isAdmin && targetUser?.role === "admin") {
    return NextResponse.json({ error: "Cannot delete admin users" }, { status: 403 });
  }

  // Use admin client to properly delete the user from auth.users
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (serviceRoleKey && supabaseUrl) {
    const adminClient = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // First delete from profiles (in case there are RLS policies)
    const { error: profileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      console.error("Failed to delete profile:", profileError);
      return NextResponse.json({ error: `Failed to delete profile: ${profileError.message}` }, { status: 500 });
    }

    // Then delete from auth.users
    const { error: authError } = await adminClient.auth.admin.deleteUser(userId);

    if (authError) {
      console.error("Failed to delete auth user:", authError);
      // Profile is already deleted, but auth user remains - this is a partial failure
      return NextResponse.json({
        error: `Profile deleted but failed to delete auth user: ${authError.message}`,
        partialSuccess: true
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  // Fallback: try regular client (will likely fail due to RLS)
  const { error } = await supabase
    .from("profiles")
    .delete()
    .eq("id", userId);

  if (error) {
    return NextResponse.json({
      error: `Failed to delete user: ${error.message}. Service role key may be required.`,
      hint: "Configure SUPABASE_SERVICE_ROLE_KEY for proper user deletion"
    }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
