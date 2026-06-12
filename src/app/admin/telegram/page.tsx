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
import { CalendarPlus, DollarSign, Eye, Loader2, Pencil, Plus, Power, PowerOff, RefreshCw, Send, Trash2, UserMinus, Users } from "lucide-react";
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
  is_dedicated_ip: boolean;
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
  customer_type: "client" | "agent";
  created_at: string;
  last_seen_at: string;
  tg_customer_peers?: { id: string; status: string }[];
}
interface AdminPeer {
  id: string;
  customer_id: string;
  peer_name: string;
  peer_public_key: string;
  allowed_address: string;
  public_ip: string;
  wg_interface: string;
  status: "active" | "expired" | "disabled";
  expires_at: string;
  created_at: string;
  renewal_price_usd: number | null;
  renewal_duration_days: number | null;
  tg_customers?: { telegram_id: number; username: string | null; first_name: string | null } | null;
  tg_plans?: { name: string } | null;
  routers?: { name: string } | null;
}
interface AdminPayment {
  id: string;
  customer_id: string;
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
  sale_dedicated?: boolean;
  router_id?: string;
  routers?: { name: string } | null;
}
/* Live peer from the router (via /api/wireguard getPeers) */
interface RouterPeer {
  name?: string;
  interface?: string;
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
  is_dedicated_ip: false,
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

  // Peer detail + assign-to-customer (from the IP peers dialog)
  const [peerDetail, setPeerDetail] = useState<RouterPeer | null>(null);
  const [assignCustomerId, setAssignCustomerId] = useState("");
  const [assignDays, setAssignDays] = useState("");
  const [assignNotify, setAssignNotify] = useState(true);
  const [assignPrice, setAssignPrice] = useState("");
  const [assignRenewDays, setAssignRenewDays] = useState("");
  const [assigning, setAssigning] = useState(false);

  // "Assign peer" dialog from the Peers tab (pick server → peer → customer)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignRouterId, setAssignRouterId] = useState("");
  const [assignRouterPeers, setAssignRouterPeers] = useState<RouterPeer[]>([]);
  const [loadingAssignPeers, setLoadingAssignPeers] = useState(false);
  const [assignPeerKey, setAssignPeerKey] = useState("");

  // Renewal pricing dialog (per customer peer)
  const [pricingTarget, setPricingTarget] = useState<AdminPeer | null>(null);
  const [pricingPrice, setPricingPrice] = useState("");
  const [pricingDays, setPricingDays] = useState("");
  const [savingPricing, setSavingPricing] = useState(false);

  // All for-sale IPs (shown when no server is selected in IPs tab)
  const [forSaleAll, setForSaleAll] = useState<IpOption[]>([]);

  // Customer detail dialog
  const [customerDialog, setCustomerDialog] = useState<AdminCustomer | null>(null);

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
    const [p, c, cp, pay, r, fs] = await Promise.all([
      tgAdmin("listPlans"),
      tgAdmin("listCustomers"),
      tgAdmin("listCustomerPeers"),
      tgAdmin("listPayments"),
      tgAdmin("listRouters"),
      tgAdmin("listForSaleIps"),
    ]);
    setPlans(p.plans || []);
    setCustomers(c.customers || []);
    setPeers(cp.peers || []);
    setPayments(pay.payments || []);
    setRouters(r.routers || []);
    setForSaleAll(fs.ips || []);
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
    const next = !ip.for_sale;
    // optimistic: flip right away, revert if the server call fails
    setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, for_sale: next } : i)));
    try {
      await tgAdmin("setIpForSale", { id: ip.id, forSale: next });
      toast.success(next ? `${ip.public_ip} is now for sale` : `${ip.public_ip} reserved`);
      tgAdmin("listForSaleIps").then((r) => setForSaleAll(r.ips || [])).catch(() => {});
    } catch (err) {
      setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, for_sale: !next } : i)));
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  // Live peers for the "Assign peer" dialog (Peers tab)
  useEffect(() => {
    if (!assignRouterId) {
      setAssignRouterPeers([]);
      return;
    }
    setLoadingAssignPeers(true);
    setAssignPeerKey("");
    fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getPeers", routerId: assignRouterId }),
    })
      .then((res) => res.json())
      .then((json) => setAssignRouterPeers(json.peers || []))
      .catch(() => setAssignRouterPeers([]))
      .finally(() => setLoadingAssignPeers(false));
  }, [assignRouterId]);

  const doAssignPeer = async (routerId: string, rp: RouterPeer) => {
    setAssigning(true);
    try {
      await tgAdmin("assignPeerToCustomer", {
        customerId: assignCustomerId,
        routerId,
        publicKey: rp["public-key"],
        name: rp.name,
        allowedAddress: rp["allowed-address"]?.split(",")[0],
        wgInterface: rp.interface,
        comment: rp.comment,
        days: assignDays === "" ? null : Number(assignDays),
        notify: assignNotify,
        renewalPriceUsd: assignPrice === "" ? null : Number(assignPrice),
        renewalDurationDays: assignRenewDays === "" ? null : Number(assignRenewDays),
      });
      toast.success("Peer assigned to customer");
      setPeerDetail(null);
      setAssignDialogOpen(false);
      await Promise.all([refreshPeers(), tgAdmin("listCustomers").then((r) => setCustomers(r.customers || []))]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to assign peer");
    } finally {
      setAssigning(false);
    }
  };

  const resetAssignForm = () => {
    setAssignCustomerId("");
    setAssignDays("");
    setAssignNotify(true);
    setAssignPrice("");
    setAssignRenewDays("");
  };

  const setCustomerType = async (c: AdminCustomer, type: "client" | "agent") => {
    try {
      await tgAdmin("setCustomerType", { id: c.id, type });
      setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, customer_type: type } : x)));
      toast.success(`${customerLabel(c)} is now ${type === "agent" ? "an agent (no store)" : "a client"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const savePricing = async () => {
    if (!pricingTarget) return;
    setSavingPricing(true);
    try {
      await tgAdmin("updatePeerRenewal", {
        id: pricingTarget.id,
        price: pricingPrice === "" ? null : Number(pricingPrice),
        days: pricingDays === "" ? null : Number(pricingDays),
      });
      toast.success("Renewal pricing saved");
      setPricingTarget(null);
      await refreshPeers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setSavingPricing(false);
    }
  };

  const toggleDedicated = async (ip: IpOption) => {
    const next = !ip.sale_dedicated;
    setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, sale_dedicated: next } : i)));
    setForSaleAll((prev) => prev.map((i) => (i.id === ip.id ? { ...i, sale_dedicated: next } : i)));
    try {
      await tgAdmin("setIpDedicated", { id: ip.id, dedicated: next });
      toast.success(next ? `${ip.public_ip} sells as dedicated (1 customer)` : `${ip.public_ip} sells as shared`);
    } catch (err) {
      setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, sale_dedicated: !next } : i)));
      setForSaleAll((prev) => prev.map((i) => (i.id === ip.id ? { ...i, sale_dedicated: !next } : i)));
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const unassignPeer = async (peer: AdminPeer) => {
    if (!confirm(`Unassign "${peer.peer_name}" from ${customerLabel(peer.tg_customers)}? The peer stays on the server untouched.`)) return;
    setBusyPeerId(peer.id);
    try {
      await tgAdmin("unassignPeer", { id: peer.id });
      toast.success("Peer unassigned — you can now assign it to another customer");
      await refreshPeers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyPeerId(null);
    }
  };

  const assignPeer = async () => {
    if (!peerDetail || !assignCustomerId || !saleRouterId) return;
    await doAssignPeer(saleRouterId, peerDetail);
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
      is_dedicated_ip: Boolean(plan.is_dedicated_ip),
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
        is_dedicated_ip: planForm.is_dedicated_ip,
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
                      <TableCell className="font-medium">
                        {plan.name}
                        {plan.is_dedicated_ip && (
                          <Badge variant="outline" className="ml-2 bg-violet-500/15 text-violet-400 border-violet-500/30">dedicated IP</Badge>
                        )}
                      </TableCell>
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
                      <TableHead>For sale</TableHead>
                      <TableHead className="text-right">Dedicated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSaleIps && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin inline-block" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!loadingSaleIps && saleIps.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
                              {ip.for_sale && ip.sale_dedicated && (
                                <Badge variant="outline" className="bg-violet-500/15 text-violet-400 border-violet-500/30">dedicated</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Switch checked={Boolean(ip.for_sale)} onCheckedChange={() => toggleForSale(ip)} disabled={!ip.enabled} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Switch
                                checked={Boolean(ip.sale_dedicated)}
                                onCheckedChange={() => toggleDedicated(ip)}
                                disabled={!ip.enabled || !ip.for_sale}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                  </TableBody>
                </Table>
              </div>
            )}
            {!saleRouterId && (
              <div className="space-y-2">
                <p className="text-sm font-medium">All IPs currently for sale ({forSaleAll.length})</p>
                <div className="rounded-xl border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Server</TableHead>
                        <TableHead>Public IP</TableHead>
                        <TableHead>TG customers</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead className="text-right">For sale</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {forSaleAll.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No IPs for sale yet — select a server above and flip the switch on the IPs you want to sell.
                          </TableCell>
                        </TableRow>
                      )}
                      {forSaleAll.map((ip) => (
                        <TableRow key={ip.id}>
                          <TableCell>{ip.routers?.name || "—"}</TableCell>
                          <TableCell className="font-mono">{ip.public_ip}</TableCell>
                          <TableCell>
                            {peers.filter((p) => p.public_ip === ip.public_ip && p.status === "active").length}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-2">
                              <Switch checked={Boolean(ip.sale_dedicated)} onCheckedChange={() => toggleDedicated(ip)} />
                              <span className="text-xs text-muted-foreground">{ip.sale_dedicated ? "dedicated" : "shared"}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Switch
                              checked
                              onCheckedChange={async () => {
                                try {
                                  await tgAdmin("setIpForSale", { id: ip.id, forSale: false });
                                  setForSaleAll((prev) => prev.filter((i) => i.id !== ip.id));
                                  toast.success(`${ip.public_ip} reserved`);
                                } catch (err) {
                                  toast.error(err instanceof Error ? err.message : "Error");
                                }
                              }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">Select a server above to manage all of its IPs.</p>
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
                    <TableHead>Type</TableHead>
                    <TableHead>Peers</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead>Last seen</TableHead>
                    <TableHead>Banned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No customers yet. They appear automatically when they open the Mini App.
                      </TableCell>
                    </TableRow>
                  )}
                  {customers.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => setCustomerDialog(c)}>
                      <TableCell className="font-medium">
                        {customerLabel(c)}
                        {c.first_name && c.username && (
                          <span className="text-muted-foreground text-xs ml-2">{c.first_name} {c.last_name || ""}</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.telegram_id}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Select value={c.customer_type || "client"} onValueChange={(v) => setCustomerType(c, v as "client" | "agent")}>
                          <SelectTrigger className="h-8 w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="client">Client</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {(c.tg_customer_peers || []).filter((p) => p.status === "active").length} active /{" "}
                        {(c.tg_customer_peers || []).length}
                      </TableCell>
                      <TableCell>{fmtDate(c.created_at)}</TableCell>
                      <TableCell>{fmtDate(c.last_seen_at)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Switch checked={c.is_banned} onCheckedChange={() => toggleBan(c)} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ============ PEERS ============ */}
          <TabsContent value="peers" className="space-y-4">
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  resetAssignForm();
                  setAssignRouterId("");
                  setAssignPeerKey("");
                  setAssignDialogOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" /> Assign existing peer
              </Button>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Peer</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Server</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
                      <TableCell className="text-xs">
                        {peer.renewal_price_usd != null
                          ? `$${Number(peer.renewal_price_usd).toFixed(2)} / ${peer.renewal_duration_days || 30}d`
                          : <span className="text-muted-foreground">store plans</span>}
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
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Renewal pricing"
                              onClick={() => {
                                setPricingTarget(peer);
                                setPricingPrice(peer.renewal_price_usd != null ? String(peer.renewal_price_usd) : "");
                                setPricingDays(peer.renewal_duration_days != null ? String(peer.renewal_duration_days) : "");
                              }}
                            >
                              <DollarSign className="w-4 h-4" />
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
                              title="Unassign (keep peer on server)"
                              onClick={() => unassignPeer(peer)}
                            >
                              <UserMinus className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              title="Delete (removes from server too)"
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
                    <button
                      key={p["public-key"] || idx}
                      onClick={() => {
                        resetAssignForm();
                        setPeerDetail(p);
                      }}
                      className="w-full flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2 hover:bg-secondary transition-colors text-left"
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
                    </button>
                  );
                })}
            </div>
          </DialogContent>
        </Dialog>

        {/* Assign existing peer dialog (from Peers tab) */}
        <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign existing peer</DialogTitle>
              <DialogDescription>
                Link a peer that already exists on a server to a Telegram customer so they can manage and renew it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Server</Label>
                <Select value={assignRouterId} onValueChange={setAssignRouterId}>
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
              {assignRouterId && (
                <div className="space-y-1.5">
                  <Label>Peer {loadingAssignPeers && <Loader2 className="w-3 h-3 animate-spin inline-block ml-1" />}</Label>
                  <Select value={assignPeerKey} onValueChange={setAssignPeerKey} disabled={loadingAssignPeers}>
                    <SelectTrigger>
                      <SelectValue placeholder={loadingAssignPeers ? "Loading peers…" : "Select a peer"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {assignRouterPeers
                        .filter((p) => p["public-key"] && !isTgCustomerPeer(p))
                        .map((p) => (
                          <SelectItem key={p["public-key"]} value={p["public-key"] as string}>
                            {(p.name || "(unnamed)") + " — " + (p["allowed-address"]?.split(",")[0] || "")}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={assignCustomerId} onValueChange={setAssignCustomerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {customerLabel(c)} ({c.telegram_id}) {c.customer_type === "agent" ? "· agent" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3 items-end">
                <div className="space-y-1.5">
                  <Label>Days (empty = dashboard timer / no timer)</Label>
                  <Input type="number" min="1" placeholder="auto" value={assignDays} onChange={(e) => setAssignDays(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Checkbox checked={assignNotify} onCheckedChange={(v) => setAssignNotify(v === true)} id="assign2-notify" />
                  <Label htmlFor="assign2-notify" className="text-xs">Notify on Telegram</Label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Renewal price USD (optional)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="store plans" value={assignPrice} onChange={(e) => setAssignPrice(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Renewal days</Label>
                  <Input type="number" min="1" placeholder="30" value={assignRenewDays} onChange={(e) => setAssignRenewDays(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                With a custom renewal price the customer renews THIS peer at that price with crypto —
                it never shows as a store purchase. Leave empty to use the server's store plans.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const rp = assignRouterPeers.find((p) => p["public-key"] === assignPeerKey);
                  if (rp) doAssignPeer(assignRouterId, rp);
                }}
                disabled={assigning || !assignRouterId || !assignPeerKey || !assignCustomerId}
              >
                {assigning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Assign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Renewal pricing dialog */}
        <Dialog open={!!pricingTarget} onOpenChange={(open) => !open && setPricingTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Renewal pricing — {pricingTarget?.peer_name}</DialogTitle>
              <DialogDescription>
                Custom price this customer pays to renew this peer with crypto. Leave both empty to use the store plans.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Price USD</Label>
                <Input type="number" min="0" step="0.01" placeholder="empty = plans" value={pricingPrice} onChange={(e) => setPricingPrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Days per renewal</Label>
                <Input type="number" min="1" placeholder="30" value={pricingDays} onChange={(e) => setPricingDays(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPricingTarget(null)}>
                Cancel
              </Button>
              <Button onClick={savePricing} disabled={savingPricing}>
                {savingPricing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Peer detail + assign dialog */}
        <Dialog open={!!peerDetail} onOpenChange={(open) => !open && setPeerDetail(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{peerDetail?.name || "(unnamed peer)"}</DialogTitle>
              <DialogDescription className="font-mono">{peerDetail?.["allowed-address"]}</DialogDescription>
            </DialogHeader>
            {peerDetail && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Interface</p>
                    <p className="font-mono">{peerDetail.interface || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Public IP</p>
                    <p className="font-mono">{ipPeersDialog?.public_ip || peerDetail.comment || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Status</p>
                    {peerDetail.disabled ? (
                      <Badge variant="outline" className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30">disabled</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">enabled</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Public key</p>
                    <p className="font-mono text-xs truncate" title={peerDetail["public-key"]}>
                      {peerDetail["public-key"]?.substring(0, 16)}…
                    </p>
                  </div>
                </div>

                {isTgCustomerPeer(peerDetail) ? (
                  <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-sm text-sky-300">
                    Already assigned to{" "}
                    <b>{customerLabel(isTgCustomerPeer(peerDetail)?.tg_customers)}</b> — manage it from the Peers tab.
                  </div>
                ) : (
                  <div className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3">
                    <p className="text-sm font-medium">Assign to a Telegram customer</p>
                    <p className="text-xs text-muted-foreground">
                      The customer will see this peer in the Mini App: live status, time left, self-renewal
                      and key rotation. They can't enable/disable it.
                    </p>
                    <div className="space-y-1.5">
                      <Label>Customer</Label>
                      <Select value={assignCustomerId} onValueChange={setAssignCustomerId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {customerLabel(c)} ({c.telegram_id})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3 items-end">
                      <div className="space-y-1.5">
                        <Label>Days (empty = dashboard timer / no timer)</Label>
                        <Input type="number" min="1" placeholder="auto" value={assignDays} onChange={(e) => setAssignDays(e.target.value)} />
                      </div>
                      <div className="flex items-center gap-2 pb-2">
                        <Checkbox checked={assignNotify} onCheckedChange={(v) => setAssignNotify(v === true)} id="assign-notify" />
                        <Label htmlFor="assign-notify" className="text-xs">Notify on Telegram</Label>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>Renewal price USD (optional)</Label>
                        <Input type="number" min="0" step="0.01" placeholder="store plans" value={assignPrice} onChange={(e) => setAssignPrice(e.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Renewal days</Label>
                        <Input type="number" min="1" placeholder="30" value={assignRenewDays} onChange={(e) => setAssignRenewDays(e.target.value)} />
                      </div>
                    </div>
                    <Button className="w-full" onClick={assignPeer} disabled={assigning || !assignCustomerId}>
                      {assigning && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Assign peer
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Customer detail dialog */}
        <Dialog open={!!customerDialog} onOpenChange={(open) => !open && setCustomerDialog(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{customerLabel(customerDialog)}</DialogTitle>
              <DialogDescription>
                Telegram ID {customerDialog?.telegram_id} · joined {fmtDate(customerDialog?.created_at || null)}
              </DialogDescription>
            </DialogHeader>
            {customerDialog && (
              <div className="space-y-4 max-h-[65vh] overflow-y-auto">
                <div>
                  <p className="text-sm font-medium mb-2">Peers</p>
                  {peers.filter((p) => p.customer_id === customerDialog.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">No peers yet.</p>
                  )}
                  <div className="space-y-2">
                    {peers
                      .filter((p) => p.customer_id === customerDialog.id)
                      .map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{p.peer_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {p.public_ip} · {p.allowed_address}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {p.routers?.name || "—"} · expires {fmtDate(p.expires_at)}
                            </p>
                          </div>
                          {statusBadge(p.status)}
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Extend"
                            onClick={() => {
                              setExtendPeerTarget(p);
                              setExtendDays("30");
                              setExtendNotify(true);
                            }}
                          >
                            <CalendarPlus className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Payments</p>
                  {payments.filter((p) => p.customer_id === customerDialog.id).length === 0 && (
                    <p className="text-sm text-muted-foreground">No payments yet.</p>
                  )}
                  <div className="space-y-2">
                    {payments
                      .filter((p) => p.customer_id === customerDialog.id)
                      .map((p) => (
                        <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              {p.type === "purchase" ? "Purchase" : "Renewal"} · ${Number(p.amount_usd).toFixed(2)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {fmtDate(p.created_at)} · {p.tg_plans?.name || "—"}
                            </p>
                          </div>
                          {statusBadge(p.status)}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
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
              <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
                <Switch checked={planForm.is_dedicated_ip} onCheckedChange={(v) => setPlanForm((f) => ({ ...f, is_dedicated_ip: v }))} />
                <div>
                  <Label>Dedicated IP plan</Label>
                  <p className="text-xs text-muted-foreground">
                    Provisions only on IPs marked <b>Dedicated</b> in IPs for Sale — one customer per IP.
                    Off = shared IPs pool.
                  </p>
                </div>
              </div>
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
