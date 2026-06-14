import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateInitData } from "@/lib/telegram";
import { getProfileByTelegramId, mintSession } from "@/lib/admin-tg-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login desde la Mini App de admin (/tg/admin). La página manda el initData
 * crudo en el header x-tg-init-data. Validamos el HMAC (token del bot agent),
 * buscamos el perfil vinculado por telegram_id y acuñamos la sesión (cookies).
 */
export async function POST(request: Request) {
  const initData = request.headers.get("x-tg-init-data");
  if (!initData) {
    return NextResponse.json({ error: "Missing Telegram auth" }, { status: 401 });
  }

  let validated: ReturnType<typeof validateInitData>;
  try {
    validated = validateInitData(initData);
  } catch (err) {
    console.error("[TgMiniAppLogin] validateInitData threw:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Telegram auth not configured" }, { status: 500 });
  }
  if (!validated) {
    return NextResponse.json({ error: "Invalid Telegram auth" }, { status: 401 });
  }

  const profile = await getProfileByTelegramId(validated.user.id);
  if (!profile) {
    return NextResponse.json(
      { error: "Your Telegram isn't linked to an account. Link it from Profile in the panel." },
      { status: 403 }
    );
  }

  const supabase = await createClient();
  const minted = await mintSession(supabase, profile.id);
  if (!minted.ok) {
    return NextResponse.json({ error: minted.reason }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
