import { NextResponse } from "next/server";
import { getMiniAppUrl, sendTelegramMessage, type BotKind } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook compartido por los dos bots:
 *   - store  → /api/telegram/webhook            (@blackgoatvpn_bot, clientes)
 *   - agent  → /api/telegram/webhook?bot=agent  (@Wireguardvpnmanagerbot, agents)
 * Responde a cualquier mensaje con el botón que abre la Mini App.
 * Registrar ambos con: node scripts/setup-telegram-webhook.mjs
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot: BotKind = new URL(request.url).searchParams.get("bot") === "agent" ? "agent" : "store";

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
    const greeting = `👋 Hi${firstName ? ` <b>${firstName}</b>` : ""}!`;
    const text =
      bot === "agent"
        ? `${greeting}\n\nFrom the app you can <b>manage your VPN peers</b>: check live status, see how much time is left, download your WireGuard config and rotate your keys.`
        : `${greeting}\n\nFrom the app you can <b>buy your VPN access</b>, check your peers' status, download your WireGuard config and renew your service paying with crypto.`;

    await sendTelegramMessage(
      chatId,
      text,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Open App", web_app: { url: appUrl } }]],
        },
      },
      bot
    );
  }

  // Telegram solo necesita un 200
  return NextResponse.json({ ok: true });
}
