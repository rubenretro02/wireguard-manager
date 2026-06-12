import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";
import {
  buildClientConfig,
  getLivePeerStatus,
  getLiveStatusesForPeers,
  getServiceClient,
  rotateCustomerPeerKeys,
  type LivePeerStatus,
  type TgCustomerPeer,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializePeer(peer: TgCustomerPeer, live?: LivePeerStatus | null) {
  return {
    live: live ?? null,
    id: peer.id,
    // El customer ve su display_name editable, nunca el nombre del sistema
    name: peer.display_name || "Peer",
    router_id: peer.router_id,
    public_ip: peer.public_ip,
    allowed_address: peer.allowed_address,
    status: peer.status,
    expires_at: peer.expires_at,
    created_at: peer.created_at,
    plan_id: peer.plan_id,
    // v19: si tiene precio propio, la renovación usa este precio (no planes)
    renewal_price_usd: peer.renewal_price_usd,
    renewal_duration_days: peer.renewal_duration_days,
    // Peers asignados desde el dashboard pueden no tener private key guardada:
    // el customer rota llaves desde la app para obtener una config completa.
    has_config: Boolean(peer.peer_private_key),
    config: peer.peer_private_key ? buildClientConfig(peer) : null,
  };
}

/**
 * Peers del customer autenticado, con su config lista para usar.
 * ?live=1 agrega estado en vivo (online/offline + tráfico) consultando el server.
 */
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

  const wantLive = new URL(request.url).searchParams.get("live") === "1";
  let liveMap = new Map<string, LivePeerStatus>();
  let statusChanges = new Map<string, string>();
  if (wantLive && peers?.length) {
    try {
      const result = await getLiveStatusesForPeers(supabase, peers as TgCustomerPeer[]);
      liveMap = result.live;
      statusChanges = result.statusChanges;
    } catch (err) {
      console.warn("[TgPeers] live statuses failed:", err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    peers: (peers || []).map((p) => {
      // aplicar el status sincronizado con el servidor en esta misma respuesta
      const corrected = statusChanges.get(p.id);
      const peer = corrected ? { ...p, status: corrected } : p;
      return serializePeer(peer as TgCustomerPeer, liveMap.get(p.id) || null);
    }),
  });
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
    case "rename": {
      const name = String(body.name || "").trim();
      if (!name || name.length > 32) {
        return NextResponse.json({ error: "Name must be 1-32 characters" }, { status: 400 });
      }
      const { data: updated, error } = await supabase
        .from("tg_customer_peers")
        .update({ display_name: name })
        .eq("id", peer.id)
        .select()
        .single();
      if (error || !updated) return NextResponse.json({ error: "Failed to rename" }, { status: 500 });
      return NextResponse.json({ peer: serializePeer(updated as TgCustomerPeer) });
    }

    case "rotateKeys": {
      try {
        const updated = await rotateCustomerPeerKeys(supabase, peer as TgCustomerPeer);
        return NextResponse.json({ peer: serializePeer(updated) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return NextResponse.json({ error: `Failed to rotate keys: ${msg}` }, { status: 500 });
      }
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
