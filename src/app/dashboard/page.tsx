"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import {
  Users,
  Globe,
  Server,
  Activity,
  Plus,
  RefreshCw,
  Search,
  Download,
  Settings,
  Trash2,
  Power,
  PowerOff,
  Pencil,
  ArrowUpDown,
  Eye
} from "lucide-react";
import type { Profile, Router as RouterType, WireGuardInterface, WireGuardPeer, PublicIP } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<RouterType[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>("");
  const [interfaces, setInterfaces] = useState<WireGuardInterface[]>([]);
  const [peers, setPeers] = useState<WireGuardPeer[]>([]);
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create peer dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPeer, setNewPeer] = useState({ interface: "", name: "", "allowed-address": "", comment: "" });
  const [selectedPublicIpId, setSelectedPublicIpId] = useState<string>("");

  // View config dialog
  const [viewConfigOpen, setViewConfigOpen] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<WireGuardPeer | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Edit peer
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPeer, setEditingPeer] = useState<WireGuardPeer | null>(null);
  const [editName, setEditName] = useState("");
  const [editAllowedAddress, setEditAllowedAddress] = useState("");
  const [editComment, setEditComment] = useState("");
  const [updating, setUpdating] = useState(false);

  // Stats
  const stats = useMemo(() => {
    const total = peers.length;
    const active = peers.filter(p => {
      const isDisabled = p.disabled === true || String(p.disabled) === "true";
      return !isDisabled;
    }).length;
    const disabled = total - active;
    const uniqueSubnets = new Set(
      peers.map(p => {
        const addr = p["allowed-address"]?.split(",")[0]?.split("/")[0] || "";
        const parts = addr.split(".");
        return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "";
      }).filter(Boolean)
    ).size;

    return { total, active, disabled, uniqueSubnets };
  }, [peers]);

  // Filter and sort peers
  const filteredPeers = useMemo(() => {
    const filtered = peers.filter((peer) => {
      const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
      if (statusFilter === "enabled" && isDisabled) return false;
      if (statusFilter === "disabled" && !isDisabled) return false;

      if (!searchQuery.trim()) return true;
      const query = searchQuery.toLowerCase().trim();
      const name = String(peer.name || "");
      const comment = String(peer.comment || "");
      const allowedAddress = String(peer["allowed-address"] || "");
      return (
        name.toLowerCase().includes(query) ||
        comment.toLowerCase().includes(query) ||
        allowedAddress.toLowerCase().includes(query)
      );
    });

    // Sort by ID (assuming higher ID = newer)
    const sorted = [...filtered].sort((a, b) => {
      const idA = a[".id"] || "";
      const idB = b[".id"] || "";
      return sortOrder === "desc" ? idB.localeCompare(idA) : idA.localeCompare(idB);
    });

    return sorted;
  }, [peers, searchQuery, statusFilter, sortOrder]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileData) setProfile(profileData as Profile);

      const { data: routersData } = await supabase
        .from("routers")
        .select("id, name, host, port, api_port, username, use_ssl, created_at");

      if (routersData && routersData.length > 0) {
        setRouters(routersData as RouterType[]);
        setSelectedRouterId(routersData[0].id);
      }
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  const fetchWireGuardData = useCallback(async (forceRefresh = false) => {
    if (!selectedRouterId) return;
    setRefreshing(true);
    try {
      const [intRes, peerRes] = await Promise.all([
        fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getInterfaces", routerId: selectedRouterId, forceRefresh })
        }),
        fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getPeers", routerId: selectedRouterId, forceRefresh })
        })
      ]);

      const [intData, peerData] = await Promise.all([intRes.json(), peerRes.json()]);

      if (intData.interfaces) {
        setInterfaces(intData.interfaces);
        if (intData.interfaces.length > 0 && !newPeer.interface) {
          setNewPeer(p => ({ ...p, interface: intData.interfaces[0].name }));
        }
      }
      if (peerData.peers) {
        setPeers(peerData.peers);
        if (forceRefresh) {
          toast.success(`Loaded ${peerData.peers.length} peers`);
        }
      }
    } catch {
      toast.error("Failed to fetch data");
    }
    setRefreshing(false);
  }, [selectedRouterId, newPeer.interface]);

  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const res = await fetch(`/api/public-ips?routerId=${selectedRouterId}`);
      const data = await res.json();
      if (data.publicIps) {
        setPublicIps(data.publicIps.filter((ip: PublicIP) => ip.enabled));
      }
    } catch {
      console.error("Failed to fetch public IPs");
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (selectedRouterId) {
      fetchWireGuardData();
      fetchPublicIps();
    }
  }, [selectedRouterId, fetchWireGuardData, fetchPublicIps]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  const handleCreatePeerSimplified = async () => {
    if (!selectedPublicIpId || !newPeer.interface || !newPeer.name) {
      toast.error("Please fill all required fields");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createPeerSimplified",
          routerId: selectedRouterId,
          data: {
            publicIpId: selectedPublicIpId,
            interface: newPeer.interface,
            name: newPeer.name,
          }
        })
      });
      const data = await res.json();
      if (data.peer) {
        toast.success(`Peer created! IP: ${data.assignedIp}`);
        setCreateDialogOpen(false);
        setNewPeer({ interface: interfaces[0]?.name || "", name: "", "allowed-address": "", comment: "" });
        setSelectedPublicIpId("");
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to create peer");
      }
    } catch {
      toast.error("Failed to create peer");
    }
    setCreating(false);
  };

  const handleCreatePeer = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createPeer", routerId: selectedRouterId, data: newPeer })
      });
      const data = await res.json();
      if (data.peer) {
        toast.success("Peer created successfully");
        setCreateDialogOpen(false);
        setNewPeer({ interface: interfaces[0]?.name || "", name: "", "allowed-address": "", comment: "" });
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to create peer");
      }
    } catch {
      toast.error("Failed to create peer");
    }
    setCreating(false);
  };

  const handleDeletePeer = async (id: string) => {
    if (!confirm("Delete this peer?")) return;
    const res = await fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterId, data: { id } })
    });
    const data = await res.json();
    if (data.success) {
      toast.success("Peer deleted");
      fetchWireGuardData();
    } else {
      toast.error(data.error || "Failed to delete");
    }
  };

  const handleTogglePeer = async (id: string, disabled: boolean) => {
    const action = disabled ? "enablePeer" : "disablePeer";
    const res = await fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, routerId: selectedRouterId, data: { id } })
    });
    const data = await res.json();
    if (data.success) {
      toast.success(disabled ? "Peer enabled" : "Peer disabled");
      fetchWireGuardData();
    } else {
      toast.error(data.error || "Failed");
    }
  };

  const handleEditPeer = async () => {
    if (!editingPeer) return;
    setUpdating(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePeer",
          routerId: selectedRouterId,
          data: {
            id: editingPeer[".id"],
            name: editName,
            "allowed-address": editAllowedAddress,
            comment: editComment,
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Peer updated");
        setEditDialogOpen(false);
        setViewConfigOpen(false);
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update peer");
    }
    setUpdating(false);
  };

  const openEditPeerDialog = (peer: WireGuardPeer) => {
    setEditingPeer(peer);
    setEditName(peer.name || "");
    setEditAllowedAddress(peer["allowed-address"] || "");
    setEditComment(peer.comment || "");
    setEditDialogOpen(true);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "0 B";
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
  };

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardLayout
      userRole={profile?.role}
      userEmail={profile?.email}
      onLogout={handleLogout}
    >
      <PageHeader title="Dashboard" description="Manage your WireGuard peers">
        <Select value={selectedRouterId} onValueChange={setSelectedRouterId}>
          <SelectTrigger className="w-[200px] bg-secondary border-border">
            <Server className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Select router" />
          </SelectTrigger>
          <SelectContent>
            {routers.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      <PageContent>
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="Total Peers"
            value={stats.total}
            icon={Users}
            iconColor="primary"
            onClick={() => setStatusFilter("all")}
            active={statusFilter === "all"}
          />
          <StatCard
            title="Active"
            value={stats.active}
            subtitle={`${stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(1) : 0}% of total`}
            icon={Activity}
            iconColor="emerald"
            onClick={() => setStatusFilter("enabled")}
            active={statusFilter === "enabled"}
          />
          <StatCard
            title="Disabled"
            value={stats.disabled}
            icon={PowerOff}
            iconColor="red"
            onClick={() => setStatusFilter("disabled")}
            active={statusFilter === "disabled"}
          />
          <StatCard
            title="Subnets"
            value={stats.uniqueSubnets}
            icon={Globe}
            iconColor="cyan"
          />
        </div>

        {/* Peers Table Card */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Table Header */}
          <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h2 className="text-lg font-semibold">
                Peers
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({filteredPeers.length})
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search peers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-[200px] bg-secondary border-border"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[130px] bg-secondary border-border">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                title={sortOrder === "desc" ? "Newest first" : "Oldest first"}
              >
                <ArrowUpDown className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => fetchWireGuardData(false)}
                disabled={refreshing}
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
              <Button
                variant="outline"
                onClick={() => fetchWireGuardData(true)}
                disabled={refreshing}
              >
                Force Refresh
              </Button>
              <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add Peer
              </Button>
            </div>
          </div>

          {/* Table */}
          {filteredPeers.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {searchQuery || statusFilter !== "all"
                ? "No peers match your filters"
                : "No peers found. Add your first peer above."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border">
                  <TableHead className="text-muted-foreground">Name</TableHead>
                  <TableHead className="text-muted-foreground">Interface</TableHead>
                  <TableHead className="text-muted-foreground">Allowed Address</TableHead>
                  <TableHead className="text-muted-foreground">Public IP</TableHead>
                  <TableHead className="text-muted-foreground">Traffic</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPeers.map((peer) => {
                  const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
                  return (
                    <TableRow key={peer[".id"]} className="table-row-hover border-border">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{peer.name || "-"}</span>
                          <button
                            onClick={() => openEditPeerDialog(peer)}
                            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {peer.interface || "-"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {peer["allowed-address"]}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        {peer.comment || "-"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span className="text-emerald-400">{formatBytes(peer.rx)}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-blue-400">{formatBytes(peer.tx)}</span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={isDisabled ? "badge-danger" : "badge-success"}
                        >
                          {isDisabled ? "Disabled" : "Enabled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => downloadConfig(peer)}
                            title="Download config"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setSelectedPeer(peer);
                              setViewConfigOpen(true);
                            }}
                            title="View config"
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTogglePeer(peer[".id"], isDisabled)}
                            title={isDisabled ? "Enable" : "Disable"}
                          >
                            {isDisabled ? (
                              <Power className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <PowerOff className="w-4 h-4 text-amber-400" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeletePeer(peer[".id"])}
                            className="text-destructive hover:text-destructive"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </PageContent>

      {/* Create Peer Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Create Peer</DialogTitle>
            <DialogDescription>Add a new WireGuard peer</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Interface</Label>
              <Select value={newPeer.interface} onValueChange={(v) => setNewPeer({ ...newPeer, interface: v })}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Select interface" />
                </SelectTrigger>
                <SelectContent>
                  {interfaces.length === 0 ? (
                    <SelectItem value="_none" disabled>No interfaces found</SelectItem>
                  ) : (
                    interfaces.map((i) => (
                      <SelectItem key={i[".id"]} value={i.name}>{i.name}</SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Public IP</Label>
              <Select value={selectedPublicIpId} onValueChange={setSelectedPublicIpId}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue placeholder="Select public IP" />
                </SelectTrigger>
                <SelectContent>
                  {publicIps.length === 0 ? (
                    <SelectItem value="_none" disabled>No public IPs configured</SelectItem>
                  ) : (
                    publicIps.map((ip) => (
                      <SelectItem key={ip.id} value={ip.id}>
                        {ip.public_ip} ({ip.internal_subnet}.0/24)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {publicIps.length === 0 && (
                <p className="text-xs text-amber-400">Configure public IPs in Admin Panel first</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                placeholder="My Device"
                value={newPeer.name}
                onChange={(e) => setNewPeer({ ...newPeer, name: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreatePeerSimplified}
              disabled={creating || !selectedPublicIpId || !newPeer.interface || !newPeer.name}
            >
              {creating ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Peer Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Peer</DialogTitle>
            <DialogDescription>Update peer configuration</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-secondary border-border"
                placeholder="My Device"
              />
            </div>
            <div className="space-y-2">
              <Label>Allowed Address</Label>
              <Input
                value={editAllowedAddress}
                onChange={(e) => setEditAllowedAddress(e.target.value)}
                className="bg-secondary border-border font-mono"
                placeholder="10.10.200.5/32"
              />
            </div>
            <div className="space-y-2">
              <Label>Public IP (Comment)</Label>
              <Input
                value={editComment}
                onChange={(e) => setEditComment(e.target.value)}
                className="bg-secondary border-border font-mono"
                placeholder="76.245.59.200"
              />
            </div>
            {editingPeer && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Public Key (read-only)</Label>
                <Input
                  readOnly
                  value={editingPeer["public-key"] || ""}
                  className="bg-secondary/50 border-border font-mono text-xs text-muted-foreground"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditPeer} disabled={updating}>
              {updating ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Config Dialog */}
      <Dialog open={viewConfigOpen} onOpenChange={setViewConfigOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Peer Configuration</span>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => selectedPeer && openEditPeerDialog(selectedPeer)}
              >
                <Pencil className="w-3 h-3" />
                Edit
              </Button>
            </DialogTitle>
            <DialogDescription>{selectedPeer?.name || selectedPeer?.comment}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Interface</Label>
                <p className="font-mono text-sm">{selectedPeer?.interface || "-"}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Allowed Address</Label>
                <p className="font-mono text-sm text-cyan-400">{selectedPeer?.["allowed-address"] || "-"}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Public IP</Label>
                <p className="font-mono text-sm text-emerald-400">{selectedPeer?.comment || "-"}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Status</Label>
                <Badge variant="outline" className={selectedPeer?.disabled ? "text-red-400" : "text-emerald-400"}>
                  {selectedPeer?.disabled ? "Disabled" : "Enabled"}
                </Badge>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Public Key</Label>
              <Input
                readOnly
                value={selectedPeer?.["public-key"] || ""}
                className="bg-secondary border-border font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs">Client Configuration</Label>
              <pre className="bg-secondary p-4 rounded-lg text-sm overflow-x-auto font-mono border border-border">
                {selectedPeer && generateConfig(selectedPeer)}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewConfigOpen(false)}>
              Close
            </Button>
            <Button onClick={() => selectedPeer && downloadConfig(selectedPeer)}>
              <Download className="w-4 h-4 mr-2" />
              Download .conf
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
