import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { consumeToken, mintSession } from "@/lib/admin-tg-auth";
import { SSO_COOKIE } from "@/lib/sso-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Login por link de un solo uso (lo emite el bot al recibir /admin).
 * Valida el token, acuña la sesión de Supabase (setea cookies) y redirige al
 * panel. Abre en el navegador real del sistema, ya logueado.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const token = searchParams.get("token") || "";

  const claimed = await consumeToken(token, "login");
  if (!claimed) {
    return NextResponse.redirect(`${origin}/login?error=tg_link_expired`);
  }

  const supabase = await createClient();
  const minted = await mintSession(supabase, claimed.user_id);
  if (!minted.ok) {
    return NextResponse.redirect(`${origin}/login?error=tg_login_failed`);
  }

  // Stamp the SSO login time so the middleware can force a re-login after the
  // max age (see lib/sso-session.ts).
  const res = NextResponse.redirect(`${origin}/dashboard`);
  res.cookies.set(SSO_COOKIE, String(Date.now()), {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
  });
  return res;
}
