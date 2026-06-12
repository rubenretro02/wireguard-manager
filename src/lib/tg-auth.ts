import { NextResponse } from "next/server";
import { validateInitData } from "@/lib/telegram";
import { getServiceClient, type TgCustomer } from "@/lib/tg-store";

/**
 * Auth de la miniapp: cada request a /api/tg/* manda el initData crudo en el
 * header `x-tg-init-data`. Se valida el HMAC en cada request (stateless) y se
 * upserta el customer por telegram_id.
 */
export async function authenticateTgRequest(
  request: Request
): Promise<{ customer: TgCustomer } | { error: NextResponse }> {
  const initData = request.headers.get("x-tg-init-data");
  if (!initData) {
    return { error: NextResponse.json({ error: "Missing Telegram auth" }, { status: 401 }) };
  }

  let validated: ReturnType<typeof validateInitData>;
  try {
    validated = validateInitData(initData);
  } catch (err) {
    console.error("[TgAuth] validateInitData threw:", err instanceof Error ? err.message : err);
    return { error: NextResponse.json({ error: "Telegram auth not configured" }, { status: 500 }) };
  }
  if (!validated) {
    return { error: NextResponse.json({ error: "Invalid Telegram auth" }, { status: 401 }) };
  }

  const supabase = getServiceClient();
  const u = validated.user;
  const profileFields = {
    username: u.username || null,
    first_name: u.first_name || null,
    last_name: u.last_name || null,
    photo_url: u.photo_url || null,
    language_code: u.language_code || null,
    last_seen_at: new Date().toISOString(),
  };

  // No usamos upsert ciego: el customer_type inicial depende del bot por el
  // que entró (bot manager → agent), pero NUNCA se pisa en cuentas existentes.
  let customer: TgCustomer | null = null;
  const { data: existing } = await supabase
    .from("tg_customers")
    .select("*")
    .eq("telegram_id", u.id)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await supabase
      .from("tg_customers")
      .update(profileFields)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) console.error("[TgAuth] Failed to update customer:", error.message);
    customer = (updated || existing) as TgCustomer;
  } else {
    const { data: created, error } = await supabase
      .from("tg_customers")
      .insert({
        telegram_id: u.id,
        ...profileFields,
        customer_type: validated.bot === "agent" ? "agent" : "client",
      })
      .select()
      .single();
    if (error || !created) {
      console.error("[TgAuth] Failed to create customer:", error?.message);
      return { error: NextResponse.json({ error: "Failed to load account" }, { status: 500 }) };
    }
    customer = created as TgCustomer;
  }

  if (!customer) {
    return { error: NextResponse.json({ error: "Failed to load account" }, { status: 500 }) };
  }

  if (customer.is_banned) {
    return { error: NextResponse.json({ error: "Account is banned" }, { status: 403 }) };
  }

  return { customer: customer as TgCustomer };
}
