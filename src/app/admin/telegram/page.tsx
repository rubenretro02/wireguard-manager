"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { CalendarPlus, Eye, Loader2, Pencil, Plus, Power, PowerOff, RefreshCw, Send, Trash2, Users } from "lucide-react";
import type { Profile } from "@/lib/types";

/* ============ Types (tg-admin API responses, with joins) ============ */
interface AdminPlan {
  id: string;
  name: string;
  description: string | null;
  price_usd: number;
  duration_days: number;
  router_id: string;
  public_ip_id: string | null;
  enabled: boolean;
  sort_order: number;
  routers?: { name: string } | null;
  public_ips?: { public_ip: string } | null;
}
interface AdminCustomer {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_banned: boolean;
  created_at: string;
  last_seen_at: string;
  tg_customer_peers?: { id: string; status: string }[];
}
interface AdminPeer {
  id: string;
  peer_name: string;
  peer_public_key: string;
  allowed_address: string;
  public_ip: string;
  wg_interface: string;
  status: "active" | "expired" | "disabled";
  expires_at: string;
  created_at: string;
  tg_customers?: { telegram_id: number; username: string | null; first_name: string | null } | null;
  tg_plans?: { name: string } | null;
  routers?: { name: string } | null;
}
interface AdminPayment {
  id: string;
  type: string;
  amount_usd: number;
  status: string;
  order_id: string;
  created_at: string;
  paid_at: string | null;
  tg_customers?: { telegram_id: number; username: string | null; first_name: string | null } | null;
  tg_plans?: { name: string } | null;
}
interface RouterOption {
  id: string;
  name: string;
  host: string;
  connection_type: string;
  wg_interface: string | null;
}
interface IpOption {
  id: string;
  public_ip: string;
  ip_number: number;
  internal_subnet: string;
  enabled: boolean;
  restricted: boolean;
  for_sale?: boolean;
}
/* Live peer from the router (via /api/wireguard getPeers) */
interface RouterPeer {
  name?: string;
  "allowed-address"?: string;
  "public-key"?: string;
  disabled?: boolean;
  comment?: string;
}

const emptyPlanForm = {
  id: "",
  name: "",
  description: "",
  price_usd: "",
  duration_days: "30",
  router_id: "",
  public_ip_id: "",
  enabled: true,
  sort_order: "0",
};

function customerLabel(c?: { telegram_id: number; username: string | null; first_name: string | null } | null): string {
  if (!c) return "—";
  return c.username ? `@${c.username}` : c.first_name || String(c.telegram_id);
}

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function AdminTelegramPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [peers, setPeers] = useState<AdminPeer[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [routers, setRouters] = useState<RouterOption[]>([]);
  const [ips, setIps] = useState<IpOption[]>([]);

  // "IPs for Sale" tab
  const [saleRouterId, setSaleRouterId] = useState<string>("");
  const [saleIps, setSaleIps] = useState<IpOption[]>([]);
  const [loadingSaleIps, setLoadingSaleIps] = useState(false);
  const [routerPeers, setRouterPeers] = useState<RouterPeer[]>([]);
  const [loadingRouterPeers, setLoadingRouterPeers] = useState(false);
  const [ipPeersDialog, setIpPeersDialog] = useState<IpOption | null>(null);

  // Plan dialog
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ ...emptyPlanForm });
  const [savingPlan, setSavingPlan] = useState(false);

  // Extend dialog
  const [extendPeerTarget, setExtendPeerTarget] = useState<AdminPeer | null>(null);
  const [extendDays, setExtendDays] = useState("30");
  const [extendNotify, setExtendNotify] = useState(true);
  const [extending, setExtending] = useState(false);

  const [busyPeerId, setBusyPeerId] = useState<string | null>(null);

  const tgAdmin = useCallback(async (action: string, data: Record<string, unknown> = {}) => {
    const res = await fetch("/api/tg-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Error ${res.status}`);
    return json;
  }, []);

  const loadAll = useCallback(async () => {
    const [p, c, cp, pay, r] = await Promise.all([
      tgAdmin("listPlans"),
      tgAdmin("listCustomers"),
      tgAdmin("listCustomerPeers"),
      tgAdmin("listPayments"),
      tgAdmin("listRouters"),
    ]);
    setPlans(p.plans || []);
    setCustomers(c.customers || []);
    setPeers(cp.peers || []);
    setPayments(pay.payments || []);
    setRouters(r.routers || []);
  }, [tgAdmin]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push("/login");
        return;
      }
      const { data: prof } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (prof?.role !== "admin") {
        router.push("/dashboard");
        return;
      }
      setProfile(prof);
      try {
        await loadAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IPs for the router selected in the plan form
  useEffect(() => {
    if (!planForm.router_id) {
      setIps([]);
      return;
    }
    tgAdmin("listPublicIps", { routerId: planForm.router_id })
      .then((r) => setIps(r.ips || []))
      .catch(() => setIps([]));
  }, [planForm.router_id, tgAdmin]);

  // Load IPs + live peers for the router selected in the "IPs for Sale" tab
  useEffect(() => {
    if (!saleRouterId) {
      setSaleIps([]);
      setRouterPeers([]);
      return;
    }
    setLoadingSaleIps(true);
    tgAdmin("listPublicIps", { routerId: saleRouterId })
      .then((r) => setSaleIps(r.ips || []))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load IPs"))
      .finally(() => setLoadingSaleIps(false));

    setLoadingRouterPeers(true);
    fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getPeers", routerId: saleRouterId }),
    })
      .then((res) => res.json())
      .then((json) => setRouterPeers(json.peers || []))
      .catch(() => setRouterPeers([]))
      .finally(() => setLoadingRouterPeers(false));
  }, [saleRouterId, tgAdmin]);

  const peersForIp = useCallback(
    (ip: IpOption): RouterPeer[] =>
      routerPeers.filter((p) => p["allowed-address"]?.split(",")[0]?.startsWith(`${ip.internal_subnet}.`)),
    [routerPeers]
  );

  const isTgCustomerPeer = useCallback(
    (p: RouterPeer): AdminPeer | undefined =>
      peers.find((cp) => cp.peer_public_key && cp.peer_public_key === p["public-key"]),
    [peers]
  );

  const toggleForSale = async (ip: IpOption) => {
    try {
      await tgAdmin("setIpForSale", { id: ip.id, forSale: !ip.for_sale });
      setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, for_sale: !ip.for_sale } : i)));
      toast.success(!ip.for_sale ? `${ip.public_ip} is now for sale` : `${ip.public_ip} reserved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  /* ============ Plans ============ */
  const openNewPlan = () => {
    setPlanForm({ ...emptyPlanForm });
    setPlanDialogOpen(true);
  };

  const openEditPlan = (plan: AdminPlan) => {
    setPlanForm({
      id: plan.id,
      name: plan.name,
      description: plan.description || "",
      price_usd: String(plan.price_usd),
      duration_days: String(plan.duration_days),
      router_id: plan.router_id,
      public_ip_id: plan.public_ip_id || "",
      enabled: plan.enabled,
      sort_order: String(plan.sort_order),
    });
    setPlanDialogOpen(true);
  };

  const savePlan = async () => {
    if (!planForm.name || planForm.price_usd === "" || !planForm.duration_days || !planForm.router_id) {
      toast.error("Fill in name, price, duration and server");
      return;
    }
    setSavingPlan(true);
    try {
      const payload = {
        name: planForm.name,
        description: planForm.description || null,
        price_usd: Number(planForm.price_usd),
        duration_days: Number(planForm.duration_days),
        router_id: planForm.router_id,
        public_ip_id: planForm.public_ip_id || null,
        enabled: planForm.enabled,
        sort_order: Number(planForm.sort_order) || 0,
      };
      if (planForm.id) {
        await tgAdmin("updatePlan", { id: planForm.id, ...payload });
        toast.success("Plan updated");
      } else {
        await tgAdmin("createPlan", payload);
        toast.success("Plan created");
      }
      setPlanDialogOpen(false);
      setPlans((await tgAdmin("listPlans")).plans || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save plan");
    } finally {
      setSavingPlan(false);
    }
  };

  const togglePlanEnabled = async (plan: AdminPlan) => {
    try {
      await tgAdmin("updatePlan", { id: plan.id, enabled: !plan.enabled });
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, enabled: !plan.enabled } : p)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const deletePlan = async (plan: AdminPlan) => {
    if (!confirm(`Delete plan "${plan.name}"?`)) return;
    try {
      await tgAdmin("deletePlan", { id: plan.id });
      setPlans((prev) => prev.filter((p) => p.id !== plan.id));
      toast.success("Plan deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  /* ============ Customers ============ */
  const toggleBan = async (customer: AdminCustomer) => {
    try {
      await tgAdmin("setCustomerBan", { id: customer.id, banned: !customer.is_banned });
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, is_banned: !customer.is_banned } : c))
      );
      toast.success(customer.is_banned ? "Customer unbanned" : "Customer banned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  /* ============ Customer peers ============ */
  const refreshPeers = async () => {
    try {
      setPeers((await tgAdmin("listCustomerPeers")).peers || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const doExtend = async () => {
    if (!extendPeerTarget) return;
    setExtending(true);
    try {
      await tgAdmin("extendPeer", { id: extendPeerTarget.id, days: Number(extendDays), notify: extendNotify });
      toast.success(`Extended ${extendDays} days`);
      setExtendPeerTarget(null);
      await refreshPeers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setExtending(false);
    }
  };

  const peerAction = async (peer: AdminPeer, action: "disableCustomerPeer" | "enableCustomerPeer" | "deleteCustomerPeer") => {
    if (action === "deleteCustomerPeer" && !confirm(`Delete peer "${peer.peer_name}"? It will be removed from the server and the customer.`)) return;
    setBusyPeerId(peer.id);
    try {
      await tgAdmin(action, { id: peer.id });
      toast.success("Done");
      await refreshPeers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyPeerId(null);
    }
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const statusBadge = (status: string) => {
    const variants: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      expired: "bg-red-500/15 text-red-400 border-red-500/30",
      disabled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
      paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      failed: "bg-red-500/15 text-red-400 border-red-500/30",
      cancelled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
    };
    return <Badge variant="outline" className={variants[status] || ""}>{status}</Badge>;
  };

  return (
    <DashboardLayout userRole={profile.role} userEmail={profile.email} userCapabilities={profile.capabilities} onLogout={handleLogout}>
      <PageHeader title="Telegram Store" description="Plans, customers and payments for the Mini App">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAll().catch(() => toast.error("Failed to refresh"))}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      </PageHeader>
      <PageContent>
        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">Plans ({plans.length})</TabsTrigger>
            <TabsTrigger value="ips">IPs for Sale</TabsTrigger>
            <TabsTrigger value="customers">Customers ({customers.length})</TabsTrigger>
            <TabsTrigger value="peers">Peers ({peers.length})</TabsTrigger>
            <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
          </TabsList>

          {/* ============ PLANS ============ */}
          <TabsContent value="plans" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={openNewPlan}>
                <Plus className="w-4 h-4 mr-2" /> New Plan
              </Button>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Pinned IP</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No plans yet. Create one to make it appear in the Mini App.
                      </TableCell>
                    </TableRow>
                  )}
                  {plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell>{plan.routers?.name || "—"}</TableCell>
                      <TableCell>{Number(plan.price_usd) <= 0 ? "Free" : `$${Number(plan.price_usd).toFixed(2)}`}</TableCell>
                      <TableCell>{plan.duration_days} days</TableCell>
                      <TableCell className="font-mono text-xs">{plan.public_ips?.public_ip || "auto"}</TableCell>
                      <TableCell>
                        <Switch checked={plan.enabled} onCheckedChange={() => togglePlanEnabled(plan)} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEditPlan(plan)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePlan(plan)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ============ IPs FOR SALE ============ */}
          <TabsContent value="ips" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Automatic orders ONLY use IPs marked <b>for sale</b> (least-loaded first). The rest stay
                reserved for your own use or dedicated-IP customers (assign those by pinning the IP in a plan).
              </p>
              <div className="w-64 shrink-0">
                <Select value={saleRouterId} onValueChange={setSaleRouterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {routers.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.host})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {saleRouterId && (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Public IP</TableHead>
                      <TableHead>Peers using it</TableHead>
                      <TableHead>TG customers</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">For sale</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSaleIps && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin inline-block" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!loadingSaleIps && saleIps.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          This server has no public IPs configured.
                        </TableCell>
                      </TableRow>
                    )}
                    {!loadingSaleIps &&
                      saleIps.map((ip) => {
                        const ipPeers = peersForIp(ip);
                        const tgCount = peers.filter(
                          (p) => p.public_ip === ip.public_ip && p.status === "active"
                        ).length;
                        return (
                          <TableRow key={ip.id}>
                            <TableCell className="font-mono">{ip.public_ip}</TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 gap-1.5"
                                onClick={() => setIpPeersDialog(ip)}
                                disabled={loadingRouterPeers}
                              >
                                {loadingRouterPeers ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Users className="w-3.5 h-3.5" />
                                )}
                                {loadingRouterPeers ? "" : ipPeers.length}
                                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TableCell>
                            <TableCell>{tgCount}</TableCell>
                            <TableCell className="space-x-1.5">
                              {!ip.enabled && (
                                <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">disabled</Badge>
                              )}
                              {ip.restricted && (
                                <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">restricted</Badge>
                              )}
                              {ip.for_sale ? (
                                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">for sale</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30">reserved</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Switch checked={Boolean(ip.for_sale)} onCheckedChange={() => toggleForSale(ip)} disabled={!ip.enabled} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            )}
            {!saleRouterId && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Select a server to see its IPs.
              </div>
            )}
          </TabsContent>

          {/* ============ CUSTOMERS ============ */}
          <TabsContent value="customers">
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Telegram ID</TableHead>
                    <TableHead>Peers</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Banned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No customers yet. They appear automatically when they open the Mini App.
                      </TableCell>
                    </TableRow>
                  )}
                  {customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {customerLabel(c)}
                        {c.first_name && c.username && (
                          <span className="text-muted-foreground text-xs ml-2">{c.first_name} {c.last_name || ""}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.telegram_id}</TableCell>
                      <TableCell>
                        {(c.tg_customer_peers || []).filter((p) => p.status === "active").length} active /{" "}
                        {(c.tg_customer_peers || []).length}
                      </TableCell>
                      <TableCell>{fmtDate(c.created_at)}</TableCell>
                      <TableCell>{fmtDate(c.last_seen_at)}</TableCell>
                      <TableCell>
                        <Switch checked={c.is_banned} onCheckedChange={() => toggleBan(c)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ============ PEERS ============ */}
          <TabsContent value="peers">
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Peer</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No customer peers yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {peers.map((peer) => (
                    <TableRow key={peer.id}>
                      <TableCell className="font-medium">{peer.peer_name}</TableCell>
                      <TableCell>{customerLabel(peer.tg_customers)}</TableCell>
                      <TableCell>
                        {peer.routers?.name || "—"}
                        <span className="text-muted-foreground text-xs ml-1">({peer.wg_interface})</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {peer.public_ip}
                        <br />
                        <span className="text-muted-foreground">{peer.allowed_address}</span>
                      </TableCell>
                      <TableCell>{statusBadge(peer.status)}</TableCell>
                      <TableCell>{fmtDate(peer.expires_at)}</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {busyPeerId === peer.id ? (
                          <Loader2 className="w-4 h-4 animate-spin inline-block" />
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Extend"
                              onClick={() => {
                                setExtendPeerTarget(peer);
                                setExtendDays("30");
                                setExtendNotify(true);
                              }}
                            >
                              <CalendarPlus className="w-4 h-4" />
                            </Button>
                            {peer.status === "active" ? (
                              <Button variant="ghost" size="sm" title="Disable" onClick={() => peerAction(peer, "disableCustomerPeer")}>
                                <PowerOff className="w-4 h-4" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" title="Enable" onClick={() => peerAction(peer, "enableCustomerPeer")}>
                                <Power className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              title="Delete"
                              onClick={() => peerAction(peer, "deleteCustomerPeer")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ============ PAYMENTS ============ */}
          <TabsContent value="payments">
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No payments recorded yet.
                      </TableCell>
                    </TableRow>
                  )}
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{fmtDate(p.created_at)}</TableCell>
                      <TableCell>{customerLabel(p.tg_customers)}</TableCell>
                      <TableCell>{p.tg_plans?.name || "—"}</TableCell>
                      <TableCell>{p.type === "purchase" ? "Purchase" : "Renewal"}</TableCell>
                      <TableCell>${Number(p.amount_usd).toFixed(2)}</TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        {/* Peers-per-IP dialog */}
        <Dialog open={!!ipPeersDialog} onOpenChange={(open) => !open && setIpPeersDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Peers using {ipPeersDialog?.public_ip}</DialogTitle>
              <DialogDescription>
                {ipPeersDialog ? peersForIp(ipPeersDialog).length : 0} peer(s) on subnet {ipPeersDialog?.internal_subnet}.x
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {ipPeersDialog && peersForIp(ipPeersDialog).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No peers on this IP — safe to put it for sale.
                </p>
              )}
              {ipPeersDialog &&
                peersForIp(ipPeersDialog).map((p, idx) => {
                  const tgPeer = isTgCustomerPeer(p);
                  return (
                    <div
                      key={p["public-key"] || idx}
                      className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name || "(unnamed)"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{p["allowed-address"]}</p>
                      </div>
                      {tgPeer && (
                        <Badge variant="outline" className="bg-sky-500/15 text-sky-400 border-sky-500/30">
                          TG: {customerLabel(tgPeer.tg_customers)}
                        </Badge>
                      )}
                      {p.disabled ? (
                        <Badge variant="outline" className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30">disabled</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">enabled</Badge>
                      )}
                    </div>
                  );
                })}
            </div>
          </DialogContent>
        </Dialog>

        {/* Plan dialog */}
        <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{planForm.id ? "Edit plan" : "New plan"}</DialogTitle>
              <DialogDescription>Active plans are shown in the Mini App.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Name</Label>
                <Input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} placeholder="VPN 1 Month" />
              </div>
              <div className="space-y-1.5">
                <Label>Description (optional)</Label>
                <Textarea
                  value={planForm.description}
                  onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Dedicated IP, unlimited traffic…"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Price USD</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={planForm.price_usd}
                    onChange={(e) => setPlanForm((f) => ({ ...f, price_usd: e.target.value }))}
                    placeholder="10.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Duration (days)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={planForm.duration_days}
                    onChange={(e) => setPlanForm((f) => ({ ...f, duration_days: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Server</Label>
                <Select value={planForm.router_id} onValueChange={(v) => setPlanForm((f) => ({ ...f, router_id: v, public_ip_id: "" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a server" />
                  </SelectTrigger>
                  <SelectContent>
                    {routers.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.host}) — {r.connection_type === "linux-ssh" ? "Linux" : "MikroTik"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {planForm.router_id && (
                <div className="space-y-1.5">
                  <Label>Pinned public IP (optional, for dedicated-IP plans)</Label>
                  <Select
                    value={planForm.public_ip_id || "__auto__"}
                    onValueChange={(v) => setPlanForm((f) => ({ ...f, public_ip_id: v === "__auto__" ? "" : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto (least-loaded IP for sale)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Auto (least-loaded IP for sale)</SelectItem>
                      {ips
                        .filter((ip) => ip.enabled)
                        .map((ip) => (
                          <SelectItem key={ip.id} value={ip.id}>
                            {ip.public_ip}
                            {ip.restricted ? " (restricted)" : ""}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>Sort order</Label>
                  <Input
                    type="number"
                    value={planForm.sort_order}
                    onChange={(e) => setPlanForm((f) => ({ ...f, sort_order: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={planForm.enabled} onCheckedChange={(v) => setPlanForm((f) => ({ ...f, enabled: v }))} />
                  <Label>Visible in the app</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={savePlan} disabled={savingPlan}>
                {savingPlan && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Extend dialog */}
        <Dialog open={!!extendPeerTarget} onOpenChange={(open) => !open && setExtendPeerTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Extend {extendPeerTarget?.peer_name}</DialogTitle>
              <DialogDescription>
                Adds days to the expiration. If expired/disabled, it gets reactivated on the server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Days</Label>
                <Input type="number" min="1" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={extendNotify} onCheckedChange={(v) => setExtendNotify(v === true)} id="notify" />
                <Label htmlFor="notify" className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Notify customer on Telegram
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExtendPeerTarget(null)}>
                Cancel
              </Button>
              <Button onClick={doExtend} disabled={extending || !Number(extendDays)}>
                {extending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Extend
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContent>
    </DashboardLayout>
  );
}
