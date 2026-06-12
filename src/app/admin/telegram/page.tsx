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
import { CalendarPlus, Loader2, Pencil, Plus, Power, PowerOff, RefreshCw, Send, Trash2 } from "lucide-react";
import type { Profile } from "@/lib/types";

/* ============ Tipos (respuestas del API admin, con joins) ============ */
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
  wg_interface: string | null;
}
interface IpOption {
  id: string;
  public_ip: string;
  ip_number: number;
  enabled: boolean;
  restricted: boolean;
  for_sale?: boolean;
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
  return iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—";
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

  // Tab "IPs en venta"
  const [saleRouterId, setSaleRouterId] = useState<string>("");
  const [saleIps, setSaleIps] = useState<IpOption[]>([]);
  const [loadingSaleIps, setLoadingSaleIps] = useState(false);

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
        toast.error(err instanceof Error ? err.message : "Error cargando datos");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IPs del router elegido en el form de plan
  useEffect(() => {
    if (!planForm.router_id) {
      setIps([]);
      return;
    }
    tgAdmin("listPublicIps", { routerId: planForm.router_id })
      .then((r) => setIps(r.ips || []))
      .catch(() => setIps([]));
  }, [planForm.router_id, tgAdmin]);

  // Cargar IPs del router seleccionado en la pestaña "IPs en venta"
  useEffect(() => {
    if (!saleRouterId) {
      setSaleIps([]);
      return;
    }
    setLoadingSaleIps(true);
    tgAdmin("listPublicIps", { routerId: saleRouterId })
      .then((r) => setSaleIps(r.ips || []))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Error cargando IPs"))
      .finally(() => setLoadingSaleIps(false));
  }, [saleRouterId, tgAdmin]);

  const toggleForSale = async (ip: IpOption) => {
    try {
      await tgAdmin("setIpForSale", { id: ip.id, forSale: !ip.for_sale });
      setSaleIps((prev) => prev.map((i) => (i.id === ip.id ? { ...i, for_sale: !ip.for_sale } : i)));
      toast.success(!ip.for_sale ? `${ip.public_ip} abierta a ventas` : `${ip.public_ip} reservada`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  /* ============ Planes ============ */
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
      toast.error("Completa nombre, precio, duración y servidor");
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
        toast.success("Plan actualizado");
      } else {
        await tgAdmin("createPlan", payload);
        toast.success("Plan creado");
      }
      setPlanDialogOpen(false);
      setPlans((await tgAdmin("listPlans")).plans || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error guardando plan");
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
    if (!confirm(`¿Eliminar el plan "${plan.name}"?`)) return;
    try {
      await tgAdmin("deletePlan", { id: plan.id });
      setPlans((prev) => prev.filter((p) => p.id !== plan.id));
      toast.success("Plan eliminado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  /* ============ Clientes ============ */
  const toggleBan = async (customer: AdminCustomer) => {
    try {
      await tgAdmin("setCustomerBan", { id: customer.id, banned: !customer.is_banned });
      setCustomers((prev) =>
        prev.map((c) => (c.id === customer.id ? { ...c, is_banned: !customer.is_banned } : c))
      );
      toast.success(customer.is_banned ? "Cliente desbloqueado" : "Cliente bloqueado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  /* ============ Peers ============ */
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
      toast.success(`Extendido ${extendDays} días`);
      setExtendPeerTarget(null);
      await refreshPeers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    } finally {
      setExtending(false);
    }
  };

  const peerAction = async (peer: AdminPeer, action: "disableCustomerPeer" | "enableCustomerPeer" | "deleteCustomerPeer") => {
    if (action === "deleteCustomerPeer" && !confirm(`¿Eliminar el peer "${peer.peer_name}"? Se quita del servidor y del cliente.`)) return;
    setBusyPeerId(peer.id);
    try {
      await tgAdmin(action, { id: peer.id });
      toast.success("Listo");
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
      <PageHeader title="Telegram Store" description="Planes, clientes y pagos de la Mini App">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => loadAll().catch(() => toast.error("Error al refrescar"))}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refrescar
          </Button>
        </div>
      </PageHeader>
      <PageContent>
        <Tabs defaultValue="plans">
          <TabsList>
            <TabsTrigger value="plans">Planes ({plans.length})</TabsTrigger>
            <TabsTrigger value="ips">IPs en venta</TabsTrigger>
            <TabsTrigger value="customers">Clientes ({customers.length})</TabsTrigger>
            <TabsTrigger value="peers">Peers ({peers.length})</TabsTrigger>
            <TabsTrigger value="payments">Pagos ({payments.length})</TabsTrigger>
          </TabsList>

          {/* ============ PLANES ============ */}
          <TabsContent value="plans" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={openNewPlan}>
                <Plus className="w-4 h-4 mr-2" /> Nuevo Plan
              </Button>
            </div>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Servidor</TableHead>
                    <TableHead>Precio</TableHead>
                    <TableHead>Duración</TableHead>
                    <TableHead>IP fija</TableHead>
                    <TableHead>Activo</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plans.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Sin planes. Crea el primero para que aparezca en la Mini App.
                      </TableCell>
                    </TableRow>
                  )}
                  {plans.map((plan) => (
                    <TableRow key={plan.id}>
                      <TableCell className="font-medium">{plan.name}</TableCell>
                      <TableCell>{plan.routers?.name || "—"}</TableCell>
                      <TableCell>{Number(plan.price_usd) <= 0 ? "Gratis" : `$${Number(plan.price_usd).toFixed(2)}`}</TableCell>
                      <TableCell>{plan.duration_days} días</TableCell>
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

          {/* ============ IPs EN VENTA ============ */}
          <TabsContent value="ips" className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Las órdenes automáticas SOLO usan IPs marcadas <b>en venta</b> (se elige la menos cargada).
                Las demás quedan reservadas para tu uso o clientes con IP dedicada (esas se asignan fijándolas en un plan).
              </p>
              <div className="w-64 shrink-0">
                <Select value={saleRouterId} onValueChange={setSaleRouterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un servidor" />
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
                      <TableHead>IP pública</TableHead>
                      <TableHead>Clientes activos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">En venta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingSaleIps && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8">
                          <Loader2 className="w-5 h-5 animate-spin inline-block" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!loadingSaleIps && saleIps.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          Este servidor no tiene IPs públicas configuradas.
                        </TableCell>
                      </TableRow>
                    )}
                    {!loadingSaleIps &&
                      saleIps.map((ip) => {
                        const activeCount = peers.filter(
                          (p) => p.public_ip === ip.public_ip && p.status === "active"
                        ).length;
                        return (
                          <TableRow key={ip.id}>
                            <TableCell className="font-mono">{ip.public_ip}</TableCell>
                            <TableCell>{activeCount}</TableCell>
                            <TableCell className="space-x-1.5">
                              {!ip.enabled && (
                                <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">disabled</Badge>
                              )}
                              {ip.restricted && (
                                <Badge variant="outline" className="bg-amber-500/15 text-amber-400 border-amber-500/30">restricted</Badge>
                              )}
                              {ip.for_sale ? (
                                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">en venta</Badge>
                              ) : (
                                <Badge variant="outline" className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30">reservada</Badge>
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
                Selecciona un servidor para ver sus IPs.
              </div>
            )}
          </TabsContent>

          {/* ============ CLIENTES ============ */}
          <TabsContent value="customers">
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Telegram ID</TableHead>
                    <TableHead>Peers</TableHead>
                    <TableHead>Registrado</TableHead>
                    <TableHead>Última vez</TableHead>
                    <TableHead>Bloqueado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Sin clientes aún. Aparecen automáticamente al abrir la Mini App.
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
                        {(c.tg_customer_peers || []).filter((p) => p.status === "active").length} activos /{" "}
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
                    <TableHead>Cliente</TableHead>
                    <TableHead>Servidor</TableHead>
                    <TableHead>IP</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Vence</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {peers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        Sin peers de clientes.
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
                              title="Extender"
                              onClick={() => {
                                setExtendPeerTarget(peer);
                                setExtendDays("30");
                                setExtendNotify(true);
                              }}
                            >
                              <CalendarPlus className="w-4 h-4" />
                            </Button>
                            {peer.status === "active" ? (
                              <Button variant="ghost" size="sm" title="Deshabilitar" onClick={() => peerAction(peer, "disableCustomerPeer")}>
                                <PowerOff className="w-4 h-4" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="sm" title="Habilitar" onClick={() => peerAction(peer, "enableCustomerPeer")}>
                                <Power className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              title="Eliminar"
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

          {/* ============ PAGOS ============ */}
          <TabsContent value="payments">
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Sin pagos registrados.
                      </TableCell>
                    </TableRow>
                  )}
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{fmtDate(p.created_at)}</TableCell>
                      <TableCell>{customerLabel(p.tg_customers)}</TableCell>
                      <TableCell>{p.tg_plans?.name || "—"}</TableCell>
                      <TableCell>{p.type === "purchase" ? "Compra" : "Renovación"}</TableCell>
                      <TableCell>${Number(p.amount_usd).toFixed(2)}</TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>

        {/* Dialog plan */}
        <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{planForm.id ? "Editar plan" : "Nuevo plan"}</DialogTitle>
              <DialogDescription>Los planes activos se muestran en la Mini App.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} placeholder="VPN 1 Mes" />
              </div>
              <div className="space-y-1.5">
                <Label>Descripción (opcional)</Label>
                <Textarea
                  value={planForm.description}
                  onChange={(e) => setPlanForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="IP dedicada, tráfico ilimitado…"
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Precio USD</Label>
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
                  <Label>Duración (días)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={planForm.duration_days}
                    onChange={(e) => setPlanForm((f) => ({ ...f, duration_days: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Servidor (linux-ssh)</Label>
                <Select value={planForm.router_id} onValueChange={(v) => setPlanForm((f) => ({ ...f, router_id: v, public_ip_id: "" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un servidor" />
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
              {planForm.router_id && (
                <div className="space-y-1.5">
                  <Label>IP pública fija (opcional)</Label>
                  <Select
                    value={planForm.public_ip_id || "__auto__"}
                    onValueChange={(v) => setPlanForm((f) => ({ ...f, public_ip_id: v === "__auto__" ? "" : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Auto (primera IP disponible)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Auto (primera IP disponible)</SelectItem>
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
                  <Label>Orden</Label>
                  <Input
                    type="number"
                    value={planForm.sort_order}
                    onChange={(e) => setPlanForm((f) => ({ ...f, sort_order: e.target.value }))}
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch checked={planForm.enabled} onCheckedChange={(v) => setPlanForm((f) => ({ ...f, enabled: v }))} />
                  <Label>Visible en la app</Label>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlanDialogOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={savePlan} disabled={savingPlan}>
                {savingPlan && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog extender */}
        <Dialog open={!!extendPeerTarget} onOpenChange={(open) => !open && setExtendPeerTarget(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Extender {extendPeerTarget?.peer_name}</DialogTitle>
              <DialogDescription>
                Suma días a la expiración. Si está expirado/deshabilitado, se reactiva en el servidor.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Días</Label>
                <Input type="number" min="1" value={extendDays} onChange={(e) => setExtendDays(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={extendNotify} onCheckedChange={(v) => setExtendNotify(v === true)} id="notify" />
                <Label htmlFor="notify" className="flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Notificar al cliente por Telegram
                </Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setExtendPeerTarget(null)}>
                Cancelar
              </Button>
              <Button onClick={doExtend} disabled={extending || !Number(extendDays)}>
                {extending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Extender
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContent>
    </DashboardLayout>
  );
}
