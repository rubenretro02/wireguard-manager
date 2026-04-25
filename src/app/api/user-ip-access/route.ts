import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET - Fetch IP access for a user
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const routerId = searchParams.get("routerId");

  if (!userId) {
    return NextResponse.json({ error: "User ID required" }, { status: 400 });
  }

  let query = supabase
    .from("user_ip_access")
    .select("*, public_ips(*), routers(id, name)")
    .eq("user_id", userId);

  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ipAccess: data });
}

// POST - Grant IP access
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check if user is admin or has can_manage_user_ips capability
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  const canManage = profile?.capabilities?.can_manage_user_ips;

  if (!isAdmin && !canManage) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const body = await request.json();
  const { user_id, router_id, ip_id, ip_ids } = body;

  if (!user_id || !router_id) {
    return NextResponse.json({ error: "User ID and Router ID required" }, { status: 400 });
  }

  // If managing for a user they didn't create, check if admin
  if (!isAdmin) {
    const { data: targetUser } = await supabase
      .from("profiles")
      .select("created_by_user_id")
      .eq("id", user_id)
      .single();

    if (targetUser?.created_by_user_id !== user.id) {
      return NextResponse.json({ error: "You can only manage users you created" }, { status: 403 });
    }
  }

  try {
    // Handle bulk insert (array of ip_ids)
    if (ip_ids && Array.isArray(ip_ids)) {
      const records = ip_ids.map((ipId: string) => ({
        user_id,
        router_id,
        ip_id: ipId,
        can_use: true,
        created_by: user.id,
      }));

      const { data, error } = await supabase
        .from("user_ip_access")
        .upsert(records, { onConflict: "user_id,router_id,ip_id" })
        .select();

      if (error) throw error;

      return NextResponse.json({ success: true, count: data?.length || 0 });
    }

    // Handle single insert
    if (!ip_id) {
      return NextResponse.json({ error: "IP ID required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("user_ip_access")
      .upsert({
        user_id,
        router_id,
        ip_id,
        can_use: true,
        created_by: user.id,
      }, { onConflict: "user_id,router_id,ip_id" })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, ipAccess: data });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// DELETE - Revoke IP access
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check if user is admin or has can_manage_user_ips capability
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";
  const canManage = profile?.capabilities?.can_manage_user_ips;

  if (!isAdmin && !canManage) {
    return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const userId = searchParams.get("userId");
  const routerId = searchParams.get("routerId");
  const ipId = searchParams.get("ipId");
  const all = searchParams.get("all"); // Delete all for user/router

  try {
    if (id) {
      // Delete by access ID
      const { error } = await supabase
        .from("user_ip_access")
        .delete()
        .eq("id", id);

      if (error) throw error;
    } else if (all === "true" && userId && routerId) {
      // Delete all IP access for user on router
      const { error } = await supabase
        .from("user_ip_access")
        .delete()
        .eq("user_id", userId)
        .eq("router_id", routerId);

      if (error) throw error;
    } else if (userId && routerId && ipId) {
      // Delete specific IP access
      const { error } = await supabase
        .from("user_ip_access")
        .delete()
        .eq("user_id", userId)
        .eq("router_id", routerId)
        .eq("ip_id", ipId);

      if (error) throw error;
    } else {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
