"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { Profile, Router, WireGuardInterface, WireGuardPeer } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>("demo");
  const [interfaces, setInterfaces] = useState<WireGuardInterface[]>([]);
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPeer, setNewPeer] = useState({ interface: "", name: "", "allowed-address": "", comment: "" });
  const [viewConfigOpen, setViewConfigOpen] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<WireGuardPeer | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [interfaceFilter, setInterfaceFilter] = useState<string>("all");
  const [peerMetadata, setPeerMetadata] = useState<Record<string, { created_at: string; created_by_email: string }>>({});
  const [selectedPrefix, setSelectedPrefix] = useState<string>("");
  const [lastOctet, setLastOctet] = useState<string>("");
  const [showOctetSuggestions, setShowOctetSuggestions] = useState(false);

  // Extract all subnet prefixes from peers
  const { subnetPrefixes, usedIPsByPrefix } = useMemo(() => {
    const prefixSet = new Set<string>();
    const usedByPrefix: Record<string, number[]> = {};

    for (const peer of peers) {
      const addr = peer["allowed-address"]?.split(",")[0]?.split("/")[0] || "";
      if (addr) {
        const parts = addr.split(".");
        if (parts.length === 4) {
          const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`;
          prefixSet.add(prefix);
          if (!usedByPrefix[prefix]) usedByPrefix[prefix] = [];
          const octet = parseInt(parts[3], 10);
          if (!isNaN(octet)) usedByPrefix[prefix].push(octet);
        }
      }
    }

    return {
      subnetPrefixes: Array.from(prefixSet).sort(),
      usedIPsByPrefix: usedByPrefix,
    };
  }, [peers]);

  // Get available octets for selected prefix
  const availableOctets = useMemo(() => {
    if (!selectedPrefix) return [];
    const used = new Set(usedIPsByPrefix[selectedPrefix] || []);
    const available: number[] = [];
    for (let i = 2; i <= 254; i++) {
      if (!used.has(i)) available.push(i);
    }
    return available;
  }, [selectedPrefix, usedIPsByPrefix]);

  const usedOctets = useMemo(() => {
    if (!selectedPrefix) return [];
    return (usedIPsByPrefix[selectedPrefix] || []).sort((a, b) => a - b);
  }, [selectedPrefix, usedIPsByPrefix]);

  // Update allowed-address when prefix or octet changes
  useEffect(() => {
    if (selectedPrefix && lastOctet) {
      setNewPeer(p => ({ ...p, "allowed-address": `${selectedPrefix}.${lastOctet}/32` }));
    } else {
      setNewPeer(p => ({ ...p, "allowed-address": "" }));
    }
  }, [selectedPrefix, lastOctet]);

  // Set default prefix when dialog opens
  useEffect(() => {
    if (createDialogOpen && subnetPrefixes.length > 0 && !selectedPrefix) {
      setSelectedPrefix(subnetPrefixes[0]);
    }
  }, [createDialogOpen, subnetPrefixes, selectedPrefix]);

  // Filter peers based on search query, status, and interface
  const filteredPeers = useMemo(() => {
    return peers.filter((peer) => {
      // Status filter (disabled can be boolean or string "true"/"false" from MikroTik)
      const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
      if (statusFilter === "enabled" && isDisabled) return false;
      if (statusFilter === "disabled" && !isDisabled) return false;

      // Interface filter
      if (interfaceFilter !== "all") {
        const peerIface = typeof peer.interface === "string" ? peer.interface : "";
        if (peerIface !== interfaceFilter) return false;
      }

      // Text search
      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase().trim();
      const name = String(peer.name || "");
      const comment = String(peer.comment || "");
      const allowedAddress = String(peer["allowed-address"] || "");
      const iface = String(typeof peer.interface === "string" ? peer.interface : "");
      return (
        name.toLowerCase().includes(query) ||
        comment.toLowerCase().includes(query) ||
        allowedAddress.toLowerCase().includes(query) ||
        iface.toLowerCase().includes(query)
      );
    });
  }, [peers, searchQuery, statusFilter, interfaceFilter]);

  // Get unique interface names for the filter dropdown
  const interfaceNames = useMemo(() => {
    const names = new Set<string>();
    for (const peer of peers) {
      if (typeof peer.interface === "string" && peer.interface) {
        names.add(peer.interface);
      }
    }
    return Array.from(names).sort();
  }, [peers]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      const { data: profileData } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (profileData) setProfile(profileData as Profile);
      const { data: routersData } = await supabase.from("routers").select("id, name, host, port, api_port, username, use_ssl, created_at");
      if (routersData && routersData.length > 0) {
        setRouters(routersData as Router[]);
        setSelectedRouterId(routersData[0].id);
      }
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  const fetchWireGuardData = useCallback(async () => {
    if (!selectedRouterId) return;
    setLoading(true);
    try {
      const intRes = await fetch("/api/wireguard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "getInterfaces", routerId: selectedRouterId }) });
      const intData = await intRes.json();
      if (intData.interfaces) {
        setInterfaces(intData.interfaces);
        if (intData.interfaces.length > 0 && !newPeer.interface) setNewPeer((p) => ({ ...p, interface: intData.interfaces[0].name }));
      }
      const peerRes = await fetch("/api/wireguard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "getPeers", routerId: selectedRouterId }) });
      const peerData = await peerRes.json();
      if (peerData.peers) setPeers(peerData.peers);
    } catch { toast.error("Failed to fetch data"); }
    setLoading(false);
  }, [selectedRouterId, newPeer.interface]);

  // Load peer metadata from localStorage
  const loadPeerMetadata = useCallback(() => {
    try {
      const stored = localStorage.getItem("wg_peer_metadata");
      if (stored) {
        const all = JSON.parse(stored) as Record<string, Record<string, { created_at: string; created_by_email: string }>>;
        setPeerMetadata(all[selectedRouterId] || {});
      }
    } catch {
      // Ignore parse errors
    }
  }, [selectedRouterId]);

  const savePeerMetadata = useCallback((peerKey: string, email: string) => {
    try {
      const stored = localStorage.getItem("wg_peer_metadata");
      const all: Record<string, Record<string, { created_at: string; created_by_email: string }>> = stored ? JSON.parse(stored) : {};
      if (!all[selectedRouterId]) all[selectedRouterId] = {};
      all[selectedRouterId][peerKey] = {
        created_at: new Date().toISOString(),
        created_by_email: email,
      };
      localStorage.setItem("wg_peer_metadata", JSON.stringify(all));
      setPeerMetadata(all[selectedRouterId]);
    } catch {
      // Ignore storage errors
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (selectedRouterId) {
      fetchWireGuardData();
      loadPeerMetadata();
    }
  }, [selectedRouterId, fetchWireGuardData, loadPeerMetadata]);

  const handleLogout = async () => { await supabase.auth.signOut(); router.push("/login"); };

  const handleCreatePeer = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/wireguard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createPeer", routerId: selectedRouterId, data: newPeer }) });
      const data = await res.json();
      if (data.peer) {
        // Save custom metadata (creation date + creator) in localStorage
        const peerKey = data.peer["public-key"] || data.peer[".id"] || newPeer.name;
        savePeerMetadata(peerKey, profile?.email || "Unknown");
        toast.success("Peer created");
        setCreateDialogOpen(false);
        setNewPeer({ interface: interfaces[0]?.name || "", name: "", "allowed-address": "", comment: "" });
        setSelectedPrefix("");
        setLastOctet("");
        fetchWireGuardData();
      }
      else toast.error(data.error || "Failed to create peer");
    } catch { toast.error("Failed to create peer"); }
    setCreating(false);
  };

  const handleDeletePeer = async (id: string) => {
    if (!confirm("Delete this peer?")) return;
    const res = await fetch("/api/wireguard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterId, data: { id } }) });
    const data = await res.json();
    if (data.success) { toast.success("Peer deleted"); fetchWireGuardData(); }
    else toast.error(data.error || "Failed");
  };

  const handleTogglePeer = async (id: string, disabled: boolean) => {
    const action = disabled ? "enablePeer" : "disablePeer";
    const res = await fetch("/api/wireguard", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, routerId: selectedRouterId, data: { id } }) });
    const data = await res.json();
    if (data.success) { toast.success(disabled ? "Peer enabled" : "Peer disabled"); fetchWireGuardData(); }
    else toast.error(data.error || "Failed");
  };

  const formatBytes = (bytes?: number) => { if (!bytes) return "0 B"; const sizes = ["B", "KB", "MB", "GB"]; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`; };

  const generateConfig = (peer: WireGuardPeer) => {
    const iface = interfaces.find((i) => i.name === peer.interface);
    const selectedRouter = routers.find((r) => r.id === selectedRouterId);
    const privateKey = peer["private-key"] || "[CLIENT_PRIVATE_KEY]";
    const endpointHost = peer.comment && /^\d+\.\d+\.\d+\.\d+$/.test(peer.comment)
      ? peer.comment
      : selectedRouter?.host || "server.example.com";
    const listenPort = iface?.["listen-port"] || 51820;

    return `[Interface]
PrivateKey = ${privateKey}
Address = ${peer["allowed-address"]?.split(",")[0]?.split("/")[0]}/32
DNS = 8.8.8.8

[Peer]
PublicKey = ${iface?.["public-key"] || "[SERVER_PUBLIC_KEY]"}
AllowedIPs = 0.0.0.0/0
Endpoint = ${endpointHost}:${listenPort}
PersistentKeepalive = 25`;
  };

  const downloadConfig = (peer: WireGuardPeer) => {
    const config = generateConfig(peer);
    const blob = new Blob([config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${peer.name || peer.comment || "wireguard"}.conf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (loading && !profile) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-foreground rounded-full" /></div>;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" /></svg>
            </div>
            <h1 className="text-xl font-semibold">WireGuard Manager</h1>
            <Select value={selectedRouterId} onValueChange={setSelectedRouterId}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Select router" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="demo">Demo Mode</SelectItem>
                {routers.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedRouterId === "demo" && <Badge variant="secondary">Demo</Badge>}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground text-sm">{profile?.email} <Badge variant={profile?.role === "admin" ? "destructive" : "secondary"}>{profile?.role}</Badge></span>
            {profile?.role === "admin" && <Button variant="ghost" onClick={() => router.push("/admin")}>Admin</Button>}
            <Button variant="ghost" onClick={handleLogout}>Logout</Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-lg font-medium mb-4">WireGuard Interfaces</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {interfaces.map((iface) => (
              <div key={iface[".id"]} className="bg-card rounded-lg p-4 border">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{iface.name}</span>
                  <Badge variant={iface.running ? "default" : "secondary"}>{iface.running ? "Running" : "Stopped"}</Badge>
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Port: {iface["listen-port"]}</p>
                  <p className="truncate">Key: {iface["public-key"]?.substring(0, 20)}...</p>
                </div>
              </div>
            ))}
            {interfaces.length === 0 && <div className="col-span-full text-center py-8 text-muted-foreground">No interfaces found</div>}
          </div>
        </div>

        <Separator className="my-8" />

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">WireGuard Peers ({filteredPeers.length}{filteredPeers.length !== peers.length ? ` of ${peers.length}` : ""})</h2>
            <div className="flex gap-2 flex-wrap">
              <Input
                placeholder="Search peers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <Select value={interfaceFilter} onValueChange={setInterfaceFilter}>
                <SelectTrigger className="w-[160px]"><SelectValue placeholder="Interface" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Interfaces</SelectItem>
                  {interfaceNames.map((name) => (
                    <SelectItem key={name} value={name}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" onClick={fetchWireGuardData}>Refresh</Button>
              <Dialog open={createDialogOpen} onOpenChange={(open) => {
                setCreateDialogOpen(open);
                if (!open) {
                  setSelectedPrefix("");
                  setLastOctet("");
                }
              }}>
                <DialogTrigger asChild><Button>Add Peer</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Peer</DialogTitle><DialogDescription>Add a new WireGuard peer</DialogDescription></DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Interface</Label>
                      <Select value={newPeer.interface} onValueChange={(v) => setNewPeer({ ...newPeer, interface: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{interfaces.map((i) => <SelectItem key={i[".id"]} value={i.name}>{i.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input placeholder="Ruben PC" value={newPeer.name} onChange={(e) => setNewPeer({ ...newPeer, name: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Allowed Address</Label>
                      {subnetPrefixes.length === 0 ? (
                        <Input
                          placeholder="10.10.200.5/32"
                          value={newPeer["allowed-address"]}
                          onChange={(e) => setNewPeer({ ...newPeer, "allowed-address": e.target.value })}
                        />
                      ) : (
                        <div className="flex gap-2">
                          <Select value={selectedPrefix} onValueChange={setSelectedPrefix}>
                            <SelectTrigger className="w-[160px] font-mono">
                              <SelectValue placeholder="Select subnet" />
                            </SelectTrigger>
                            <SelectContent>
                              {subnetPrefixes.map((prefix) => (
                                <SelectItem key={prefix} value={prefix} className="font-mono">
                                  {prefix}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="flex items-center text-lg font-mono">.</span>
                          <div className="relative flex-1">
                            <Input
                              type="number"
                              min="2"
                              max="254"
                              placeholder="X"
                              value={lastOctet}
                              onChange={(e) => setLastOctet(e.target.value)}
                              onFocus={() => setShowOctetSuggestions(true)}
                              onBlur={() => setTimeout(() => setShowOctetSuggestions(false), 200)}
                              className="font-mono"
                            />
                            {showOctetSuggestions && selectedPrefix && (
                              <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-48 overflow-y-auto">
                                <div className="p-2 border-b bg-muted/50">
                                  <p className="text-xs font-medium">{selectedPrefix}.X</p>
                                  <p className="text-xs text-muted-foreground">
                                    {usedOctets.length} used, {availableOctets.length} available
                                  </p>
                                </div>
                                <div className="p-1">
                                  <p className="text-xs text-muted-foreground px-2 py-1">Available:</p>
                                  <div className="flex flex-wrap gap-1 p-2 max-h-20 overflow-y-auto">
                                    {availableOctets.slice(0, 30).map((octet) => (
                                      <button
                                        key={octet}
                                        type="button"
                                        className="px-2 py-1 text-xs bg-secondary hover:bg-secondary/80 rounded cursor-pointer font-mono"
                                        onClick={() => {
                                          setLastOctet(octet.toString());
                                          setShowOctetSuggestions(false);
                                        }}
                                      >
                                        {octet}
                                      </button>
                                    ))}
                                    {availableOctets.length > 30 && (
                                      <span className="text-xs text-muted-foreground px-2">+{availableOctets.length - 30} more</span>
                                    )}
                                  </div>
                                  {usedOctets.length > 0 && (
                                    <>
                                      <p className="text-xs text-muted-foreground px-2 py-1 border-t mt-1">Used:</p>
                                      <div className="flex flex-wrap gap-1 p-2">
                                        {usedOctets.slice(0, 15).map((octet) => (
                                          <span key={octet} className="px-2 py-1 text-xs bg-destructive/20 text-destructive rounded font-mono">
                                            {octet}
                                          </span>
                                        ))}
                                        {usedOctets.length > 15 && (
                                          <span className="text-xs text-muted-foreground px-2">+{usedOctets.length - 15} more</span>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          <span className="flex items-center text-sm text-muted-foreground font-mono">/32</span>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {subnetPrefixes.length === 0
                          ? "Enter full IP address (no existing subnets detected)"
                          : "Select subnet and enter last octet"}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Comment (Endpoint IP)</Label>
                      <Input placeholder="76.245.59.200" value={newPeer.comment} onChange={(e) => setNewPeer({ ...newPeer, comment: e.target.value })} />
                      <p className="text-xs text-muted-foreground">IP address used for the Endpoint in config file</p>
                    </div>
                  </div>
                  <DialogFooter><Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>Cancel</Button><Button onClick={handleCreatePeer} disabled={creating || !newPeer["allowed-address"]}>{creating ? "Creating..." : "Create"}</Button></DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {loading ? <div className="text-center py-12"><div className="animate-spin w-8 h-8 border-2 border-muted-foreground border-t-foreground rounded-full mx-auto" /></div> : filteredPeers.length === 0 ? <div className="text-center py-12 text-muted-foreground">{searchQuery || statusFilter !== "all" || interfaceFilter !== "all" ? "No peers match your filters" : "No peers found"}</div> : (
            <div className="bg-card rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Interface</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Allowed Address</TableHead>
                    <TableHead>Comment</TableHead>
                    <TableHead>Traffic</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created By</TableHead>
                    <TableHead>Created At</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPeers.map((peer) => (
                    <TableRow key={peer[".id"]}>
                      <TableCell className="font-medium">{peer.interface}</TableCell>
                      <TableCell>{peer.name || peer.comment || "-"}</TableCell>
                      <TableCell className="font-mono text-sm">{peer["allowed-address"]}</TableCell>
                      <TableCell className="text-sm">{peer.comment || "-"}</TableCell>
                      <TableCell className="text-sm"><span className="text-green-500">{formatBytes(peer.rx)}</span> / <span className="text-blue-500">{formatBytes(peer.tx)}</span></TableCell>
                      <TableCell>{(() => { const dis = peer.disabled === true || String(peer.disabled) === "true"; return <Badge variant={dis ? "secondary" : "default"}>{dis ? "Disabled" : "Enabled"}</Badge>; })()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {peerMetadata[peer["public-key"]]?.created_by_email || "-"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {peerMetadata[peer["public-key"]]?.created_at
                          ? new Date(peerMetadata[peer["public-key"]].created_at).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => downloadConfig(peer)} title="Download .conf">DL</Button>
                          <Button variant="ghost" size="sm" onClick={() => { setSelectedPeer(peer); setViewConfigOpen(true); }} title="View config">CFG</Button>
                          <Button variant="ghost" size="sm" onClick={() => { const dis = peer.disabled === true || String(peer.disabled) === "true"; handleTogglePeer(peer[".id"], dis); }}>{(peer.disabled === true || String(peer.disabled) === "true") ? "EN" : "DIS"}</Button>
                          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeletePeer(peer[".id"])}>DEL</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </main>

      <Dialog open={viewConfigOpen} onOpenChange={setViewConfigOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Peer Configuration</DialogTitle><DialogDescription>{selectedPeer?.name || selectedPeer?.comment}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Public Key</Label><Input readOnly value={selectedPeer?.["public-key"] || ""} /></div>
            <div className="space-y-2"><Label>Client Configuration</Label><pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto whitespace-pre-wrap">{selectedPeer && generateConfig(selectedPeer)}</pre></div>
          </div>
          <DialogFooter><Button onClick={() => selectedPeer && downloadConfig(selectedPeer)}>Download .conf</Button><Button variant="ghost" onClick={() => setViewConfigOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
