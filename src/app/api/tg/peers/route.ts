import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";
import {
  buildClientConfig,
  getLivePeerStatus,
  getServiceClient,
  type TgCustomerPeer,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializePeer(peer: TgCustomerPeer) {
  return {
    id: peer.id,
    name: peer.peer_name,
    router_id: peer.router_id,
    public_ip: peer.public_ip,
    allowed_address: peer.allowed_address,
    status: peer.status,
    expires_at: peer.expires_at,
    created_at: peer.created_at,
    plan_id: peer.plan_id,
    config: buildClientConfig(peer),
  };
}

/** Peers del customer autenticado, con su config lista para usar. */
export async function GET(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  const { data: peers, error } = await supabase
    .from("tg_customer_peers")
    .select("*")
    .eq("customer_id", auth.customer.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Failed to load peers" }, { status: 500 });
  }
  return NextResponse.json({ peers: (peers || []).map((p) => serializePeer(p as TgCustomerPeer)) });
}

/** Acciones sobre un peer propio. Por ahora: status en vivo (handshake/tráfico). */
export async function POST(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => ({}));
  const { action, peerId } = body;
  if (!peerId) return NextResponse.json({ error: "Missing peerId" }, { status: 400 });

  const supabase = getServiceClient();
  const { data: peer } = await supabase
    .from("tg_customer_peers")
    .select("*")
    .eq("id", peerId)
    .eq("customer_id", auth.customer.id)
    .single();
  if (!peer) return NextResponse.json({ error: "Peer not found" }, { status: 404 });

  switch (action) {
    case "status": {
      try {
        const status = await getLivePeerStatus(peer as TgCustomerPeer);
        return NextResponse.json({ status });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Failed to get status: ${msg}` }, { status: 500 });
      }
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
