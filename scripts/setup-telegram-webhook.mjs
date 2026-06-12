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
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token || !appUrl) {
  console.error("Faltan TELEGRAM_BOT_TOKEN y/o NEXT_PUBLIC_APP_URL");
  process.exit(1);
}

const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret || undefined,
    allowed_updates: ["message"],
  }),
});
const json = await res.json();
console.log("setWebhook:", JSON.stringify(json, null, 2));

// Botón de menú que abre la Mini App directamente
const menuRes = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_button: {
      type: "web_app",
      text: "VPN Store",
      web_app: { url: `${appUrl.replace(/\/$/, "")}/tg` },
    },
  }),
});
console.log("setChatMenuButton:", JSON.stringify(await menuRes.json(), null, 2));
