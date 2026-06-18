"use client";

import { useEffect, useRef, useState } from "react";

// Custom pull-to-refresh for the Telegram Mini App. Telegram's WebView has no
// native pull-to-refresh, and disableVerticalSwipes() frees the downward drag,
// so we own the gesture: pull down from the very top past a threshold and
// release to refresh. Pass `onRefresh` for a soft refresh (re-fetch without a
// full reload); without it, falls back to window.location.reload(). Only active
// inside Telegram. Renders a follow-the-finger spinner; never blocks taps.

const THRESHOLD = 110; // px of pull needed to trigger
const MAX_PULL = 160; // cap the indicator travel
const DAMP = 0.45; // resistance (lower = must drag farther)
const START = 14; // dead-zone: ignore the first few px so a casual scroll doesn't engage

export function PullToRefresh({ onRefresh }: { onRefresh?: () => Promise<void> | void }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullRef = useRef(0);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const apply = (v: number) => {
    pullRef.current = v;
    setPull(v);
  };

  useEffect(() => {
    const tg = (window as unknown as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
    if (!tg || !tg.initData) return; // only inside Telegram

    const atTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY) <= 0;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1 || !atTop()) {
        startY.current = null;
        return;
      }
      startY.current = e.touches[0].clientY;
      active.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (refreshingRef.current || startY.current === null) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= START || !atTop()) {
        if (active.current) {
          active.current = false;
          apply(0);
        }
        return;
      }
      active.current = true;
      apply(Math.min(MAX_PULL, (dy - START) * DAMP));
      if (e.cancelable) e.preventDefault(); // suppress native overscroll while pulling
    };

    const finish = () => {
      refreshingRef.current = false;
      setRefreshing(false);
      apply(0);
    };

    const onEnd = () => {
      if (startY.current === null) return;
      const shouldRefresh = active.current && pullRef.current >= THRESHOLD;
      startY.current = null;
      active.current = false;
      if (!shouldRefresh) {
        apply(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      apply(THRESHOLD);
      const fn = onRefreshRef.current;
      if (fn) {
        Promise.resolve(fn()).finally(finish);
      } else {
        window.location.reload();
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const offset = refreshing ? THRESHOLD : pull;
  const ready = pull >= THRESHOLD || refreshing;

  return (
    <div
      aria-hidden
      className="fixed inset-x-0 top-0 z-[200] flex justify-center pointer-events-none"
      style={{
        transform: `translateY(${offset - 36}px)`,
        opacity: offset > 0 ? 1 : 0,
        transition: pull === 0 || refreshing ? "transform 0.2s ease, opacity 0.2s ease" : "none",
      }}
    >
      <div className="mt-3 grid h-[30px] w-[30px] place-items-center rounded-full bg-card border border-border shadow-md">
        <span
          className={`block h-4 w-4 rounded-full border-2 border-muted ${refreshing ? "animate-spin" : ""}`}
          style={{
            borderTopColor: "hsl(var(--primary))",
            opacity: ready ? 1 : 0.6,
            transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
          }}
        />
      </div>
    </div>
  );
}
