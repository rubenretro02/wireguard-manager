import crypto from "crypto";

/**
 * Telegram Mini App helpers:
 *  - validateInitData(): verifica el HMAC de window.Telegram.WebApp.initData
 *    según https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *  - tgApi(): llamadas al Bot API (sendMessage, setWebhook, ...)
 */

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}

/** Hay dos bots: "store" (clientes que compran) y "agent" (peers gestionados, sin tienda). */
export type BotKind = "store" | "agent";

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  raw: URLSearchParams;
  /** Bot cuya firma validó el initData — define el tipo de cuenta al registrarse */
  bot: BotKind;
}

const MAX_INIT_DATA_AGE_SECONDS = 60 * 60 * 24; // 24h: la miniapp manda initData en cada request

export function getBotToken(bot: BotKind = "store"): string {
  const token = bot === "agent" ? process.env.TELEGRAM_AGENT_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(bot === "agent" ? "TELEGRAM_AGENT_BOT_TOKEN is not configured" : "TELEGRAM_BOT_TOKEN is not configured");
  }
  return token;
}

function validateWithToken(params: URLSearchParams, hash: string, token: string): boolean {
  // data_check_string: todos los campos menos hash, ordenados, key=value con \n
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Valida initData de la Mini App contra ambos bots (store y agent).
 * Devuelve el user + de qué bot vino, o null si la firma es inválida,
 * falta el user, o los datos son muy viejos.
 */
export function validateInitData(initData: string): ValidatedInitData | null {
  if (!initData) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  let bot: BotKind | null = null;
  if (validateWithToken(params, hash, getBotToken("store"))) {
    bot = "store";
  } else if (process.env.TELEGRAM_AGENT_BOT_TOKEN && validateWithToken(params, hash, getBotToken("agent"))) {
    bot = "agent";
  }
  if (!bot) return null;

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) return null;
  const authDate = new Date(Number.parseInt(authDateRaw, 10) * 1000);
  if (Number.isNaN(authDate.getTime())) return null;
  if (Date.now() - authDate.getTime() > MAX_INIT_DATA_AGE_SECONDS * 1000) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (!user?.id) return null;

  return { user, authDate, raw: params, bot };
}

/** Llamada genérica al Bot API. Lanza si Telegram devuelve ok=false. */
// biome-ignore lint/suspicious/noExplicitAny: payload shape varies per method
export async function tgApi<T = any>(method: string, payload: Record<string, unknown>, bot: BotKind = "store"): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${getBotToken(bot)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) {
    throw new Error(`Telegram API ${method} failed: ${json.description || res.status}`);
  }
  return json.result as T;
}

/** Mensaje simple a un chat (HTML parse mode). Nunca lanza: loguea y sigue. */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  extra: Record<string, unknown> = {},
  bot: BotKind = "store"
): Promise<void> {
  try {
    await tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra }, bot);
  } catch (err) {
    console.error("[Telegram] sendMessage failed:", err instanceof Error ? err.message : err);
  }
}

/** Responde a un callback_query (quita el "reloj" de carga del botón inline). */
export async function answerCallbackQuery(
  callbackQueryId: string,
  bot: BotKind = "store",
  text?: string
): Promise<void> {
  try {
    await tgApi(
      "answerCallbackQuery",
      { callback_query_id: callbackQueryId, ...(text ? { text } : {}) },
      bot
    );
  } catch (err) {
    console.error("[Telegram] answerCallbackQuery failed:", err instanceof Error ? err.message : err);
  }
}

/** Bot a usar para notificar a un customer según su tipo (agents usan el bot manager). */
export function botForCustomerType(customerType?: string | null): BotKind {
  return customerType === "agent" && process.env.TELEGRAM_AGENT_BOT_TOKEN ? "agent" : "store";
}

/** URL pública de la miniapp (botón web_app). */
export function getMiniAppUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return `${base.replace(/\/$/, "")}/tg`;
}

/** URL de la Mini App de login de admin (botón web_app del bot agent). */
export function getAdminMiniAppUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return `${base.replace(/\/$/, "")}/tg/admin`;
}

/**
 * Bot que se usa para el login de admins. Reusa el bot de agents
 * (@Wireguardvpnmanagerbot); si no está configurado, cae al store.
 */
export const ADMIN_BOT: BotKind = "agent";

let cachedAdminBotUsername: string | null = null;

/** Username del bot admin (vía getMe, cacheado) para armar deep links t.me. */
export async function getAdminBotUsername(): Promise<string> {
  if (cachedAdminBotUsername) return cachedAdminBotUsername;
  const me = await tgApi<{ username: string }>("getMe", {}, ADMIN_BOT);
  cachedAdminBotUsername = me.username;
  return me.username;
}

/**
 * Setea el botón de menú (Mini App) SOLO para un chat. Lo usamos para que, una
 * vez vinculado, el botón de menú del admin abra el panel en vez de la tienda.
 * No lanza: loguea y sigue (no debe romper el flujo del webhook).
 */
async function setChatMenuButtonWebApp(
  chatId: number | string,
  text: string,
  url: string,
  bot: BotKind = ADMIN_BOT
): Promise<void> {
  try {
    await tgApi(
      "setChatMenuButton",
      { chat_id: chatId, menu_button: { type: "web_app", text, web_app: { url } } },
      bot
    );
  } catch (err) {
    console.error("[Telegram] setChatMenuButton failed:", err instanceof Error ? err.message : err);
  }
}

/** Botón de menú del chat → Panel admin (Mini App /tg/admin). */
export async function setAdminMenuButton(chatId: number | string, bot: BotKind = ADMIN_BOT): Promise<void> {
  let url: string;
  try {
    url = getAdminMiniAppUrl();
  } catch {
    return;
  }
  await setChatMenuButtonWebApp(chatId, "Admin Panel", url, bot);
}

/** Botón de menú del chat → tienda/manager (Mini App /tg). Usado al desvincular. */
export async function setStoreMenuButton(chatId: number | string, bot: BotKind = ADMIN_BOT): Promise<void> {
  let url: string;
  try {
    url = getMiniAppUrl();
  } catch {
    return;
  }
  await setChatMenuButtonWebApp(chatId, "VPN Manager", url, bot);
}
