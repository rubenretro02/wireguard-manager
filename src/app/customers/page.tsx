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
import { BookUser, Check, Loader2, Pencil, Plus, RefreshCw, Search, Send, UserRound, X } from "lucide-react";
import { fuzzyScore } from "@/lib/fuzzy";
import type { Profile } from "@/lib/types";

interface CustomerRow {
  id: string;
  telegram_id: number | null;
  /** Our label for the customer (v36). Telegram keeps rewriting first/last, this one is ours. */
  name: string | null;
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

/** Linked to Telegram or not — a manual customer becomes "telegram" once they open their link (v32). */
const kindOf = (c: CustomerRow): "telegram" | "manual" => (c.telegram_id ? "telegram" : "manual");

/** Telegram's own name for the account (what the customer sees in Telegram). */
const tgFullName = (c: CustomerRow): string => [c.first_name, c.last_name].filter(Boolean).join(" ").trim();

/** How Telegram identifies them: @username > Telegram name > id. Empty for manual customers. */
function tgIdentity(c: CustomerRow): string {
  if (!c.telegram_id) return "";
  return c.username ? `@${c.username}` : tgFullName(c) || String(c.telegram_id);
}

/** Our name first; otherwise whatever identifies them. */
function displayName(c: CustomerRow): string {
  return c.name || tgIdentity(c) || tgFullName(c) || c.email || "Customer";
}

const emptyForm = { name: "", email: "", phone: "", notes: "", customerType: "client" };

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
  // Inline rename (pencil on the Name cell)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [savingName, setSavingName] = useState(false);

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
      // Before migration v30 runs there is no `source` column: everything is Telegram
      setCustomers((json.customers || []).map((c: CustomerRow) => ({ ...c, source: c.source || "telegram" })));
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
      .filter((c) => sourceFilter === "all" || kindOf(c) === sourceFilter)
      .map((c) => ({
        c,
        score: fuzzyScore(
          [c.name, displayName(c), c.first_name, c.last_name, c.username, c.email, c.phone, c.telegram_id ? String(c.telegram_id) : null],
          search
        ),
      }))
      .filter(({ score }) => score >= 0);
    // Searching ranks by relevance; otherwise the list is alphabetical
    if (search.trim()) scored.sort((a, b) => b.score - a.score);
    else scored.sort((a, b) => displayName(a.c).replace(/^@/, "").localeCompare(displayName(b.c).replace(/^@/, ""), undefined, { sensitivity: "base" }));
    return scored.map((s) => s.c);
  }, [customers, search, sourceFilter]);

  const startRename = (c: CustomerRow) => {
    setEditingId(c.id);
    setEditingName(c.name || "");
  };

  const saveRename = async () => {
    if (!editingId) return;
    const current = customers.find((c) => c.id === editingId);
    const next = editingName.trim();
    if (!current || (current.name || "") === next) { setEditingId(null); return; }
    setSavingName(true);
    try {
      await tgAdmin("updateCustomer", { id: editingId, name: next });
      setCustomers((prev) => prev.map((c) => (c.id === editingId ? { ...c, name: next || null } : c)));
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename");
    } finally {
      setSavingName(false);
    }
  };

  const createCustomer = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
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
    telegram: customers.filter((c) => kindOf(c) === "telegram").length,
    manual: customers.filter((c) => kindOf(c) === "manual").length,
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
                placeholder="Search by name, @username, Telegram name, email, phone…"
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
                <TableHead>Name</TableHead>
                <TableHead>Telegram</TableHead>
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
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    {customers.length === 0 ? "No customers yet — create the first one." : "No customers match your search."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((c) => {
                  const peers = c.tg_customer_peers || [];
                  const active = peers.filter((p) => p.status === "active").length;
                  const editing = editingId === c.id;
                  return (
                    <TableRow
                      key={c.id}
                      className="border-border hover:bg-secondary/50 transition-colors cursor-pointer"
                      onClick={() => { if (!editing) router.push(`/customers/${c.id}`); }}
                    >
                      {/* Our label — independent of whatever Telegram calls them */}
                      <TableCell onClick={(e) => { if (editing) e.stopPropagation(); }}>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            {kindOf(c) === "telegram" ? <Send className="w-4 h-4 text-primary" /> : <UserRound className="w-4 h-4 text-primary" />}
                          </div>
                          {editing ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setEditingId(null); }}
                                placeholder="Customer name"
                                className="h-8 w-44 bg-secondary"
                                autoFocus
                                disabled={savingName}
                              />
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-400" onClick={saveRename} disabled={savingName}>
                                {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingId(null)} disabled={savingName}>
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          ) : (
                            <div className="group flex items-center gap-1 min-w-0">
                              <span className={`font-medium truncate ${c.name ? "" : "text-muted-foreground italic"}`}>{c.name || "No name"}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 opacity-40 group-hover:opacity-100"
                                title="Rename"
                                onClick={(e) => { e.stopPropagation(); startRename(c); }}
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                            </div>
                          )}
                          {c.is_banned && <Badge variant="outline" className="text-red-400 border-red-400/50">banned</Badge>}
                        </div>
                      </TableCell>
                      {/* Who they are on Telegram */}
                      <TableCell>
                        {c.telegram_id ? (
                          <div className="min-w-0">
                            <div className="text-sm truncate">{tgIdentity(c)}</div>
                            {c.username && tgFullName(c) && (
                              <div className="text-xs text-muted-foreground truncate">{tgFullName(c)}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">not linked</span>
                        )}
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
                        <Badge variant="outline" className={kindOf(c) === "telegram" ? "text-sky-400 border-sky-400/50" : "text-violet-400 border-violet-400/50"}>
                          {kindOf(c)}
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
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-secondary" autoFocus placeholder="How you call this customer" />
              <p className="text-xs text-muted-foreground">Your own label. It stays even if they later link a Telegram account with a different name.</p>
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
