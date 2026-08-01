"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// When the app runs inside the Telegram WebView (notably the embedded admin
// panel reached from the bot), expand to full height and disable the vertical
// swipe-to-close gesture so a scroll never closes the Mini App. It also tells
// Telegram the app's (dark) background so the native controls (status-bar
// text, floating ⌄/⋯ pill) pick a readable tint, and puts the customer Mini
// App (/tg) in fullscreen on phones. No-op in a normal browser. Mounted
// app-wide in the root layout.
//
// The embedded panel reaches /dashboard via a full navigation, which drops the
// #tgWebAppData launch params; we remember "we're in Telegram" in sessionStorage
// so the guard keeps working across in-panel reloads.

type WebApp = {
  initData?: string;
  /** 'unknown' when the SDK runs outside Telegram (e.g. a normal browser). */
  platform?: string;
  ready?: () => void;
  expand?: () => void;
  disableVerticalSwipes?: () => void;
  /** Bot API 6.1+ — header/background color for Telegram's native controls. */
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  /** Bot API 8.0+ — fullscreen mode (app covers the status bar). */
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  isFullscreen?: boolean;
};

const FLAG = "tg_inapp";
// hsl(0 0% 4%) — the app's --background in globals.css.
const APP_BG = "#0a0a0a";

export function TelegramViewport() {
  const pathname = usePathname();

  useEffect(() => {
    let tries = 0;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
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
        // expand() while already fullscreen makes iOS re-layout the viewport
        // (scroll jank), and the admin flow reloads the page twice — so every
        // step here must be a no-op when the state is already right.
        if (!tg.isFullscreen) tg.expand?.();
        tg.disableVerticalSwipes?.(); // Bot API 7.7+; no-op on older clients
        tg.setHeaderColor?.(APP_BG);
        tg.setBackgroundColor?.(APP_BG);
        // Fullscreen (Bot API 8.0+) gives the Mini App the native ⌄ minimize
        // control. Phones only (on desktop it would maximize the window).
        // Applies on every route: the embedded admin panel pads its fixed
        // chrome with --tg-top, so an admin flowing /tg → /tg/admin →
        // /dashboard keeps fullscreen instead of bouncing back to a sheet.
        if ((tg.platform === "ios" || tg.platform === "android") && !tg.isFullscreen) {
          tg.requestFullscreen?.();
        }
      } catch {
        /* older clients may lack some methods */
      }
    };
    apply();
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
