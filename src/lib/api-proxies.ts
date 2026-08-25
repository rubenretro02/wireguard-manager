/** SOCKS5 helpers shared by the v1 proxy routes. */
import { Socks5ProxyClient } from "@/lib/socks5-proxy";
import type { Router } from "@/lib/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

export interface ProxyRow {
  id: string;
  router_id: string;
  username: string;
  password: string;
  public_ip: string;
  port: number;
  enabled: boolean;
  name: string | null;
  max_connections: number | null;
  expires_at: string | null;
  created_by: string | null;
  bytes_sent: number | null;
  bytes_received: number | null;
  last_connected_at: string | null;
}

export function buildSocksClient(router: Router) {
  return new Socks5ProxyClient({
    host: router.host,
    port: router.ssh_port || 22,
    username: router.username,
    password: router.password,
    privateKey: router.ssh_key || undefined,
    authMethod: (router.ssh_auth_method as "password" | "key" | "both") || "password",
  });
}

/** 3proxy keeps every proxy of a server in one config file, so it is rebuilt whole. */
export async function rebuildProxies(admin: AnyClient, router: Router) {
  const { data: all } = await admin
    .from("socks5_proxies")
    .select("*")
    .eq("router_id", router.id)
    .eq("enabled", true);

  return buildSocksClient(router).rebuildConfig(
    (all || []).map((p: ProxyRow) => ({
      username: p.username,
      password: p.password,
      publicIp: p.public_ip,
      port: 1080,
      enabled: true,
      maxConnections: p.max_connections || 0,
    }))
  );
}

export function toApiProxy(p: ProxyRow) {
  return {
    id: p.id,
    name: p.name,
    username: p.username,
    password: p.password,
    host: p.public_ip,
    port: p.port,
    enabled: p.enabled,
    maxConnections: p.max_connections || 0,
    expiresAt: p.expires_at,
    bytesSent: p.bytes_sent || 0,
    bytesReceived: p.bytes_received || 0,
    lastConnectedAt: p.last_connected_at,
  };
}
