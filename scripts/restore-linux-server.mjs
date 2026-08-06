#!/usr/bin/env node
/**
 * Restore a formatted Linux WireGuard server from the data stored in Supabase.
 *
 * Rebuilds: base packages, panel SSH user (from the routers row), the WG
 * interface (new keypair, same listen port), all public IPs + SNAT rules from
 * `public_ips`, and every enabled peer from `linux_peers` (same keys/IPs).
 * Idempotent: safe to re-run; every step checks before creating.
 *
 * Usage:
 *   node scripts/restore-linux-server.mjs --host 12.164.34.2 \
 *     --ssh-user gdinardo --ssh-pass 'SECRET' [--listen-port 51824] [--dry-run]
 *
 * The bootstrap SSH user must be able to sudo with its password.
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("ssh2");

// ---------- args ----------
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--")) args[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = process.argv[++i];
}
if (!args.host || !args.sshUser || !args.sshPass) {
  console.error("Usage: node scripts/restore-linux-server.mjs --host <ip> --ssh-user <user> --ssh-pass <pass> [--listen-port N] [--dry-run]");
  process.exit(1);
}

// ---------- env / supabase ----------
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1";
const SB_HEADERS = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};
async function sb(path, opts = {}) {
  const res = await fetch(`${SB}/${path}`, { headers: SB_HEADERS, ...opts });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// ---------- ssh ----------
const conn = new Client();
function connect() {
  return new Promise((resolve, reject) => {
    conn.on("ready", resolve).on("error", reject).connect({
      host: args.host,
      port: 22,
      username: args.sshUser,
      password: args.sshPass,
      readyTimeout: 20000,
    });
  });
}
function rawExec(command, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`SSH timeout: ${command.slice(0, 80)}`)), timeoutMs);
    conn.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let out = "", errOut = "";
      stream
        .on("data", (d) => (out += d))
        .stderr.on("data", (d) => (errOut += d));
      stream.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, out: out.trim(), err: errOut.trim() });
      });
    });
  });
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
// Run an arbitrary shell script as root: base64 avoids all quoting pitfalls.
async function sudoScript(script, timeoutMs = 120000) {
  if (args.dryRun) { console.log("  [dry-run script]\n" + script.split("\n").map((l) => "    " + l).join("\n")); return { code: 0, out: "", err: "" }; }
  const b64 = Buffer.from(script, "utf8").toString("base64");
  return rawExec(`echo ${q(args.sshPass)} | sudo -S bash -c 'echo ${b64} | base64 -d | bash'`, timeoutMs);
}
async function sudoCmd(cmd, timeoutMs = 120000) {
  return sudoScript(cmd, timeoutMs);
}
function die(msg, r) {
  console.error(`FATAL: ${msg}${r ? `\n  code=${r.code}\n  out=${r.out}\n  err=${r.err}` : ""}`);
  process.exit(1);
}
const log = (m) => console.log(m);

// ==========================================================================
log(`\n=== Restore ${args.host} ===`);

// ---------- fetch DB data ----------
const routers = await sb(`routers?select=*&host=eq.${args.host}`);
if (routers.length !== 1) die(`expected 1 router row for host ${args.host}, got ${routers.length}`);
const router = routers[0];
const rid = router.id;
log(`Router: "${router.name}" (${rid})`);
log(`  wg_interface=${router.wg_interface} out_interface=${router.out_interface} prefix=${router.public_ip_prefix} internal=${router.internal_prefix} mask=${router.public_ip_mask}`);

const publicIps = await sb(`public_ips?select=ip_number,public_ip,internal_subnet,wg_interface,enabled&router_id=eq.${rid}&order=ip_number`);
const peers = await sb(`linux_peers?select=public_key,allowed_ips,name,disabled&router_id=eq.${rid}`);
const tgPeers = await sb(`tg_customer_peers?select=id,wg_interface,listen_port&router_id=eq.${rid}`);
const enabledPeers = peers.filter((p) => !p.disabled && p.public_key && p.allowed_ips);
const listenPort = Number(args.listenPort) || tgPeers[0]?.listen_port || 51821;
const wgIface = router.wg_interface || "wg0";
const internalPrefix = router.internal_prefix || "10.10";
const publicPrefix = router.public_ip_prefix;
const mask = router.public_ip_mask || "/24";
log(`Data: ${publicIps.length} public IPs, ${peers.length} peers (${enabledPeers.length} enabled), listen port ${listenPort}, iface ${wgIface}`);

await connect();
log(`SSH connected as ${args.sshUser}`);

// ---------- Phase A: recon ----------
log(`\n--- Phase A: recon ---`);
const os = await rawExec(`cat /etc/os-release | head -2`);
log(`OS: ${os.out.replace(/\n/g, " ")}`);
const sudoTest = await sudoCmd(`id -u`);
if (sudoTest.code !== 0 || sudoTest.out !== "0") die("sudo with password failed for bootstrap user", sudoTest);
log(`sudo: OK`);

// Detect the NIC that carries the primary public IP.
const addrShow = await rawExec(`ip -o -4 addr show`);
const nicLine = addrShow.out.split("\n").find((l) => l.includes(` ${args.host}/`));
if (!nicLine) die(`could not find NIC holding ${args.host} in:\n${addrShow.out}`);
const outIface = nicLine.trim().split(/\s+/)[1];
log(`Out interface detected: ${outIface}${outIface !== router.out_interface ? `  (DB says ${router.out_interface} — will update DB)` : ""}`);
const primaryIpsOnNic = new Set(
  addrShow.out.split("\n")
    .filter((l) => l.trim().split(/\s+/)[1] === outIface)
    .map((l) => l.match(/inet (\d+\.\d+\.\d+\.\d+)\//)?.[1])
    .filter(Boolean)
);

// ---------- Phase B: base system ----------
log(`\n--- Phase B: base system ---`);
let r = await sudoScript(
  `export DEBIAN_FRONTEND=noninteractive
echo iptables-persistent iptables-persistent/autosave_v4 boolean false | debconf-set-selections
echo iptables-persistent iptables-persistent/autosave_v6 boolean false | debconf-set-selections
apt-get update -qq
apt-get install -y -qq wireguard-tools iptables-persistent >/dev/null
wg --version`,
  420000
);
if (r.code !== 0) die("package install failed", r);
log(`Packages: ${r.out.split("\n").pop()}`);

// Panel user from the routers row, same password as before the format.
r = await sudoScript(
  `id -u ${router.username} >/dev/null 2>&1 || useradd -m -s /bin/bash ${router.username}
echo ${q(`${router.username}:${router.password}`)} | chpasswd
cat > /etc/sudoers.d/${router.username} <<'EOF'
${router.username} ALL=(ALL) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick, /sbin/iptables, /usr/sbin/iptables, /sbin/ip, /usr/sbin/ip, /usr/sbin/iptables-save, /bin/cat, /bin/ls, /bin/systemctl, /usr/bin/bash, /usr/bin/tee, /bin/chmod, /bin/rm
EOF
chmod 440 /etc/sudoers.d/${router.username}
visudo -c -q && echo SUDOERS_OK`
);
if (r.code !== 0 || !r.out.includes("SUDOERS_OK")) die(`user ${router.username} / sudoers setup failed`, r);
log(`User ${router.username}: OK (sudoers valid)`);

r = await sudoScript(
  `printf 'net.ipv4.ip_forward=1\\n' > /etc/sysctl.d/99-wireguard.conf
sysctl -w net.ipv4.ip_forward=1 -q
sysctl -n net.ipv4.ip_forward`
);
if (r.out.trim().split("\n").pop() !== "1") die("ip_forward not enabled", r);
log(`ip_forward: 1`);

// ---------- Phase C: WG interface ----------
log(`\n--- Phase C: interface ${wgIface} ---`);
const confExists = (await sudoCmd(`test -f /etc/wireguard/${wgIface}.conf && echo yes || echo no`)).out === "yes";
let serverPub;
if (confExists) {
  log(`/etc/wireguard/${wgIface}.conf already exists — keeping it (idempotent re-run)`);
  serverPub = (await sudoCmd(`wg show ${wgIface} public-key || (cat /etc/wireguard/${wgIface}.conf | grep PrivateKey | cut -d= -f2- | tr -d ' ' | wg pubkey)`)).out.trim();
} else {
  const keyR = await sudoCmd(`k=$(wg genkey); echo "$k"; echo "$k" | wg pubkey`);
  if (keyR.code !== 0) die("wg genkey failed", keyR);
  const [priv, pub] = keyR.out.split("\n").map((s) => s.trim());
  serverPub = pub;
  // All internal gateways go straight into the conf so they persist from boot 0.
  const addresses = publicIps.map((ip) => `${ip.internal_subnet}.1/24`);
  const conf =
    `[Interface]\nPrivateKey = ${priv}\nListenPort = ${listenPort}\n` +
    addresses.map((a) => `Address = ${a}`).join("\n") + "\n" +
    `PostUp = iptables -A FORWARD -i ${wgIface} -j ACCEPT; iptables -A FORWARD -o ${wgIface} -j ACCEPT;\n` +
    `PostDown = iptables -D FORWARD -i ${wgIface} -j ACCEPT; iptables -D FORWARD -o ${wgIface} -j ACCEPT;\n`;
  const confB64 = Buffer.from(conf, "utf8").toString("base64");
  r = await sudoScript(
    `echo ${confB64} | base64 -d > /etc/wireguard/${wgIface}.conf
chmod 600 /etc/wireguard/${wgIface}.conf
systemctl enable wg-quick@${wgIface} -q
systemctl start wg-quick@${wgIface}
wg show ${wgIface} listen-port`,
    180000
  );
  if (r.code !== 0 || !r.out.includes(String(listenPort))) die(`${wgIface} did not start`, r);
  log(`${wgIface} up, listening on ${listenPort}. NEW SERVER KEYS — SAVE THESE:`);
  log(`  PrivateKey: ${priv}`);
  log(`  PublicKey:  ${pub}`);
}
log(`Server public key: ${serverPub}`);

// ---------- Phase D: public IPs + SNAT ----------
log(`\n--- Phase D: ${publicIps.length} public IPs + SNAT on ${outIface} ---`);
const ipCmds = [];
const persistLines = [];
for (const ip of publicIps) {
  persistLines.push(`ip addr add ${ip.public_ip}${mask} dev ${outIface} 2>/dev/null || true`);
  if (!primaryIpsOnNic.has(ip.public_ip)) {
    ipCmds.push(`ip addr show ${outIface} | grep -qw "${ip.public_ip}" || ip addr add ${ip.public_ip}${mask} dev ${outIface}`);
  }
  ipCmds.push(
    `iptables -t nat -C POSTROUTING -s ${ip.internal_subnet}.0/24 -o ${outIface} -j SNAT --to-source ${ip.public_ip} 2>/dev/null || ` +
    `iptables -t nat -I POSTROUTING 1 -s ${ip.internal_subnet}.0/24 -o ${outIface} -j SNAT --to-source ${ip.public_ip}`
  );
}
// chunks keep each SSH exec well under arg limits
for (let i = 0; i < ipCmds.length; i += 100) {
  r = await sudoScript(ipCmds.slice(i, i + 100).join("\n"), 300000);
  if (r.code !== 0) die(`public IP / SNAT batch failed at chunk ${i}`, r);
  log(`  batch ${Math.min(i + 100, ipCmds.length)}/${ipCmds.length} OK`);
}
// Boot persistence: oneshot unit re-adds the IP aliases (the original setup
// never persisted them); iptables-persistent restores rules.v4.
r = await sudoScript(
  `cat > /usr/local/sbin/wg-public-ips.sh <<'EOF'
#!/bin/bash
${persistLines.join("\n")}
EOF
chmod 755 /usr/local/sbin/wg-public-ips.sh
cat > /etc/systemd/system/wg-public-ips.service <<'EOF'
[Unit]
Description=Re-add WireGuard public IP aliases
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/wg-public-ips.sh

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable wg-public-ips.service -q
sh -c 'iptables-save > /etc/iptables/rules.v4'
echo PERSIST_OK`
);
if (!r.out.includes("PERSIST_OK")) die("persistence setup failed", r);
log(`Persistence: oneshot unit + /etc/iptables/rules.v4 written`);

// ---------- Phase E: peers ----------
log(`\n--- Phase E: ${enabledPeers.length} peers ---`);
const peerCmds = enabledPeers.map((p) => `wg set ${wgIface} peer ${q(p.public_key)} allowed-ips ${q(p.allowed_ips)}`);
for (let i = 0; i < peerCmds.length; i += 50) {
  r = await sudoScript(peerCmds.slice(i, i + 50).join("\n"), 180000);
  if (r.code !== 0) die(`peer batch failed at chunk ${i}`, r);
  log(`  peers ${Math.min(i + 50, peerCmds.length)}/${peerCmds.length} OK`);
}
r = await sudoCmd(`wg-quick save ${wgIface} && echo SAVED`, 180000);
if (!r.out.includes("SAVED") && !r.err.includes("SAVED")) die(`wg-quick save failed`, r);
log(`wg-quick save: OK (conf now holds all peers + addresses)`);

// ---------- verification ----------
log(`\n--- Verification ---`);
const vPeers = await sudoCmd(`wg show ${wgIface} peers | wc -l`);
const vIps = await rawExec(`ip -o -4 addr show ${outIface} | grep -c "inet ${publicPrefix.split(".").slice(0, 2).join(".")}\\." || true`);
const vNat = await sudoCmd(`iptables -t nat -S POSTROUTING | grep -c SNAT || true`);
const vPort = await rawExec(`ss -lun | grep -c ${listenPort} || true`);
log(`peers in wg:   ${vPeers.out}  (expected ${enabledPeers.length})`);
log(`public IPs:    ${vIps.out}   (expected ${publicIps.length})`);
log(`SNAT rules:    ${vNat.out}   (expected ${publicIps.length})`);
log(`udp ${listenPort} listening: ${Number(vPort.out) > 0 ? "yes" : "NO"}`);

// ---------- Phase F: Supabase updates ----------
log(`\n--- Phase F: Supabase ---`);
if (!args.dryRun) {
  if (tgPeers.length > 0) {
    await sb(`tg_customer_peers?router_id=eq.${rid}`, {
      method: "PATCH",
      body: JSON.stringify({ server_public_key: serverPub }),
      headers: { ...SB_HEADERS, Prefer: "return=minimal" },
    });
    log(`tg_customer_peers: server_public_key updated on ${tgPeers.length} rows`);
  }
  if (outIface !== router.out_interface) {
    await sb(`routers?id=eq.${rid}`, {
      method: "PATCH",
      body: JSON.stringify({ out_interface: outIface }),
      headers: { ...SB_HEADERS, Prefer: "return=minimal" },
    });
    log(`routers.out_interface: ${router.out_interface} -> ${outIface}`);
  }
}

conn.end();
log(`\n=== DONE. Next: Force Refresh in the panel; clients must re-download their config (new server PublicKey). ===`);
