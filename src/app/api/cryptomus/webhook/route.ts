import { NextResponse } from "next/server";
import { isFailedStatus, isPaidStatus, verifyWebhookSign } from "@/lib/cryptomus";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  getServiceClient,
  provisionPeerForCustomer,
  renewCustomerPeer,
  type TgCustomer,
  type TgCustomerPeer,
  type TgPlan,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook de Cryptomus. Verifica la firma y, en paid/paid_over, hace el
 * fulfillment (crear peer o renovar) una sola vez (claim atómico via
 * fulfilled_at). Si el fulfillment falla devolvemos 500 para que Cryptomus
 * reintente.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const payload = verifyWebhookSign(rawBody);
  if (!payload) {
    console.warn("[CryptomusWebhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const supabase = getServiceClient();
  const { data: payment } = await supabase
    .from("tg_payments")
    .select("*")
    .eq("order_id", payload.order_id)
    .single();
  if (!payment) {
    console.warn("[CryptomusWebhook] Unknown order:", payload.order_id);
    return NextResponse.json({ error: "Unknown order" }, { status: 404 });
  }

  // Guardar siempre el último payload para auditoría
  await supabase.from("tg_payments").update({ raw: payload }).eq("id", payment.id);

  if (isFailedStatus(payload.status)) {
    if (payment.status === "pending") {
      await supabase
        .from("tg_payments")
        .update({ status: payload.status === "cancel" ? "cancelled" : "failed" })
        .eq("id", payment.id)
        .eq("status", "pending");
    }
    return NextResponse.json({ ok: true });
  }

  if (!isPaidStatus(payload.status)) {
    // process / confirm_check / etc: aún no cobrado
    return NextResponse.json({ ok: true });
  }

  // Claim atómico: solo un webhook hace el fulfillment
  const { data: claimed } = await supabase
    .from("tg_payments")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      fulfilled_at: new Date().toISOString(),
    })
    .eq("id", payment.id)
    .is("fulfilled_at", null)
    .select()
    .single();

  if (!claimed) {
    // Ya fue procesado por otro webhook
    return NextResponse.json({ ok: true, alreadyFulfilled: true });
  }

  const { data: customer } = await supabase
    .from("tg_customers")
    .select("*")
    .eq("id", payment.customer_id)
    .single();

  try {
    if (payment.type === "renewal" && payment.customer_peer_id) {
      const { data: peer } = await supabase
        .from("tg_customer_peers")
        .select("*")
        .eq("id", payment.customer_peer_id)
        .single();
      if (!peer) throw new Error("Peer missing for renewal");

      // Duración: plan del pago, o el renewal propio del peer (peers asignados)
      let durationDays: number | null = null;
      if (payment.plan_id) {
        const { data: plan } = await supabase
          .from("tg_plans")
          .select("duration_days")
          .eq("id", payment.plan_id)
          .single();
        durationDays = plan?.duration_days || null;
      }
      if (!durationDays) durationDays = (peer as TgCustomerPeer).renewal_duration_days || 30;

      const renewed = await renewCustomerPeer({
        supabase,
        peer: peer as TgCustomerPeer,
        durationDays,
      });

      if (customer) {
        await sendTelegramMessage(
          (customer as TgCustomer).telegram_id,
          `✅ <b>Renewal successful</b>\n\nYour peer <b>${renewed.peer_name}</b> was renewed until <b>${new Date(renewed.expires_at as string).toLocaleDateString("en-US")}</b>.`
        );
      }
    } else {
      const { data: plan } = await supabase
        .from("tg_plans")
        .select("*")
        .eq("id", payment.plan_id)
        .single();
      if (!plan || !customer) throw new Error("Plan or customer missing for purchase");

      const { peer } = await provisionPeerForCustomer({
        supabase,
        customer: customer as TgCustomer,
        plan: plan as TgPlan,
      });

      await supabase.from("tg_payments").update({ customer_peer_id: peer.id }).eq("id", payment.id);

      await sendTelegramMessage(
        (customer as TgCustomer).telegram_id,
        `✅ <b>Payment received</b>\n\nYour peer <b>${peer.peer_name}</b> is ready. Open the app to download your configuration.\n\nExpires: <b>${new Date(peer.expires_at as string).toLocaleDateString("en-US")}</b>`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[CryptomusWebhook] Fulfillment failed:", msg);
    // Liberar el claim para que el retry de Cryptomus pueda volver a intentar
    await supabase.from("tg_payments").update({ fulfilled_at: null }).eq("id", payment.id);
    return NextResponse.json({ error: "Fulfillment failed" }, { status: 500 });
  }
}
