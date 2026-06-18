// SSO session cap. A Telegram single-sign-on login (the /sso browser link and
// the embedded admin panel) is valid for this long; afterwards the middleware
// forces a fresh /sso login. Kept dependency-free so it's safe to import from
// both the edge middleware and the Node route handlers.

/** Cookie that stamps when the SSO session was minted (epoch ms). */
export const SSO_COOKIE = "tg_sso_at";

/** How long an SSO session stays valid before a re-login is required. */
export const SSO_SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
