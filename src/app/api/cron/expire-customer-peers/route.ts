import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity-logger";
import { botForCustomerType, sendTelegramMessage } from "@/lib/telegram";
import {
  deactivateCustomerPeer,
  getServiceClient,
  type TgCustomerPeer,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron: expira peers de clientes vencidos (los quita de WireGuard) y avisa
 * por Telegram. Protegido con CRON_SECRET (header Authorization: Bearer <secret>).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const now = new Date();

  const { data: expiredPeers, error } = await supabase
    .from("tg_customer_peers")
    .select("*, tg_customers(telegram_id, customer_type)")
    .eq("status", "active")
    .lt("expires_at", now.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

  for (const row of expiredPeers || []) {
    const peer = row as TgCustomerPeer & { tg_customers?: { telegram_id: number; customer_type?: string } | null };
    try {
      await deactivateCustomerPeer({ supabase, peer, status: "expired" });
      results.push({ id: peer.id, name: peer.peer_name, ok: true });
      // userId null = evento de sistema; la página de Logs lo muestra como "system"
      await logActivity({
        supabase,
        userId: null,
        routerId: peer.router_id,
        action: "disable",
        entityType: "peer",
        entityId: peer.peer_public_key,
        entityName: peer.peer_name,
        details: { auto: true, reason: "store subscription expired", source: "cron expire-customer-peers", expires_at: peer.expires_at },
      });
      if (peer.tg_customers?.telegram_id) {
        const isAgent = peer.tg_customers.customer_type === "agent";
        await sendTelegramMessage(
          peer.tg_customers.telegram_id,
          isAgent
            ? `⛔ Your peer <b>${peer.peer_name}</b> expired and was deactivated.\n\nContact support to extend it.`
            : `⛔ Your peer <b>${peer.peer_name}</b> expired and was deactivated.\n\nYou can renew it from the app to reactivate it with the same configuration.`,
          {},
          botForCustomerType(peer.tg_customers.customer_type)
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[ExpireCron] Failed to expire peer ${peer.id}:`, msg);
      results.push({ id: peer.id, name: peer.peer_name, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    checked_at: now.toISOString(),
    expired: results.length,
    results,
  });
}
