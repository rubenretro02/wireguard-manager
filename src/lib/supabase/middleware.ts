import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SSO_COOKIE, SSO_SESSION_MAX_AGE_MS } from "@/lib/sso-session";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // Check if Supabase env vars are configured
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    // If env vars are not set, skip auth check and allow access
    // This is useful during development setup
    console.warn("[Middleware] Supabase env vars not configured, skipping auth");
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({
            request,
          });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Protected routes
  const protectedPaths = ["/dashboard", "/admin"];
  const isProtectedPath = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (isProtectedPath && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // SSO session cap: a Telegram /sso login is valid for a limited time. Past the
  // max age we sign the user out and send them back to /sso for a fresh login.
  if (isProtectedPath && user) {
    const stampedAt = Number(request.cookies.get(SSO_COOKIE)?.value);
    if (Number.isFinite(stampedAt) && Date.now() - stampedAt > SSO_SESSION_MAX_AGE_MS) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "error=sso_expired";
      const expired = NextResponse.redirect(url);
      // Clear the Supabase session cookies + the SSO stamp so they're logged out.
      for (const c of request.cookies.getAll()) {
        if (c.name.startsWith("sb-") || c.name === SSO_COOKIE) {
          expired.cookies.set(c.name, "", { maxAge: 0, path: "/" });
        }
      }
      return expired;
    }
  }

  // Redirect logged-in users from login page
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
