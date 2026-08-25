/**
 * Dokploy integration: registers a tenant's panel domain so it serves this app
 * with its own TLS certificate.
 *
 * Needs DOKPLOY_URL, DOKPLOY_TOKEN and DOKPLOY_APPLICATION_ID. Without them the
 * app keeps working and simply tells the tenant to ask an admin — the domain is
 * saved either way.
 */
const APP_PORT = 3000;

interface DokployDomain {
  domainId: string;
  host: string;
}

function config() {
  const url = process.env.DOKPLOY_URL;
  const token = process.env.DOKPLOY_TOKEN;
  const applicationId = process.env.DOKPLOY_APPLICATION_ID;
  if (!url || !token || !applicationId) return null;
  return { url: url.replace(/\/$/, ""), token, applicationId };
}

export function dokployConfigured(): boolean {
  return config() !== null;
}

async function call(path: string, init?: RequestInit) {
  const cfg = config();
  if (!cfg) throw new Error("Dokploy is not configured");
  const res = await fetch(`${cfg.url}/api/${path}`, {
    ...init,
    headers: { "x-api-key": cfg.token, "Content-Type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Dokploy ${path}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text.replace(/^﻿/, "")) : null;
}

export async function listPanelDomains(): Promise<DokployDomain[]> {
  const cfg = config();
  if (!cfg) return [];
  return (await call(`domain.byApplicationId?applicationId=${cfg.applicationId}`)) || [];
}

/**
 * Adds the domain to the panel app. Idempotent: an already-registered host is
 * reported as a success so saving the profile twice is harmless.
 */
export async function ensurePanelDomain(host: string): Promise<{ ok: boolean; message: string }> {
  const cfg = config();
  if (!cfg) return { ok: false, message: "Dokploy is not configured on this deployment" };

  try {
    const existing = await listPanelDomains();
    if (existing.some((d) => d.host?.toLowerCase() === host.toLowerCase())) {
      return { ok: true, message: "Already registered" };
    }

    await call("domain.create", {
      method: "POST",
      body: JSON.stringify({
        host,
        path: "/",
        port: APP_PORT,
        https: true,
        certificateType: "letsencrypt",
        domainType: "application",
        applicationId: cfg.applicationId,
      }),
    });
    return { ok: true, message: "Domain registered — the certificate is issued within a minute" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Dokploy call failed" };
  }
}

/** Removes a domain the tenant no longer uses. Never throws. */
export async function removePanelDomain(host: string): Promise<void> {
  try {
    const existing = await listPanelDomains();
    const match = existing.find((d) => d.host?.toLowerCase() === host.toLowerCase());
    if (!match) return;
    await call("domain.delete", { method: "POST", body: JSON.stringify({ domainId: match.domainId }) });
  } catch {
    // Leaving a stale domain registered is harmless
  }
}
