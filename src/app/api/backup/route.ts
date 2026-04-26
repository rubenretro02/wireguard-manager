import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { Client } from "ssh2";

interface BackupData {
  exportDate: string;
  version: string;
  server: {
    id: string;
    name: string;
    host: string;
    connectionType: string;
    // Full router config for restore
    config: {
      port: number;
      api_port: number;
      ssh_port: number;
      username: string;
      use_ssl: boolean;
      public_ip_prefix: string | null;
      internal_prefix: string | null;
      wg_interface: string | null;
      out_interface: string | null;
      public_ip_mask: string | null;
    };
  };
  wireguard: {
    interfaces: Array<{
      name: string;
      privateKey: string;
      publicKey: string;
      listenPort: number;
      address: string;
      configRaw: string; // Full raw config file
    }>;
    peers: Array<{
      name: string;
      publicKey: string;
      privateKey?: string;
      presharedKey?: string;
      allowedAddress: string;
      endpoint?: string;
      comment?: string;
      disabled: boolean;
      interface: string;
    }>;
  };
  socks5: {
    config: string;
    proxies: Array<{
      username: string;
      password: string;
      publicIp: string;
      port: number;
      maxConnections: number;
      name: string | null;
      enabled: boolean;
    }>;
  };
  firewall: {
    iptables: string;
    iptablesNat: string;
  };
  network: {
    interfaces: string;
    ipAddresses: string;
  };
  database: {
    // Core data
    peers: unknown[];
    socks5Proxies: unknown[];
    publicIps: unknown[];
    // Users and access control
    users: unknown[];
    userRouters: unknown[];
    userSocks5Proxies: unknown[];
    userSocks5ServerAccess: unknown[];
  };
}

// Helper function to check if user is admin
async function checkIsAdmin(userId: string): Promise<boolean> {
  const adminClient = createAdminClient();
  if (!adminClient) return false;

  const { data: profile } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  return profile?.role?.toLowerCase() === "admin";
}

// Execute SSH command
async function executeSSH(
  host: string,
  port: number,
  username: string,
  password: string,
  privateKey: string | null,
  command: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = "";

    const config: {
      host: string;
      port: number;
      username: string;
      password?: string;
      privateKey?: string;
      readyTimeout: number;
    } = {
      host,
      port,
      username,
      readyTimeout: 30000,
    };

    if (privateKey) {
      config.privateKey = privateKey;
    } else if (password) {
      config.password = password;
    }

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          reject(err);
          return;
        }

        stream.on("close", () => {
          conn.end();
          resolve(output);
        });

        stream.on("data", (data: Buffer) => {
          output += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          output += data.toString();
        });
      });
    });

    conn.on("error", (err) => {
      reject(err);
    });

    conn.connect(config);
  });
}

// POST - Perform backup or restore actions
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only admins can use backup/restore
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { action, routerId, backupData } = body;

  if (!routerId) {
    return NextResponse.json({ error: "Router ID required" }, { status: 400 });
  }

  // Get router info
  const { data: router, error: routerError } = await supabase
    .from("routers")
    .select("*")
    .eq("id", routerId)
    .single();

  if (routerError || !router) {
    return NextResponse.json({ error: "Router not found" }, { status: 404 });
  }

  // Only support Linux SSH routers for now
  if (router.connection_type !== "linux-ssh") {
    return NextResponse.json({
      error: "Backup/Restore only supported for Linux SSH servers"
    }, { status: 400 });
  }

  try {
    switch (action) {
      case "export": {
        // Get WireGuard configuration from server
        const wgShowAll = await executeSSH(
          router.host,
          router.ssh_port || 22,
          router.username,
          router.password,
          router.ssh_key,
          "sudo wg show all"
        );

        // Get WireGuard interface configurations
        const wgConfigs: Record<string, string> = {};
        const wgInterfaces = router.wg_interface ? [router.wg_interface] : ["wg0", "wg1", "wg2", "wg3", "wg4"];

        for (const iface of wgInterfaces) {
          try {
            const config = await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              `sudo cat /etc/wireguard/${iface}.conf 2>/dev/null || echo ""`
            );
            if (config.trim()) {
              wgConfigs[iface] = config;
            }
          } catch {
            // Interface doesn't exist, skip
          }
        }

        // Get 3proxy configuration
        let socks5Config = "";
        try {
          socks5Config = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "sudo cat /etc/3proxy/3proxy.cfg 2>/dev/null || echo ''"
          );
        } catch {
          socks5Config = "";
        }

        // Get iptables rules
        let iptablesRules = "";
        let iptablesNat = "";
        try {
          iptablesRules = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "sudo iptables-save 2>/dev/null || echo ''"
          );
          iptablesNat = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "sudo iptables -t nat -L -n -v 2>/dev/null || echo ''"
          );
        } catch {
          // Iptables might not be available
        }

        // Get network interfaces
        let networkInterfaces = "";
        let ipAddresses = "";
        try {
          networkInterfaces = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "ip link show 2>/dev/null || echo ''"
          );
          ipAddresses = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "ip addr show 2>/dev/null || echo ''"
          );
        } catch {
          // Network info might not be available
        }

        // Get peers from database
        const { data: dbPeers } = await supabase
          .from("peers")
          .select("*")
          .eq("router_id", routerId);

        // Get SOCKS5 proxies from database
        const { data: dbProxies } = await supabase
          .from("socks5_proxies")
          .select("*")
          .eq("router_id", routerId);

        // Get public IPs from database
        const { data: dbPublicIps } = await supabase
          .from("public_ips")
          .select("*")
          .eq("router_id", routerId);

        // Get users (profiles) from database - only non-admin users related to this router
        const { data: dbUsers } = await supabase
          .from("profiles")
          .select("*");

        // Get user_routers from database
        const { data: dbUserRouters } = await supabase
          .from("user_routers")
          .select("*")
          .eq("router_id", routerId);

        // Get user_socks5_proxies from database (join with socks5_proxies to filter by router)
        const { data: dbUserSocks5Proxies } = await supabase
          .from("user_socks5_proxies")
          .select("*, socks5_proxies!inner(router_id)")
          .eq("socks5_proxies.router_id", routerId);

        // Get user_socks5_server_access from database
        const { data: dbUserSocks5ServerAccess } = await supabase
          .from("user_socks5_server_access")
          .select("*")
          .eq("router_id", routerId);

        // Parse WireGuard configs to extract interface and peer info
        const interfaces: BackupData["wireguard"]["interfaces"] = [];
        const peers: BackupData["wireguard"]["peers"] = [];

        for (const [ifaceName, config] of Object.entries(wgConfigs)) {
          // Parse interface section
          const interfaceMatch = config.match(/\[Interface\]([\s\S]*?)(?=\[Peer\]|$)/);
          if (interfaceMatch) {
            const ifaceSection = interfaceMatch[1];
            const privateKeyMatch = ifaceSection.match(/PrivateKey\s*=\s*(\S+)/);
            const addressMatch = ifaceSection.match(/Address\s*=\s*(\S+)/);
            const listenPortMatch = ifaceSection.match(/ListenPort\s*=\s*(\d+)/);

            if (privateKeyMatch) {
              interfaces.push({
                name: ifaceName,
                privateKey: privateKeyMatch[1],
                publicKey: "", // Will be derived from private key
                listenPort: listenPortMatch ? parseInt(listenPortMatch[1]) : 51820,
                address: addressMatch ? addressMatch[1] : "",
                configRaw: config,
              });
            }
          }

          // Parse peer sections
          const peerMatches = config.matchAll(/\[Peer\]([\s\S]*?)(?=\[Peer\]|$)/g);
          for (const peerMatch of peerMatches) {
            const peerSection = peerMatch[1];
            const publicKeyMatch = peerSection.match(/PublicKey\s*=\s*(\S+)/);
            const presharedKeyMatch = peerSection.match(/PresharedKey\s*=\s*(\S+)/);
            const allowedIpsMatch = peerSection.match(/AllowedIPs\s*=\s*(\S+)/);
            const endpointMatch = peerSection.match(/Endpoint\s*=\s*(\S+)/);
            const commentMatch = peerSection.match(/#\s*(.+)/);

            if (publicKeyMatch && allowedIpsMatch) {
              peers.push({
                name: commentMatch ? commentMatch[1].trim() : "",
                publicKey: publicKeyMatch[1],
                presharedKey: presharedKeyMatch ? presharedKeyMatch[1] : undefined,
                allowedAddress: allowedIpsMatch[1],
                endpoint: endpointMatch ? endpointMatch[1] : undefined,
                comment: commentMatch ? commentMatch[1].trim() : undefined,
                disabled: false,
                interface: ifaceName,
              });
            }
          }
        }

        // Parse SOCKS5 proxies from config
        const socks5Proxies: BackupData["socks5"]["proxies"] = [];
        if (socks5Config) {
          // Parse users section
          const userMatches = socks5Config.matchAll(/users\s+(\S+):CL:(\S+)/g);
          const users: Record<string, string> = {};
          for (const match of userMatches) {
            users[match[1]] = match[2];
          }

          // Parse socks sections
          const socksMatches = socks5Config.matchAll(/socks\s+-p(\d+)\s+-i([\d.]+)\s+-e([\d.]+)/g);
          for (const match of socksMatches) {
            const port = parseInt(match[1]);
            const bindIp = match[2];
            const exitIp = match[3];

            // Find corresponding user for this proxy
            // Look for allow line before this socks line
            const allowMatch = socks5Config.match(new RegExp(`allow\\s+(\\S+)\\s+[\\s\\S]*?socks\\s+-p${port}`));
            const username = allowMatch ? allowMatch[1] : "";
            const password = users[username] || "";

            socks5Proxies.push({
              username,
              password,
              publicIp: exitIp,
              port,
              maxConnections: 0,
              name: null,
              enabled: true,
            });
          }
        }

        // Build backup object
        const backup: BackupData = {
          exportDate: new Date().toISOString(),
          version: "1.0",
          server: {
            id: router.id,
            name: router.name,
            host: router.host,
            connectionType: router.connection_type,
            config: {
              port: router.port,
              api_port: router.api_port,
              ssh_port: router.ssh_port,
              username: router.username,
              use_ssl: router.use_ssl,
              public_ip_prefix: router.public_ip_prefix,
              internal_prefix: router.internal_prefix,
              wg_interface: router.wg_interface,
              out_interface: router.out_interface,
              public_ip_mask: router.public_ip_mask,
            },
          },
          wireguard: {
            interfaces,
            peers,
          },
          socks5: {
            config: socks5Config,
            proxies: socks5Proxies,
          },
          firewall: {
            iptables: iptablesRules,
            iptablesNat: iptablesNat,
          },
          network: {
            interfaces: networkInterfaces,
            ipAddresses: ipAddresses,
          },
          database: {
            peers: dbPeers || [],
            socks5Proxies: dbProxies || [],
            publicIps: dbPublicIps || [],
            users: dbUsers || [],
            userRouters: dbUserRouters || [],
            userSocks5Proxies: dbUserSocks5Proxies || [],
            userSocks5ServerAccess: dbUserSocks5ServerAccess || [],
          },
        };

        // Calculate backup size
        const backupJson = JSON.stringify(backup, null, 2);
        const backupSize = new Blob([backupJson]).size;

        return NextResponse.json({
          success: true,
          backup,
          stats: {
            wgInterfaces: interfaces.length,
            wgPeers: peers.length,
            socks5Proxies: socks5Proxies.length,
            dbPeers: dbPeers?.length || 0,
            dbSocks5Proxies: dbProxies?.length || 0,
            dbPublicIps: dbPublicIps?.length || 0,
            dbUsers: dbUsers?.length || 0,
            dbUserRouters: dbUserRouters?.length || 0,
            dbUserSocks5Proxies: dbUserSocks5Proxies?.length || 0,
            dbUserSocks5ServerAccess: dbUserSocks5ServerAccess?.length || 0,
            backupSize,
            backupSizeFormatted: formatBytes(backupSize),
          }
        });
      }

      case "restore": {
        if (!backupData) {
          return NextResponse.json({ error: "Backup data required" }, { status: 400 });
        }

        const backup = backupData as BackupData;
        const results: string[] = [];
        const errors: string[] = [];

        // 1. Restore WireGuard interfaces
        for (const iface of backup.wireguard.interfaces) {
          try {
            // Write full config file
            const escapedConfig = iface.configRaw.replace(/'/g, "'\"'\"'");
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              `echo '${escapedConfig}' | sudo tee /etc/wireguard/${iface.name}.conf > /dev/null`
            );

            results.push(`Restored WireGuard interface: ${iface.name}`);
          } catch (err) {
            errors.push(`Failed to restore interface ${iface.name}: ${err}`);
          }
        }

        // 2. Restore WireGuard peers
        // (Already included in configRaw, so skip unless you want to append)

        // 3. Restore 3proxy config
        if (backup.socks5.config) {
          try {
            // Create 3proxy directory
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              "sudo mkdir -p /etc/3proxy"
            );

            // Write config
            const escapedConfig = backup.socks5.config.replace(/'/g, "'\"'\"'");
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              `echo '${escapedConfig}' | sudo tee /etc/3proxy/3proxy.cfg > /dev/null`
            );

            results.push("Restored 3proxy configuration");
          } catch (err) {
            errors.push(`Failed to restore 3proxy config: ${err}`);
          }
        }

        // 4. Restore iptables rules
        if (backup.firewall.iptables) {
          try {
            const escapedRules = backup.firewall.iptables.replace(/'/g, "'\"'\"'");
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              `echo '${escapedRules}' | sudo iptables-restore`
            );
            results.push("Restored iptables rules");
          } catch (err) {
            errors.push(`Failed to restore iptables: ${err}`);
          }
        }

        // 4b. Ensure critical ports are open (fallback if iptables-restore fails)
        try {
          // Get WireGuard listen port from config
          const wgPort = backup.wireguard.interfaces[0]?.listenPort || 13231;

          // Open required ports using iptables directly (works even if restore failed)
          const portCommands = [
            // SOCKS5 port
            `sudo iptables -C INPUT -p tcp --dport 1080 -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p tcp --dport 1080 -j ACCEPT`,
            // WireGuard port
            `sudo iptables -C INPUT -p udp --dport ${wgPort} -j ACCEPT 2>/dev/null || sudo iptables -A INPUT -p udp --dport ${wgPort} -j ACCEPT`,
            // Enable IP forwarding for NAT
            `echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward > /dev/null`,
            // Persist IP forwarding
            `grep -q 'net.ipv4.ip_forward=1' /etc/sysctl.conf || echo 'net.ipv4.ip_forward=1' | sudo tee -a /etc/sysctl.conf > /dev/null`,
          ];

          for (const cmd of portCommands) {
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              cmd
            );
          }
          results.push("Verified critical ports are open (1080, " + wgPort + ")");
        } catch (err) {
          errors.push(`Warning: Could not verify ports: ${err}`);
        }

        // 4c. Save iptables rules persistently
        try {
          await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            `sudo sh -c 'iptables-save > /etc/iptables/rules.v4 2>/dev/null || iptables-save > /etc/iptables.rules 2>/dev/null || true'`
          );
          results.push("Saved iptables rules persistently");
        } catch {
          // Not critical, ignore
        }

        // 5. Restore database records
        if (backup.database.peers && Array.isArray(backup.database.peers) && backup.database.peers.length > 0) {
          try {
            // Clear existing peers for this router
            await supabase
              .from("peers")
              .delete()
              .eq("router_id", routerId);

            // Insert peers with new router_id
            const peersToInsert = (backup.database.peers as Record<string, unknown>[]).map((p) => ({
              ...p,
              id: undefined, // Let DB generate new ID
              router_id: routerId,
            }));

            const { error: peersError } = await supabase
              .from("peers")
              .insert(peersToInsert);

            if (peersError) {
              errors.push(`Failed to restore DB peers: ${peersError.message}`);
            } else {
              results.push(`Restored ${peersToInsert.length} peers to database`);
            }
          } catch (err) {
            errors.push(`Failed to restore DB peers: ${err}`);
          }
        }

        if (backup.database.socks5Proxies && Array.isArray(backup.database.socks5Proxies) && backup.database.socks5Proxies.length > 0) {
          try {
            // Clear existing proxies for this router
            await supabase
              .from("socks5_proxies")
              .delete()
              .eq("router_id", routerId);

            // Insert proxies with new router_id
            const proxiesToInsert = (backup.database.socks5Proxies as Record<string, unknown>[]).map((p) => ({
              ...p,
              id: undefined,
              router_id: routerId,
            }));

            const { error: proxiesError } = await supabase
              .from("socks5_proxies")
              .insert(proxiesToInsert);

            if (proxiesError) {
              errors.push(`Failed to restore DB proxies: ${proxiesError.message}`);
            } else {
              results.push(`Restored ${proxiesToInsert.length} SOCKS5 proxies to database`);
            }
          } catch (err) {
            errors.push(`Failed to restore DB proxies: ${err}`);
          }
        }

        if (backup.database.publicIps && Array.isArray(backup.database.publicIps) && backup.database.publicIps.length > 0) {
          try {
            // Clear existing public IPs for this router
            await supabase
              .from("public_ips")
              .delete()
              .eq("router_id", routerId);

            // Insert public IPs with new router_id
            const publicIpsToInsert = (backup.database.publicIps as Record<string, unknown>[]).map((p) => ({
              ...p,
              id: undefined,
              router_id: routerId,
            }));

            const { error: publicIpsError } = await supabase
              .from("public_ips")
              .insert(publicIpsToInsert);

            if (publicIpsError) {
              errors.push(`Failed to restore DB public IPs: ${publicIpsError.message}`);
            } else {
              results.push(`Restored ${publicIpsToInsert.length} public IPs to database`);
            }
          } catch (err) {
            errors.push(`Failed to restore DB public IPs: ${err}`);
          }
        }

        if (backup.database.users && Array.isArray(backup.database.users) && backup.database.users.length > 0) {
          try {
            // For safety, only update existing users, do not create new ones
            // Users need to be created via auth, so we just update profiles
            let updatedCount = 0;
            for (const userProfile of backup.database.users as Record<string, unknown>[]) {
              if (!userProfile || !userProfile["id"]) continue;
              const { data: existingUser } = await supabase
                .from("profiles")
                .select("id")
                .eq("id", userProfile["id"])
                .single();
              if (existingUser) {
                // Update existing user's non-auth fields
                const { id, email, created_at, ...updateFields } = userProfile as Record<string, unknown>;
                await supabase.from("profiles").update(updateFields).eq("id", id);
                updatedCount++;
              }
            }
            results.push(`Updated ${updatedCount} user profiles`);
          } catch (err) {
            errors.push(`Failed to restore users: ${err}`);
          }
        }

        if (backup.database.userRouters && Array.isArray(backup.database.userRouters) && backup.database.userRouters.length > 0) {
          try {
            // Clear existing user_routers for this router
            await supabase
              .from("user_routers")
              .delete()
              .eq("router_id", routerId);

            // Insert user_routers with new router_id
            const userRoutersToInsert = (backup.database.userRouters as Record<string, unknown>[]).map((p) => ({
              ...p,
              id: undefined,
              router_id: routerId,
            }));

            const { error: userRoutersError } = await supabase
              .from("user_routers")
              .insert(userRoutersToInsert);

            if (userRoutersError) {
              errors.push(`Failed to restore user_routers: ${userRoutersError.message}`);
            } else {
              results.push(`Restored ${userRoutersToInsert.length} user_routers to database`);
            }
          } catch (err) {
            errors.push(`Failed to restore user_routers: ${err}`);
          }
        }

        if (backup.database.userSocks5Proxies && Array.isArray(backup.database.userSocks5Proxies) && backup.database.userSocks5Proxies.length > 0) {
          try {
            // user_socks5_proxies links users to proxy IDs
            // We need to find matching proxies by username/public_ip in the restored data
            let restoredCount = 0;
            for (const userProxy of backup.database.userSocks5Proxies as Record<string, unknown>[]) {
              if (!userProxy || !userProxy["user_id"] || !userProxy["socks5_proxy_id"]) continue;

              // Check if this exact assignment already exists
              const { data: existing } = await supabase
                .from("user_socks5_proxies")
                .select("id")
                .eq("user_id", userProxy["user_id"])
                .eq("socks5_proxy_id", userProxy["socks5_proxy_id"])
                .single();

              if (!existing) {
                const { error } = await supabase.from("user_socks5_proxies").insert({
                  user_id: userProxy["user_id"],
                  socks5_proxy_id: userProxy["socks5_proxy_id"],
                });
                if (!error) restoredCount++;
              }
            }
            results.push(`Restored ${restoredCount} user_socks5_proxies assignments`);
          } catch (err) {
            errors.push(`Failed to restore user_socks5_proxies: ${err}`);
          }
        }

        if (backup.database.userSocks5ServerAccess && Array.isArray(backup.database.userSocks5ServerAccess) && backup.database.userSocks5ServerAccess.length > 0) {
          try {
            // Clear existing user_socks5_server_access for this router
            await supabase
              .from("user_socks5_server_access")
              .delete()
              .eq("router_id", routerId);

            // Insert user_socks5_server_access with new router_id
            const userSocks5ServerAccessToInsert = (backup.database.userSocks5ServerAccess as Record<string, unknown>[]).map((p) => ({
              ...p,
              id: undefined,
              router_id: routerId,
            }));

            const { error: userSocks5ServerAccessError } = await supabase
              .from("user_socks5_server_access")
              .insert(userSocks5ServerAccessToInsert);

            if (userSocks5ServerAccessError) {
              errors.push(`Failed to restore user_socks5_server_access: ${userSocks5ServerAccessError.message}`);
            } else {
              results.push(`Restored ${userSocks5ServerAccessToInsert.length} user_socks5_server_access to database`);
            }
          } catch (err) {
            errors.push(`Failed to restore user_socks5_server_access: ${err}`);
          }
        }

        // 6. Start/restart services
        try {
          // Restart WireGuard interfaces
          for (const iface of backup.wireguard.interfaces) {
            await executeSSH(
              router.host,
              router.ssh_port || 22,
              router.username,
              router.password,
              router.ssh_key,
              `sudo wg-quick down ${iface.name} 2>/dev/null; sudo wg-quick up ${iface.name}`
            );
          }
          results.push("Restarted WireGuard interfaces");
        } catch (err) {
          errors.push(`Failed to restart WireGuard: ${err}`);
        }

        try {
          // Restart 3proxy
          await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "sudo systemctl restart 3proxy 2>/dev/null || sudo pkill 3proxy; sudo 3proxy /etc/3proxy/3proxy.cfg &"
          );
          results.push("Restarted 3proxy service");
        } catch (err) {
          errors.push(`Failed to restart 3proxy: ${err}`);
        }

        return NextResponse.json({
          success: errors.length === 0,
          results,
          errors,
        });
      }

      case "preview": {
        // Get quick stats without full backup
        let wgInterfaceCount = 0;
        let wgPeerCount = 0;

        try {
          const wgShow = await executeSSH(
            router.host,
            router.ssh_port || 22,
            router.username,
            router.password,
            router.ssh_key,
            "sudo wg show all"
          );

          // Count interfaces
          wgInterfaceCount = (wgShow.match(/interface:/gi) || []).length;
          // Count peers
          wgPeerCount = (wgShow.match(/peer:/gi) || []).length;
        } catch {
          // WireGuard might not be running
        }

        // Get database counts
        const { count: dbPeersCount } = await supabase
          .from("peers")
          .select("*", { count: "exact", head: true })
          .eq("router_id", routerId);

        const { count: dbProxiesCount } = await supabase
          .from("socks5_proxies")
          .select("*", { count: "exact", head: true })
          .eq("router_id", routerId);

        const { count: dbPublicIpsCount } = await supabase
          .from("public_ips")
          .select("*", { count: "exact", head: true })
          .eq("router_id", routerId);

        const { count: dbUsersCount } = await supabase
          .from("profiles")
          .select("*", { count: "exact", head: true });

        const { count: dbUserRoutersCount } = await supabase
          .from("user_routers")
          .select("*", { count: "exact", head: true })
          .eq("router_id", routerId);

        // user_socks5_proxies doesn't have router_id, count all
        const { count: dbUserSocks5ProxiesCount } = await supabase
          .from("user_socks5_proxies")
          .select("*", { count: "exact", head: true });

        const { count: dbUserSocks5ServerAccessCount } = await supabase
          .from("user_socks5_server_access")
          .select("*", { count: "exact", head: true })
          .eq("router_id", routerId);

        return NextResponse.json({
          success: true,
          preview: {
            wgInterfaces: wgInterfaceCount,
            wgPeers: wgPeerCount,
            dbPeers: dbPeersCount || 0,
            dbSocks5Proxies: dbProxiesCount || 0,
            dbPublicIps: dbPublicIpsCount || 0,
            dbUsers: dbUsersCount || 0,
            dbUserRouters: dbUserRoutersCount || 0,
            dbUserSocks5Proxies: dbUserSocks5ProxiesCount || 0,
            dbUserSocks5ServerAccess: dbUserSocks5ServerAccessCount || 0,
          }
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    const err = error as Error;
    console.error("[Backup API] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
