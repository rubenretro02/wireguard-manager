import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { authenticateTgRequest } from "@/lib/tg-auth";
import { createInvoice, isCryptomusConfigured } from "@/lib/cryptomus";
import {
  getServiceClient,
  provisionPeerForCustomer,
  renewCustomerPeer,
  type TgCustomerPeer,
  type TgPlan,
} from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Crea una orden de compra (peer nuevo) o renovación (peerId existente).
 * Planes con precio 0 se aprovisionan al instante sin pasar por Cryptomus.
 */
export async function POST(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;
  const customer = auth.customer;

  const body = await request.json().catch(() => ({}));
  const { planId, peerId } = body as { planId?: string; peerId?: string };
  if (!planId) return NextResponse.json({ error: "Missing planId" }, { status: 400 });

  const supabase = getServiceClient();
  const { data: plan } = await supabase
    .from("tg_plans")
    .select("*")
    .eq("id", planId)
    .eq("enabled", true)
    .single();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Renovación: el peer debe ser del customer y el plan del mismo server
  let peer: TgCustomerPeer | null = null;
  if (peerId) {
    const { data } = await supabase
      .from("tg_customer_peers")
      .select("*")
      .eq("id", peerId)
      .eq("customer_id", customer.id)
      .single();
    if (!data) return NextResponse.json({ error: "Peer not found" }, { status: 404 });
    if (data.router_id !== plan.router_id) {
      return NextResponse.json({ error: "Plan is for a different server" }, { status: 400 });
    }
    peer = data as TgCustomerPeer;
  }

  const type = peer ? "renewal" : "purchase";
  const price = Number(plan.price_usd);

  // Plan gratis (trial): fulfill inmediato
  if (price <= 0) {
    try {
      if (peer) {
        await renewCustomerPeer({ supabase, peer, durationDays: plan.duration_days });
      } else {
        await provisionPeerForCustomer({ supabase, customer, plan: plan as TgPlan });
      }
      return NextResponse.json({ free: true, fulfilled: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  if (!isCryptomusConfigured()) {
    return NextResponse.json({ error: "Payments are not configured yet" }, { status: 503 });
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (!appUrl) {
    return NextResponse.json({ error: "NEXT_PUBLIC_APP_URL is not configured" }, { status: 500 });
  }

  const orderId = `tg-${type}-${randomUUID()}`;

  // Registrar el pago pendiente antes de crear el invoice
  const { data: payment, error: paymentError } = await supabase
    .from("tg_payments")
    .insert({
      customer_id: customer.id,
      plan_id: plan.id,
      customer_peer_id: peer?.id || null,
      type,
      order_id: orderId,
      amount_usd: price,
      status: "pending",
    })
    .select()
    .single();
  if (paymentError || !payment) {
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }

  try {
    const invoice = await createInvoice({
      amountUsd: price,
      orderId,
      callbackUrl: `${appUrl}/api/cryptomus/webhook`,
      returnUrl: `${appUrl}/tg`,
      lifetimeSeconds: 3600,
    });

    await supabase
      .from("tg_payments")
      .update({ cryptomus_uuid: invoice.uuid, payment_url: invoice.url })
      .eq("id", payment.id);

    return NextResponse.json({
      paymentId: payment.id,
      paymentUrl: invoice.url,
      amountUsd: price,
    });
  } catch (err) {
    await supabase.from("tg_payments").update({ status: "failed" }).eq("id", payment.id);
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[TgCheckout] createInvoice failed:", msg);
    return NextResponse.json({ error: "Failed to create payment, try again" }, { status: 502 });
  }
}
