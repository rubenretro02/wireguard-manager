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

export interface ValidatedInitData {
  user: TelegramUser;
  authDate: Date;
  raw: URLSearchParams;
}

const MAX_INIT_DATA_AGE_SECONDS = 60 * 60 * 24; // 24h: la miniapp manda initData en cada request

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

/**
 * Valida initData de la Mini App. Devuelve el user o null si la firma es
 * inválida, falta el user, o los datos son muy viejos.
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

  // data_check_string: todos los campos menos hash, ordenados, key=value con \n
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(getBotToken()).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const a = Buffer.from(computedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

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

  return { user, authDate, raw: params };
}

/** Llamada genérica al Bot API. Lanza si Telegram devuelve ok=false. */
// biome-ignore lint/suspicious/noExplicitAny: payload shape varies per method
export async function tgApi<T = any>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
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
  extra: Record<string, unknown> = {}
): Promise<void> {
  try {
    await tgApi("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  } catch (err) {
    console.error("[Telegram] sendMessage failed:", err instanceof Error ? err.message : err);
  }
}

/** URL pública de la miniapp (botón web_app). */
export function getMiniAppUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not configured");
  return `${base.replace(/\/$/, "")}/tg`;
}
