import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { issueToken, unlinkTelegram } from "@/lib/admin-tg-auth";
import { getAdminBotUsername } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: genera un token de vínculo (purpose='link') para el usuario logueado y
 * devuelve el deep link del bot admin para abrir y vincular su Telegram.
 * DELETE: desvincula el Telegram del usuario logueado.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token: string;
  let botUsername: string;
  try {
    token = await issueToken("link", user.id);
    botUsername = await getAdminBotUsername();
  } catch (err) {
    console.error("[Profile/Telegram] link issue failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Telegram no está configurado en el servidor." }, { status: 500 });
  }

  const deepLink = `https://t.me/${botUsername}?start=link_${token}`;
  return NextResponse.json({ deepLink, botUsername });
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await unlinkTelegram(user.id);
  } catch (err) {
    console.error("[Profile/Telegram] unlink failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo desvincular." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
