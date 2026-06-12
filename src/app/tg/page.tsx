"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  Activity,
  Bell,
  Clock,
  Copy,
  Download,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  QrCode,
  RefreshCw,
  Shield,
  ShoppingCart,
  Wallet,
  X,
} from "lucide-react";

/* ============ Telegram WebApp types (mínimas) ============ */
interface TelegramWebApp {
  initData: string;
  ready: () => void;
  expand: () => void;
  openLink: (url: string) => void;
  openTelegramLink?: (url: string) => void;
  HapticFeedback?: { notificationOccurred: (type: "error" | "success" | "warning") => void };
  colorScheme?: "light" | "dark";
}

const SUPPORT_BOT = process.env.NEXT_PUBLIC_SUPPORT_BOT || "blackgoatsupport_bot";
declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/* ============ Tipos de la API ============ */
interface Customer {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  customer_type?: "client" | "agent";
}
interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_usd: number;
  duration_days: number;
  router_id: string;
  is_dedicated_ip?: boolean;
}
interface Peer {
  id: string;
  name: string;
  router_id: string;
  public_ip: string;
  allowed_address: string;
  status: "active" | "expired" | "disabled";
  expires_at: string;
  created_at: string;
  plan_id: string | null;
  renewal_price_usd: number | null;
  renewal_duration_days: number | null;
  has_config: boolean;
  config: string | null;
}
interface Payment {
  id: string;
  type: "purchase" | "renewal";
  amount_usd: number;
  status: string;
  payment_url: string | null;
  created_at: string;
}
interface LiveStatus {
  connected: boolean;
  latestHandshake: string | null;
  rx: number;
  tx: number;
}

type Tab = "peers" | "buy" | "payments";

/* ============ Helpers ============ */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`;
}

function daysLeft(expiresAt: string): number {
  return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_LABEL: Record<Peer["status"], string> = {
  active: "Active",
  expired: "Expired",
  disabled: "Disabled",
};
const STATUS_STYLE: Record<Peer["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  expired: "bg-red-500/15 text-red-400",
  disabled: "bg-zinc-500/15 text-zinc-400",
};

export default function TgMiniApp() {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [notInTelegram, setNotInTelegram] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [banned, setBanned] = useState(false);
  const [loading, setLoading] = useState(true);

  const [tab, setTab] = useState<Tab>("peers");
  const [peers, setPeers] = useState<Peer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const [configPeer, setConfigPeer] = useState<Peer | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Peer | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renewPeer, setRenewPeer] = useState<Peer | null>(null);
  const [statuses, setStatuses] = useState<Record<string, LiveStatus | "loading">>({});
  const [buying, setBuying] = useState<string | null>(null); // planId en proceso
  const [pendingPayment, setPendingPayment] = useState<Payment | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initDataRef = useRef<string>("");

  const tgFetch = useCallback(async (path: string, options: RequestInit = {}) => {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-tg-init-data": initDataRef.current,
        ...(options.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 403) setBanned(true);
      throw new Error(json.error || `Error ${res.status}`);
    }
    return json;
  }, []);

  const refreshPeers = useCallback(async () => {
    const { peers } = await tgFetch("/api/tg/peers");
    setPeers(peers);
  }, [tgFetch]);

  const refreshPayments = useCallback(async () => {
    const { payments } = await tgFetch("/api/tg/payments");
    setPayments(payments);
  }, [tgFetch]);

  // Refresca los datos del tab actual (manual = botón, con spinner y toast de error)
  const refreshCurrent = useCallback(
    async (manual: boolean) => {
      if (manual) setRefreshing(true);
      try {
        const jobs: Promise<unknown>[] = [refreshPeers()];
        if (tab === "buy") jobs.push(tgFetch("/api/tg/plans").then((r) => setPlans(r.plans)));
        if (tab === "payments") jobs.push(refreshPayments());
        await Promise.all(jobs);
      } catch (err) {
        if (manual) toast.error(err instanceof Error ? err.message : "Failed to refresh");
      } finally {
        if (manual) setRefreshing(false);
      }
    },
    [tab, refreshPeers, refreshPayments, tgFetch]
  );

  // Auto-refresh cada 10s
  useEffect(() => {
    if (!customer) return;
    const interval = setInterval(() => {
      refreshCurrent(false);
    }, 10000);
    return () => clearInterval(interval);
  }, [customer, refreshCurrent]);

  /* ============ Init: esperar el script de Telegram y autenticar ============ */
  useEffect(() => {
    let tries = 0;
    const interval = setInterval(() => {
      const tg = window.Telegram?.WebApp;
      tries++;
      if (tg?.initData) {
        clearInterval(interval);
        tg.ready();
        tg.expand();
        initDataRef.current = tg.initData;
        setWebApp(tg);
      } else if (tries > 25) {
        clearInterval(interval);
        setNotInTelegram(true);
        setLoading(false);
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!webApp) return;
    (async () => {
      try {
        const { customer } = await tgFetch("/api/tg/auth", { method: "POST" });
        setCustomer(customer);
        const jobs: Promise<unknown>[] = [refreshPeers()];
        // Agents no ven la tienda: no cargamos planes
        if (customer.customer_type !== "agent") {
          jobs.push(tgFetch("/api/tg/plans").then((r) => setPlans(r.plans)));
        }
        await Promise.all(jobs);
      } catch (err) {
        if (!banned) toast.error(err instanceof Error ? err.message : "Connection error");
      } finally {
        setLoading(false);
      }
    })();
  }, [webApp, tgFetch, refreshPeers, banned]);

  /* ============ QR del config ============ */
  useEffect(() => {
    setRotateConfirm(false);
    if (!configPeer?.config) {
      setQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(configPeer.config, { width: 280, margin: 1, color: { dark: "#000000", light: "#ffffff" } })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [configPeer]);

  /* ============ Acciones ============ */
  const renamePeer = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setRenaming(true);
    try {
      const { peer: updated } = await tgFetch("/api/tg/peers", {
        method: "POST",
        body: JSON.stringify({ action: "rename", peerId: renameTarget.id, name: renameValue.trim() }),
      });
      setPeers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setRenameTarget(null);
      toast.success("Name updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setRenaming(false);
    }
  };

  const openSupport = () => {
    const url = `https://t.me/${SUPPORT_BOT}`;
    // openTelegramLink abre el chat dentro de Telegram (openLink iría al browser)
    if (webApp?.openTelegramLink) webApp.openTelegramLink(url);
    else window.open(url, "_blank");
  };

  const copyConfig = async (peer: Peer) => {
    if (!peer.config) return;
    try {
      await navigator.clipboard.writeText(peer.config);
      toast.success("Config copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  const rotateKeys = async (peer: Peer) => {
    setRotating(true);
    try {
      const { peer: updated } = await tgFetch("/api/tg/peers", {
        method: "POST",
        body: JSON.stringify({ action: "rotateKeys", peerId: peer.id }),
      });
      setPeers((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setConfigPeer(updated);
      setRotateConfirm(false);
      webApp?.HapticFeedback?.notificationOccurred("success");
      toast.success("New keys generated — use the new config");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate keys");
    } finally {
      setRotating(false);
    }
  };

  const downloadConfig = (peer: Peer) => {
    if (!peer.config) return;
    const blob = new Blob([peer.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const checkStatus = async (peer: Peer) => {
    setStatuses((s) => ({ ...s, [peer.id]: "loading" }));
    try {
      const { status } = await tgFetch("/api/tg/peers", {
        method: "POST",
        body: JSON.stringify({ action: "status", peerId: peer.id }),
      });
      setStatuses((s) => ({ ...s, [peer.id]: status }));
    } catch (err) {
      setStatuses((s) => {
        const next = { ...s };
        delete next[peer.id];
        return next;
      });
      toast.error(err instanceof Error ? err.message : "Failed to get status");
    }
  };

  const startPaymentPolling = useCallback(
    (paymentId: string) => {
      if (pollRef.current) clearInterval(pollRef.current);
      let ticks = 0;
      pollRef.current = setInterval(async () => {
        ticks++;
        if (ticks > 150) {
          // ~10 min
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        try {
          const { payment } = await tgFetch(`/api/tg/payments?id=${paymentId}`);
          if (payment.status === "paid") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPendingPayment(null);
            webApp?.HapticFeedback?.notificationOccurred("success");
            toast.success("Payment confirmed! Your service is ready 🎉");
            await refreshPeers();
            setTab("peers");
          } else if (["failed", "cancelled", "expired"].includes(payment.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPendingPayment(null);
            toast.error("Payment was not completed");
          }
        } catch {
          /* reintenta en el próximo tick */
        }
      }, 4000);
    },
    [tgFetch, refreshPeers, webApp]
  );

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  // plan = null → renovación con precio propio del peer (sin plan)
  const checkout = async (plan: Plan | null, peer?: Peer) => {
    setBuying(plan?.id || peer?.id || "x");
    try {
      const res = await tgFetch("/api/tg/checkout", {
        method: "POST",
        body: JSON.stringify({ planId: plan?.id, peerId: peer?.id }),
      });
      setRenewPeer(null);
      if (res.free && res.fulfilled) {
        toast.success(peer ? "Peer renewed 🎉" : "Peer created 🎉");
        await refreshPeers();
        setTab("peers");
        return;
      }
      setPendingPayment({
        id: res.paymentId,
        type: peer ? "renewal" : "purchase",
        amount_usd: res.amountUsd,
        status: "pending",
        payment_url: res.paymentUrl,
        created_at: new Date().toISOString(),
      });
      startPaymentPolling(res.paymentId);
      webApp?.openLink(res.paymentUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setBuying(null);
    }
  };

  /* ============ Render ============ */
  if (notInTelegram) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <Shield className="w-12 h-12 text-primary" />
        <h1 className="text-xl font-bold">VPN Store</h1>
        <p className="text-muted-foreground text-sm">
          This app only works inside Telegram.
          <br />
          Open it from the bot.
        </p>
      </div>
    );
  }

  if (banned) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <X className="w-12 h-12 text-red-400" />
        <h1 className="text-xl font-bold">Account suspended</h1>
        <p className="text-muted-foreground text-sm">Contact support for more information.</p>
        <button
          onClick={openSupport}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-sm font-medium"
        >
          <Bell className="w-4 h-4" /> Support
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Agents: solo gestionan sus peers — sin tienda, sin precios, sin pagos
  const isAgent = customer?.customer_type === "agent";

  return (
    <div className="min-h-screen pb-20 max-w-lg mx-auto">
      {/* Header */}
      <header className="px-4 pt-5 pb-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-bold leading-tight">VPN Store</h1>
          <p className="text-xs text-muted-foreground truncate">
            Hi, {customer?.first_name || customer?.username || "there"} 👋
          </p>
        </div>
        <button
          onClick={openSupport}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Bell className="w-4 h-4" /> Support
        </button>
        <button
          onClick={() => refreshCurrent(true)}
          disabled={refreshing}
          aria-label="Refresh"
          className="p-2.5 rounded-xl bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Pago pendiente */}
      {pendingPayment && (
        <div className="mx-4 mb-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400 shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-amber-300">Waiting for ${Number(pendingPayment.amount_usd).toFixed(2)} payment…</p>
            <p className="text-xs text-amber-300/70">It confirms automatically once received.</p>
          </div>
          {pendingPayment.payment_url && (
            <button
              onClick={() => webApp?.openLink(pendingPayment.payment_url as string)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 font-medium"
            >
              Reopen
            </button>
          )}
        </div>
      )}

      {/* Contenido */}
      <main className="px-4 space-y-3">
        {tab === "peers" && (
          <>
            {peers.length === 0 ? (
              <div className="text-center py-16 space-y-3">
                <Globe className="w-10 h-10 text-muted-foreground mx-auto" />
                <p className="text-sm text-muted-foreground">
                  {isAgent ? "No peers assigned to you yet." : "You don't have any peers yet."}
                </p>
                {!isAgent && (
                  <button
                    onClick={() => setTab("buy")}
                    className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
                  >
                    Buy my first access
                  </button>
                )}
              </div>
            ) : (
              peers.map((peer) => {
                const live = statuses[peer.id];
                const days = daysLeft(peer.expires_at);
                return (
                  <div key={peer.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex items-center gap-1.5">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{peer.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{peer.public_ip}</p>
                        </div>
                        <button
                          onClick={() => {
                            setRenameTarget(peer);
                            setRenameValue(peer.name);
                          }}
                          aria-label="Rename"
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-lg font-medium shrink-0 ${STATUS_STYLE[peer.status]}`}>
                        {STATUS_LABEL[peer.status]}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3.5 h-3.5" />
                      {peer.status === "active" ? (
                        days > 0 ? (
                          <span>
                            Expires {fmtDate(peer.expires_at)} ·{" "}
                            <span className={days <= 3 ? "text-amber-400 font-medium" : ""}>{days} day{days === 1 ? "" : "s"} left</span>
                          </span>
                        ) : (
                          <span className="text-amber-400">Expires today</span>
                        )
                      ) : (
                        <span>Expired {fmtDate(peer.expires_at)}</span>
                      )}
                    </div>

                    {live && live !== "loading" && (
                      <div className="flex items-center gap-3 text-xs rounded-xl bg-secondary/50 px-3 py-2">
                        <span className={`w-2 h-2 rounded-full ${live.connected ? "bg-emerald-400" : "bg-zinc-500"}`} />
                        <span className="text-muted-foreground">{live.connected ? "Connected" : "Not connected"}</span>
                        <span className="ml-auto text-muted-foreground font-mono">
                          ↓{formatBytes(live.rx)} ↑{formatBytes(live.tx)}
                        </span>
                      </div>
                    )}

                    <div className={`grid gap-2 ${isAgent ? "grid-cols-2" : "grid-cols-3"}`}>
                      <button
                        onClick={() => setConfigPeer(peer)}
                        className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-secondary text-xs font-medium hover:bg-secondary/80 transition-colors"
                      >
                        <QrCode className="w-3.5 h-3.5" /> Config
                      </button>
                      <button
                        onClick={() => checkStatus(peer)}
                        disabled={live === "loading" || peer.status !== "active"}
                        className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-secondary text-xs font-medium hover:bg-secondary/80 transition-colors disabled:opacity-40"
                      >
                        {live === "loading" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5" />
                        )}{" "}
                        Status
                      </button>
                      {!isAgent && (
                        <button
                          onClick={() => setRenewPeer(peer)}
                          className="flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl bg-primary/15 text-primary text-xs font-medium hover:bg-primary/25 transition-colors"
                        >
                          <RefreshCw className="w-3.5 h-3.5" /> Renew
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {tab === "buy" && (
          <>
            {plans.length === 0 && (
              <div className="text-center py-16">
                <p className="text-sm text-muted-foreground">No plans available right now.</p>
              </div>
            )}
            {plans.length > 0 && (
              plans.map((plan) => (
                <div key={plan.id} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {plan.name}
                        {plan.is_dedicated_ip && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 font-medium align-middle">
                            Dedicated IP
                          </span>
                        )}
                      </p>
                      {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-lg text-primary">
                        {Number(plan.price_usd) <= 0 ? "Free" : `$${Number(plan.price_usd).toFixed(2)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">{plan.duration_days} days</p>
                    </div>
                  </div>
                  <button
                    onClick={() => checkout(plan)}
                    disabled={buying !== null}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                  >
                    {buying === plan.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
                    {Number(plan.price_usd) <= 0 ? "Activate" : "Pay with crypto"}
                  </button>
                </div>
              ))
            )}
            <button
              onClick={openSupport}
              className="w-full rounded-2xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors text-left flex items-center gap-2.5"
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span>
                Need a <b>dedicated IP</b> (not shared), or more dedicated IPs? Contact support.
              </span>
            </button>
          </>
        )}

        {tab === "payments" && (
          <PaymentsTab payments={payments} refresh={refreshPayments} webApp={webApp} />
        )}
      </main>

      {/* Modal config */}
      {configPeer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setConfigPeer(null)}>
          <div
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{configPeer.name}</h2>
              <button onClick={() => setConfigPeer(null)} className="p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>

            {configPeer.config ? (
              <>
                {qrDataUrl && (
                  <div className="flex justify-center">
                    <div className="p-3 bg-white rounded-2xl">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrDataUrl} alt="WireGuard config QR code" className="w-56 h-56" />
                    </div>
                  </div>
                )}
                <p className="text-xs text-center text-muted-foreground">
                  Scan the QR with the WireGuard app, or copy the config below.
                </p>

                <pre className="text-[10px] leading-relaxed bg-secondary/50 rounded-xl p-3 overflow-x-auto font-mono whitespace-pre">
                  {configPeer.config}
                </pre>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => copyConfig(configPeer)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium"
                  >
                    <Copy className="w-4 h-4" /> Copy
                  </button>
                  <button
                    onClick={() => downloadConfig(configPeer)}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-secondary text-sm font-medium"
                  >
                    <Download className="w-4 h-4" /> Download .conf
                  </button>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-2 text-sm">
                <p className="font-medium text-amber-300">Config not available yet</p>
                <p className="text-amber-300/80 text-xs">
                  This peer was linked to your account by the admin, so its private key isn't stored here.
                  If you already have a working config, keep using it. To get a fresh config + QR, generate
                  new keys below.
                </p>
              </div>
            )}

            {/* Rotate keys */}
            <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2">
              {!rotateConfirm ? (
                <button
                  onClick={() => setRotateConfirm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-secondary text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" /> {configPeer.config ? "Regenerate keys" : "Generate new keys"}
                </button>
              ) : (
                <>
                  <p className="text-xs text-amber-400">
                    ⚠️ Your current config will stop working immediately. You'll need to import the new
                    config on your device. Continue?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setRotateConfirm(false)}
                      className="px-4 py-2 rounded-xl bg-secondary text-xs font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => rotateKeys(configPeer)}
                      disabled={rotating}
                      className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 text-xs font-medium disabled:opacity-50"
                    >
                      {rotating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                      Yes, rotate keys
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal renovar */}
      {renewPeer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setRenewPeer(null)}>
          <div
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Renew {renewPeer.name}</h2>
              <button onClick={() => setRenewPeer(null)} className="p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
            {renewPeer.renewal_price_usd != null ? (
              // Precio de renovación propio de este peer (asignado por el admin)
              <button
                onClick={() => checkout(null, renewPeer)}
                disabled={buying !== null}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <span className="text-sm font-medium">
                  Renew · {renewPeer.renewal_duration_days || 30} days
                </span>
                <span className="text-sm font-bold text-primary">
                  {buying ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : Number(renewPeer.renewal_price_usd) <= 0 ? (
                    "Free"
                  ) : (
                    `$${Number(renewPeer.renewal_price_usd).toFixed(2)}`
                  )}
                </span>
              </button>
            ) : plans.filter((p) => p.router_id === renewPeer.router_id).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No renewal plans available for this server.
              </p>
            ) : (
              plans
                .filter((p) => p.router_id === renewPeer.router_id)
                .map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => checkout(plan, renewPeer)}
                    disabled={buying !== null}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-secondary/40 hover:bg-secondary transition-colors disabled:opacity-50"
                  >
                    <span className="text-sm font-medium">
                      {plan.name} · {plan.duration_days} days
                    </span>
                    <span className="text-sm font-bold text-primary">
                      {buying === plan.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : Number(plan.price_usd) <= 0 ? (
                        "Free"
                      ) : (
                        `$${Number(plan.price_usd).toFixed(2)}`
                      )}
                    </span>
                  </button>
                ))
            )}
          </div>
        </div>
      )}

      {/* Modal rename */}
      {renameTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center" onClick={() => setRenameTarget(null)}>
          <div
            className="w-full max-w-lg bg-card border border-border rounded-t-3xl sm:rounded-3xl p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Rename peer</h2>
              <button onClick={() => setRenameTarget(null)} className="p-1.5 rounded-lg hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={32}
              placeholder="My phone, Office PC…"
              className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm outline-none focus:border-primary"
            />
            <button
              onClick={renamePeer}
              disabled={renaming || !renameValue.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
            >
              {renaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Pencil className="w-4 h-4" />}
              Save name
            </button>
          </div>
        </div>
      )}

      {/* Bottom nav — agents solo ven sus peers, sin tienda */}
      {!isAgent && (
      <nav className="fixed bottom-0 inset-x-0 border-t border-border bg-card/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto grid grid-cols-3">
          {(
            [
              { key: "peers", label: "My Peers", icon: Globe },
              { key: "buy", label: "Buy", icon: ShoppingCart },
              { key: "payments", label: "Payments", icon: Wallet },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              onClick={() => {
                setTab(item.key);
                if (item.key === "payments") refreshPayments().catch(() => {});
              }}
              className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
                tab === item.key ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      )}
    </div>
  );
}

/* ============ Tab de pagos ============ */
const PAYMENT_STATUS_STYLE: Record<string, string> = {
  paid: "bg-emerald-500/15 text-emerald-400",
  pending: "bg-amber-500/15 text-amber-400",
  failed: "bg-red-500/15 text-red-400",
  cancelled: "bg-zinc-500/15 text-zinc-400",
  expired: "bg-zinc-500/15 text-zinc-400",
};

function PaymentsTab({
  payments,
  refresh,
  webApp,
}: {
  payments: Payment[];
  refresh: () => Promise<void>;
  webApp: TelegramWebApp | null;
}) {
  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (payments.length === 0) {
    return (
      <div className="text-center py-16">
        <Wallet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">No payments yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {payments.map((p) => (
        <div key={p.id} className="rounded-2xl border border-border bg-card px-4 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {p.type === "purchase" ? "Purchase" : "Renewal"} · ${Number(p.amount_usd).toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground">{fmtDate(p.created_at)}</p>
          </div>
          {p.status === "pending" && p.payment_url && (
            <button
              onClick={() => webApp?.openLink(p.payment_url as string)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-primary/15 text-primary font-medium"
            >
              Pay
            </button>
          )}
          <span className={`text-xs px-2 py-1 rounded-lg font-medium ${PAYMENT_STATUS_STYLE[p.status] || "bg-secondary"}`}>
            {p.status}
          </span>
        </div>
      ))}
    </div>
  );
}
