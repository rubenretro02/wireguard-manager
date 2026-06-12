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
  const { data: customer, error } = await supabase
    .from("tg_customers")
    .upsert(
      {
        telegram_id: u.id,
        username: u.username || null,
        first_name: u.first_name || null,
        last_name: u.last_name || null,
        photo_url: u.photo_url || null,
        language_code: u.language_code || null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "telegram_id" }
    )
    .select()
    .single();

  if (error || !customer) {
    console.error("[TgAuth] Failed to upsert customer:", error?.message);
    return { error: NextResponse.json({ error: "Failed to load account" }, { status: 500 }) };
  }

  if (customer.is_banned) {
    return { error: NextResponse.json({ error: "Account is banned" }, { status: 403 }) };
  }

  return { customer: customer as TgCustomer };
}
