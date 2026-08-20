import { NextResponse } from "next/server";
import {
  buildLinuxClient,
  buildMikroTikClient,
  findMikroTikPeerByPublicKey,
  getServiceClient,
  isMikroTikDisabled,
  reactivateCustomerPeerOnServer,
  type TgCustomerPeer,
} from "@/lib/tg-store";
import type { Router } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron: aplica el timer de `peer_metadata` del lado del servidor.
 *
 * Hasta v23 el auto-disable vivía SOLO en el navegador (setInterval en
 * /dashboard), así que nada expiraba si nadie tenía la pestaña abierta — y con
 * la pestaña abierta apagaba peers que Telegram acababa de renovar, porque
 * miraba una fecha desincronizada. Ahora las dos tablas se escriben juntas
 * (src/lib/peer-expiry.ts) y este endpoint hace cumplir esa fecha única:
 *
 *   1. expirados y todavía prendidos -> apagar
 *   2. scheduled_enable_at vencido   -> prender y limpiar la columna
 *   3. 'expired' en TG con fecha futura -> reactivar (auto-sanación)
 *
 * Protegido con CRON_SECRET (header Authorization: Bearer <secret>).
 * Vercel Hobby solo permite un cron diario; para granularidad de minutos
 * apuntarle cron-job.org, igual que /api/cron/expire-customer-peers.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const disabled: string[] = [];
  const enabled: string[] = [];
  const reactivated: string[] = [];
  const errors: { peer: string; error: string }[] = [];

  // --- candidatos del timer del dashboard --------------------------------
  const { data: expiredMeta, error: expiredError } = await supabase
    .from("peer_metadata")
    .select("router_id, peer_public_key, peer_name, peer_interface")
    .eq("auto_disable_enabled", true)
    .lt("expires_at", nowIso);

  if (expiredError) {
    return NextResponse.json({ error: expiredError.message }, { status: 500 });
  }

  const { data: scheduledMeta } = await supabase
    .from("peer_metadata")
    .select("router_id, peer_public_key, peer_name, peer_interface")
    .not("scheduled_enable_at", "is", null)
    .lte("scheduled_enable_at", nowIso);

  // Red de seguridad: nunca apagar un peer cuya fecha REAL en la tienda está en
  // el futuro (o es NULL = sin timer). Con el espejo de v24 las dos fechas
  // coinciden siempre; esto impide que el bug reportado pueda repetirse.
  const candidateKeys = (expiredMeta || []).map((m) => m.peer_public_key);
  const protectedKeys = new Set<string>();
  if (candidateKeys.length) {
    const { data: tgRows } = await supabase
      .from("tg_customer_peers")
      .select("peer_public_key, expires_at")
      .in("peer_public_key", candidateKeys);
    for (const row of tgRows || []) {
      if (!row.expires_at || new Date(row.expires_at) > now) {
        protectedKeys.add(row.peer_public_key);
      }
    }
  }

  const toDisable = (expiredMeta || []).filter((m) => !protectedKeys.has(m.peer_public_key));

  // --- agrupar por router y actuar ---------------------------------------
  const routerIds = Array.from(
    new Set([...toDisable, ...(scheduledMeta || [])].map((m) => m.router_id))
  );

  const { data: routers } = routerIds.length
    ? await supabase.from("routers").select("*").in("id", routerIds)
    : { data: [] as Router[] };

  const routerById = new Map((routers || []).map((r) => [String(r.id), r as Router]));

  for (const meta of toDisable) {
    const router = routerById.get(String(meta.router_id));
    if (!router) continue;
    try {
      if (router.connection_type === "linux-ssh") {
        const iface = meta.peer_interface || router.wg_interface;
        const client = buildLinuxClient(router, iface || undefined);
        // En Linux "disable" = sacar la llave de wg (mismo criterio que
        // /api/wireguard disablePeer).
        const live = await client.getPeersForInterface(iface || router.wg_interface);
        if (!live.some((p) => p.publicKey === meta.peer_public_key)) continue; // ya estaba apagado
        await client.removePeer(meta.peer_public_key, iface || undefined);
        await supabase
          .from("linux_peers")
          .update({ disabled: true })
          .eq("router_id", meta.router_id)
          .eq("public_key", meta.peer_public_key);
      } else {
        const client = buildMikroTikClient(router);
        const rp = await findMikroTikPeerByPublicKey(client, meta.peer_public_key);
        if (!rp || isMikroTikDisabled(rp.disabled)) continue; // ya estaba apagado
        await client.disableWireGuardPeer(rp[".id"]);
      }
      disabled.push(meta.peer_name || meta.peer_public_key);
    } catch (err) {
      errors.push({
        peer: meta.peer_name || meta.peer_public_key,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  for (const meta of scheduledMeta || []) {
    const router = routerById.get(String(meta.router_id));
    if (!router) continue;
    try {
      if (router.connection_type === "linux-ssh") {
        const iface = meta.peer_interface || router.wg_interface;
        const { data: stored } = await supabase
          .from("linux_peers")
          .select("public_key, allowed_ips")
          .eq("router_id", meta.router_id)
          .eq("public_key", meta.peer_public_key)
          .maybeSingle();
        if (!stored) continue;
        const client = buildLinuxClient(router, iface || undefined);
        await client.addPeer(stored.public_key, stored.allowed_ips, iface || undefined);
        await supabase
          .from("linux_peers")
          .update({ disabled: false })
          .eq("router_id", meta.router_id)
          .eq("public_key", meta.peer_public_key);
      } else {
        const client = buildMikroTikClient(router);
        const rp = await findMikroTikPeerByPublicKey(client, meta.peer_public_key);
        if (!rp) continue;
        await client.enableWireGuardPeer(rp[".id"]);
      }
      await supabase
        .from("peer_metadata")
        .update({ scheduled_enable_at: null })
        .eq("router_id", meta.router_id)
        .eq("peer_public_key", meta.peer_public_key);
      enabled.push(meta.peer_name || meta.peer_public_key);
    } catch (err) {
      errors.push({
        peer: meta.peer_name || meta.peer_public_key,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  // --- auto-sanación: 'expired' con fecha futura --------------------------
  // Son los que el bug de los dos timers dejó muertos. 'disabled' NO entra acá:
  // ese estado lo puso un admin a propósito.
  const { data: revivable } = await supabase
    .from("tg_customer_peers")
    .select("*")
    .eq("status", "expired")
    .gt("expires_at", nowIso);

  for (const row of revivable || []) {
    const peer = row as TgCustomerPeer;
    try {
      await reactivateCustomerPeerOnServer(supabase, peer);
      await supabase.from("tg_customer_peers").update({ status: "active" }).eq("id", peer.id);
      reactivated.push(peer.peer_name);
    } catch (err) {
      errors.push({
        peer: peer.peer_name,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    checked_at: nowIso,
    disabled,
    enabled,
    reactivated,
    skipped_protected: protectedKeys.size,
    errors,
  });
}
