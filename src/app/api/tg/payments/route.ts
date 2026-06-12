import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";
import { getServiceClient } from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tg/payments         → últimos pagos del customer
 * GET /api/tg/payments?id=...  → un pago puntual (polling post-checkout)
 */
export async function GET(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const baseSelect = "id, type, amount_usd, status, payment_url, paid_at, fulfilled_at, created_at, plan_id, customer_peer_id";

  if (id) {
    const { data: payment } = await supabase
      .from("tg_payments")
      .select(baseSelect)
      .eq("id", id)
      .eq("customer_id", auth.customer.id)
      .single();
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    return NextResponse.json({ payment });
  }

  const { data: payments, error } = await supabase
    .from("tg_payments")
    .select(baseSelect)
    .eq("customer_id", auth.customer.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: "Failed to load payments" }, { status: 500 });
  return NextResponse.json({ payments: payments || [] });
}
