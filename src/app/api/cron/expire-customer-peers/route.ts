import { NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";
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
    .select("*, tg_customers(telegram_id)")
    .eq("status", "active")
    .lt("expires_at", now.toISOString());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];

  for (const row of expiredPeers || []) {
    const peer = row as TgCustomerPeer & { tg_customers?: { telegram_id: number } | null };
    try {
      await deactivateCustomerPeer({ supabase, peer, status: "expired" });
      results.push({ id: peer.id, name: peer.peer_name, ok: true });
      if (peer.tg_customers?.telegram_id) {
        await sendTelegramMessage(
          peer.tg_customers.telegram_id,
          `⛔ Tu peer <b>${peer.peer_name}</b> expiró y fue desactivado.\n\nPuedes renovarlo desde la app para reactivarlo con la misma configuración.`
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
