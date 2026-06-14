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
          setState({ kind: "error", message: "Abrí esta página desde el bot de Telegram." });
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
          setState({ kind: "error", message: json.error || "No se pudo iniciar sesión." });
          return;
        }
        setState({ kind: "ok" });
        // La cookie de sesión ya está seteada: cargar el panel en el webview.
        window.location.replace("/dashboard");
      } catch {
        setState({ kind: "error", message: "Error de red. Probá de nuevo." });
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
            <p className="text-sm text-muted-foreground">Iniciando sesión…</p>
          </>
        )}
        {state.kind === "ok" && (
          <>
            <ShieldCheck className="w-8 h-8 mx-auto text-green-500" />
            <p className="text-sm text-muted-foreground">Listo, abriendo el panel…</p>
          </>
        )}
        {state.kind === "error" && (
          <>
            <ShieldAlert className="w-8 h-8 mx-auto text-destructive" />
            <p className="text-sm font-medium">No se pudo entrar</p>
            <p className="text-sm text-muted-foreground">{state.message}</p>
          </>
        )}
      </div>
    </div>
  );
}
