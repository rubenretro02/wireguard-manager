"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { PeerLogDialog } from "@/components/PeerLogDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Copy, Download, Link2, Loader2, Pencil, Power, PowerOff, QrCode, RefreshCw,
  ScrollText, Send, Server, Timer, Trash2, Unlink, UserRound, Wifi, WifiOff,
} from "lucide-react";
import type { Profile } from "@/lib/types";

interface Customer {
  id: string;
  telegram_id: number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  source: "telegram" | "manual";
  customer_type: "client" | "agent";
  is_banned: boolean;
  created_at: string;
}

interface CustomerPeer {
  id: string;
  router_id: string;
  peer_name: string;
  display_name: string | null;
  peer_public_key: string;
  peer_private_key: string | null;
  allowed_address: string;
  public_ip: string;
  endpoint_host: string | null;
  wg_interface: string;
  server_public_key: string;
  listen_port: number;
  dns: string;
  status: "active" | "expired" | "disabled";
  expires_at: string | null;
  created_at: string;
  connected?: boolean | null;
  latest_handshake?: string | null;
  routers?: { name: string } | null;
}

interface RouterOption { id: string; name: string; host: string }
interface ServerPeer { name?: string; "public-key"?: string; "allowed-address"?: string; interface?: string; comment?: string; disabled?: boolean }

function displayName(c: Customer): string {
  if (c.username) return `@${c.username}`;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return full || c.email || (c.telegram_id ? String(c.telegram_id) : "Customer");
}

function buildConfig(p: CustomerPeer): string {
  const address = p.allowed_address.split(",")[0].split("/")[0];
  return `[Interface]
PrivateKey = ${p.peer_private_key || "[YOUR_PRIVATE_KEY]"}
Address = ${address}/32
DNS = ${p.dns || "8.8.8.8"}

[Peer]
PublicKey = ${p.server_public_key}
AllowedIPs = 0.0.0.0/0
Endpoint = ${p.endpoint_host || p.public_ip}:${p.listen_port}
PersistentKeepalive = 25`;
}

function timeLeft(iso: string | null): { label: string; tone: "ok" | "warn" | "bad" | "none" } {
  if (!iso) return { label: "no expiry", tone: "none" };
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {
    const d = Math.floor(-diff / 86400000);
    return { label: d > 0 ? `${d}d ago` : "expired", tone: "bad" };
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const label = d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((diff % 3600000) / 60000)}m`;
  return { label, tone: d < 7 ? "warn" : "ok" };
}

export default function CustomerDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const customerId = params.id;
  const supabase = createClient();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [peers, setPeers] = useState<CustomerPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit customer
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ firstName: "", lastName: "", email: "", phone: "", notes: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // Extend
  const [extendPeer, setExtendPeer] = useState<CustomerPeer | null>(null);
  const [extendDays, setExtendDays] = useState("30");
  const [extendMode, setExtendMode] = useState<"add" | "set">("add");
  const [extendDate, setExtendDate] = useState("");
  const [extending, setExtending] = useState(false);

  // Config / QR
  const [configPeer, setConfigPeer] = useState<CustomerPeer | null>(null);
  // History
  const [logPeer, setLogPeer] = useState<CustomerPeer | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  // Assign existing peer
  const [assignOpen, setAssignOpen] = useState(false);
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [assignRouter, setAssignRouter] = useState("");
  const [serverPeers, setServerPeers] = useState<ServerPeer[]>([]);
  const [loadingServerPeers, setLoadingServerPeers] = useState(false);
  const [assignedKeys, setAssignedKeys] = useState<Set<string>>(new Set());
  const [assignKey, setAssignKey] = useState("");
  const [assignDays, setAssignDays] = useState("");
  const [assignSearch, setAssignSearch] = useState("");
  const [assigning, setAssigning] = useState(false);

  const tgAdmin = useCallback(async (action: string, data: Record<string, unknown> = {}) => {
    const res = await fetch("/api/tg-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }, []);

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      tgAdmin("getCustomer", { id: customerId }),
      tgAdmin("listCustomerPeers", { customerId }),
    ]);
    setCustomer({ ...c.customer, source: c.customer.source || "telegram" });
    setPeers(p.peers || []);
  }, [tgAdmin, customerId]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (!data || data.role !== "admin") { router.push("/dashboard"); return; }
      setProfile(data as Profile);
      try {
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load customer");
        router.push("/customers");
        return;
      }
      setLoading(false);
    })();
  }, [supabase, router, load]);

  // Live status refresh every 10s (the API caches router reads)
  useEffect(() => {
    if (loading) return;
    const t = setInterval(() => { load().catch(() => {}); }, 10000);
    return () => clearInterval(t);
  }, [loading, load]);

  const refresh = async () => {
    setRefreshing(true);
    try { await load(); } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
    setRefreshing(false);
  };

  const stats = useMemo(() => ({
    total: peers.length,
    online: peers.filter((p) => p.connected).length,
    active: peers.filter((p) => p.status === "active").length,
    down: peers.filter((p) => p.status !== "active").length,
    servers: new Set(peers.map((p) => p.router_id)).size,
  }), [peers]);

  /* ---------- customer edit ---------- */
  const openEdit = () => {
    if (!customer) return;
    setEditForm({
      firstName: customer.first_name || "",
      lastName: customer.last_name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      notes: customer.notes || "",
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      const json = await tgAdmin("updateCustomer", { id: customerId, ...editForm });
      setCustomer(json.customer);
      setEditOpen(false);
      toast.success("Customer updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  /* ---------- peer actions ---------- */
  const peerAction = async (peer: CustomerPeer, action: "disableCustomerPeer" | "enableCustomerPeer" | "deleteCustomerPeer" | "unassignPeer") => {
    if (action === "deleteCustomerPeer" && !confirm(`Delete "${peer.peer_name}"? It is removed from the server too.`)) return;
    if (action === "unassignPeer" && !confirm(`Remove "${peer.peer_name}" from this customer? The peer stays on the server.`)) return;
    setBusyId(peer.id);
    try {
      await tgAdmin(action, { id: peer.id });
      toast.success("Done");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyId(null);
    }
  };

  const openExtend = (peer: CustomerPeer) => {
    setExtendPeer(peer);
    setExtendMode("add");
    setExtendDays("30");
    setExtendDate(peer.expires_at ? new Date(peer.expires_at).toISOString().slice(0, 16) : "");
  };

  const submitExtend = async () => {
    if (!extendPeer) return;
    setExtending(true);
    try {
      if (extendMode === "add") {
        const days = Number(extendDays);
        if (!(days > 0)) { toast.error("Enter the number of days"); return; }
        await tgAdmin("extendPeer", { id: extendPeer.id, days, notify: Boolean(customer?.telegram_id) });
        toast.success(`Added ${days} day(s)`);
      } else {
        await tgAdmin("extendPeer", {
          id: extendPeer.id,
          mode: "set",
          expiresAt: extendDate ? new Date(extendDate).toISOString() : null,
          notify: Boolean(customer?.telegram_id),
        });
        toast.success(extendDate ? "Expiry date set" : "Timer removed");
      }
      setExtendPeer(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setExtending(false);
    }
  };

  const openConfig = async (peer: CustomerPeer) => {
    setConfigPeer(peer);
    setQr(null);
    if (peer.peer_private_key) {
      setQr(await QRCode.toDataURL(buildConfig(peer), { width: 260, margin: 1, color: { dark: "#000000", light: "#ffffff" } }));
    }
  };

  const downloadConfig = (peer: CustomerPeer) => {
    const blob = new Blob([buildConfig(peer)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${peer.peer_name || "peer"}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ---------- assign existing peer ---------- */
  const openAssign = async () => {
    setAssignOpen(true);
    setAssignRouter("");
    setServerPeers([]);
    setAssignKey("");
    setAssignDays("");
    setAssignSearch("");
    try {
      const [r, all] = await Promise.all([tgAdmin("listRouters"), tgAdmin("listCustomerPeers")]);
      setRouters(r.routers || []);
      setAssignedKeys(new Set((all.peers || []).map((p: CustomerPeer) => p.peer_public_key)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const loadServerPeers = async (routerId: string) => {
    setAssignRouter(routerId);
    setAssignKey("");
    setLoadingServerPeers(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPeers", routerId }),
      });
      const json = await res.json();
      setServerPeers(Array.isArray(json.peers) ? json.peers : []);
    } catch {
      toast.error("Could not read the server");
    } finally {
      setLoadingServerPeers(false);
    }
  };

  const availableServerPeers = useMemo(() => {
    const q = assignSearch.trim().toLowerCase();
    return serverPeers
      .filter((p) => p["public-key"] && !assignedKeys.has(p["public-key"]))
      .filter((p) => !q || (p.name || "").toLowerCase().includes(q) || (p["allowed-address"] || "").includes(q) || (p.comment || "").includes(q));
  }, [serverPeers, assignedKeys, assignSearch]);

  const submitAssign = async () => {
    const peer = serverPeers.find((p) => p["public-key"] === assignKey);
    if (!peer || !assignRouter) return;
    setAssigning(true);
    try {
      await tgAdmin("assignPeerToCustomer", {
        customerId,
        routerId: assignRouter,
        publicKey: peer["public-key"],
        name: peer.name,
        allowedAddress: peer["allowed-address"]?.split(",")[0],
        wgInterface: peer.interface,
        comment: peer.comment,
        days: assignDays === "" ? null : Number(assignDays),
        notify: Boolean(customer?.telegram_id),
      });
      toast.success("Peer assigned");
      setAssignOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setAssigning(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading || !profile || !customer) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const statusBadge = (p: CustomerPeer) => {
    const tone: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      expired: "bg-red-500/15 text-red-400 border-red-500/30",
      disabled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    };
    return <Badge variant="outline" className={tone[p.status] || ""}>{p.status}</Badge>;
  };

  return (
    <DashboardLayout userRole={profile.role} userEmail={profile.email} userCapabilities={profile.capabilities} onLogout={handleLogout}>
      <PageHeader
        title={displayName(customer)}
        description={`${customer.source === "telegram" ? "Telegram customer" : "Manual customer"} · ${customer.customer_type}`}
      >
        <Button variant="outline" onClick={() => router.push("/customers")} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Customers
        </Button>
        <Button variant="outline" onClick={openEdit} className="gap-2">
          <Pencil className="w-4 h-4" />
          Edit
        </Button>
        <Button onClick={openAssign} className="gap-2">
          <Link2 className="w-4 h-4" />
          Assign existing peer
        </Button>
      </PageHeader>

      <PageContent>
        {/* Customer card */}
        <Card className="bg-card border-border mb-6">
          <CardContent className="p-5 flex flex-wrap gap-6 items-start">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {customer.source === "telegram" ? <Send className="w-5 h-5 text-primary" /> : <UserRound className="w-5 h-5 text-primary" />}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-2 text-sm flex-1">
              <div>
                <div className="text-muted-foreground text-xs">Name</div>
                <div className="font-medium">{[customer.first_name, customer.last_name].filter(Boolean).join(" ") || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Email</div>
                <div>{customer.email || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Phone</div>
                <div className="font-mono">{customer.phone || "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground text-xs">Telegram</div>
                <div className="font-mono">{customer.telegram_id ? `${customer.username ? "@" + customer.username + " · " : ""}${customer.telegram_id}` : "not linked"}</div>
              </div>
              {customer.notes && (
                <div className="col-span-2 md:col-span-4">
                  <div className="text-muted-foreground text-xs">Notes</div>
                  <div className="whitespace-pre-wrap">{customer.notes}</div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: "Peers", value: stats.total, cls: "text-foreground" },
            { label: "Online now", value: stats.online, cls: "text-emerald-400" },
            { label: "Active", value: stats.active, cls: "text-cyan-400" },
            { label: "Expired / disabled", value: stats.down, cls: "text-red-400" },
            { label: "Servers", value: stats.servers, cls: "text-foreground" },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">{s.label}</div>
                <div className={`text-2xl font-bold ${s.cls}`}>{s.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Peers across every server */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Peers <span className="text-muted-foreground text-sm">({peers.length})</span></h3>
          <Button variant="outline" size="icon" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Server</TableHead>
                <TableHead>Peer</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Public IP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {peers.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-12">
                    No peers yet — use &quot;Assign existing peer&quot; or pick this customer when creating one in the Dashboard.
                  </TableCell>
                </TableRow>
              ) : (
                peers.map((p) => {
                  const left = timeLeft(p.expires_at);
                  const busy = busyId === p.id;
                  return (
                    <TableRow key={p.id} className="border-border hover:bg-secondary/50 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          <Server className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="truncate max-w-[160px]" title={p.routers?.name}>{p.routers?.name || p.router_id}</span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{p.wg_interface}</div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{p.peer_name}</div>
                        {p.display_name && <div className="text-xs text-muted-foreground">{p.display_name}</div>}
                      </TableCell>
                      <TableCell>
                        {p.connected === null || p.connected === undefined ? (
                          <span className="text-xs text-muted-foreground">unknown</span>
                        ) : p.connected ? (
                          <span className="flex items-center gap-1.5 text-emerald-400 text-sm"><Wifi className="w-3.5 h-3.5" /> Online</span>
                        ) : (
                          <div>
                            <span className="flex items-center gap-1.5 text-muted-foreground text-sm"><WifiOff className="w-3.5 h-3.5" /> Offline</span>
                            {p.latest_handshake && (
                              <div className="text-[11px] text-muted-foreground">{new Date(p.latest_handshake).toLocaleString()}</div>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-cyan-400">{p.allowed_address}</TableCell>
                      <TableCell className="font-mono text-sm text-emerald-400">{p.public_ip}</TableCell>
                      <TableCell>{statusBadge(p)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={{
                            ok: "text-amber-400 border-amber-400/50",
                            warn: "text-amber-400 border-amber-400",
                            bad: "text-red-400 border-red-400/50",
                            none: "text-muted-foreground",
                          }[left.tone]}
                        >
                          <Timer className="w-3 h-3 mr-1" />
                          {left.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button variant="ghost" size="icon" title="Add time / set expiry" onClick={() => openExtend(p)} className="text-emerald-400">
                            <Timer className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="History" onClick={() => setLogPeer(p)}>
                            <ScrollText className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Config & QR" onClick={() => openConfig(p)}>
                            <QrCode className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Download config" onClick={() => downloadConfig(p)}>
                            <Download className="w-4 h-4" />
                          </Button>
                          {p.status === "active" ? (
                            <Button variant="ghost" size="icon" title="Disable" disabled={busy} onClick={() => peerAction(p, "disableCustomerPeer")}>
                              <PowerOff className="w-4 h-4 text-amber-400" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" title="Enable" disabled={busy} onClick={() => peerAction(p, "enableCustomerPeer")}>
                              <Power className="w-4 h-4 text-emerald-400" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" title="Remove from customer (keeps the peer)" disabled={busy} onClick={() => peerAction(p, "unassignPeer")}>
                            <Unlink className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Delete peer" disabled={busy} onClick={() => peerAction(p, "deleteCustomerPeer")} className="text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </PageContent>

      {/* Edit customer */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>First name</Label><Input value={editForm.firstName} onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })} className="bg-secondary" /></div>
              <div className="space-y-2"><Label>Last name</Label><Input value={editForm.lastName} onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })} className="bg-secondary" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Email</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="bg-secondary" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="bg-secondary" /></div>
            </div>
            <div className="space-y-2"><Label>Notes</Label><Textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="bg-secondary" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend / set expiry */}
      <Dialog open={!!extendPeer} onOpenChange={(o) => !o && setExtendPeer(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Timer className="w-5 h-5 text-emerald-400" />Subscription time</DialogTitle>
            <DialogDescription>
              {extendPeer?.peer_name} · {extendPeer?.routers?.name}
              {extendPeer?.expires_at ? ` · currently expires ${new Date(extendPeer.expires_at).toLocaleString()}` : " · no expiry"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button variant={extendMode === "add" ? "default" : "outline"} size="sm" onClick={() => setExtendMode("add")} className="flex-1">Add days</Button>
              <Button variant={extendMode === "set" ? "default" : "outline"} size="sm" onClick={() => setExtendMode("set")} className="flex-1">Set exact date</Button>
            </div>
            {extendMode === "add" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  {[1, 7, 30, 90].map((d) => (
                    <Button key={d} variant={extendDays === String(d) ? "default" : "outline"} size="sm" onClick={() => setExtendDays(String(d))}>{d}d</Button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Label>Custom:</Label>
                  <Input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(e.target.value)} className="w-28 bg-secondary" />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Added on top of the current expiry (or from now if already expired). Renewing early never loses days.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Input type="datetime-local" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} className="bg-secondary" />
                <p className="text-xs text-muted-foreground">Leave it empty to remove the timer (never expires).</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendPeer(null)}>Cancel</Button>
            <Button onClick={submitExtend} disabled={extending} className="gap-2">
              {extending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Timer className="w-4 h-4" />}
              {extendMode === "add" ? "Add time" : extendDate ? "Set date" : "Remove timer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Config / QR */}
      <Dialog open={!!configPeer} onOpenChange={(o) => !o && setConfigPeer(null)}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>{configPeer?.peer_name}</DialogTitle>
            <DialogDescription>{configPeer?.routers?.name} · {configPeer?.allowed_address}</DialogDescription>
          </DialogHeader>
          {configPeer && (
            <div className="space-y-3">
              {configPeer.peer_private_key ? (
                <>
                  {qr && <div className="flex justify-center"><img src={qr} alt="QR" className="rounded-lg bg-white p-2" /></div>}
                  <Textarea readOnly value={buildConfig(configPeer)} className="font-mono text-xs bg-secondary h-56 resize-none" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => { navigator.clipboard.writeText(buildConfig(configPeer)); toast.success("Copied"); }}>
                      <Copy className="w-3.5 h-3.5" /> Copy
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1" onClick={() => downloadConfig(configPeer)}>
                      <Download className="w-3.5 h-3.5" /> Download
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This peer was created outside the app, so its private key is unknown. Rotate its keys from the Telegram admin to issue a fresh config.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <PeerLogDialog
        open={!!logPeer}
        onOpenChange={(o) => !o && setLogPeer(null)}
        publicKey={logPeer?.peer_public_key || null}
        peerName={logPeer?.peer_name}
        subtitle={logPeer ? `${logPeer.routers?.name || ""} · ${logPeer.allowed_address}` : null}
      />

      {/* Assign existing peer */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" />Assign existing peer</DialogTitle>
            <DialogDescription>Pick a server, then one of its peers that has no customer yet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Server</Label>
              <Select value={assignRouter} onValueChange={loadServerPeers}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue placeholder="Select a server" /></SelectTrigger>
                <SelectContent>
                  {routers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {assignRouter && (
              <div className="space-y-2">
                <Label>Peer</Label>
                <Input placeholder="Filter by name, address or IP…" value={assignSearch} onChange={(e) => setAssignSearch(e.target.value)} className="bg-secondary" />
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                  {loadingServerPeers ? (
                    <div className="p-4 text-center text-muted-foreground text-sm"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Reading the server…</div>
                  ) : availableServerPeers.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">No unassigned peers here.</div>
                  ) : (
                    availableServerPeers.map((p) => (
                      <button
                        key={p["public-key"]}
                        type="button"
                        onClick={() => setAssignKey(p["public-key"] || "")}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-secondary/60 ${assignKey === p["public-key"] ? "bg-primary/10" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium truncate">{p.name || "(unnamed)"}</span>
                          <span className="font-mono text-xs text-muted-foreground">{p["allowed-address"]}</span>
                        </div>
                        <div className="text-xs text-muted-foreground font-mono">{p.comment} {p.disabled ? "· disabled" : ""}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Days of access (optional)</Label>
              <Input type="number" min={1} placeholder="Keep the current timer" value={assignDays} onChange={(e) => setAssignDays(e.target.value)} className="bg-secondary" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button onClick={submitAssign} disabled={!assignKey || assigning} className="gap-2">
              {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
