import { NextResponse } from "next/server";
import {
  getAdminMiniAppUrl,
  getMiniAppUrl,
  sendTelegramMessage,
  type BotKind,
  type TelegramUser,
} from "@/lib/telegram";
import {
  consumeToken,
  getProfileByTelegramId,
  issueToken,
  linkTelegramToProfile,
} from "@/lib/admin-tg-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook compartido por los dos bots:
 *   - store  → /api/telegram/webhook            (@blackgoatvpn_bot, clientes)
 *   - agent  → /api/telegram/webhook?bot=agent  (@Wireguardvpnmanagerbot, agents + admins)
 *
 * El bot agent además maneja el login de admins al panel:
 *   - /start link_<token>  → vincula el Telegram al perfil que generó el token
 *   - /admin               → emite un link de un solo uso para entrar al panel
 * El comando /admin solo responde a perfiles ya vinculados.
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

  if (!chatId || message?.chat?.type !== "private") {
    return NextResponse.json({ ok: true });
  }

  const text: string = (message?.text || "").trim();
  const from = message?.from as TelegramUser | undefined;

  // ---- Login de admin (solo bot agent) ----
  if (bot === "agent" && from) {
    if (text.startsWith("/start link_")) {
      await handleLinkCommand(chatId, text.slice("/start link_".length), from, bot);
      return NextResponse.json({ ok: true });
    }
    if (text === "/admin" || text.startsWith("/admin")) {
      await handleAdminLogin(chatId, from, bot);
      return NextResponse.json({ ok: true });
    }
  }

  // ---- Comportamiento por defecto: abrir la Mini App ----
  await sendDefaultWelcome(chatId, from, bot);
  return NextResponse.json({ ok: true });
}

/** Vincula el Telegram al perfil dueño del token de vínculo. */
async function handleLinkCommand(
  chatId: number,
  token: string,
  from: TelegramUser,
  bot: BotKind
): Promise<void> {
  const claimed = await consumeToken(token, "link");
  if (!claimed) {
    await sendTelegramMessage(
      chatId,
      "⚠️ Ese enlace de vinculación expiró o ya se usó. Generá uno nuevo desde <b>Perfil</b> en el panel.",
      {},
      bot
    );
    return;
  }

  const linked = await linkTelegramToProfile(claimed.user_id, from);
  if (!linked.ok) {
    await sendTelegramMessage(chatId, `⚠️ ${linked.reason}`, {}, bot);
    return;
  }

  await sendTelegramMessage(
    chatId,
    "✅ <b>Cuenta vinculada.</b>\n\nYa podés entrar al panel desde acá: usá /admin para un enlace de acceso o abrí el panel embebido.",
    { reply_markup: { inline_keyboard: adminButtons() } },
    bot
  );
}

/** Emite un link de un solo uso para entrar al panel (solo perfiles vinculados). */
async function handleAdminLogin(chatId: number, from: TelegramUser, bot: BotKind): Promise<void> {
  const profile = await getProfileByTelegramId(from.id);
  if (!profile) {
    await sendTelegramMessage(
      chatId,
      "🔒 Tu Telegram no está vinculado a ninguna cuenta del panel.\n\nIniciá sesión en el panel desde la web → <b>Perfil</b> → <b>Conectar Telegram</b>.",
      {},
      bot
    );
    return;
  }

  let token: string;
  try {
    token = await issueToken("login", profile.id);
  } catch (err) {
    console.error("[TelegramWebhook] issue login token failed:", err instanceof Error ? err.message : err);
    await sendTelegramMessage(chatId, "⚠️ No se pudo generar el enlace. Probá de nuevo.", {}, bot);
    return;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) {
    await sendTelegramMessage(chatId, "⚠️ El servidor no está configurado (NEXT_PUBLIC_APP_URL).", {}, bot);
    return;
  }

  await sendTelegramMessage(
    chatId,
    "🔐 Tu enlace de acceso (válido por 60 segundos):",
    {
      reply_markup: {
        inline_keyboard: [[{ text: "🔐 Abrir panel →", url: `${base}/api/auth/tg-login?token=${token}` }]],
      },
    },
    bot
  );
}

/** Botones de admin: panel embebido (web_app). El link de acceso va por /admin. */
function adminButtons(): Array<Array<Record<string, unknown>>> {
  try {
    return [[{ text: "🖥 Panel admin", web_app: { url: getAdminMiniAppUrl() } }]];
  } catch {
    return [];
  }
}

/** Mensaje por defecto con el botón que abre la Mini App correspondiente. */
async function sendDefaultWelcome(
  chatId: number,
  from: TelegramUser | undefined,
  bot: BotKind
): Promise<void> {
  let appUrl: string;
  try {
    appUrl = getMiniAppUrl();
  } catch {
    console.error("[TelegramWebhook] NEXT_PUBLIC_APP_URL missing");
    return;
  }

  const firstName = from?.first_name || "";
  const greeting = `👋 Hi${firstName ? ` <b>${firstName}</b>` : ""}!`;
  const text =
    bot === "agent"
      ? `${greeting}\n\nFrom the app you can <b>manage your VPN peers</b>: check live status, see how much time is left, download your WireGuard config and rotate your keys.`
      : `${greeting}\n\nFrom the app you can <b>buy your VPN access</b>, check your peers' status, download your WireGuard config and renew your service paying with crypto.`;

  const keyboard: Array<Array<Record<string, unknown>>> = [
    [{ text: "🚀 Open App", web_app: { url: appUrl } }],
  ];

  // Si el usuario del bot agent es un admin vinculado, ofrecerle también el panel.
  if (bot === "agent" && from && (await getProfileByTelegramId(from.id))) {
    keyboard.push(...adminButtons());
  }

  await sendTelegramMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } }, bot);
}
