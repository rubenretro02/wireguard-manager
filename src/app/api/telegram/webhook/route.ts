import { NextResponse } from "next/server";
import {
  answerCallbackQuery,
  getAdminMiniAppUrl,
  getMiniAppUrl,
  sendTelegramMessage,
  setAdminMenuButton,
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
 *   - /sso, /single-sign-on, /admin → emite un link de un solo uso para el panel
 *   - botón inline "Single Sign On" (callback_data "sso") → mismo link
 * El login solo responde a perfiles ya vinculados.
 */
export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bot: BotKind = new URL(request.url).searchParams.get("bot") === "agent" ? "agent" : "store";

  const update = await request.json().catch(() => null);

  // ---- Botones inline (callback_query): "Single Sign On" ----
  const callback = update?.callback_query;
  if (callback) {
    await handleCallbackQuery(callback, bot);
    return NextResponse.json({ ok: true });
  }

  const message = update?.message;
  const chatId = message?.chat?.id;

  if (!chatId || message?.chat?.type !== "private") {
    return NextResponse.json({ ok: true });
  }

  const text: string = (message?.text || "").trim();
  const from = message?.from as TelegramUser | undefined;
  // Comando base sin args ni "@botname": /sso, /single-sign-on, /admin
  const command = text.split(/\s+/)[0].split("@")[0].toLowerCase();

  // ---- Login de admin (solo bot agent) ----
  if (bot === "agent" && from) {
    if (text.startsWith("/start link_")) {
      await handleLinkCommand(chatId, text.slice("/start link_".length), from, bot);
      return NextResponse.json({ ok: true });
    }
    if (command === "/sso" || command === "/single-sign-on" || command === "/admin") {
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
      "⚠️ This link expired or was already used. Generate a new one from <b>Profile</b> in the panel.",
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

  // El botón de menú de este chat ahora abre el panel admin (no la tienda).
  await setAdminMenuButton(chatId, bot);

  await sendTelegramMessage(
    chatId,
    "✅ <b>Account linked.</b>\n\nYour menu button now opens the <b>Admin Panel</b>. You can also use /sso (single sign-on) to get a browser login link.",
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
      "🔒 Your Telegram isn't linked to any panel account.\n\nSign in on the web → <b>Profile</b> → <b>Connect Telegram</b>.",
      {},
      bot
    );
    return;
  }

  // Idempotente: asegura que el botón de menú de admins ya vinculados abra el panel.
  await setAdminMenuButton(chatId, bot);

  let token: string;
  try {
    token = await issueToken("login", profile.id);
  } catch (err) {
    console.error("[TelegramWebhook] issue login token failed:", err instanceof Error ? err.message : err);
    await sendTelegramMessage(chatId, "⚠️ Couldn't generate the link. Please try again.", {}, bot);
    return;
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!base) {
    await sendTelegramMessage(chatId, "⚠️ Server is not configured (NEXT_PUBLIC_APP_URL).", {}, bot);
    return;
  }

  const loginUrl = `${base}/api/auth/tg-login?token=${token}`;
  await sendTelegramMessage(
    chatId,
    // La URL va también como texto: si el botón no abre, se puede tocar/copiar.
    `🔐 <b>Single sign-on</b>\n\nYour access link (valid for 5 minutes):\n\n${loginUrl}`,
    {
      // Sin la tarjeta de vista previa del enlace (el recuadro con el sitio).
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "🔐 Open panel →", url: loginUrl }]],
      },
    },
    bot
  );
}

/**
 * Botones de admin: panel embebido (web_app) + "Single Sign On" (callback que
 * genera un link de login nuevo, manejado en handleCallbackQuery).
 */
function adminButtons(): Array<Array<Record<string, unknown>>> {
  try {
    return [
      [{ text: "🖥 Admin Panel", web_app: { url: getAdminMiniAppUrl() } }],
      [{ text: "🔐 Single Sign On", callback_data: "sso" }],
    ];
  } catch {
    return [];
  }
}

/** Maneja los botones inline. "sso" → emite un link de login fresco. */
async function handleCallbackQuery(
  // biome-ignore lint/suspicious/noExplicitAny: Telegram update shape
  callback: any,
  bot: BotKind
): Promise<void> {
  await answerCallbackQuery(callback?.id, bot);
  const chatId = callback?.message?.chat?.id;
  const from = callback?.from as TelegramUser | undefined;
  if (!chatId || !from) return;
  if (bot === "agent" && callback?.data === "sso") {
    await handleAdminLogin(chatId, from, bot);
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

  // Si el usuario del bot agent es un admin vinculado, ofrecerle también el panel
  // y dejar su botón de menú apuntando al panel (no a la tienda).
  if (bot === "agent" && from && (await getProfileByTelegramId(from.id))) {
    keyboard.push(...adminButtons());
    await setAdminMenuButton(chatId, bot);
  }

  await sendTelegramMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } }, bot);
}
