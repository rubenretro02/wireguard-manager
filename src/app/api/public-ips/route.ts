import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const routerId = searchParams.get("routerId");

  let query = supabase.from("public_ips").select("*").order("ip_number", { ascending: true });

  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  const { data: publicIps, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ publicIps });
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
  const { router_id, ip_number } = body;

  if (!router_id || ip_number === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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

  const publicIp = `${router.public_ip_prefix}.${ip_number}`;
  const internalSubnet = `${router.internal_prefix}.${ip_number}`;

  // Get user email for created_by
  const { data: userProfile } = await supabase.from("profiles").select("email").eq("id", user.id).single();

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
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This IP number already exists for this router" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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

  const { error } = await supabase.from("public_ips").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
