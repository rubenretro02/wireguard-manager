import { NextResponse } from "next/server";
import { authenticateTgRequest } from "@/lib/tg-auth";
import { getServiceClient } from "@/lib/tg-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Planes disponibles para comprar (solo enabled). */
export async function GET(request: Request) {
  const auth = await authenticateTgRequest(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  const { data: plans, error } = await supabase
    .from("tg_plans")
    .select("id, name, description, price_usd, duration_days, router_id, sort_order")
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .order("price_usd", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Failed to load plans" }, { status: 500 });
  }
  return NextResponse.json({ plans: plans || [] });
}
