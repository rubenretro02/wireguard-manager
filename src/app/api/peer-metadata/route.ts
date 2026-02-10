import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const routerId = searchParams.get("routerId");

  if (!routerId) {
    return NextResponse.json({ error: "routerId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("peer_metadata")
    .select("*")
    .eq("router_id", routerId);

  if (error) {
    // Table might not exist yet - return empty array gracefully
    console.error("[Peer Metadata] Error fetching:", error.message);
    return NextResponse.json({ metadata: [] });
  }

  return NextResponse.json({ metadata: data || [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get user profile for email
  const { data: profile } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", user.id)
    .single();

  const body = await request.json();
  const { action, routerId, peerPublicKey, peerName, peerInterface, allowedAddress } = body;

  if (action === "save") {
    const { data, error } = await supabase
      .from("peer_metadata")
      .upsert(
        {
          router_id: routerId,
          peer_public_key: peerPublicKey,
          peer_name: peerName || null,
          peer_interface: peerInterface || null,
          allowed_address: allowedAddress || null,
          created_by_email: profile?.email || user.email || "unknown",
          created_by_user_id: user.id,
        },
        { onConflict: "router_id,peer_public_key" }
      )
      .select()
      .single();

    if (error) {
      console.error("[Peer Metadata] Error saving:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ metadata: data });
  }

  if (action === "delete") {
    const { error } = await supabase
      .from("peer_metadata")
      .delete()
      .eq("router_id", routerId)
      .eq("peer_public_key", peerPublicKey);

    if (error) {
      console.error("[Peer Metadata] Error deleting:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
