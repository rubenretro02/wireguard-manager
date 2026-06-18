#!/usr/bin/env node
/**
 * Registra el webhook del bot de Telegram apuntando a la app desplegada.
 *
 * Uso:
 *   TELEGRAM_BOT_TOKEN=123:abc NEXT_PUBLIC_APP_URL=https://tuapp.vercel.app \
 *   TELEGRAM_WEBHOOK_SECRET=un-secreto node scripts/setup-telegram-webhook.mjs
 *
 * (también lee las variables de .env.local si existe)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Cargar .env.local básico si las vars no están en el entorno
const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"\n\r]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const agentToken = process.env.TELEGRAM_AGENT_BOT_TOKEN;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !appUrl) {
  console.error("Faltan TELEGRAM_BOT_TOKEN y/o NEXT_PUBLIC_APP_URL");
  process.exit(1);
}

const base = appUrl.replace(/\/$/, "");

async function configureBot(botToken, label, webhookUrl, menuText) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret || undefined,
      // callback_query: necesario para el botón inline "Single Sign On".
      allowed_updates: ["message", "callback_query"],
    }),
  });
  console.log(`[${label}] setWebhook:`, JSON.stringify(await res.json()));

  // Botón de menú que abre la Mini App directamente
  const menuRes = await fetch(`https://api.telegram.org/bot${botToken}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: menuText,
        web_app: { url: `${base}/tg` },
      },
    }),
  });
  console.log(`[${label}] setChatMenuButton:`, JSON.stringify(await menuRes.json()));
}

async function setCommands(botToken, label, commands) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, scope: { type: "all_private_chats" } }),
  });
  console.log(`[${label}] setMyCommands:`, JSON.stringify(await res.json()));
}

await configureBot(token, "store", `${base}/api/telegram/webhook`, "VPN Store");

if (agentToken) {
  await configureBot(agentToken, "agent", `${base}/api/telegram/webhook?bot=agent`, "VPN Manager");
  // El bot agent también sirve de login al panel para admins/semi-admins vinculados.
  // Nota: los comandos del menú solo admiten [a-z0-9_]; "/single-sign-on" no se
  // puede registrar (lo maneja el webhook si se teclea), pero "/sso" sí.
  await setCommands(agentToken, "agent", [
    { command: "sso", description: "Single sign-on to the admin panel" },
    { command: "admin", description: "Sign in to the admin panel (alias of /sso)" },
  ]);
} else {
  console.log("[agent] TELEGRAM_AGENT_BOT_TOKEN no configurado — bot de agents omitido");
}
