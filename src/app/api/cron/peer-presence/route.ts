import { NextResponse } from "next/server";
import {
  buildLinuxClient,
  buildMikroTikClient,
  getServiceClient,
  parseMikroTikDuration,
} from "@/lib/tg-store";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron: online/offline sessions per peer (v31).
 *
 * WireGuard never emits connection events — the only signal is the latest
 * handshake. This reads every server, marks a peer online when its handshake
 * is younger than HANDSHAKE_WINDOW, and opens/closes rows in `peer_sessions`
 * on transitions. Resolution is the cron interval: run it every 1–2 minutes
 * from cron-job.org (Authorization: Bearer CRON_SECRET), like the other crons.
 *
 * A server that doesn't answer is skipped without touching its sessions: an
 * outage must not look like every peer disconnecting.
 */
const HANDSHAKE_WINDOW_SEC = 180;

interface LiveEntry {
  publicKey: string;
  handshakeAt: Date | null;
  clientIp: string | null;
  rx: number;
  tx: number;
}

async function readLivePeers(router: Router, interfaces: string[]): Promise<LiveEntry[]> {
  const out: LiveEntry[] = [];
  if (router.connection_type === "linux-ssh") {
    for (const iface of interfaces) {
      const peers = await buildLinuxClient(router, iface).getPeersForInterface(iface);
      for (const p of peers) {
        const epoch = Number.parseInt(p.latestHandshake || "0", 10);
        out.push({
          publicKey: p.publicKey,
          handshakeAt: epoch > 0 ? new Date(epoch * 1000) : null,
          clientIp: p.endpoint ? p.endpoint.split(":")[0] : null,
          rx: p.transfer?.rx || 0,
          tx: p.transfer?.tx || 0,
        });
      }
    }
  } else {
    const now = Date.now();
    const peers = await buildMikroTikClient(router).getWireGuardPeers();
    for (const p of peers) {
      // MikroTik reports the handshake as a relative duration ("1m20s")
      const ago = parseMikroTikDuration(p["last-handshake"]);
      out.push({
        publicKey: p["public-key"],
        handshakeAt: ago !== null ? new Date(now - ago * 1000) : null,
        clientIp: p["current-endpoint-address"] || null,
        rx: Number(p.rx) || 0,
        tx: Number(p.tx) || 0,
      });
    }
  }
  return out;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = new Date();
  const summary: Record<string, { online: number; opened: number; closed: number } | { error: string }> = {};

  const { data: routers } = await supabase.from("routers").select("*");

  for (const router of (routers || []) as Router[]) {
    try {
      // Every interface this router owns (router-per-interface workflow + per-IP overrides)
      const interfaces = new Set<string>([router.wg_interface || "wg0"]);
      if (router.connection_type === "linux-ssh") {
        const { data: ips } = await supabase.from("public_ips").select("wg_interface").eq("router_id", router.id);
        for (const ip of ips || []) if (ip.wg_interface) interfaces.add(ip.wg_interface);
      }

      const live = await readLivePeers(router, Array.from(interfaces));
      const onlineNow = new Map<string, LiveEntry>();
      for (const entry of live) {
        if (entry.handshakeAt && now.getTime() - entry.handshakeAt.getTime() < HANDSHAKE_WINDOW_SEC * 1000) {
          onlineNow.set(entry.publicKey, entry);
        }
      }

      const { data: openRows } = await supabase
        .from("peer_sessions")
        .select("id, peer_public_key, last_handshake_at, last_seen_at")
        .eq("router_id", router.id)
        .is("ended_at", null);
      const open = new Map((openRows || []).map((r) => [r.peer_public_key, r]));

      let opened = 0;
      let closed = 0;

      // Online peers: extend their open session or start one
      for (const [key, entry] of onlineNow) {
        const existing = open.get(key);
        const patch = {
          last_seen_at: now.toISOString(),
          last_handshake_at: entry.handshakeAt?.toISOString() || null,
          client_ip: entry.clientIp,
          rx_bytes: entry.rx,
          tx_bytes: entry.tx,
        };
        if (existing) {
          await supabase.from("peer_sessions").update(patch).eq("id", existing.id);
        } else {
          await supabase.from("peer_sessions").insert({
            router_id: router.id,
            peer_public_key: key,
            started_at: (entry.handshakeAt || now).toISOString(),
            ...patch,
          });
          opened++;
        }
      }

      // Open sessions whose peer is no longer online: close them at the last
      // moment we know they were alive (handshake + window), never in the future
      for (const [key, row] of open) {
        if (onlineNow.has(key)) continue;
        const lastAlive = row.last_handshake_at
          ? new Date(new Date(row.last_handshake_at).getTime() + HANDSHAKE_WINDOW_SEC * 1000)
          : new Date(row.last_seen_at);
        const endedAt = lastAlive < now ? lastAlive : now;
        await supabase.from("peer_sessions").update({ ended_at: endedAt.toISOString() }).eq("id", row.id);
        closed++;
      }

      summary[router.name] = { online: onlineNow.size, opened, closed };
    } catch (err) {
      summary[router.name] = { error: err instanceof Error ? err.message : "unreachable" };
    }
  }

  return NextResponse.json({ ok: true, at: now.toISOString(), servers: summary });
}
