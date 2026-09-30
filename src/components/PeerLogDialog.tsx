"use client";

import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";

interface PeerLogEvent {
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  actor?: string | null;
  durationMs?: number | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string | null;
  peerName?: string | null;
  subtitle?: string | null;
}

type Range = "today" | "week" | "month" | "all" | "custom";

const KIND_STYLE: Record<string, string> = {
  online: "text-emerald-400",
  offline: "text-muted-foreground",
  created: "text-cyan-400",
  enabled: "text-emerald-400",
  disabled: "text-amber-400",
  expired: "text-red-400",
  renewed: "text-violet-400",
  timer: "text-violet-400",
  deleted: "text-red-400",
  assigned: "text-sky-400",
  unassigned: "text-sky-400",
  keys: "text-amber-400",
  updated: "text-foreground",
};

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "< 1 min";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h}h ${rest}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Peer history: what happened to it and when it was online — VM Guard style. */
export function PeerLogDialog({ open, onOpenChange, publicKey, peerName, subtitle }: Props) {
  const [range, setRange] = useState<Range>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [events, setEvents] = useState<PeerLogEvent[]>([]);
  const [summary, setSummary] = useState<{ sessions: number; totalOnlineMs: number; onlineNow: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const apiRange = range === "custom" ? "all" : range;
      const res = await fetch(`/api/peer-log?publicKey=${encodeURIComponent(publicKey)}&range=${apiRange}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      let list: PeerLogEvent[] = json.events || [];
      if (range === "custom") {
        const from = customFrom ? new Date(customFrom).getTime() : 0;
        const to = customTo ? new Date(customTo).getTime() + 86400000 : Infinity;
        list = list.filter((e) => { const t = new Date(e.at).getTime(); return t >= from && t <= to; });
      }
      setEvents(list);
      setSummary(json.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [publicKey, range, customFrom, customTo]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-emerald-400" />
            History — {peerName || "peer"}
          </DialogTitle>
          <DialogDescription>
            {subtitle ? `${subtitle} · ` : ""}Online time, connections, renewals, suspensions and every change — with who did it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1">
            {(["today", "week", "month", "all", "custom"] as Range[]).map((r) => (
              <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)} className="capitalize h-7 px-2.5 text-xs">
                {r}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {summary && (
              summary.sessions === 0 ? (
                <span title="Connections are recorded by the presence cron">no sessions recorded yet</span>
              ) : (
                <span>
                  {summary.sessions} session{summary.sessions === 1 ? "" : "s"} · {fmtDuration(summary.totalOnlineMs)} online
                  {summary.onlineNow ? <span className="text-emerald-400"> · online now</span> : null}
                </span>
              )
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="bg-secondary h-8 text-xs" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="bg-secondary h-8 text-xs" />
          </div>
        )}

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="grid grid-cols-[170px_1fr_90px] gap-3 px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground bg-secondary/40">
            <span>When</span><span>Event</span><span className="text-right">Time</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y divide-border">
            {loading && events.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>
            ) : error ? (
              <div className="p-6 text-center text-sm text-red-400">{error}</div>
            ) : events.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nothing in this range. Connections appear once the presence cron has run; older actions were logged before per-peer history existed.
              </div>
            ) : (
              events.map((e, i) => (
                <div key={i} className="grid grid-cols-[170px_1fr_90px] gap-3 px-3 py-2 text-xs items-start">
                  <span className="text-muted-foreground whitespace-nowrap">{new Date(e.at).toLocaleString()}</span>
                  <span>
                    <span className={`font-medium ${KIND_STYLE[e.kind] || ""}`}>{e.title}</span>
                    {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                    {e.actor && e.kind !== "online" && e.kind !== "offline" && (
                      <span className="text-muted-foreground"> · by {e.actor}</span>
                    )}
                  </span>
                  <span className="text-right text-muted-foreground whitespace-nowrap">
                    {e.kind === "online" ? (e.durationMs === null || e.durationMs === undefined ? <span className="text-emerald-400">now</span> : fmtDuration(e.durationMs)) : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
