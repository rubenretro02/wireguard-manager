#!/usr/bin/env node
/**
 * Peers "fantasma": filas de `linux_peers` con disabled=false cuyo peer ya no está en WireGuard
 * (ver CLAUDE.md 2026-10-07). Para cada uno:
 *   - si su allowed_ips está libre en el server  → lo vuelve a agregar a wg (misma llave, mismo
 *     .conf del cliente) y registra un `enable` en activity_logs;
 *   - si otro peer vivo (o otra fila enabled de la DB) ya usa esa IP → le asigna la siguiente IP
 *     libre del mismo /24, lo deja disabled=true y registra un `update` con la IP vieja y la nueva.
 *
 * Uso:  node scripts/restore-ghost-peers.mjs [--apply] [--host <ip> ...]
 * Sin --apply solo imprime el plan. Lee SUPABASE_ACCESS_TOKEN de .env.local (Management API) y las
 * credenciales SSH de la tabla `routers`. Por host hace UNA conexión para leer y UNA para aplicar
 * (todos los `wg set` en un solo bash): Miami, TX y Zoe banean conexiones repetidas.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "ssh2";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = fs.readFileSync(path.join(root, ".env.local"), "utf8");
const token = env.match(/SUPABASE_ACCESS_TOKEN=(\S+)/)?.[1];
if (!token) throw new Error("SUPABASE_ACCESS_TOKEN missing in .env.local");
const PROJECT = "kqghdmlfweqbkqwiwgct";
const ADMIN_USER_ID = "c147057c-9dfc-4232-ac98-069e85234a08"; // clifordzhughes@gmail.com

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const onlyHosts = args.filter((a, i) => args[i - 1] === "--host");

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok || j?.message) throw new Error(`SQL failed: ${j?.message || r.status}\n${query}`);
  return j;
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function ssh(c, cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const t = setTimeout(() => { conn.end(); reject(new Error("ssh timeout")); }, 120000);
    conn.on("ready", () => {
      conn.exec(`echo ${lit(c.password)} | sudo -S bash -c ${lit(cmd)} 2>/dev/null`, (err, stream) => {
        if (err) { clearTimeout(t); conn.end(); return reject(err); }
        let out = "";
        stream.on("data", (d) => (out += d)).on("close", () => { clearTimeout(t); conn.end(); resolve(out); }).stderr.on("data", () => {});
      });
    }).on("error", (e) => { clearTimeout(t); reject(e); }).connect({
      host: c.host, port: c.ssh_port || 22, username: c.username, password: c.password, readyTimeout: 30000,
    });
  });
}

const logRow = (g, action, details) =>
  sql(`insert into activity_logs (user_id, router_id, action, entity_type, entity_id, entity_name, peer_public_key, details)
       values (${lit(ADMIN_USER_ID)}, ${lit(g.router_id)}, ${lit(action)}, 'peer', ${lit(g.id)}, ${lit(g.name || "")}, ${lit(g.public_key)},
               ${lit(JSON.stringify({ source: "restore-ghost-peers", ...details }))}::jsonb)`);

const routers = await sql(`select id, name, host, username, password, ssh_port, wg_interface from routers where connection_type = 'linux-ssh' order by name`);
const peers = await sql(`select id, router_id, public_key, name, allowed_ips, public_ip, disabled, created_by_email from linux_peers`);
const tgRows = await sql(`select router_id, allowed_address from tg_customer_peers`);

const hosts = new Map();
for (const r of routers) {
  if (!hosts.has(r.host)) hosts.set(r.host, []);
  hosts.get(r.host).push(r);
}

let totalRestored = 0;
let totalRenumbered = 0;

for (const [host, hostRouters] of hosts) {
  if (onlyHosts.length && !onlyHosts.includes(host)) continue;
  const label = hostRouters.map((r) => r.name).join(" / ");
  const routerIds = new Set(hostRouters.map((r) => r.id));
  const rows = peers.filter((p) => routerIds.has(p.router_id));
  console.log(`\n######## ${label} (${host})`);

  // Estado vivo: peers por interface + subred /24 que atiende cada interface
  let dump;
  try {
    dump = await ssh(hostRouters[0], `wg show all dump; echo "---ADDR---"; ip -4 -o addr show | awk "{print \\$2, \\$4}"`);
  } catch (e) {
    console.log(`   SSH ERROR: ${e.message} — skipped`);
    continue;
  }
  const [dumpTxt, addrTxt] = dump.split("---ADDR---");
  const live = new Map(); // publicKey -> { iface, allowed[] }
  for (const line of dumpTxt.split("\n")) {
    const f = line.split("\t");
    if (f.length !== 9) continue;
    live.set(f[1], { iface: f[0], allowed: f[4].split(",").map((s) => s.trim()) });
  }
  const subnetIface = new Map(); // "10.10.89" -> "wg0"
  for (const line of (addrTxt || "").split("\n")) {
    const [iface, cidr] = line.trim().split(" ");
    const m = iface?.startsWith("wg") ? cidr?.match(/^(\d+\.\d+\.\d+)\.\d+\/24$/) : null;
    if (m) subnetIface.set(m[1], iface);
  }
  if (live.size === 0) {
    console.log("   live dump is empty — refusing to act on this host");
    continue;
  }

  const ghosts = rows.filter((p) => !p.disabled && !live.has(p.public_key));
  console.log(`   live peers: ${live.size}, DB rows: ${rows.length}, ghosts: ${ghosts.length}`);

  const restores = []; // { g, iface }
  const renumbers = []; // { g, next, who }
  const taken = new Set();
  for (const v of live.values()) for (const a of v.allowed) taken.add(a);
  for (const p of rows) taken.add(p.allowed_ips);
  for (const t of tgRows) if (routerIds.has(t.router_id)) taken.add(t.allowed_address);

  for (const g of ghosts) {
    const prefix = g.allowed_ips.replace(/\.\d+\/\d+$/, "");
    const iface = subnetIface.get(prefix) || hostRouters.find((r) => r.id === g.router_id)?.wg_interface || "wg0";
    const liveOwner = [...live.entries()].find(([k, v]) => k !== g.public_key && v.iface === iface && v.allowed.includes(g.allowed_ips));
    const dbOwner = rows.find((p) => p.id !== g.id && !p.disabled && p.allowed_ips === g.allowed_ips);
    if (!liveOwner && !dbOwner) {
      restores.push({ g, iface });
      console.log(`   RESTORE  "${g.name?.trim() || "?"}" ${g.allowed_ips} on ${iface} (${g.created_by_email || "?"})`);
      continue;
    }
    let next = null;
    for (let n = 2; n <= 254; n++) {
      const cand = `${prefix}.${n}/32`;
      if (!taken.has(cand)) { next = cand; taken.add(cand); break; }
    }
    const who = liveOwner ? `live peer ${liveOwner[0].slice(0, 10)}…` : `DB row "${dbOwner.name?.trim()}"`;
    console.log(`   RENUMBER "${g.name?.trim() || "?"}" ${g.allowed_ips} → ${next || "NO FREE IP"} (taken by ${who}); stays disabled`);
    if (next) renumbers.push({ g, next, who });
  }

  if (!APPLY) continue;

  // Todos los wg set de este host en un solo exec, después un save por interface y el dump para verificar
  if (restores.length) {
    const ifaces = [...new Set(restores.map((r) => r.iface))];
    const cmd = [
      ...restores.map(({ g, iface }) => `wg set ${iface} peer ${g.public_key} allowed-ips ${g.allowed_ips}`),
      ...ifaces.map((i) => `wg-quick save ${i}`),
      "wg show all dump",
    ].join("; ");
    const out = await ssh(hostRouters[0], cmd);
    const nowLive = new Set(out.split("\n").map((l) => l.split("\t")).filter((f) => f.length === 9).map((f) => f[1]));
    for (const { g, iface } of restores) {
      if (!nowLive.has(g.public_key)) {
        console.log(`      !! "${g.name?.trim()}" not present after wg set — check manually`);
        continue;
      }
      await logRow(g, "enable", { reason: "restored: was missing from the server while enabled in the DB", interface: iface });
      totalRestored++;
    }
    console.log(`   restored ${restores.filter(({ g }) => nowLive.has(g.public_key)).length}/${restores.length}`);
  }

  for (const { g, next, who } of renumbers) {
    await sql(`update linux_peers set allowed_ips = ${lit(next)}, disabled = true where id = ${lit(g.id)}`);
    await sql(`update peer_metadata set allowed_address = ${lit(next)} where router_id = ${lit(g.router_id)} and peer_public_key = ${lit(g.public_key)}`);
    await sql(`update tg_customer_peers set allowed_address = ${lit(next)} where router_id = ${lit(g.router_id)} and peer_public_key = ${lit(g.public_key)}`);
    await logRow(g, "update", {
      reason: "address was reused by another peer while this one was missing from the server; renumbered and left disabled",
      old_address: g.allowed_ips,
      new_address: next,
      taken_by: who,
    });
    totalRenumbered++;
  }
  if (renumbers.length) console.log(`   renumbered ${renumbers.length} (left disabled)`);
}

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"}: restored ${totalRestored}, renumbered+disabled ${totalRenumbered}`);
