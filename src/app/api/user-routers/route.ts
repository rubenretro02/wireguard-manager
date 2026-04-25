import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const routerId = searchParams.get("routerId");

  let query = supabase
    .from("user_routers")
    .select(`
      *,
      profiles:user_id (id, email, username),
      routers:router_id (id, name)
    `)
    .order("created_at", { ascending: false });

  if (userId) {
    query = query.eq("user_id", userId);
  }
  if (routerId) {
    query = query.eq("router_id", routerId);
  }

  const { data: userRouters, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ userRouters });
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
  const { user_id, router_id } = body;

  if (!user_id || !router_id) {
    return NextResponse.json({ error: "Missing required fields (user_id, router_id)" }, { status: 400 });
  }

  const { data: userRouter, error } = await supabase
    .from("user_routers")
    .insert({ user_id, router_id })
    .select(`
      *,
      profiles:user_id (id, email, username),
      routers:router_id (id, name)
    `)
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "User already has access to this router" }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ userRouter, success: true });
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
    return NextResponse.json({ error: "User-Router ID required" }, { status: 400 });
  }

  const { error } = await supabase.from("user_routers").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
