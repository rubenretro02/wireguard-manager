import type { WireGuardInterface, WireGuardPeer } from "./types";
import { RouterOSClient } from "routeros-client";
import type { RosApiMenu } from "routeros-client";
import { generateKeyPair } from "./wireguard-keys";

export type ConnectionType = "rest" | "api";

interface MikroTikConfig {
  host: string;
  port: number;
  apiPort: number;
  username: string;
  password: string;
  useSsl: boolean;
  connectionType: ConnectionType;
}

// REST API Client (HTTPS port 443)
class MikroTikRestClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: { host: string; port: number; username: string; password: string; useSsl: boolean }) {
    const protocol = config.useSsl ? "https" : "http";
    this.baseUrl = `${protocol}://${config.host}:${config.port}/rest`;
    this.authHeader = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
    };
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`MikroTik REST API error: ${response.status} - ${errorText}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  async getWireGuardInterfaces(): Promise<WireGuardInterface[]> {
    return this.request<WireGuardInterface[]>("GET", "/interface/wireguard");
  }

  async createWireGuardInterface(data: Partial<WireGuardInterface>): Promise<WireGuardInterface> {
    return this.request<WireGuardInterface>("PUT", "/interface/wireguard", data as Record<string, unknown>);
  }

  async getWireGuardPeers(): Promise<WireGuardPeer[]> {
    return this.request<WireGuardPeer[]>("GET", "/interface/wireguard/peers");
  }

  async createWireGuardPeer(data: Partial<WireGuardPeer>): Promise<WireGuardPeer> {
    // Generate key pair if no private key provided
    const keyPair = generateKeyPair();
    const peerData = {
      ...data,
      "private-key": data["private-key"] || keyPair.privateKey,
    };
    const result = await this.request<WireGuardPeer>("PUT", "/interface/wireguard/peers", peerData as Record<string, unknown>);
    return {
      ...result,
      "private-key": peerData["private-key"],
    };
  }

  async updateWireGuardPeer(id: string, data: Partial<WireGuardPeer>): Promise<void> {
    await this.request<void>("PATCH", `/interface/wireguard/peers/${id}`, data as Record<string, unknown>);
  }

  async deleteWireGuardPeer(id: string): Promise<void> {
    await this.request<void>("DELETE", `/interface/wireguard/peers/${id}`);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request<unknown>("GET", "/system/resource");
      return true;
    } catch {
      return false;
    }
  }

  async executeCommand(path: string): Promise<Record<string, unknown>[]> {
    // Convert /ip/firewall/nat/print to /ip/firewall/nat
    const apiPath = path.replace(/\/print$/, "");
    return this.request<Record<string, unknown>[]>("GET", apiPath);
  }
}

// Classic API Client (port 8728/8729) - with connection reuse
class MikroTikClassicClient {
  private config: { host: string; port: number; username: string; password: string; useSsl: boolean };
  private client: RouterOSClient;
  private api: RosApiMenu | null = null;
  private connecting: boolean = false;
  private lastUsed: number = 0;

  constructor(config: { host: string; port: number; username: string; password: string; useSsl: boolean }) {
    this.config = config;
    this.client = new RouterOSClient({
      host: config.host,
      port: config.port,
      user: config.username,
      password: config.password,
      tls: config.useSsl ? {} : undefined,
      timeout: 30,
    });
  }

  private async ensureConnected(): Promise<RosApiMenu> {
    // If already connected and connection is recent, reuse it
    if (this.api && this.client.isConnected()) {
      this.lastUsed = Date.now();
      return this.api;
    }

    // If currently connecting, wait
    if (this.connecting) {
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.ensureConnected();
    }

    this.connecting = true;
    try {
      // Close existing connection if any
      if (this.client.isConnected()) {
        try {
          await this.client.close();
        } catch {
          // Ignore close errors
        }
      }

      console.log(`[MikroTik Classic] Connecting to ${this.config.host}:${this.config.port}...`);
      this.api = await this.client.connect();
      this.lastUsed = Date.now();
      console.log("[MikroTik Classic] Connected successfully");
      return this.api;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.isConnected()) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors
      }
    }
    this.api = null;
  }

  private transformResponse<T>(data: Record<string, unknown>[]): T[] {
    return data.map((item) => {
      const transformed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(item)) {
        if (key === "id") {
          transformed[".id"] = value;
        } else if (key === "publicKey") {
          transformed["public-key"] = value;
        } else if (key === "privateKey") {
          transformed["private-key"] = value;
        } else if (key === "listenPort") {
          transformed["listen-port"] = Number(value);
        } else if (key === "allowedAddress") {
          transformed["allowed-address"] = value;
        } else if (key === "endpointAddress") {
          transformed["endpoint-address"] = value;
        } else if (key === "endpointPort") {
          transformed["endpoint-port"] = Number(value);
        } else if (key === "currentEndpointAddress") {
          transformed["current-endpoint-address"] = value;
        } else if (key === "currentEndpointPort") {
          transformed["current-endpoint-port"] = Number(value);
        } else if (key === "persistentKeepalive") {
          transformed["persistent-keepalive"] = value;
        } else if (key === "lastHandshake") {
          transformed["last-handshake"] = value;
        } else if (key === "disabled" || key === "running") {
          transformed[key] = value === true || value === "true";
        } else {
          transformed[key] = value;
        }
      }
      return transformed as T;
    });
  }

  async getWireGuardInterfaces(): Promise<WireGuardInterface[]> {
    const api = await this.ensureConnected();
    const result = await api.menu("/interface/wireguard").getAll();
    return this.transformResponse<WireGuardInterface>(result as Record<string, unknown>[]);
  }

  async createWireGuardInterface(data: Partial<WireGuardInterface>): Promise<WireGuardInterface> {
    const api = await this.ensureConnected();
    const addData: Record<string, unknown> = { name: data.name };
    if (data["listen-port"]) addData["listen-port"] = data["listen-port"];
    const result = await api.menu("/interface/wireguard").add(addData);
    return result as unknown as WireGuardInterface;
  }

  async getWireGuardPeers(): Promise<WireGuardPeer[]> {
    const api = await this.ensureConnected();
    const result = await api.menu("/interface/wireguard/peers").getAll();
    return this.transformResponse<WireGuardPeer>(result as Record<string, unknown>[]);
  }

  async createWireGuardPeer(data: Partial<WireGuardPeer>): Promise<WireGuardPeer> {
    // Generate key pair BEFORE connecting
    const keyPair = generateKeyPair();

    const addData: Record<string, string | undefined> = {
      interface: data.interface,
      "allowed-address": data["allowed-address"],
      "private-key": data["private-key"] || keyPair.privateKey,
    };
    if (data.name) addData.name = data.name;
    if (data.comment) addData.comment = data.comment;

    const api = await this.ensureConnected();
    console.log("[MikroTik Classic] Adding peer...");
    const result = await api.menu("/interface/wireguard/peers").add(addData);
    console.log("[MikroTik Classic] Peer created");

    return {
      ...result as unknown as WireGuardPeer,
      "private-key": addData["private-key"],
      "public-key": keyPair.publicKey,
    };
  }

  async updateWireGuardPeer(id: string, data: Partial<WireGuardPeer> & { name?: string }): Promise<void> {
    const api = await this.ensureConnected();
    const updateData: Record<string, unknown> = {};
    if (data.disabled !== undefined) updateData.disabled = data.disabled ? "yes" : "no";
    if (data.comment !== undefined) updateData.comment = data.comment;
    if (data["allowed-address"] !== undefined) updateData["allowed-address"] = data["allowed-address"];
    if (data.name !== undefined) updateData.name = data.name;
    await api.menu("/interface/wireguard/peers").where({ ".id": id }).update(updateData);
  }

  async deleteWireGuardPeer(id: string): Promise<void> {
    const api = await this.ensureConnected();
    await api.menu("/interface/wireguard/peers").where({ ".id": id }).remove();
  }

  async enablePeer(id: string): Promise<void> {
    const api = await this.ensureConnected();
    await api.menu("/interface/wireguard/peers").enable(id);
  }

  async disablePeer(id: string): Promise<void> {
    const api = await this.ensureConnected();
    await api.menu("/interface/wireguard/peers").disable(id);
  }

  async testConnection(): Promise<boolean> {
    try {
      const api = await this.ensureConnected();
      await api.menu("/system/resource").getOne();
      return true;
    } catch (error) {
      const err = error as Error;
      console.error("[MikroTik Classic] Connection failed:", err.message);
      throw error;
    }
  }

  async executeCommand(path: string): Promise<Record<string, unknown>[]> {
    const api = await this.ensureConnected();
    // Convert /ip/firewall/nat/print to /ip/firewall/nat
    const menuPath = path.replace(/\/print$/, "");
    const result = await api.menu(menuPath).getAll();
    return result as Record<string, unknown>[];
  }
}

// Connection cache for reusing clients
const clientCache = new Map<string, MikroTikClassicClient>();

function getClientCacheKey(config: MikroTikConfig): string {
  return `${config.host}:${config.apiPort}:${config.username}`;
}

// Function to clear all cached connections
export async function clearClientCache(): Promise<void> {
  console.log("[MikroTik] Clearing all client cache...");
  const disconnectPromises: Promise<void>[] = [];
  for (const [key, client] of clientCache.entries()) {
    console.log(`[MikroTik] Disconnecting ${key}`);
    disconnectPromises.push(
      client.disconnect().catch(() => {
        // Ignore disconnect errors
      })
    );
  }
  await Promise.all(disconnectPromises);
  clientCache.clear();
  console.log("[MikroTik] All client cache cleared");
}

// Function to clear a specific cached connection
export async function clearClientCacheForRouter(host: string, apiPort: number, username: string): Promise<void> {
  const cacheKey = `${host}:${apiPort}:${username}`;
  const client = clientCache.get(cacheKey);
  if (client) {
    console.log(`[MikroTik] Disconnecting and clearing cache for ${cacheKey}`);
    try {
      await client.disconnect();
    } catch (err) {
      console.log(`[MikroTik] Disconnect error (ignored): ${err}`);
    }
    clientCache.delete(cacheKey);
    console.log(`[MikroTik] Cache cleared for ${cacheKey}`);
  } else {
    console.log(`[MikroTik] No cached client found for ${cacheKey}`);
  }
}

// Unified client that supports both connection types
export class MikroTikClient {
  private restClient: MikroTikRestClient | null = null;
  private classicClient: MikroTikClassicClient | null = null;

  constructor(config: MikroTikConfig) {
    if (config.connectionType === "rest") {
      this.restClient = new MikroTikRestClient({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        useSsl: config.useSsl,
      });
    } else {
      // Reuse cached client if available
      const cacheKey = getClientCacheKey(config);
      let cachedClient = clientCache.get(cacheKey);

      if (!cachedClient) {
        cachedClient = new MikroTikClassicClient({
          host: config.host,
          port: config.apiPort,
          username: config.username,
          password: config.password,
          useSsl: false,
        });
        clientCache.set(cacheKey, cachedClient);
      }

      this.classicClient = cachedClient;
    }
  }

  async getWireGuardInterfaces(): Promise<WireGuardInterface[]> {
    if (this.restClient) return this.restClient.getWireGuardInterfaces();
    if (this.classicClient) return this.classicClient.getWireGuardInterfaces();
    throw new Error("No client configured");
  }

  async createWireGuardInterface(data: Partial<WireGuardInterface>): Promise<WireGuardInterface> {
    if (this.restClient) return this.restClient.createWireGuardInterface(data);
    if (this.classicClient) return this.classicClient.createWireGuardInterface(data);
    throw new Error("No client configured");
  }

  async getWireGuardPeers(): Promise<WireGuardPeer[]> {
    if (this.restClient) return this.restClient.getWireGuardPeers();
    if (this.classicClient) return this.classicClient.getWireGuardPeers();
    throw new Error("No client configured");
  }

  async createWireGuardPeer(data: Partial<WireGuardPeer>): Promise<WireGuardPeer> {
    if (this.restClient) return this.restClient.createWireGuardPeer(data);
    if (this.classicClient) return this.classicClient.createWireGuardPeer(data);
    throw new Error("No client configured");
  }

  async updateWireGuardPeer(id: string, data: Partial<WireGuardPeer>): Promise<void> {
    if (this.restClient) return this.restClient.updateWireGuardPeer(id, data);
    if (this.classicClient) return this.classicClient.updateWireGuardPeer(id, data);
    throw new Error("No client configured");
  }

  async deleteWireGuardPeer(id: string): Promise<void> {
    if (this.restClient) return this.restClient.deleteWireGuardPeer(id);
    if (this.classicClient) return this.classicClient.deleteWireGuardPeer(id);
    throw new Error("No client configured");
  }

  async enableWireGuardPeer(id: string): Promise<void> {
    if (this.restClient) {
      await this.restClient.updateWireGuardPeer(id, { disabled: false });
    } else if (this.classicClient) {
      await this.classicClient.enablePeer(id);
    } else {
      throw new Error("No client configured");
    }
  }

  async disableWireGuardPeer(id: string): Promise<void> {
    if (this.restClient) {
      await this.restClient.updateWireGuardPeer(id, { disabled: true });
    } else if (this.classicClient) {
      await this.classicClient.disablePeer(id);
    } else {
      throw new Error("No client configured");
    }
  }

  async testConnection(): Promise<boolean> {
    if (this.restClient) return this.restClient.testConnection();
    if (this.classicClient) return this.classicClient.testConnection();
    return false;
  }

  async executeCommand(path: string): Promise<Record<string, unknown>[]> {
    if (this.restClient) return this.restClient.executeCommand(path);
    if (this.classicClient) return this.classicClient.executeCommand(path);
    throw new Error("No client configured");
  }
}

// Demo data for testing
export const DEMO_INTERFACES: WireGuardInterface[] = [
  {
    ".id": "*1",
    name: "wg0",
    "public-key": "dGVzdC1wdWJsaWMta2V5LWZvci1kZW1vLXB1cnBvc2Vz",
    "listen-port": 51820,
    disabled: false,
    running: true,
  },
];

export const DEMO_PEERS: WireGuardPeer[] = [
  {
    ".id": "*1",
    interface: "wg0",
    "public-key": "Y2xpZW50LTEtcHVibGljLWtleS1mb3ItZGVtbw==",
    "allowed-address": "10.0.0.2/32",
    comment: "Client 1 - Demo",
    disabled: false,
    rx: 1024000,
    tx: 512000,
  },
  {
    ".id": "*2",
    interface: "wg0",
    "public-key": "Y2xpZW50LTItcHVibGljLWtleS1mb3ItZGVtbw==",
    "allowed-address": "10.0.0.3/32",
    comment: "Client 2 - Demo",
    disabled: true,
    rx: 0,
    tx: 0,
  },
];
