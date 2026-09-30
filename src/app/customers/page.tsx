"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BookUser, Loader2, Plus, RefreshCw, Search, Send, UserRound } from "lucide-react";
import { fuzzyScore } from "@/lib/fuzzy";
import type { Profile } from "@/lib/types";

interface CustomerRow {
  id: string;
  telegram_id: number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: "telegram" | "manual";
  customer_type: "client" | "agent";
  is_banned: boolean;
  created_at: string;
  tg_customer_peers?: { id: string; status: string }[];
}

function displayName(c: CustomerRow): string {
  if (c.username) return `@${c.username}`;
  const full = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  return c.email || (c.telegram_id ? String(c.telegram_id) : "Customer");
}

const emptyForm = { firstName: "", lastName: "", email: "", phone: "", notes: "", customerType: "client" };

export default function CustomersPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "telegram" | "manual">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

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

  const loadCustomers = useCallback(async () => {
    try {
      const json = await tgAdmin("listCustomers");
      setCustomers(json.customers || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load customers");
    }
  }, [tgAdmin]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (!data || data.role !== "admin") { router.push("/dashboard"); return; }
      setProfile(data as Profile);
      await loadCustomers();
      setLoading(false);
    })();
  }, [supabase, router, loadCustomers]);

  const filtered = useMemo(() => {
    const scored = customers
      .filter((c) => sourceFilter === "all" || c.source === sourceFilter)
      .map((c) => ({
        c,
        score: fuzzyScore(
          [displayName(c), c.first_name, c.last_name, c.username, c.email, c.phone, c.telegram_id ? String(c.telegram_id) : null],
          search
        ),
      }))
      .filter(({ score }) => score >= 0);
    if (search.trim()) scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.c);
  }, [customers, search, sourceFilter]);

  const createCustomer = async () => {
    if (!form.firstName.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const json = await tgAdmin("createCustomer", form);
      toast.success("Customer created");
      setCreateOpen(false);
      setForm(emptyForm);
      router.push(`/customers/${json.customer.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const counts = {
    all: customers.length,
    telegram: customers.filter((c) => c.source === "telegram").length,
    manual: customers.filter((c) => c.source === "manual").length,
  };

  return (
    <DashboardLayout userRole={profile.role} userEmail={profile.email} userCapabilities={profile.capabilities} onLogout={handleLogout}>
      <PageHeader title="Customers" description="Every client and all their peers, across every server">
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New customer
        </Button>
      </PageHeader>
      <PageContent>
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="relative flex-1 max-w-md min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, phone, @username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-secondary border-border"
              />
            </div>
            <div className="flex gap-1">
              {([["all", "All"], ["telegram", "Telegram"], ["manual", "Manual"]] as const).map(([value, label]) => (
                <Button
                  key={value}
                  size="sm"
                  variant={sourceFilter === value ? "default" : "outline"}
                  onClick={() => setSourceFilter(value)}
                  className="gap-1.5"
                >
                  {label}
                  <span className="text-xs opacity-70">{counts[value]}</span>
                </Button>
              ))}
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={async () => { setRefreshing(true); await loadCustomers(); setRefreshing(false); }}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Customer</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Peers</TableHead>
                <TableHead>Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow className="border-border">
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-12">
                    {customers.length === 0 ? "No customers yet — create the first one." : "No customers match your search."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const peers = c.tg_customer_peers || [];
                  const active = peers.filter((p) => p.status === "active").length;
                  return (
                    <TableRow
                      key={c.id}
                      className="border-border hover:bg-secondary/50 transition-colors cursor-pointer"
                      onClick={() => router.push(`/customers/${c.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            {c.source === "telegram" ? <Send className="w-4 h-4 text-primary" /> : <UserRound className="w-4 h-4 text-primary" />}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate">{displayName(c)}</div>
                            {c.username && (c.first_name || c.last_name) && (
                              <div className="text-xs text-muted-foreground truncate">
                                {[c.first_name, c.last_name].filter(Boolean).join(" ")}
                              </div>
                            )}
                          </div>
                          {c.is_banned && <Badge variant="outline" className="text-red-400 border-red-400/50">banned</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.email || c.phone ? (
                          <div className="flex flex-col">
                            {c.email && <span>{c.email}</span>}
                            {c.phone && <span className="font-mono text-xs">{c.phone}</span>}
                          </div>
                        ) : c.telegram_id ? (
                          <span className="font-mono text-xs">TG {c.telegram_id}</span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.source === "telegram" ? "text-sky-400 border-sky-400/50" : "text-violet-400 border-violet-400/50"}>
                          {c.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={c.customer_type === "agent" ? "text-amber-400 border-amber-400/50" : ""}>
                          {c.customer_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">{active}</span>
                        <span className="text-muted-foreground"> / {peers.length}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(c.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </PageContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookUser className="w-5 h-5 text-primary" />
              New customer
            </DialogTitle>
            <DialogDescription>
              A customer without Telegram. You can assign peers from any server to them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>First name *</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="bg-secondary" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Last name</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="bg-secondary" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-secondary" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-secondary" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={form.customerType} onValueChange={(v) => setForm({ ...form, customerType: v })}>
                <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="bg-secondary" rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={createCustomer} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
