import { NextResponse } from "next/server";
import { getMiniAppUrl, sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook del bot. Solo maneja /start (y cualquier otro mensaje) respondiendo
 * con el botón que abre la Mini App. Registrarlo con:
 *   node scripts/setup-telegram-webhook.mjs
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  const message = update?.message;
  const chatId = message?.chat?.id;

  if (chatId && message?.chat?.type === "private") {
    let appUrl: string;
    try {
      appUrl = getMiniAppUrl();
    } catch {
      console.error("[TelegramWebhook] NEXT_PUBLIC_APP_URL missing");
      return NextResponse.json({ ok: true });
    }

    const firstName = message?.from?.first_name || "";
    await sendTelegramMessage(
      chatId,
      `👋 Hola${firstName ? ` <b>${firstName}</b>` : ""}!\n\nDesde la app puedes <b>comprar tu acceso VPN</b>, ver el estado de tus peers, descargar tu configuración WireGuard y renovar tu servicio pagando con cripto.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Abrir App", web_app: { url: appUrl } }]],
        },
      }
    );
  }

  // Telegram solo necesita un 200
  return NextResponse.json({ ok: true });
}
