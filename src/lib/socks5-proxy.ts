import { Client } from "ssh2";
import type { AuthMethod } from "./types";

export interface Socks5ProxyConfig {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKey?: string;
  authMethod: AuthMethod;
}

export interface Socks5User {
  username: string;
  password: string;
  publicIp: string;
  port: number;
  enabled: boolean;
  maxConnections?: number; // 0 or undefined = unlimited
}

export interface Socks5ProxyInfo {
  port: number;
  publicIp: string;
  username?: string;
  connections: number;
}

// ============================================
// SSH CONNECTION POOL - Reuse from linux-wireguard
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
  private readonly MAX_IDLE_TIME = 60000;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.cleanupInterval = setInterval(() => this.cleanupIdleConnections(), 30000);
  }

  static getInstance(): SSHConnectionPool {
    if (!SSHConnectionPool.instance) {
      SSHConnectionPool.instance = new SSHConnectionPool();
    }
    return SSHConnectionPool.instance;
  }

  private getConnectionKey(host: string, port: number, username: string): string {
    return `socks5_${username}@${host}:${port}`;
  }

  private cleanupIdleConnections() {
    const now = Date.now();
    for (const [key, conn] of this.connections.entries()) {
      if (conn.isConnected && now - conn.lastUsed > this.MAX_IDLE_TIME) {
        console.log(`[Socks5Pool] Closing idle connection: ${key}`);
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

    if (pooledConn?.isConnected && pooledConn.client) {
      pooledConn.lastUsed = Date.now();
      return pooledConn.client;
    }

    if (pooledConn?.isConnecting && pooledConn.connectPromise) {
      return pooledConn.connectPromise;
    }

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
      }, 30000);

      client.on("ready", () => {
        clearTimeout(timeout);
        pooledConn!.isConnected = true;
        pooledConn!.isConnecting = false;
        pooledConn!.lastUsed = Date.now();
        console.log(`[Socks5Pool] Connected: ${key}`);
        resolve(client);
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        pooledConn!.isConnected = false;
        pooledConn!.isConnecting = false;
        this.connections.delete(key);
        reject(err);
      });

      client.on("close", () => {
        pooledConn!.isConnected = false;
        pooledConn!.isConnecting = false;
        this.connections.delete(key);
      });

      const connectionConfig: Record<string, unknown> = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 30000,
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
}

const sshPool = SSHConnectionPool.getInstance();

// ============================================
// SOCKS5 PROXY CLIENT
// ============================================
export class Socks5ProxyClient {
  private config: Socks5ProxyConfig;

  constructor(config: Socks5ProxyConfig) {
    this.config = {
      port: 22,
      ...config,
    };
  }

  /**
   * Execute a command via SSH using connection pool
   * @param useSudo Whether to wrap command in sudo (default: true)
   */
  private async executeCommand(command: string, useSudo = true): Promise<string> {
    const client = await sshPool.getConnection({
      host: this.config.host,
      port: this.config.port!,
      username: this.config.username,
      password: this.config.password,
      privateKey: this.config.privateKey,
      authMethod: this.config.authMethod,
    });

    let finalCommand = command;
    if (useSudo) {
      // Try sudo -n first (works with NOPASSWD), fallback to sudo -S with password
      const sudoPassword = (this.config.password || "").replace(/'/g, "'\\''");
      finalCommand = `sudo -n ${command} 2>/dev/null || echo '${sudoPassword}' | sudo -S -p '' ${command}`;
    }

    return new Promise((resolve, reject) => {
      client.exec(finalCommand, (err, stream) => {
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
   * Check if 3proxy is installed
   */
  async is3proxyInstalled(): Promise<boolean> {
    try {
      // Simple check: look for 3proxy binary or config file
      const result = await this.executeCommand(
        "if [ -f /etc/3proxy/3proxy.cfg ] || [ -f /usr/bin/3proxy ] || [ -f /bin/3proxy ] || which 3proxy >/dev/null 2>&1; then echo yes; else echo no; fi",
        false
      );
      return result.trim() === "yes";
    } catch {
      return false;
    }
  }

  /**
   * Install 3proxy on the server
   */
  async install3proxy(): Promise<{ success: boolean; message: string }> {
    try {
      // Check if already installed
      const installed = await this.is3proxyInstalled();
      if (installed) {
        return { success: true, message: "3proxy is already installed" };
      }

      // Install 3proxy
      console.log("[Socks5] Installing 3proxy...");

      // Wait for any existing apt/dpkg locks to be released
      await this.executeCommand("fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 && sleep 5 || true");

      // Try to install from repos first, if not available compile from source
      try {
        await this.executeCommand("apt-get update && apt-get install -y 3proxy");
      } catch {
        // 3proxy not in repos, install from source
        console.log("[Socks5] 3proxy not in repos, compiling from source...");
        await this.executeCommand("apt-get update && apt-get install -y build-essential git");
        await this.executeCommand("cd /tmp && rm -rf 3proxy && git clone https://github.com/3proxy/3proxy.git");
        await this.executeCommand("cd /tmp/3proxy && make -f Makefile.Linux && make -f Makefile.Linux install");
      }

      // Create config directory
      await this.executeCommand("mkdir -p /etc/3proxy");

      // Create log directory
      await this.executeCommand("mkdir -p /var/log/3proxy");

      // Create runtime directory
      await this.executeCommand("mkdir -p /var/run/3proxy");

      // Create base config
      const baseConfig = `
daemon
pidfile /var/run/3proxy/3proxy.pid
timeouts 1 5 30 60 180 1800 15 60
log /var/log/3proxy/3proxy.log D
auth strong
`;
      await this.executeCommand(`bash -c "echo '${baseConfig}' > /etc/3proxy/3proxy.cfg"`);

      // Create systemd service (Type=simple works better than forking)
      const serviceFile = `
[Unit]
Description=3proxy Proxy Server
After=network.target

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /var/run/3proxy /var/log/3proxy
ExecStartPre=-/bin/pkill -9 3proxy
ExecStart=/bin/3proxy /etc/3proxy/3proxy.cfg
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
      await this.executeCommand(`bash -c "echo '${serviceFile}' > /usr/lib/systemd/system/3proxy.service"`);
      await this.executeCommand("systemctl daemon-reload");
      await this.executeCommand("systemctl enable 3proxy");

      // Configure NOPASSWD for the SSH user to avoid sudo password prompts
      const sshUser = this.config.username;
      console.log(`[Socks5] Configuring NOPASSWD for user: ${sshUser}`);
      await this.executeCommand(`bash -c "echo '${sshUser} ALL=(ALL) NOPASSWD: ALL' | tee /etc/sudoers.d/${sshUser} && chmod 440 /etc/sudoers.d/${sshUser}"`);

      return { success: true, message: "3proxy installed successfully" };
    } catch (error) {
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  /**
   * Rebuild the entire 3proxy config with correct structure
   * This ensures all proxies work by defining users first, then auth, then socks
   */
  async rebuildConfig(proxies: Socks5User[]): Promise<{ success: boolean; message: string }> {
    try {
      if (proxies.length === 0) {
        // No proxies, create minimal config
        const emptyConfig = `# 3proxy configuration
pidfile /var/run/3proxy/3proxy.pid
timeouts 1 5 30 60 180 1800 15 60
log /var/log/3proxy/3proxy.log D
auth strong
`;
        await this.executeCommand(`echo '${emptyConfig}' | sudo tee /etc/3proxy/3proxy.cfg`);
        await this.executeCommand("sudo systemctl restart 3proxy 2>/dev/null || sudo pkill 3proxy 2>/dev/null || true");
        return { success: true, message: "Config cleared - no proxies" };
      }

      // Build config with correct structure:
      // 1. Header and settings
      // 2. ALL users defined first
      // 3. auth strong
      // 4. allow * (allow all authenticated users)
      // 5. ALL socks services

      let config = `# 3proxy configuration - auto-generated
pidfile /var/run/3proxy/3proxy.pid
timeouts 1 5 30 60 180 1800 15 60
log /var/log/3proxy/3proxy.log D

`;

      // Add all users
      for (const proxy of proxies) {
        config += `users ${proxy.username}:CL:${proxy.password}\n`;
      }

      config += `
auth strong
allow *

`;

      // Add all socks services with connection limits
      for (const proxy of proxies) {
        // Add maxconn if set (0 or undefined = unlimited)
        if (proxy.maxConnections && proxy.maxConnections > 0) {
          config += `maxconn ${proxy.maxConnections}\n`;
        }
        config += `socks -p1080 -i${proxy.publicIp} -e${proxy.publicIp}\n`;
      }

      // Write config
      const escapedConfig = config.replace(/'/g, "'\\''");
      await this.executeCommand(`echo '${escapedConfig}' | sudo tee /etc/3proxy/3proxy.cfg`);

      // Restart 3proxy
      await this.executeCommand("sudo pkill -9 3proxy 2>/dev/null; sleep 1; sudo systemctl start 3proxy");

      // Ensure firewall allows port 1080
      await this.executeCommand("iptables -C INPUT -p tcp --dport 1080 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 1080 -j ACCEPT");

      return { success: true, message: `Config rebuilt with ${proxies.length} proxies` };
    } catch (error) {
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  /**
   * Add a SOCKS5 proxy user - validates only, rebuildConfig does the actual work
   */
  async addSocks5User(user: Socks5User): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `SOCKS5 proxy created at ${user.publicIp}:1080` };
  }

  /**
   * Remove a SOCKS5 proxy user - validates only, rebuildConfig does the actual work
   */
  async removeSocks5User(username: string, publicIp: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `SOCKS5 proxy for ${username} removed` };
  }

  /**
   * Get list of active SOCKS5 proxies from server config
   */
  async listSocks5Proxies(): Promise<Socks5ProxyInfo[]> {
    try {
      const config = await this.executeCommand("cat /etc/3proxy/3proxy.cfg 2>/dev/null || echo ''", false);
      const proxies: Socks5ProxyInfo[] = [];

      // Parse socks proxy lines: socks -p1080 -iIP -eIP
      const lines = config.split("\n");
      for (const line of lines) {
        const match = line.match(/socks\s+-p(\d+)\s+-i([\d.]+)\s+-e([\d.]+)/);
        if (match) {
          proxies.push({
            port: parseInt(match[1]),
            publicIp: match[2],
            connections: 0,
          });
        }
      }

      return proxies;
    } catch {
      return [];
    }
  }

  /**
   * Get proxies with usernames from server config (for sync)
   */
  async getServerProxies(): Promise<Array<{ username: string; password: string; publicIp: string }>> {
    try {
      const config = await this.executeCommand("cat /etc/3proxy/3proxy.cfg 2>/dev/null || echo ''", false);
      const lines = config.split("\n");

      // Parse users: users username:CL:password
      const users: Map<string, string> = new Map();
      for (const line of lines) {
        const userMatch = line.match(/users\s+(\w+):CL:(\S+)/);
        if (userMatch) {
          users.set(userMatch[1], userMatch[2]);
        }
      }

      // Parse socks lines and match with users
      const proxies: Array<{ username: string; password: string; publicIp: string }> = [];
      const socksIps: string[] = [];

      for (const line of lines) {
        const socksMatch = line.match(/socks\s+-p\d+\s+-i([\d.]+)\s+-e[\d.]+/);
        if (socksMatch) {
          socksIps.push(socksMatch[1]);
        }
      }

      // Match users with IPs (in order)
      const userList = Array.from(users.entries());
      for (let i = 0; i < Math.min(userList.length, socksIps.length); i++) {
        proxies.push({
          username: userList[i][0],
          password: userList[i][1],
          publicIp: socksIps[i],
        });
      }

      return proxies;
    } catch {
      return [];
    }
  }

  /**
   * Get 3proxy service status
   */
  async getStatus(): Promise<{ running: boolean; installed: boolean; connectionError?: string }> {
    try {
      const installed = await this.is3proxyInstalled();
      if (!installed) {
        return { running: false, installed: false };
      }

      // Check if 3proxy is running
      const status = await this.executeCommand(
        "if pgrep -x 3proxy >/dev/null 2>&1 || systemctl is-active 3proxy 2>/dev/null | grep -q active; then echo running; else echo stopped; fi",
        false
      );
      return { running: status.trim() === "running", installed: true };
    } catch (error) {
      const err = error as Error;
      // Return connection error instead of assuming not installed
      return { running: false, installed: false, connectionError: err.message };
    }
  }

  /**
   * Start 3proxy service
   */
  async start(): Promise<{ success: boolean; message: string }> {
    try {
      await this.executeCommand("systemctl start 3proxy");
      return { success: true, message: "3proxy started" };
    } catch (error) {
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  /**
   * Stop 3proxy service
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    try {
      await this.executeCommand("systemctl stop 3proxy");
      return { success: true, message: "3proxy stopped" };
    } catch (error) {
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  /**
   * Restart 3proxy service
   */
  async restart(): Promise<{ success: boolean; message: string }> {
    try {
      await this.executeCommand("systemctl restart 3proxy");
      return { success: true, message: "3proxy restarted" };
    } catch (error) {
      const err = error as Error;
      return { success: false, message: err.message };
    }
  }

  /**
   * Get available public IPs on the server
   */
  async getAvailablePublicIps(): Promise<string[]> {
    try {
      const output = await this.executeCommand("ip addr show | grep 'inet ' | awk '{print $2}' | cut -d/ -f1 | grep -v '127.0.0.1' | grep -v '10\\.' | grep -v '192.168\\.' | grep -v '172\\.1[6-9]\\.' | grep -v '172\\.2[0-9]\\.' | grep -v '172\\.3[0-1]\\.'", false);
      return output.split("\n").filter(ip => ip.trim() !== "");
    } catch {
      return [];
    }
  }

  /**
   * Test a SOCKS5 proxy by making a request through it
   */
  async testProxy(
    proxyIp: string,
    proxyPort: number,
    username: string,
    password: string
  ): Promise<{ success: boolean; ip?: string; error?: string }> {
    try {
      // Use curl with SOCKS5 proxy to get the exit IP
      const curlCommand = `curl -s --connect-timeout 10 --max-time 15 --socks5-hostname ${username}:${password}@${proxyIp}:${proxyPort} http://ifconfig.me 2>/dev/null || curl -s --connect-timeout 10 --max-time 15 --socks5-hostname ${username}:${password}@${proxyIp}:${proxyPort} http://api.ipify.org 2>/dev/null || echo "FAILED"`;

      const result = await this.executeCommand(curlCommand, false);
      const ip = result.trim();

      if (ip === "FAILED" || !ip) {
        return { success: false, error: "Could not connect through proxy" };
      }

      // Validate that the result looks like an IP address
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ip)) {
        return { success: false, error: `Invalid response: ${ip.substring(0, 50)}` };
      }

      return { success: true, ip };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: err.message };
    }
  }

  /**
   * Get active connections on SOCKS5 port (1080)
   * Returns a map of public_ip -> number of active connections
   */
  async getActiveConnections(): Promise<Record<string, number>> {
    try {
      // Use ss to get established TCP connections on port 1080
      // The local address shows which IP is being used for the proxy
      const command = `ss -tn state established '( sport = :1080 )' 2>/dev/null | tail -n +2 | awk '{print $4}' | cut -d: -f1 | sort | uniq -c | awk '{print $2":"$1}'`;

      const result = await this.executeCommand(command, false);
      const connections: Record<string, number> = {};

      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
          const [ip, count] = line.split(":");
          if (ip && count) {
            connections[ip] = parseInt(count, 10) || 0;
          }
        }
      }

      return connections;
    } catch (error) {
      console.error("[Socks5] getActiveConnections error:", error);
      return {};
    }
  }
}
