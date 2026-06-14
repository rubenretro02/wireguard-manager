import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/tg-store";
import type { TelegramUser } from "@/lib/telegram";

/**
 * Puente Telegram -> sesión de admin (Supabase Auth).
 *
 * Dos sistemas de auth conviven en la app: el panel usa Supabase Auth
 * (cookies + tabla `profiles`) y la Mini App `/tg` usa initData + `tg_customers`.
 * Estos helpers permiten que un admin/semi-admin (un `profiles`) vincule su
 * Telegram y luego inicie sesión en el panel desde el bot, acuñando una sesión
 * de Supabase a partir de su identidad de Telegram verificada.
 *
 * Todo corre server-side con el SERVICE ROLE (bypass RLS).
 */

export type TokenPurpose = "link" | "login";

export interface AdminTgToken {
  id: string;
  token: string;
  purpose: TokenPurpose;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface LinkedProfile {
  id: string;
  email: string;
  role: "admin" | "user";
  username: string | null;
  telegram_id: number | null;
  telegram_username: string | null;
}

const LINK_TOKEN_TTL_SECONDS = 10 * 60; // 10 min para escanear/abrir el deep link
const LOGIN_TOKEN_TTL_SECONDS = 60; // 60s: token fresco por cada /admin

/** Token URL-safe aleatorio (no adivinable). */
function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Crea un token de un solo uso para `userId`. Devuelve el token crudo. */
export async function issueToken(
  purpose: TokenPurpose,
  userId: string,
  supabase: SupabaseClient = getServiceClient()
): Promise<string> {
  const ttl = purpose === "link" ? LINK_TOKEN_TTL_SECONDS : LOGIN_TOKEN_TTL_SECONDS;
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const { error } = await supabase
    .from("admin_tg_tokens")
    .insert({ token, purpose, user_id: userId, expires_at: expiresAt });
  if (error) throw new Error(`issueToken failed: ${error.message}`);
  return token;
}

/**
 * Reclama un token (atómico: marca used_at en el mismo UPDATE filtrando por
 * used_at IS NULL y expires_at futuro). Devuelve la fila si el claim funcionó,
 * o null si el token no existe / ya se usó / expiró / purpose no coincide.
 */
export async function consumeToken(
  token: string,
  purpose: TokenPurpose,
  supabase: SupabaseClient = getServiceClient()
): Promise<AdminTgToken | null> {
  if (!token) return null;
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("admin_tg_tokens")
    .update({ used_at: nowIso })
    .eq("token", token)
    .eq("purpose", purpose)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select()
    .maybeSingle();
  if (error) {
    console.error("[AdminTgAuth] consumeToken error:", error.message);
    return null;
  }
  return (data as AdminTgToken) || null;
}

/** Perfil vinculado a un telegram_id, o null. */
export async function getProfileByTelegramId(
  telegramId: number,
  supabase: SupabaseClient = getServiceClient()
): Promise<LinkedProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, role, username, telegram_id, telegram_username")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return (data as LinkedProfile) || null;
}

/**
 * Vincula un telegram_id a un perfil. Falla si ese telegram_id ya pertenece a
 * OTRO perfil (UNIQUE). Devuelve { ok } o un error legible para el usuario.
 */
export async function linkTelegramToProfile(
  userId: string,
  tgUser: TelegramUser,
  supabase: SupabaseClient = getServiceClient()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // ¿Ese Telegram ya está vinculado a otro perfil?
  const existing = await getProfileByTelegramId(tgUser.id, supabase);
  if (existing && existing.id !== userId) {
    return { ok: false, reason: "Ese Telegram ya está vinculado a otra cuenta." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      telegram_id: tgUser.id,
      telegram_username: tgUser.username || null,
      telegram_linked_at: new Date().toISOString(),
    })
    .eq("id", userId);
  if (error) {
    console.error("[AdminTgAuth] linkTelegramToProfile error:", error.message);
    return { ok: false, reason: "No se pudo vincular la cuenta." };
  }
  return { ok: true };
}

/**
 * Quita el vínculo de Telegram de un perfil. Devuelve el telegram_id que tenía
 * (o null) para poder restaurar su botón de menú a la tienda.
 */
export async function unlinkTelegram(
  userId: string,
  supabase: SupabaseClient = getServiceClient()
): Promise<number | null> {
  const { data: prev } = await supabase
    .from("profiles")
    .select("telegram_id")
    .eq("id", userId)
    .maybeSingle();

  await supabase
    .from("profiles")
    .update({ telegram_id: null, telegram_username: null, telegram_linked_at: null })
    .eq("id", userId);

  return (prev?.telegram_id as number | null) ?? null;
}

/**
 * Acuña una sesión de Supabase para `userId` escribiendo las cookies en
 * `cookieClient` (el server client de la request). Usa el service role para
 * generar un magic-link y luego verifica el token_hash en el cookie client,
 * que es lo que setea las cookies de sesión (mismo mecanismo cookie-writing
 * que exchangeCodeForSession en /api/auth/callback).
 *
 * Devuelve { ok } o un error.
 */
export async function mintSession(
  cookieClient: SupabaseClient,
  userId: string,
  service: SupabaseClient = getServiceClient()
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Email del usuario (auth.users) vía admin API.
  const { data: userRes, error: getUserErr } = await service.auth.admin.getUserById(userId);
  const email = userRes?.user?.email;
  if (getUserErr || !email) {
    console.error("[AdminTgAuth] getUserById failed:", getUserErr?.message);
    return { ok: false, reason: "No se encontró el usuario." };
  }

  // Generar un magic link (no se envía email: solo queremos el token_hash).
  const { data: linkData, error: linkErr } = await service.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error("[AdminTgAuth] generateLink failed:", linkErr?.message);
    return { ok: false, reason: "No se pudo iniciar sesión." };
  }

  // Verificar el token_hash en el cookie client -> setea las cookies de sesión.
  const { error: verifyErr } = await cookieClient.auth.verifyOtp({
    type: "email",
    token_hash: tokenHash,
  });
  if (verifyErr) {
    console.error("[AdminTgAuth] verifyOtp failed:", verifyErr.message);
    return { ok: false, reason: "No se pudo iniciar sesión." };
  }

  return { ok: true };
}
