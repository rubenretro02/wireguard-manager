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
  Trash2,
  Power,
  PowerOff,
  Pencil,
  ArrowUpDown,
  Eye,
  Check,
  X,
  ArrowDownUp,
  ArrowUp
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

  // Edit mode in view dialog - terminal style
  const [dialogEditMode, setDialogEditMode] = useState(false);
  const [dialogEditConfig, setDialogEditConfig] = useState("");
  const [dialogUpdating, setDialogUpdating] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Inline Edit - no dialog, edit directly in row
  const [editingPeerId, setEditingPeerId] = useState<string | null>(null);
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
        // Try to load last used router from localStorage
        const lastRouterId = localStorage.getItem("wg-last-router");
        const routerExists = routersData.some((r) => r.id === lastRouterId);
        if (lastRouterId && routerExists) {
          setSelectedRouterId(lastRouterId);
        } else {
          setSelectedRouterId(routersData[0].id);
        }
      }
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  // Save selected router to localStorage
  useEffect(() => {
    if (selectedRouterId) {
      localStorage.setItem("wg-last-router", selectedRouterId);
    }
  }, [selectedRouterId]);

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

  // Start inline editing
  const startEditing = (peer: WireGuardPeer) => {
    setEditingPeerId(peer[".id"]);
    setEditName(peer.name || "");
    setEditAllowedAddress(peer["allowed-address"] || "");
    setEditComment(peer.comment || "");
  };

  // Cancel inline editing
  const cancelEditing = () => {
    setEditingPeerId(null);
    setEditName("");
    setEditAllowedAddress("");
    setEditComment("");
  };

  // Save inline editing
  const saveEditing = async () => {
    if (!editingPeerId) return;
    setUpdating(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePeer",
          routerId: selectedRouterId,
          data: {
            id: editingPeerId,
            name: editName,
            "allowed-address": editAllowedAddress,
            comment: editComment,
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Peer updated");
        cancelEditing();
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update peer");
    }
    setUpdating(false);
  };

  // Generate editable config string
  const generateEditableConfig = (peer: WireGuardPeer) => {
    return `Name: ${peer.name || ""}
Address: ${peer["allowed-address"]?.split(",")[0]?.split("/")[0] || ""}
PublicIP: ${peer.comment || ""}`;
  };

  // Start edit mode in dialog - terminal style
  const startDialogEdit = () => {
    if (!selectedPeer) return;
    setDialogEditMode(true);
    setDialogEditConfig(generateEditableConfig(selectedPeer));
  };

  // Cancel edit mode in dialog
  const cancelDialogEdit = () => {
    setDialogEditMode(false);
    setDialogEditConfig("");
  };

  // Parse config and save
  const saveDialogEdit = async () => {
    if (!selectedPeer) return;

    // Parse the edited config
    const lines = dialogEditConfig.split("\n");
    let name = "";
    let address = "";
    let publicIp = "";

    for (const line of lines) {
      const [key, ...valueParts] = line.split(":");
      const value = valueParts.join(":").trim();
      const keyLower = key.toLowerCase().trim();

      if (keyLower === "name") name = value;
      else if (keyLower === "address") address = value.includes("/") ? value : `${value}/32`;
      else if (keyLower === "publicip") publicIp = value;
    }

    setDialogUpdating(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updatePeer",
          routerId: selectedRouterId,
          data: {
            id: selectedPeer[".id"],
            name: name,
            "allowed-address": address,
            comment: publicIp,
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Peer updated");
        // Update selected peer with new values
        setSelectedPeer({
          ...selectedPeer,
          name: name,
          "allowed-address": address,
          comment: publicIp,
        });
        cancelDialogEdit();
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update peer");
    }
    setDialogUpdating(false);
  };

  const formatBytes = (bytes?: number | string) => {
    // Handle string values that might come from MikroTik
    const numBytes = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (!numBytes || isNaN(numBytes) || numBytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
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
                  <TableHead className="text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <ArrowDownUp className="w-3 h-3" />
                      Traffic
                    </div>
                  </TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPeers.map((peer) => {
                  const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
                  const isEditing = editingPeerId === peer[".id"];

                  return (
                    <TableRow key={peer[".id"]} className="table-row-hover border-border">
                      {/* Name Column - Inline Edit */}
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-8 w-32 bg-secondary border-border text-sm"
                            placeholder="Name"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{peer.name || "-"}</span>
                          </div>
                        )}
                      </TableCell>

                      {/* Interface Column */}
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {peer.interface || "-"}
                        </Badge>
                      </TableCell>

                      {/* Allowed Address Column - Inline Edit */}
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editAllowedAddress}
                            onChange={(e) => setEditAllowedAddress(e.target.value)}
                            className="h-8 w-36 bg-secondary border-border font-mono text-xs"
                            placeholder="10.10.200.x/32"
                          />
                        ) : (
                          <span className="font-mono text-sm text-cyan-400">
                            {peer["allowed-address"]}
                          </span>
                        )}
                      </TableCell>

                      {/* Public IP Column - Inline Edit */}
                      <TableCell>
                        {isEditing ? (
                          <Input
                            value={editComment}
                            onChange={(e) => setEditComment(e.target.value)}
                            className="h-8 w-32 bg-secondary border-border font-mono text-xs"
                            placeholder="76.245.59.xxx"
                          />
                        ) : (
                          <span className="font-mono text-sm text-emerald-400">
                            {peer.comment || "-"}
                          </span>
                        )}
                      </TableCell>

                      {/* Traffic Column */}
                      <TableCell className="text-sm">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1">
                            <ArrowUp className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400 text-xs">{formatBytes(peer.rx)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <ArrowUp className="w-3 h-3 text-blue-400 rotate-180" />
                            <span className="text-blue-400 text-xs">{formatBytes(peer.tx)}</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Status Column */}
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={isDisabled ? "badge-danger" : "badge-success"}
                        >
                          {isDisabled ? "Disabled" : "Enabled"}
                        </Badge>
                      </TableCell>

                      {/* Actions Column */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isEditing ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={saveEditing}
                                disabled={updating}
                                title="Save"
                                className="text-emerald-400 hover:text-emerald-300"
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={cancelEditing}
                                title="Cancel"
                                className="text-red-400 hover:text-red-300"
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => startEditing(peer)}
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
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
                            </>
                          )}
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

      {/* View Config Dialog */}
      <Dialog open={viewConfigOpen} onOpenChange={(open) => {
        setViewConfigOpen(open);
        if (!open) cancelDialogEdit();
      }}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peer Configuration</DialogTitle>
            <DialogDescription>
              {selectedPeer?.name || selectedPeer?.comment}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Name</Label>
                <p className="font-mono text-sm">{selectedPeer?.name || "-"}</p>
              </div>
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
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">RX (Download)</Label>
                <p className="font-mono text-sm text-emerald-400">{formatBytes(selectedPeer?.rx)}</p>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">TX (Upload)</Label>
                <p className="font-mono text-sm text-blue-400">{formatBytes(selectedPeer?.tx)}</p>
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

            {/* Edit Section - Terminal Style */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground text-xs">
                  {dialogEditMode ? "Edit Tunnel" : "Client Configuration"}
                </Label>
                {!dialogEditMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={startDialogEdit}
                    className="gap-2 h-7 text-xs"
                  >
                    <Pencil className="w-3 h-3" />
                    Edit
                  </Button>
                )}
              </div>

              {dialogEditMode ? (
                <div className="space-y-3">
                  <textarea
                    value={dialogEditConfig}
                    onChange={(e) => setDialogEditConfig(e.target.value)}
                    className="w-full h-24 bg-secondary p-3 rounded-lg text-sm font-mono border border-amber-500/50 focus:border-amber-500 focus:outline-none resize-none"
                    placeholder={`Name: peer-name\nAddress: 10.10.x.x\nPublicIP: 76.245.59.xxx`}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={cancelDialogEdit}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={saveDialogEdit} disabled={dialogUpdating} className="gap-2">
                      {dialogUpdating ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <pre className="bg-secondary p-4 rounded-lg text-sm overflow-x-auto font-mono border border-border">
                  {selectedPeer && generateConfig(selectedPeer)}
                </pre>
              )}
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
