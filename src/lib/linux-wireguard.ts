import { Client } from "ssh2";
import type { AuthMethod } from "./types";

export interface LinuxWireGuardConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  authMethod: AuthMethod;
  wgInterface?: string;
  outInterface?: string;
  publicIpPrefix?: string;
  internalPrefix?: string;
}

export interface LinuxPeer {
  publicKey: string;
  allowedIps: string;
  endpoint?: string;
  latestHandshake?: string;
  transfer?: { rx: number; tx: number };
}

export interface LinuxNatRule {
  num: number;
  source: string;
  destination: string;
  target: string;
  packets?: number;
  bytes?: number;
}

export interface LinuxNatTraffic {
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  bytes: number;
  packets: number;
}

// ============================================
// SSH CONNECTION POOL - Reutiliza conexiones
// ============================================

interface PooledConnection {
  client: Client;
  host: string;
  port: number;
  username: string;
  lastUsed: number;
  isConnected: boolean;
  isConnecting: boolean;
  connectPromise?: Promise<Client>;
}

class SSHConnectionPool {
  private static instance: SSHConnectionPool;
  private connections: Map<string, PooledConnection> = new Map();
  private readonly MAX_IDLE_TIME = 60000; // 60 seconds
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    // Cleanup idle connections every 30 seconds
    this.cleanupInterval = setInterval(() => this.cleanupIdleConnections(), 30000);
  }

  static getInstance(): SSHConnectionPool {
    if (!SSHConnectionPool.instance) {
      SSHConnectionPool.instance = new SSHConnectionPool();
    }
    return SSHConnectionPool.instance;
  }

  private getConnectionKey(host: string, port: number, username: string): string {
    return `${username}@${host}:${port}`;
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    for (const [key, conn] of this.connections.entries()) {
      if (conn.isConnected && now - conn.lastUsed > this.MAX_IDLE_TIME) {
        console.log(`[SSHPool] Closing idle connection: ${key}`);
        conn.client.end();
        conn.isConnected = false;
        this.connections.delete(key);
      }
    }
  }

  async getConnection(config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    authMethod: AuthMethod;
  }): Promise<Client> {
    const key = this.getConnectionKey(config.host, config.port, config.username);
    let pooledConn = this.connections.get(key);

    // If we have a valid connected client, reuse it
    if (pooledConn?.isConnected && pooledConn.client) {
      pooledConn.lastUsed = Date.now();
      return pooledConn.client;
    }

    // If already connecting, wait for it
    if (pooledConn?.isConnecting && pooledConn.connectPromise) {
      return pooledConn.connectPromise;
    }

    // Create new connection
    const client = new Client();
    pooledConn = {
      client,
      host: config.host,
      port: config.port,
      username: config.username,
      lastUsed: Date.now(),
      isConnected: false,
      isConnecting: true,
    };

    const connectPromise = new Promise<Client>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        pooledConn!.isConnecting = false;
        this.connections.delete(key);
        reject(new Error(`Connection timeout to ${config.host}:${config.port}`));
      }, 15000);

      client.on("ready", () => {
        clearTimeout(timeout);
        pooledConn!.isConnected = true;
        pooledConn!.isConnecting = false;
        pooledConn!.lastUsed = Date.now();
        console.log(`[SSHPool] Connected: ${key}`);
        resolve(client);
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        pooledConn!.isConnected = false;
        pooledConn!.isConnecting = false;
        this.connections.delete(key);
        console.error(`[SSHPool] Connection error for ${key}:`, err.message);
        reject(err);
      });

      client.on("close", () => {
        pooledConn!.isConnected = false;
        pooledConn!.isConnecting = false;
        this.connections.delete(key);
        console.log(`[SSHPool] Connection closed: ${key}`);
      });

      const connectionConfig: Record<string, unknown> = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 12000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      if (config.authMethod === "key" && config.privateKey) {
        connectionConfig.privateKey = config.privateKey;
      } else if (config.authMethod === "password" && config.password) {
        connectionConfig.password = config.password;
      } else if (config.authMethod === "both") {
        if (config.privateKey) connectionConfig.privateKey = config.privateKey;
        if (config.password) connectionConfig.password = config.password;
      }

      client.connect(connectionConfig);
    });

    pooledConn.connectPromise = connectPromise;
    this.connections.set(key, pooledConn);

    return connectPromise;
  }

  closeAll() {
    for (const [key, conn] of this.connections.entries()) {
      if (conn.isConnected) {
        conn.client.end();
        console.log(`[SSHPool] Closed: ${key}`);
      }
    }
    this.connections.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Global pool instance
const sshPool = SSHConnectionPool.getInstance();

// ============================================
// LINUX WIREGUARD CLIENT
// ============================================

export class LinuxWireGuardClient {
  private config: LinuxWireGuardConfig;

  constructor(config: LinuxWireGuardConfig) {
    this.config = {
      port: 22,
      wgInterface: "wg1",
      outInterface: "ens192",
      ...config,
    };
  }

  /**
   * Execute a command via SSH using connection pool
   */
  private async executeCommand(command: string): Promise<string> {
    const client = await sshPool.getConnection({
      host: this.config.host,
      port: this.config.port!,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey,
      authMethod: this.config.authMethod,
    });

    // Use sudo -S to pass password via stdin (works without NOPASSWD config)
    const sudoPassword = this.config.password || "";
    const sudoCommand = `echo '${sudoPassword}' | sudo -S ${command}`;

    return new Promise((resolve, reject) => {
      client.exec(sudoCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let output = "";
        let errorOutput = "";

        stream.on("close", (code: number) => {
          if (code === 0) {
            resolve(output.trim());
          } else {
            reject(new Error(errorOutput || `Command failed with code ${code}`));
          }
        });

        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          errorOutput += data.toString();
        });
      });
    });
  }

  /**
   * Test SSH connection - returns detailed error info
   * Now uses connection pool for efficiency (reuses connections)
   */
  async testConnection(): Promise<{ success: boolean; error?: string; details?: string; sudoRequired?: boolean }> {
    try {
      // Use the connection pool instead of creating a new connection each time
      const client = await sshPool.getConnection({
        host: this.config.host,
        port: this.config.port!,
        username: this.config.username,
        password: this.config.password,
        privateKey: this.config.privateKey,
        authMethod: this.config.authMethod,
      });

      console.log(`[LinuxWG] Testing connection to ${this.config.host}:${this.config.port} as ${this.config.username} (auth: ${this.config.authMethod}) - using pool`);

      // Test sudo permissions with a WireGuard command
      return new Promise((resolve) => {
        client.exec("sudo -n wg show 2>&1 || echo 'SUDO_FAILED'", (err, stream) => {
          if (err) {
            resolve({ success: false, error: "Exec error", details: err.message });
            return;
          }

          let output = "";
          let errorOutput = "";

          stream.on("close", () => {
            // Don't close the connection - pool will manage it
            const fullOutput = output + errorOutput;

            // Check for sudo password requirement
            if (fullOutput.includes("password is required") ||
                fullOutput.includes("a terminal is required") ||
                (fullOutput.includes("SUDO_FAILED") && fullOutput.includes("sudo:"))) {
              resolve({
                success: false,
                error: "Sudo requires password",
                details: `El usuario '${this.config.username}' necesita permisos sudo sin contraseña. Ejecute en el servidor:\n\nsudo visudo\n\nY agregue esta línea:\n${this.config.username} ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/iptables, /sbin/ip, /usr/sbin/iptables-save`,
                sudoRequired: true
              });
              return;
            }

            // Check if wg command exists
            if (fullOutput.includes("command not found") || fullOutput.includes("not found")) {
              resolve({
                success: false,
                error: "WireGuard not installed",
                details: "WireGuard tools (wg) not found on the server. Install with: apt install wireguard-tools"
              });
              return;
            }

            // Check if no WG interfaces (might be normal)
            if (fullOutput.includes("Unable to access interface") ||
                fullOutput.trim() === "" ||
                fullOutput.includes("SUDO_FAILED")) {
              // WG might not have any interfaces yet, but sudo works
              if (fullOutput.includes("SUDO_FAILED") && !fullOutput.includes("password")) {
                resolve({
                  success: true,
                  details: `SSH OK. WireGuard interface '${this.config.wgInterface}' may not exist yet or is down.`
                });
                return;
              }
            }

            // Success!
            resolve({
              success: true,
              details: "SSH connection and sudo permissions verified successfully"
            });
          });

          stream.on("data", (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on("data", (data: Buffer) => {
            errorOutput += data.toString();
          });
        });
      });
    } catch (err) {
      const error = err as Error;
      const errorMsg = error.message;
      let details = "";

      // Provide helpful error messages
      if (errorMsg.includes("ECONNREFUSED")) {
        details = `SSH port ${this.config.port} is not open or server is not running`;
      } else if (errorMsg.includes("ETIMEDOUT") || errorMsg.includes("ENOTFOUND")) {
        details = `Cannot reach host ${this.config.host}. Check IP address and network`;
      } else if (errorMsg.includes("authentication") || errorMsg.includes("Auth")) {
        details = `Authentication failed. Check username (${this.config.username}) and password/key`;
      } else if (errorMsg.includes("EHOSTUNREACH")) {
        details = `Host ${this.config.host} is unreachable. Check if server is online`;
      } else if (errorMsg.includes("timeout") || errorMsg.includes("Timeout")) {
        details = `Connection timeout to ${this.config.host}:${this.config.port}`;
      }

      return { success: false, error: errorMsg, details };
    }
  }

  /**
   * Get WireGuard interface info
   */
  async getInterfaceInfo(): Promise<{ publicKey: string; listenPort: number; address: string } | null> {
    try {
      const wgShow = await this.executeCommand(`wg show ${this.config.wgInterface}`);
      const publicKeyMatch = wgShow.match(/public key:\s*(\S+)/);
      const listenPortMatch = wgShow.match(/listening port:\s*(\d+)/);

      // Get interface address
      const ipAddr = await this.executeCommand(`ip addr show ${this.config.wgInterface} | grep inet | awk '{print $2}' | head -1`);

      return {
        publicKey: publicKeyMatch?.[1] || "",
        listenPort: parseInt(listenPortMatch?.[1] || "51821", 10),
        address: ipAddr.trim(),
      };
    } catch (error) {
      console.error("[LinuxWG] Failed to get interface info:", error);
      return null;
    }
  }

  /**
   * Get all WireGuard peers
   */
  async getPeers(): Promise<LinuxPeer[]> {
    try {
      const output = await this.executeCommand(`wg show ${this.config.wgInterface} dump`);
      const lines = output.split("\n").filter(line => line.trim());

      // First line is interface info, rest are peers
      const peers: LinuxPeer[] = [];

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 4) {
          const [publicKey, , endpoint, allowedIps, latestHandshake, rxBytes, txBytes] = parts;
          peers.push({
            publicKey,
            allowedIps,
            endpoint: endpoint !== "(none)" ? endpoint : undefined,
            latestHandshake: latestHandshake !== "0" ? latestHandshake : undefined,
            transfer: {
              rx: parseInt(rxBytes || "0", 10),
              tx: parseInt(txBytes || "0", 10),
            },
          });
        }
      }

      return peers;
    } catch (error) {
      console.error("[LinuxWG] Failed to get peers:", error);
      return [];
    }
  }

  /**
   * Get peers count
   */
  async getPeersCount(): Promise<number> {
    try {
      const output = await this.executeCommand(`wg show ${this.config.wgInterface} peers | wc -l`);
      return parseInt(output.trim(), 10);
    } catch (error) {
      console.error("[LinuxWG] Failed to get peers count:", error);
      return 0;
    }
  }

  /**
   * Add a new peer (live, without restart)
   * @param wgInterfaceOverride optional — override the interface for this single operation
   */
  async addPeer(publicKey: string, allowedIps: string, wgInterfaceOverride?: string): Promise<boolean> {
    const iface = wgInterfaceOverride || this.config.wgInterface;
    try {
      // Add peer to running interface
      await this.executeCommand(
        `wg set ${iface} peer ${publicKey} allowed-ips ${allowedIps}`
      );

      // Save to config file for persistence
      await this.executeCommand(`wg-quick save ${iface}`);

      console.log(`[LinuxWG] Added peer ${publicKey.substring(0, 8)}... with IP ${allowedIps} on ${iface}`);
      return true;
    } catch (error) {
      console.error("[LinuxWG] Failed to add peer:", error);
      return false;
    }
  }

  /**
   * Remove a peer (live, without restart). If wgInterfaceOverride is not provided
   * and the peer cannot be found on the default interface, scans all interfaces.
   */
  async removePeer(publicKey: string, wgInterfaceOverride?: string): Promise<boolean> {
    const tryRemove = async (iface: string): Promise<boolean> => {
      try {
        await this.executeCommand(`wg set ${iface} peer ${publicKey} remove`);
        await this.executeCommand(`wg-quick save ${iface}`);
        console.log(`[LinuxWG] Removed peer ${publicKey.substring(0, 8)}... from ${iface}`);
        return true;
      } catch (error) {
        console.error(`[LinuxWG] Failed to remove peer from ${iface}:`, error);
        return false;
      }
    };

    if (wgInterfaceOverride) {
      return tryRemove(wgInterfaceOverride);
    }

    // Default behaviour: try the configured interface first
    const defaultIface = this.config.wgInterface || "wg1";
    if (await tryRemove(defaultIface)) return true;

    // Fall back to scanning all interfaces (multi-interface setups)
    const all = await this.getInterfacesDetail();
    for (const i of all) {
      if (i.name === defaultIface) continue;
      if (await tryRemove(i.name)) return true;
    }
    return false;
  }

  /**
   * Get peers from one interface (defaults to config.wgInterface)
   */
  async getPeersForInterface(wgInterface: string): Promise<LinuxPeer[]> {
    try {
      const output = await this.executeCommand(`wg show ${wgInterface} dump`);
      const lines = output.split("\n").filter(line => line.trim());
      const peers: LinuxPeer[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split("\t");
        if (parts.length >= 4) {
          const [publicKey, , endpoint, allowedIps, latestHandshake, rxBytes, txBytes] = parts;
          peers.push({
            publicKey,
            allowedIps,
            endpoint: endpoint !== "(none)" ? endpoint : undefined,
            latestHandshake: latestHandshake !== "0" ? latestHandshake : undefined,
            transfer: { rx: parseInt(rxBytes || "0", 10), tx: parseInt(txBytes || "0", 10) },
          });
        }
      }
      return peers;
    } catch (error) {
      console.error(`[LinuxWG] Failed to get peers for ${wgInterface}:`, error);
      return [];
    }
  }

  /**
   * Get peers from ALL WireGuard interfaces on the server.
   * Returns each peer tagged with the interface it lives on.
   */
  async getPeersAllInterfaces(): Promise<Array<LinuxPeer & { interface: string }>> {
    const interfaces = await this.getInterfacesDetail();
    const all: Array<LinuxPeer & { interface: string }> = [];
    for (const iface of interfaces) {
      if (!iface.running) continue;
      const peers = await this.getPeersForInterface(iface.name);
      for (const p of peers) {
        all.push({ ...p, interface: iface.name });
      }
    }
    return all;
  }

  /**
   * Get NAT rules (iptables) with traffic statistics
   */
  async getNatRules(): Promise<LinuxNatRule[]> {
    try {
      const output = await this.executeCommand(
        `iptables -t nat -L POSTROUTING -n -v --line-numbers 2>/dev/null | grep SNAT || true`
      );

      const rules: LinuxNatRule[] = [];
      const lines = output.split("\n").filter(line => line.trim());

      for (const line of lines) {
        // Parse: num pkts bytes target prot opt in out source destination to:IP
        // Example: 1  1234K  567M SNAT  all  --  *  ens192 10.10.200.0/24  0.0.0.0/0  to:69.176.94.200
        const match = line.match(/^(\d+)\s+(\d+[KMG]?)\s+(\d+[KMG]?)\s+SNAT\s+\S+\s+\S+\s+\S+\s+\S+\s+(\S+)\s+\S+\s+to:(\S+)/);
        if (match) {
          rules.push({
            num: parseInt(match[1], 10),
            packets: this.parseTrafficValue(match[2]),
            bytes: this.parseTrafficValue(match[3]),
            source: match[4],
            destination: "0.0.0.0/0",
            target: match[5],
          });
        }
      }

      return rules;
    } catch (error) {
      console.error("[LinuxWG] Failed to get NAT rules:", error);
      return [];
    }
  }

  /**
   * Parse traffic values like "1234K", "567M", "1G" to bytes
   */
  private parseTrafficValue(value: string): number {
    const num = parseFloat(value);
    if (value.endsWith("K")) return num * 1024;
    if (value.endsWith("M")) return num * 1024 * 1024;
    if (value.endsWith("G")) return num * 1024 * 1024 * 1024;
    return num;
  }

  /**
   * Get NAT traffic statistics per IP number
   */
  async getNatTraffic(): Promise<LinuxNatTraffic[]> {
    if (!this.config.internalPrefix || !this.config.publicIpPrefix) {
      return [];
    }

    try {
      const rules = await this.getNatRules();
      const traffic: LinuxNatTraffic[] = [];

      for (const rule of rules) {
        // Extract IP number from source (10.10.X.0/24) or target
        if (rule.target && rule.target.startsWith(this.config.publicIpPrefix!)) {
          const parts = rule.target.split(".");
          if (parts.length === 4) {
            const ipNumber = parseInt(parts[3], 10);
            if (!isNaN(ipNumber)) {
              traffic.push({
                ip_number: ipNumber,
                public_ip: rule.target,
                internal_subnet: `${this.config.internalPrefix}.${ipNumber}`,
                bytes: rule.bytes || 0,
                packets: rule.packets || 0,
              });
            }
          }
        }
      }

      return traffic;
    } catch (error) {
      console.error("[LinuxWG] Failed to get NAT traffic:", error);
      return [];
    }
  }

  /**
   * Add NAT rule for a specific internal IP to public IP
   * Uses the MikroTik schema: 10.10.X.0/24 -> public.X
   */
  async addNatRule(ipNumber: number): Promise<{ success: boolean; error?: string }> {
    if (!this.config.internalPrefix || !this.config.publicIpPrefix) {
      return { success: false, error: "Missing internal_prefix or public_ip_prefix in config" };
    }

    const srcNetwork = `${this.config.internalPrefix}.${ipNumber}.0/24`;
    const toAddress = `${this.config.publicIpPrefix}.${ipNumber}`;
    const outIface = this.config.outInterface || "ens192";

    try {
      // Check if rule already exists
      const existingRules = await this.executeCommand(
        `iptables -t nat -L POSTROUTING -n | grep "${srcNetwork}" | grep "${toAddress}" || true`
      );

      if (existingRules.trim()) {
        console.log(`[LinuxWG] NAT rule already exists for ${srcNetwork} -> ${toAddress}`);
        return { success: true };
      }

      // Insert at the top (not -A/append): a source-restricted SNAT must be evaluated
      // BEFORE any catch-all `-o <iface> -j MASQUERADE` (e.g. from other interfaces'
      // PostUp). Appended after such a rule, it would be shadowed and every peer would
      // exit on the primary IP instead of its assigned public IP.
      await this.executeCommand(
        `iptables -t nat -I POSTROUTING 1 -s ${srcNetwork} -o ${outIface} -j SNAT --to-source ${toAddress}`
      );

      // Save iptables rules for persistence
      await this.executeCommand(`iptables-save > /etc/iptables/rules.v4 || true`);

      console.log(`[LinuxWG] Added NAT rule: ${srcNetwork} -> ${toAddress}`);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[LinuxWG] Failed to add NAT rule:", errMsg);
      return { success: false, error: `NAT (${srcNetwork} -> ${toAddress}): ${errMsg}` };
    }
  }

  /**
   * Remove NAT rule
   */
  async removeNatRule(ipNumber: number): Promise<boolean> {
    if (!this.config.internalPrefix || !this.config.publicIpPrefix) {
      return false;
    }

    const srcNetwork = `${this.config.internalPrefix}.${ipNumber}.0/24`;
    const toAddress = `${this.config.publicIpPrefix}.${ipNumber}`;
    const outIface = this.config.outInterface || "ens192";

    try {
      await this.executeCommand(
        `iptables -t nat -D POSTROUTING -s ${srcNetwork} -o ${outIface} -j SNAT --to-source ${toAddress} || true`
      );

      // Save iptables rules
      await this.executeCommand(`iptables-save > /etc/iptables/rules.v4 || true`);

      console.log(`[LinuxWG] Removed NAT rule for ${srcNetwork}`);
      return true;
    } catch (error) {
      console.error("[LinuxWG] Failed to remove NAT rule:", error);
      return false;
    }
  }

  /**
   * Add WireGuard IP address for a subnet gateway
   * Example: 10.10.200.1/24 on wg1
   * @param wgInterfaceOverride optional — when provided, uses this interface instead of the config default
   */
  async addWgIpAddress(ipNumber: number, wgInterfaceOverride?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config.internalPrefix) {
      return { success: false, error: "Missing internal_prefix in config" };
    }

    const ipAddress = `${this.config.internalPrefix}.${ipNumber}.1/24`;
    const wgIface = wgInterfaceOverride || this.config.wgInterface || "wg1";

    try {
      // Check if already exists
      const existing = await this.executeCommand(
        `ip addr show ${wgIface} | grep "${this.config.internalPrefix}.${ipNumber}.1" || true`
      );

      if (existing.trim()) {
        console.log(`[LinuxWG] WG IP already exists: ${ipAddress}`);
        return { success: true };
      }

      // Add the IP
      await this.executeCommand(`ip addr add ${ipAddress} dev ${wgIface}`);

      console.log(`[LinuxWG] Added WG IP: ${ipAddress} on ${wgIface}`);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[LinuxWG] Failed to add WG IP:", errMsg);
      return { success: false, error: `WG IP (${ipAddress} on ${wgIface}): ${errMsg}` };
    }
  }

  /**
   * Remove WireGuard IP address
   * @param wgInterfaceOverride optional — when provided, removes from this interface instead of the config default
   */
  async removeWgIpAddress(ipNumber: number, wgInterfaceOverride?: string): Promise<boolean> {
    if (!this.config.internalPrefix) {
      return false;
    }

    const ipAddress = `${this.config.internalPrefix}.${ipNumber}.1/24`;
    const wgIface = wgInterfaceOverride || this.config.wgInterface || "wg1";

    try {
      await this.executeCommand(`ip addr del ${ipAddress} dev ${wgIface} || true`);
      console.log(`[LinuxWG] Removed WG IP: ${ipAddress}`);
      return true;
    } catch (error) {
      console.error("[LinuxWG] Failed to remove WG IP:", error);
      return false;
    }
  }

  /**
   * Add public IP to the output interface
   * Example: 69.176.94.200/24 on ens192
   */
  async addPublicIpAddress(ipNumber: number, mask: string = "/24"): Promise<{ success: boolean; error?: string }> {
    if (!this.config.publicIpPrefix) {
      return { success: false, error: "Missing public_ip_prefix in config" };
    }

    const ipAddress = `${this.config.publicIpPrefix}.${ipNumber}${mask}`;
    const outIface = this.config.outInterface || "ens192";

    try {
      // Check if already exists
      const existing = await this.executeCommand(
        `ip addr show ${outIface} | grep "${this.config.publicIpPrefix}.${ipNumber}" || true`
      );

      if (existing.trim()) {
        console.log(`[LinuxWG] Public IP already exists: ${ipAddress}`);
        return { success: true };
      }

      // Add the IP
      await this.executeCommand(`ip addr add ${ipAddress} dev ${outIface}`);

      console.log(`[LinuxWG] Added public IP: ${ipAddress} on ${outIface}`);
      return { success: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("[LinuxWG] Failed to add public IP:", errMsg);
      return { success: false, error: `Public IP (${ipAddress} on ${outIface}): ${errMsg}` };
    }
  }

  /**
   * Create all MikroTik-style rules for an IP number
   * 1. WG IP (10.10.X.1/24)
   * 2. Public IP (69.176.94.X/24)
   * 3. NAT rule (10.10.X.0/24 -> 69.176.94.X)
   * @param wgInterfaceOverride optional — when provided, the WG IP gets added to THIS interface instead of the config default
   */
  async createMikroTikRules(ipNumber: number, mask: string = "/24", wgInterfaceOverride?: string): Promise<{
    wg_ip_created: boolean;
    ip_address_created: boolean;
    nat_rule_created: boolean;
    errors: string[];
  }> {
    const results = {
      wg_ip_created: false,
      ip_address_created: false,
      nat_rule_created: false,
      errors: [] as string[],
    };

    const effectiveWgInterface = wgInterfaceOverride || this.config.wgInterface;
    console.log(`[LinuxWG] Creating rules for IP number ${ipNumber}...`);
    console.log(`[LinuxWG] Config: wgInterface=${effectiveWgInterface}, outInterface=${this.config.outInterface}, internalPrefix=${this.config.internalPrefix}, publicIpPrefix=${this.config.publicIpPrefix}`);

    // 1. Add WG IP
    const wgResult = await this.addWgIpAddress(ipNumber, wgInterfaceOverride);
    results.wg_ip_created = wgResult.success;
    if (!wgResult.success && wgResult.error) {
      results.errors.push(wgResult.error);
    }

    // 2. Add Public IP
    const publicResult = await this.addPublicIpAddress(ipNumber, mask);
    results.ip_address_created = publicResult.success;
    if (!publicResult.success && publicResult.error) {
      results.errors.push(publicResult.error);
    }

    // 3. Add NAT rule
    const natResult = await this.addNatRule(ipNumber);
    results.nat_rule_created = natResult.success;
    if (!natResult.success && natResult.error) {
      results.errors.push(natResult.error);
    }

    console.log(`[LinuxWG] Results: WG=${results.wg_ip_created}, IP=${results.ip_address_created}, NAT=${results.nat_rule_created}`);
    if (results.errors.length > 0) {
      console.error(`[LinuxWG] Errors:`, results.errors);
    }

    return results;
  }

  /**
   * Delete all MikroTik-style rules for an IP number
   * @param wgInterfaceOverride optional — when provided, removes the WG IP from this interface
   */
  async deleteMikroTikRules(ipNumber: number, wgInterfaceOverride?: string): Promise<{
    wg_ip_deleted: boolean;
    ip_address_deleted: boolean;
    nat_rule_deleted: boolean;
    errors: string[];
  }> {
    const results = {
      wg_ip_deleted: false,
      ip_address_deleted: false,
      nat_rule_deleted: false,
      errors: [] as string[],
    };

    try {
      results.nat_rule_deleted = await this.removeNatRule(ipNumber);
    } catch (error) {
      results.errors.push(`NAT rule: ${error}`);
    }

    try {
      results.ip_address_deleted = await this.removeWgIpAddress(ipNumber, wgInterfaceOverride);
    } catch (error) {
      results.errors.push(`Public IP: ${error}`);
    }

    try {
      results.wg_ip_deleted = await this.removeWgIpAddress(ipNumber, wgInterfaceOverride);
    } catch (error) {
      results.errors.push(`WG IP: ${error}`);
    }

    return results;
  }

  /**
   * Get used internal IPs for a specific subnet
   */
  async getUsedIpsInSubnet(ipNumber: number): Promise<Set<number>> {
    const usedIps = new Set<number>();
    const subnetPrefix = `${this.config.internalPrefix}.${ipNumber}.`;

    try {
      const peers = await this.getPeers();
      for (const peer of peers) {
        const addr = peer.allowedIps.split("/")[0];
        if (addr.startsWith(subnetPrefix)) {
          const lastOctet = parseInt(addr.split(".")[3], 10);
          if (!isNaN(lastOctet)) {
            usedIps.add(lastOctet);
          }
        }
      }
    } catch (error) {
      console.error("[LinuxWG] Failed to get used IPs:", error);
    }

    return usedIps;
  }

  /**
   * Get next available IP in a subnet
   */
  async getNextAvailableIp(ipNumber: number): Promise<number | null> {
    const usedIps = await this.getUsedIpsInSubnet(ipNumber);

    // Start from 2 (1 is gateway)
    for (let i = 2; i < 255; i++) {
      if (!usedIps.has(i)) {
        return i;
      }
    }

    return null;
  }

  /**
   * Get system resources (CPU, RAM, uptime)
   */
  async getResources(): Promise<{
    cpuLoad: number;
    freeMemory: number;
    totalMemory: number;
    uptime: string;
    version: string;
    hostname: string;
  }> {
    try {
      const [cpuOutput, memOutput, uptimeOutput, versionOutput, hostnameOutput] = await Promise.all([
        this.executeCommand("cat /proc/loadavg | awk '{print $1}'"),
        this.executeCommand("free -b | grep Mem | awk '{print $2, $7}'"),
        this.executeCommand("uptime -p"),
        this.executeCommand("uname -r"),
        this.executeCommand("hostname"),
      ]);

      const [totalMem, freeMem] = memOutput.split(" ").map(s => parseInt(s, 10));

      return {
        cpuLoad: parseFloat(cpuOutput) * 100 / 4, // Normalize to percentage (assuming 4 cores)
        freeMemory: freeMem,
        totalMemory: totalMem,
        uptime: uptimeOutput.replace("up ", ""),
        version: versionOutput,
        hostname: hostnameOutput,
      };
    } catch (error) {
      console.error("[LinuxWG] Failed to get resources:", error);
      return {
        cpuLoad: 0,
        freeMemory: 0,
        totalMemory: 0,
        uptime: "unknown",
        version: "unknown",
        hostname: "unknown",
      };
    }
  }

  /**
   * Get all network interfaces
   */
  async getNetworkInterfaces(): Promise<string[]> {
    try {
      // Use simpler command that doesn't require complex quoting
      const output = await this.executeCommand("ls /sys/class/net");
      const interfaces = output.split("\n")
        .filter(iface => iface.trim() && iface !== "lo" && !iface.startsWith("wg"))
        .map(iface => iface.trim());
      console.log("[LinuxWG] Detected network interfaces:", interfaces);
      return interfaces;
    } catch (error) {
      console.error("[LinuxWG] Failed to get network interfaces:", error);
      return [];
    }
  }

  /**
   * Get WireGuard interfaces with their listen ports.
   * Parses /etc/wireguard/*.conf so disabled interfaces are still listed.
   */
  async getInterfacesDetail(): Promise<Array<{ name: string; port: number | null; running: boolean }>> {
    const detail = new Map<string, { name: string; port: number | null; running: boolean }>();

    // Running interfaces (from wg show)
    try {
      const wgShow = await this.executeCommand("wg show all listen-port 2>/dev/null || true");
      for (const line of wgShow.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const port = parseInt(parts[1], 10);
          detail.set(parts[0], { name: parts[0], port: isNaN(port) ? null : port, running: true });
        }
      }
    } catch {
      // ignore
    }

    // Configured interfaces (from /etc/wireguard/*.conf)
    try {
      const lsOut = await this.executeCommand("ls /etc/wireguard/*.conf 2>/dev/null || true");
      const files = lsOut.split("\n").map(f => f.trim()).filter(Boolean);
      for (const file of files) {
        const name = file.split("/").pop()!.replace(/\.conf$/, "");
        let port: number | null = detail.get(name)?.port ?? null;
        if (port === null) {
          try {
            const grepOut = await this.executeCommand(`grep -i '^[[:space:]]*ListenPort' ${file} 2>/dev/null || true`);
            const match = grepOut.match(/ListenPort\s*=\s*(\d+)/i);
            if (match) port = parseInt(match[1], 10);
          } catch {
            // ignore
          }
        }
        if (!detail.has(name)) {
          detail.set(name, { name, port, running: false });
        } else {
          const existing = detail.get(name)!;
          if (existing.port === null && port !== null) existing.port = port;
        }
      }
    } catch {
      // ignore
    }

    return Array.from(detail.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Create a new WireGuard interface on Linux.
   * Validates name and port collisions, writes the conf, enables and starts the service.
   */
  async createInterface(opts: {
    name: string;
    listenPort: number;
    address: string;
    privateKey: string;
  }): Promise<{ success: boolean; error?: string; details?: string }> {
    const { name, listenPort, address, privateKey } = opts;

    if (!/^wg\d+$/.test(name)) {
      return { success: false, error: "Invalid interface name", details: "Name must match wg<N> (e.g. wg0, wg1)" };
    }
    if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
      return { success: false, error: "Invalid listen port", details: "Port must be between 1 and 65535" };
    }
    if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(address)) {
      return { success: false, error: "Invalid address", details: "Address must be CIDR (e.g. 10.10.0.1/24)" };
    }
    if (!privateKey || privateKey.length < 40) {
      return { success: false, error: "Invalid private key" };
    }

    // Collision checks
    const existing = await this.getInterfacesDetail();
    if (existing.some(i => i.name === name)) {
      return { success: false, error: "Interface name already in use", details: `${name} already exists on the server` };
    }
    const portTaken = existing.find(i => i.port === listenPort);
    if (portTaken) {
      return { success: false, error: "Listen port already in use", details: `Port ${listenPort} is used by ${portTaken.name}` };
    }

    // Include FORWARD rules in PostUp/PostDown so the interface routes traffic even when
    // the host's FORWARD policy is DROP (e.g. servers running Docker). Harmless when it's ACCEPT.
    const conf = `[Interface]\nPrivateKey = ${privateKey}\nAddress = ${address}\nListenPort = ${listenPort}\n` +
      `PostUp = iptables -A FORWARD -i ${name} -j ACCEPT; iptables -A FORWARD -o ${name} -j ACCEPT;\n` +
      `PostDown = iptables -D FORWARD -i ${name} -j ACCEPT; iptables -D FORWARD -o ${name} -j ACCEPT;\n`;
    const b64 = Buffer.from(conf, "utf-8").toString("base64");
    const confPath = `/etc/wireguard/${name}.conf`;

    try {
      // Write conf via base64 to avoid quoting issues
      await this.executeCommand(`bash -c 'echo ${b64} | base64 -d > ${confPath}'`);
      await this.executeCommand(`chmod 600 ${confPath}`);
      await this.executeCommand(`systemctl enable wg-quick@${name}`);
      await this.executeCommand(`systemctl start wg-quick@${name}`);

      // Verify it came up
      const verify = await this.executeCommand(`wg show ${name} 2>&1 || true`);
      if (!verify || verify.toLowerCase().includes("unable to access interface")) {
        return { success: false, error: "Interface did not start", details: verify || "wg show returned empty" };
      }

      console.log(`[LinuxWG] Created interface ${name} on port ${listenPort}`);
      return { success: true };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[LinuxWG] Failed to create interface:", errMsg);

      // Best-effort cleanup if conf was partially written
      try {
        await this.executeCommand(`systemctl stop wg-quick@${name} 2>/dev/null || true`);
        await this.executeCommand(`rm -f ${confPath}`);
      } catch {
        // ignore
      }

      return { success: false, error: "Failed to create interface", details: errMsg };
    }
  }

  /**
   * Get WireGuard interfaces
   */
  async getWireGuardInterfaces(): Promise<string[]> {
    try {
      // Try multiple methods to detect WG interfaces
      let output = "";

      // Method 1: wg show interfaces (requires wg to be running)
      try {
        output = await this.executeCommand("wg show interfaces 2>/dev/null");
        if (output.trim()) {
          const interfaces = output.split(/\s+/).filter(iface => iface.trim());
          console.log("[LinuxWG] Detected WG interfaces (wg show):", interfaces);
          return interfaces;
        }
      } catch (e) {
        // Continue to next method
      }

      // Method 2: List from /sys/class/net
      try {
        output = await this.executeCommand("ls /sys/class/net | grep -E '^wg[0-9]+'");
        if (output.trim()) {
          const interfaces = output.split("\n").filter(iface => iface.trim());
          console.log("[LinuxWG] Detected WG interfaces (/sys/class/net):", interfaces);
          return interfaces;
        }
      } catch (e) {
        // Continue to next method
      }

      // Method 3: List config files
      try {
        output = await this.executeCommand("ls /etc/wireguard/*.conf 2>/dev/null | while read f; do basename \"$f\" .conf; done");
        if (output.trim()) {
          const interfaces = output.split("\n").filter(iface => iface.trim());
          console.log("[LinuxWG] Detected WG interfaces (config files):", interfaces);
          return interfaces;
        }
      } catch (e) {
        // All methods failed
      }

      console.log("[LinuxWG] No WireGuard interfaces detected");
      return [];
    } catch (error) {
      console.error("[LinuxWG] Failed to get WireGuard interfaces:", error);
      return [];
    }
  }
}
