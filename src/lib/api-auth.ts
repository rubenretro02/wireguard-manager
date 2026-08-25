/**
 * API key authentication for the public API (v1).
 *
 * Keys are shown once and stored only as a SHA-256 hash. A key carries no
 * permissions of its own: the request runs with the owner's role and
 * capabilities, so nothing can be done over the API that the same user could
 * not do in the panel.
 */
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { UserCapabilities } from "@/lib/types";

const KEY_PREFIX = "wgm_live_";

export interface ApiCaller {
  userId: string;
  email: string;
  role: string;
  isAdmin: boolean;
  capabilities: UserCapabilities;
  keyId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any;
}

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = KEY_PREFIX + randomBytes(24).toString("base64url");
  return { key, hash: hashApiKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

export function apiError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: { message, code: code || String(status) } }, { status });
}

// Simple in-process limiter: this app runs as a single container, so a module
// map is enough to stop a runaway script without adding infrastructure.
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(keyId: string): boolean {
  const now = Date.now();
  const entry = hits.get(keyId);
  if (!entry || now > entry.resetAt) {
    hits.set(keyId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

/**
 * Resolves `Authorization: Bearer wgm_live_…` into the owning user. Returns an
 * error response instead of throwing so routes can `if (error) return error`.
 */
export async function authenticateApiKey(
  request: Request
): Promise<{ caller?: ApiCaller; error?: NextResponse }> {
  const header = request.headers.get("authorization") || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { error: apiError("Missing API key. Send: Authorization: Bearer wgm_live_…", 401, "no_key") };
  }

  const admin = createAdminClient();
  if (!admin) return { error: apiError("Service role not configured", 500) };

  const { data: key } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at, expires_at")
    .eq("key_hash", hashApiKey(token))
    .maybeSingle();

  if (!key) return { error: apiError("Invalid API key", 401, "invalid_key") };
  if (key.revoked_at) return { error: apiError("This API key was revoked", 401, "revoked") };
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { error: apiError("This API key expired", 401, "expired") };
  }
  if (rateLimited(key.id)) {
    return { error: apiError(`Rate limit exceeded (${RATE_LIMIT} requests/minute)`, 429, "rate_limited") };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, email, role, capabilities")
    .eq("id", key.user_id)
    .single();
  if (!profile) return { error: apiError("The user of this key no longer exists", 401, "no_user") };

  // Best-effort usage stamp; never block the request on it
  admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id).then(
    () => {},
    () => {}
  );

  return {
    caller: {
      userId: profile.id,
      email: profile.email,
      role: profile.role,
      isAdmin: profile.role?.toLowerCase() === "admin",
      capabilities: (profile.capabilities || {}) as UserCapabilities,
      keyId: key.id,
      admin,
    },
  };
}
