"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ScrollText,
  RefreshCw,
  Search,
  Loader2,
  Download,
  Power,
  PowerOff,
  Plus,
  Trash2,
  Pencil,
  Clock,
  Bot,
} from "lucide-react";
import type { Profile, Router as RouterType } from "@/lib/types";

interface ActivityLog {
  id: string;
  created_at: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_id: string | null;
  router_id: string | null;
  profiles?: { id: string; email: string | null; username: string | null } | null;
  routers?: { id: string; name: string } | null;
}

const PAGE_SIZE = 100;

// Cada acción con su color e ícono. Las que no están caen al default.
const ACTION_STYLES: Record<string, { icon: typeof Power; className: string }> = {
  enable: { icon: Power, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  disable: { icon: PowerOff, className: "bg-red-500/10 text-red-400 border-red-500/30" },
  create: { icon: Plus, className: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  delete: { icon: Trash2, className: "bg-red-500/10 text-red-400 border-red-500/30" },
  update: { icon: Pencil, className: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
  renew: { icon: Clock, className: "bg-violet-500/10 text-violet-400 border-violet-500/30" },
};

export default function LogsPage() {
  const router = useRouter();
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile>();
  const [hasSocks5Access, setHasSocks5Access] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const [routers, setRouters] = useState<RouterType[]>([]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [routerFilter, setRouterFilter] = useState("all");
  const [rangeFilter, setRangeFilter] = useState("7d");

  // El buscador dispara fetch; sin debounce se pega al API en cada tecla.
  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const startDate = useMemo(() => {
    if (rangeFilter === "all") return null;
    const days = rangeFilter === "24h" ? 1 : rangeFilter === "7d" ? 7 : 30;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }, [rangeFilter]);

  const fetchLogs = useCallback(async (nextOffset = 0, append = false) => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(nextOffset),
      });
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      if (routerFilter !== "all") params.set("routerId", routerFilter);
      if (startDate) params.set("startDate", startDate);

      const res = await fetch(`/api/activity-logs?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to load logs");
        return;
      }
      setLogs((prev) => (append ? [...prev, ...(json.logs || [])] : json.logs || []));
      setTotal(json.total || 0);
      setHasMore(Boolean(json.hasMore));
      setOffset(nextOffset);
    } catch {
      toast.error("Network error loading logs");
    } finally {
      setRefreshing(false);
    }
  }, [debouncedSearch, routerFilter, startDate]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (prof) setProfile(prof as Profile);

      // RLS de activity_logs: solo admins pueden leer.
      if (prof?.role !== "admin") {
        toast.error("Admins only");
        router.push("/dashboard");
        return;
      }
      setHasSocks5Access(true);

      const { data: routerRows } = await supabase.from("routers").select("*").order("name");
      setRouters((routerRows || []) as RouterType[]);
      setLoading(false);
    };
    init();
  }, [supabase, router]);

  useEffect(() => {
    if (!loading) fetchLogs(0, false);
  }, [loading, fetchLogs]);

  // El filtro por acción se aplica en cliente: el API no lo soporta y así se
  // evita un round-trip por cada chip.
  const visibleLogs = useMemo(() => {
    if (actionFilter === "all") return logs;
    return logs.filter((l) => l.action === actionFilter);
  }, [logs, actionFilter]);

  const actionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of logs) counts[l.action] = (counts[l.action] || 0) + 1;
    return counts;
  }, [logs]);

  const formatExactTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
  };

  const formatRelative = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const whoDidIt = (log: ActivityLog) => {
    if (log.profiles?.email) return log.profiles.email;
    if (log.profiles?.username) return log.profiles.username;
    // Sin user_id = evento de sistema (cron, webhook de Telegram/Cryptomus).
    if (!log.user_id) return "system";
    return log.user_id.substring(0, 8);
  };

  const describe = (log: ActivityLog) => {
    const d = (log.details || {}) as Record<string, unknown>;
    const bits: string[] = [];
    if (d.auto === true) bits.push("automático");
    if (typeof d.reason === "string") bits.push(d.reason);
    if (typeof d.source === "string") bits.push(d.source);
    if (typeof d.telegram_extend_days === "number") bits.push(`+${d.telegram_extend_days}d`);
    if (typeof d.timer_mode === "string") bits.push(`timer: ${d.timer_mode}`);
    if (typeof d.expires_at === "string") bits.push(`vence ${new Date(d.expires_at).toLocaleDateString("en-US")}`);
    if (Array.isArray(d.updatedFields) && d.updatedFields.length) bits.push((d.updatedFields as string[]).join(", "));
    if (typeof d.allowed_address === "string") bits.push(String(d.allowed_address));
    return bits.join(" · ");
  };

  const exportCsv = () => {
    const header = ["timestamp", "action", "entity_type", "entity_name", "who", "router", "ip", "details"];
    const rows = visibleLogs.map((l) => [
      new Date(l.created_at).toISOString(),
      l.action,
      l.entity_type || "",
      l.entity_name || "",
      whoDidIt(l),
      l.routers?.name || "",
      l.ip_address || "",
      JSON.stringify(l.details || {}),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <DashboardLayout
      userRole={profile?.role === "admin" ? "admin" : "user"}
      userEmail={profile?.email}
      userCapabilities={profile?.capabilities}
      hasSocks5Access={hasSocks5Access}
      onLogout={handleLogout}
    >
      <PageHeader
        title="Logs"
        description="Every peer, IP and router event — what happened, when, and who did it."
      >
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!visibleLogs.length}>
            <Download className="w-4 h-4 mr-2" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => fetchLogs(0, false)} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </PageHeader>

      <PageContent>
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search peer, user, IP, action…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={rangeFilter} onValueChange={setRangeFilter}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24h</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>

          <Select value={routerFilter} onValueChange={setRouterFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue placeholder="All servers" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All servers</SelectItem>
              {routers.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Chips por acción */}
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => setActionFilter("all")}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              actionFilter === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            All ({logs.length})
          </button>
          {Object.entries(actionCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([action, count]) => (
              <button
                key={action}
                onClick={() => setActionFilter(action)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors capitalize ${
                  actionFilter === action
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted/40 text-muted-foreground border-border hover:text-foreground"
                }`}
              >
                {action} ({count})
              </button>
            ))}
        </div>

        <p className="text-xs text-muted-foreground mb-3">
          Showing {visibleLogs.length} of {total} event(s)
        </p>

        {/* Tabla */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-4 py-2.5 whitespace-nowrap">When</th>
                  <th className="text-left font-medium px-4 py-2.5">Action</th>
                  <th className="text-left font-medium px-4 py-2.5">What</th>
                  <th className="text-left font-medium px-4 py-2.5">Who</th>
                  <th className="text-left font-medium px-4 py-2.5">Server</th>
                  <th className="text-left font-medium px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <ScrollText className="w-8 h-8 mx-auto mb-3 opacity-40" />
                      <p>No events recorded for this filter.</p>
                    </td>
                  </tr>
                )}
                {visibleLogs.map((log) => {
                  const style = ACTION_STYLES[log.action] || {
                    icon: Bot,
                    className: "bg-muted text-muted-foreground border-border",
                  };
                  const Icon = style.icon;
                  const isSystem = !log.user_id;
                  return (
                    <tr key={log.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5 whitespace-nowrap align-top">
                        <div className="font-mono text-xs">{formatExactTime(log.created_at)}</div>
                        <div className="text-xs text-muted-foreground">{formatRelative(log.created_at)}</div>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <Badge variant="outline" className={`${style.className} capitalize gap-1`}>
                          <Icon className="w-3 h-3" />
                          {log.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-medium">{log.entity_name || "—"}</div>
                        {log.entity_type && (
                          <div className="text-xs text-muted-foreground capitalize">{log.entity_type}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <span className={isSystem ? "text-muted-foreground italic" : ""}>{whoDidIt(log)}</span>
                        {log.ip_address && (
                          <div className="text-xs text-muted-foreground font-mono">{log.ip_address}</div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 align-top text-muted-foreground">
                        {log.routers?.name || "—"}
                      </td>
                      <td className="px-4 py-2.5 align-top text-xs text-muted-foreground max-w-[280px]">
                        {describe(log) || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {hasMore && (
          <div className="flex justify-center mt-4">
            <Button variant="outline" onClick={() => fetchLogs(offset + PAGE_SIZE, true)} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Load more
            </Button>
          </div>
        )}
      </PageContent>
    </DashboardLayout>
  );
}
