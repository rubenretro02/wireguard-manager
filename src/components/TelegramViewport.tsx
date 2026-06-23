"use client";

import { useEffect } from "react";

// When the app runs inside the Telegram WebView (notably the embedded admin
// panel reached from the bot), expand to full height and disable the vertical
// swipe-to-close gesture so a scroll never closes the Mini App. No-op in a
// normal browser. Mounted app-wide in the root layout.
//
// The embedded panel reaches /dashboard via a full navigation, which drops the
// #tgWebAppData launch params; we remember "we're in Telegram" in sessionStorage
// so the guard keeps working across in-panel reloads.

type WebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
};

const FLAG = "tg_inapp";

export function TelegramViewport() {
  useEffect(() => {
    let tries = 0;
    const apply = () => {
      const tg = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
      if (!tg) {
        if (tries++ < 20) setTimeout(apply, 100); // SDK still loading
        return;
      }
      const flagged = sessionStorage.getItem(FLAG) === "1";
      const inTelegram = (tg.initData && tg.initData.length > 0) || flagged;
      if (!inTelegram) return;
      try {
        sessionStorage.setItem(FLAG, "1");
        tg.ready?.();
        tg.expand?.();
        tg.disableVerticalSwipes?.(); // Bot API 7.7+; no-op on older clients
      } catch {
        /* older clients may lack some methods */
      }
    };
    apply();
  }, []);

  return null;
}
