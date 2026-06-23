"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export default function TgAdminLoginPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    let attempts = 0;
    const tryLogin = async () => {
      const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
      // El script telegram-web-app.js carga afterInteractive: esperar a que exista.
      if (!tg || !tg.initData) {
        attempts += 1;
        if (attempts > 40) {
          setState({ kind: "error", message: "Open this page from the Telegram bot." });
          return;
        }
        setTimeout(tryLogin, 100);
        return;
      }

      try {
        tg.ready();
        tg.expand();
      } catch {
        /* noop */
      }

      try {
        const res = await fetch("/api/auth/tg-miniapp-login", {
          method: "POST",
          headers: { "x-tg-init-data": tg.initData },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({ kind: "error", message: json.error || "Could not sign in." });
          return;
        }
        setState({ kind: "ok" });
        // La cookie de sesión ya está seteada: cargar el panel en el webview.
        // Conservamos el hash (#tgWebAppData…) para que el SDK en /dashboard
        // detecte que está dentro de Telegram y desactive el swipe-to-close.
        window.location.replace("/dashboard" + window.location.hash);
      } catch {
        setState({ kind: "error", message: "Network error. Please try again." });
      }
    };

    tryLogin();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-sm space-y-4">
        {state.kind === "loading" && (
          <>
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="text-sm text-muted-foreground">Signing in…</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <ShieldCheck className="w-8 h-8 mx-auto text-green-500" />
            <p className="text-sm text-muted-foreground">Done, opening the panel…</p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <ShieldAlert className="w-8 h-8 mx-auto text-destructive" />
            <p className="text-sm font-medium">Couldn't sign in</p>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </>
        )}
      </div>
    </div>
  );
}
