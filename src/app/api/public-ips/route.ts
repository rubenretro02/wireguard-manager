import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity-logger";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user profile to check role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, capabilities")
    .eq("id", user.id)
    .single();

  const isAdmin = profile?.role?.toLowerCase() === "admin";

  const { searchParams } = new URL(request.url);
  const routerId = searchParams.get("routerId");
  const includeAll = searchParams.get("includeAll") === "true"; // For admin to get all IPs

  let query = supabase.from("public_ips").select("*").order("ip_number", { ascending: true });

  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  const { data: publicIps, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If admin and includeAll, return all IPs
  if (isAdmin && includeAll) {
    return NextResponse.json({ publicIps, isAdmin: true });
  }

  // If admin, return all enabled IPs
  if (isAdmin) {
    const filteredIps = publicIps?.filter((ip: { enabled: boolean }) => ip.enabled) || [];
    return NextResponse.json({ publicIps: filteredIps, isAdmin: true });
  }

  // For regular users, filter by user_ip_access
  if (!routerId) {
    return NextResponse.json({ publicIps: [], isAdmin: false });
  }

  // Get user's IP access for this router
  const { data: ipAccess } = await supabase
    .from("user_ip_access")
    .select("ip_id")
    .eq("user_id", user.id)
    .eq("router_id", routerId)
    .eq("can_use", true);

  if (!ipAccess || ipAccess.length === 0) {
    return NextResponse.json({ publicIps: [], isAdmin: false });
  }

  const accessibleIpIds = new Set(ipAccess.map((a: { ip_id: string }) => a.ip_id));

  // Filter IPs: only enabled IPs that user has access to
  const filteredIps = (publicIps || []).filter((ip: { id: string; enabled: boolean }) => {
    if (!ip.enabled) return false;
    return accessibleIpIds.has(ip.id);
  });

  return NextResponse.json({ publicIps: filteredIps, isAdmin: false });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { router_id, ip_number, ip_numbers, start_ip, end_ip } = body;

  if (!router_id) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Get router config to calculate IPs
  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("public_ip_prefix, public_ip_mask, internal_prefix")
    .eq("id", router_id)
    .single();

  if (routerError || !router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  if (!router.public_ip_prefix || !router.internal_prefix) {
    return NextResponse.json({
      error: "Router IP configuration not set. Please configure public_ip_prefix and internal_prefix first."
    }, { status: 400 });
  }

  // Get user email for created_by
  const { data: userProfile } = await supabase.from("profiles").select("email").eq("id", user.id).single();

  // BULK ADD: If start_ip and end_ip are provided, create a range
  if (start_ip !== undefined && end_ip !== undefined) {
    const startNum = parseInt(start_ip);
    const endNum = parseInt(end_ip);

    if (isNaN(startNum) || isNaN(endNum) || startNum > endNum || startNum < 1 || endNum > 254) {
      return NextResponse.json({ error: "Invalid IP range. Must be between 1-254 and start <= end" }, { status: 400 });
    }

    // Create array of IPs to add
    const ipsToAdd = [];
    for (let i = startNum; i <= endNum; i++) {
      ipsToAdd.push({
        router_id,
        ip_number: i,
        public_ip: `${router.public_ip_prefix}.${i}`,
        internal_subnet: `${router.internal_prefix}.${i}`,
        enabled: true,
        restricted: false,
        created_by: userProfile?.email || user.id,
        wg_ip_created: false,
        ip_address_created: false,
        nat_rule_created: false,
      });
    }

    // Insert all IPs, ignoring duplicates
    const { data: insertedIps, error } = await supabase
      .from("public_ips")
      .upsert(ipsToAdd, {
        onConflict: "router_id,ip_number",
        ignoreDuplicates: true
      })
      .select();

    if (error) {
      console.error("Bulk insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity for bulk add
    await logActivity({
      supabase,
      userId: user.id,
      routerId: router_id,
      action: "create",
      entityType: "public_ip",
      entityId: null,
      entityName: `Bulk: ${startNum}-${endNum}`,
      details: { start_ip: startNum, end_ip: endNum, count: endNum - startNum + 1 }
    });

    return NextResponse.json({
      success: true,
      count: ipsToAdd.length,
      message: `Added ${ipsToAdd.length} IPs (${startNum}-${endNum})`
    });
  }

  // BULK ADD: If ip_numbers array is provided
  if (ip_numbers && Array.isArray(ip_numbers)) {
    const ipsToAdd = ip_numbers.map((num: number) => ({
      router_id,
      ip_number: num,
      public_ip: `${router.public_ip_prefix}.${num}`,
      internal_subnet: `${router.internal_prefix}.${num}`,
      enabled: true,
      restricted: false,
      created_by: userProfile?.email || user.id,
      wg_ip_created: false,
      ip_address_created: false,
      nat_rule_created: false,
    }));

    // Insert all IPs, ignoring duplicates
    const { error } = await supabase
      .from("public_ips")
      .upsert(ipsToAdd, {
        onConflict: "router_id,ip_number",
        ignoreDuplicates: true
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Log activity
    await logActivity({
      supabase,
      userId: user.id,
      routerId: router_id,
      action: "create",
      entityType: "public_ip",
      entityId: null,
      entityName: `Bulk: ${ip_numbers.length} IPs`,
      details: { ip_numbers, count: ip_numbers.length }
    });

    return NextResponse.json({
      success: true,
      count: ip_numbers.length,
      message: `Added ${ip_numbers.length} IPs`
    });
  }

  // SINGLE ADD: Original behavior
  if (ip_number === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const publicIp = `${router.public_ip_prefix}.${ip_number}`;
  const internalSubnet = `${router.internal_prefix}.${ip_number}`;

  // Save to database - rules will be created manually with the Create button
  const { data: publicIpRecord, error } = await supabase
    .from("public_ips")
    .insert({
      router_id,
      ip_number,
      public_ip: publicIp,
      internal_subnet: internalSubnet,
      enabled: true,
      restricted: false,
      created_by: userProfile?.email || user.id,
      wg_ip_created: false,
      ip_address_created: false,
      nat_rule_created: false,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This IP number already exists for this router" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await logActivity({
    supabase,
    userId: user.id,
    routerId: router_id,
    action: "create",
    entityType: "public_ip",
    entityId: publicIpRecord.id,
    entityName: publicIp,
    details: { ip_number, internalSubnet }
  });

  return NextResponse.json({ publicIp: publicIpRecord, success: true });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "Public IP ID required" }, { status: 400 });
  }

  const allowedFields = ["enabled", "restricted", "nat_rule_created", "ip_address_created", "wg_ip_created"];
  const filteredUpdates: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in updates) {
      filteredUpdates[key] = updates[key];
    }
  }

  const { data: publicIp, error } = await supabase
    .from("public_ips")
    .update(filteredUpdates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ publicIp, success: true });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Public IP ID required" }, { status: 400 });
  }

  // Get the public IP info before deleting for logging
  const { data: ipToDelete } = await supabase
    .from("public_ips")
    .select("router_id, public_ip, ip_number")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("public_ips").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  if (ipToDelete) {
    await logActivity({
      supabase,
      userId: user.id,
      routerId: ipToDelete.router_id,
      action: "delete",
      entityType: "public_ip",
      entityId: id,
      entityName: ipToDelete.public_ip,
      details: { ip_number: ipToDelete.ip_number }
    });
  }

  return NextResponse.json({ success: true });
}
