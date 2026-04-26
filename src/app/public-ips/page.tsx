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
import {
  Globe,
  Server,
  Search,
  Users,
  Eye,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  User
} from "lucide-react";
import type { Profile, Router as RouterType, PublicIP, UserCapabilities, PeerMetadata } from "@/lib/types";

interface PeerInfo {
  id: string;
  name: string;
  address: string;
  publicKey?: string;
  interface?: string;
  disabled?: boolean;
  rx?: number;
  tx?: number;
  comment?: string;
  // Metadata for filtering
  createdByUserId?: string | null;
  createdByEmail?: string | null;
}

export default function PublicIpsPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<RouterType[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>("");
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasSocks5Access, setHasSocks5Access] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState<Record<string, { count: number; peers: PeerInfo[] }>>({});
  const [peerMetadata, setPeerMetadata] = useState<Record<string, PeerMetadata>>({});

  // User hierarchy for visibility
  const [visibleUserIds, setVisibleUserIds] = useState<Set<string>>(new Set());

  // Peers modal
  const [peersModalOpen, setPeersModalOpen] = useState(false);
  const [selectedIp, setSelectedIp] = useState<PublicIP | null>(null);
  const [selectedIpPeers, setSelectedIpPeers] = useState<PeerInfo[]>([]);

  // Single peer detail dialog
  const [peerDetailOpen, setPeerDetailOpen] = useState(false);
  const [selectedPeerDetail, setSelectedPeerDetail] = useState<PeerInfo | null>(null);

  // User capabilities
  const capabilities: UserCapabilities = profile?.capabilities || {};
  const isAdmin = profile?.role === "admin";
  const canSeeAllPeers = isAdmin || capabilities.can_see_all_peers;
  const canCreateUsers = capabilities.can_create_users;
  const canDelete = isAdmin || capabilities.can_delete; // Can delete peers

  // Build user hierarchy to know which peers are visible
  // Admin: sees all
  // User with can_create_users: sees own + users they created + users those users created (recursive)
  // Regular user: only sees own peers
  const fetchUserHierarchy = useCallback(async () => {
    if (!profile) return;

    const userIds = new Set<string>([profile.id]);

    // If admin or can_see_all_peers, we don't need hierarchy - they see all
    if (isAdmin || canSeeAllPeers) {
      setVisibleUserIds(userIds);
      return;
    }

    // If user can create users, get all users they created (recursively)
    if (canCreateUsers) {
      const fetchCreatedUsers = async (parentIds: string[]): Promise<string[]> => {
        if (parentIds.length === 0) return [];

        const { data: createdUsers } = await supabase
          .from("profiles")
          .select("id")
          .in("created_by_user_id", parentIds);

        if (!createdUsers || createdUsers.length === 0) return [];

        const newIds = createdUsers.map((u: { id: string }) => u.id);
        // Recursively get users created by these users
        const deeperIds = await fetchCreatedUsers(newIds);
        return [...newIds, ...deeperIds];
      };

      const createdUserIds = await fetchCreatedUsers([profile.id]);
      createdUserIds.forEach(id => userIds.add(id));
    }

    setVisibleUserIds(userIds);
  }, [profile, isAdmin, canSeeAllPeers, canCreateUsers, supabase]);

  useEffect(() => {
    if (profile) {
      fetchUserHierarchy();
    }
  }, [profile, fetchUserHierarchy]);

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

      // Check SOCKS5 server access
      if (profileData?.role === "admin") {
        setHasSocks5Access(true);
      } else {
        const { data: socks5Access } = await supabase
          .from("user_socks5_server_access")
          .select("id")
          .eq("user_id", user.id)
          .limit(1);
        setHasSocks5Access(socks5Access && socks5Access.length > 0);
      }

      // Get routers - for admin get all, for user get assigned routers
      if (profileData?.role === "admin") {
        const { data: routersData } = await supabase
          .from("routers")
          .select("id, name, host, port, api_port, username, use_ssl, created_at, connection_type");

        if (routersData && routersData.length > 0) {
          setRouters(routersData as RouterType[]);
          const lastRouterId = localStorage.getItem("wg-last-router");
          const routerExists = routersData.some((r: any) => r.id === lastRouterId);
          setSelectedRouterId(lastRouterId && routerExists ? lastRouterId : routersData[0].id);
        }
      } else {
        // For regular users, get routers they have access to
        const { data: userRouterIds } = await supabase
          .from("user_routers")
          .select("router_id")
          .eq("user_id", user.id);

        if (userRouterIds && userRouterIds.length > 0) {
          const routerIds = userRouterIds.map((ur: any) => ur.router_id);
          const { data: routersData } = await supabase
            .from("routers")
            .select("id, name, host, port, api_port, username, use_ssl, created_at, connection_type")
            .in("id", routerIds);

          if (routersData && routersData.length > 0) {
            setRouters(routersData as RouterType[]);
            const lastRouterId = localStorage.getItem("wg-last-router");
            const routerExists = routersData.some((r: any) => r.id === lastRouterId);
            setSelectedRouterId(lastRouterId && routerExists ? lastRouterId : routersData[0].id);
          }
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

  // Fetch peer metadata for filtering
  const fetchPeerMetadata = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const metadataMap: Record<string, PeerMetadata> = {};

      // Fetch from peer_metadata table
      const { data: peerMetadataData } = await supabase
        .from("peer_metadata")
        .select("*")
        .eq("router_id", selectedRouterId);

      if (peerMetadataData) {
        for (const meta of peerMetadataData) {
          metadataMap[meta.peer_public_key] = meta as PeerMetadata;
        }
      }

      // For Linux routers, also fetch from linux_peers table
      const currentRouter = routers.find(r => r.id === selectedRouterId);
      if (currentRouter?.connection_type === "linux-ssh") {
        const { data: linuxPeersData } = await supabase
          .from("linux_peers")
          .select("*")
          .eq("router_id", selectedRouterId);

        if (linuxPeersData) {
          for (const linuxPeer of linuxPeersData) {
            if (!metadataMap[linuxPeer.public_key]) {
              metadataMap[linuxPeer.public_key] = {
                id: linuxPeer.id,
                router_id: linuxPeer.router_id,
                peer_public_key: linuxPeer.public_key,
                peer_name: linuxPeer.name,
                peer_interface: null,
                allowed_address: linuxPeer.allowed_ips,
                created_by_email: linuxPeer.created_by_email,
                created_by_user_id: linuxPeer.created_by_user_id,
                created_at: linuxPeer.created_at,
                expires_at: null,
                auto_disable_enabled: false,
                expiration_hours: null,
                expiration_value: null,
                expiration_unit: null,
                scheduled_enable_at: null,
                last_status_check: null,
              } as PeerMetadata;
            }
          }
        }
      }

      setPeerMetadata(metadataMap);
    } catch (err) {
      console.error("Failed to fetch peer metadata:", err);
    }
  }, [selectedRouterId, supabase, routers]);

  // Fetch public IPs
  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterId) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/public-ips?routerId=${selectedRouterId}`);
      const data = await res.json();
      if (data.publicIps) {
        // API already filters by user access
        setPublicIps(data.publicIps);
      }
    } catch {
      console.error("Failed to fetch public IPs");
    }
    setRefreshing(false);
  }, [selectedRouterId]);

  // Check if a peer is visible to the current user
  const isPeerVisible = useCallback((peer: PeerInfo, publicKey?: string) => {
    // Admin or can_see_all_peers can see all
    if (isAdmin || canSeeAllPeers) return true;

    // Get metadata for this peer
    const meta = publicKey ? peerMetadata[publicKey] : null;

    // If no metadata, peer is not visible to non-admin users
    if (!meta) return false;

    // Check if the creator is in the visible users list
    if (meta.created_by_user_id && visibleUserIds.has(meta.created_by_user_id)) {
      return true;
    }

    // Also check by email for backwards compatibility
    if (meta.created_by_email === profile?.email) {
      return true;
    }

    return false;
  }, [isAdmin, canSeeAllPeers, peerMetadata, visibleUserIds, profile]);

  // Fetch peer counts for each IP with visibility filtering
  const fetchPeerCounts = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPeers", routerId: selectedRouterId })
      });
      const data = await res.json();
      if (data.peers) {
        const counts: Record<string, { count: number; peers: PeerInfo[] }> = {};
        for (const peer of data.peers) {
          const comment = peer.comment || "";
          const publicKey = peer["public-key"];

          // Get metadata for visibility check
          const meta = peerMetadata[publicKey];

          // Create peer info object
          const peerInfo: PeerInfo = {
            id: peer[".id"],
            name: peer.name || "Unnamed",
            address: peer["allowed-address"] || "",
            publicKey: publicKey,
            interface: peer.interface,
            disabled: peer.disabled === true || String(peer.disabled) === "true",
            rx: peer.rx,
            tx: peer.tx,
            comment: comment,
            createdByUserId: meta?.created_by_user_id || null,
            createdByEmail: meta?.created_by_email || null,
          };

          // Check if peer is visible to current user
          if (!isPeerVisible(peerInfo, publicKey)) continue;

          if (comment) {
            if (!counts[comment]) counts[comment] = { count: 0, peers: [] };
            counts[comment].count++;
            counts[comment].peers.push(peerInfo);
          }
        }
        setPeersByIp(counts);
      }
    } catch (err) {
      console.error("Failed to fetch peer counts:", err);
    }
  }, [selectedRouterId, peerMetadata, isPeerVisible]);

  useEffect(() => {
    if (selectedRouterId && profile) {
      fetchPublicIps();
      fetchPeerMetadata();
    }
  }, [selectedRouterId, fetchPublicIps, fetchPeerMetadata, profile]);

  // Fetch peer counts after metadata is loaded
  useEffect(() => {
    if (selectedRouterId && Object.keys(peerMetadata).length >= 0 && profile) {
      fetchPeerCounts();
    }
  }, [selectedRouterId, peerMetadata, profile, fetchPeerCounts, visibleUserIds]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // View peers for IP
  const handleViewPeers = (ip: PublicIP) => {
    const peersInfo = peersByIp[ip.public_ip];
    setSelectedIp(ip);
    setSelectedIpPeers(peersInfo?.peers || []);
    setPeersModalOpen(true);
  };

  // Toggle peer enabled/disabled
  const handleTogglePeer = async (peer: PeerInfo) => {
    const action = peer.disabled ? "enablePeer" : "disablePeer";
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, routerId: selectedRouterId, data: { id: peer.id } })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(peer.disabled ? "Peer enabled" : "Peer disabled");
        fetchPeerCounts();
        // Update local state
        setSelectedIpPeers(prev => prev.map(p =>
          p.id === peer.id ? { ...p, disabled: !p.disabled } : p
        ));
      } else {
        toast.error(data.error || "Failed");
      }
    } catch {
      toast.error("Failed to toggle peer");
    }
  };

  // Delete peer
  const handleDeletePeer = async (peer: PeerInfo) => {
    // Check if user has delete permission
    if (!canDelete) {
      toast.error("You don't have permission to delete peers");
      return;
    }
    if (!confirm("Delete this peer?")) return;
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deletePeer",
          routerId: selectedRouterId,
          data: {
            id: peer.id,
            "public-key": peer.publicKey,
            publicKey: peer.publicKey
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Peer deleted");
        fetchPeerCounts();
        setSelectedIpPeers(prev => prev.filter(p => p.id !== peer.id));
        if (peerDetailOpen && selectedPeerDetail?.id === peer.id) {
          setPeerDetailOpen(false);
        }
      } else {
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete peer");
    }
  };

  // Filter IPs by search
  const filteredIps = publicIps.filter((ip) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      ip.public_ip.toLowerCase().includes(query) ||
      ip.internal_subnet.toLowerCase().includes(query) ||
      String(ip.ip_number).includes(query)
    );
  });

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
      userCapabilities={profile?.capabilities}
      hasSocks5Access={hasSocks5Access}
      onLogout={handleLogout}
    >
      <PageHeader title="Public IPs" description="View available public IPs and their peers">
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
        {/* Search and Actions */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search IPs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-secondary border-border"
              />
            </div>
            {!isAdmin && (
              <Badge variant="outline" className="text-xs whitespace-nowrap">
                <User className="w-3 h-3 mr-1" />
                {canSeeAllPeers ? "All Peers Visible" : canCreateUsers ? "My Team's Peers" : "My Peers Only"}
              </Badge>
            )}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              fetchPublicIps();
              fetchPeerMetadata().then(() => fetchPeerCounts());
            }}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {/* IPs Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="w-[80px]">#</TableHead>
                <TableHead>Public IP</TableHead>
                <TableHead>Internal Subnet</TableHead>
                <TableHead>Peers</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredIps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {searchQuery ? "No IPs match your search" : "No public IPs available for your account"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredIps.map((ip) => {
                  const peersInfo = peersByIp[ip.public_ip];
                  return (
                    <TableRow key={ip.id} className="border-border">
                      <TableCell className="font-mono font-bold">{ip.ip_number}</TableCell>
                      <TableCell className="font-mono text-emerald-400">{ip.public_ip}</TableCell>
                      <TableCell className="font-mono text-cyan-400">{ip.internal_subnet}</TableCell>
                      <TableCell>
                        {peersInfo && peersInfo.count > 0 ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewPeers(ip)}
                            className="gap-1 h-7 px-2"
                          >
                            <Users className="w-3 h-3" />
                            {peersInfo.count}
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={ip.enabled ? "badge-success" : "badge-danger"}
                        >
                          {ip.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {filteredIps.length} public IP{filteredIps.length !== 1 ? "s" : ""}
          {!isAdmin && " (based on your access permissions)"}
        </div>
      </PageContent>

      {/* Peers Modal - Interactive */}
      <Dialog open={peersModalOpen} onOpenChange={setPeersModalOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peers using {selectedIp?.public_ip}</DialogTitle>
            <DialogDescription>
              {selectedIpPeers.length} peer(s) {!isAdmin && !canSeeAllPeers && "visible to you"} configured with this public IP. Click on a peer to view details.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {selectedIpPeers.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No peers found</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {selectedIpPeers.map((peer) => (
                  <div
                    key={peer.id}
                    className="flex items-center justify-between p-4 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
                  >
                    <button
                      type="button"
                      className="flex-1 text-left"
                      onClick={() => {
                        setSelectedPeerDetail(peer);
                        setPeerDetailOpen(true);
                      }}
                    >
                      <p className="font-medium hover:text-primary transition-colors">{peer.name}</p>
                      <p className="text-sm text-muted-foreground font-mono">{peer.address}</p>
                      {peer.createdByEmail && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Created by: {peer.createdByEmail.split("@")[0]}
                        </p>
                      )}
                    </button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedPeerDetail(peer);
                          setPeerDetailOpen(true);
                        }}
                        className="gap-1"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTogglePeer(peer)}
                        className={peer.disabled ? "gap-1 text-emerald-400 hover:text-emerald-300" : "gap-1 text-amber-400 hover:text-amber-300"}
                        title={peer.disabled ? "Enable peer" : "Disable peer"}
                      >
                        {peer.disabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      </Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeletePeer(peer)}
                          className="gap-1 text-red-400 hover:text-red-300"
                          title="Delete peer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeersModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peer Detail Dialog */}
      <Dialog open={peerDetailOpen} onOpenChange={setPeerDetailOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedPeerDetail?.name || "Peer Details"}</DialogTitle>
            <DialogDescription>
              {selectedPeerDetail?.comment || selectedPeerDetail?.address}
            </DialogDescription>
          </DialogHeader>
          {selectedPeerDetail && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Name</Label>
                  <p className="font-mono text-sm">{selectedPeerDetail.name || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Interface</Label>
                  <p className="font-mono text-sm">{selectedPeerDetail.interface || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Allowed Address</Label>
                  <p className="font-mono text-sm text-cyan-400">{selectedPeerDetail.address || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Public IP</Label>
                  <p className="font-mono text-sm text-emerald-400">{selectedPeerDetail.comment || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Status</Label>
                  <Badge variant="outline" className={selectedPeerDetail.disabled ? "text-red-400" : "text-emerald-400"}>
                    {selectedPeerDetail.disabled ? "Disabled" : "Enabled"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Created By</Label>
                  <p className="font-mono text-sm">{selectedPeerDetail.createdByEmail || "-"}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Configuration</Label>
                <pre className="bg-secondary p-4 rounded-lg text-sm overflow-x-auto font-mono border border-border">
{`[Interface]
PrivateKey = [CLIENT_PRIVATE_KEY]
Address = ${selectedPeerDetail.address?.split("/")[0]}/32
DNS = 8.8.8.8

[Peer]
PublicKey = [SERVER_PUBLIC_KEY]
AllowedIPs = 0.0.0.0/0
Endpoint = ${selectedPeerDetail.comment || "server"}:13231
PersistentKeepalive = 25`}
                </pre>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={() => handleTogglePeer(selectedPeerDetail)}
                  className="gap-2"
                >
                  {selectedPeerDetail.disabled ? (
                    <>
                      <Power className="w-4 h-4 text-emerald-400" />
                      Enable
                    </>
                  ) : (
                    <>
                      <PowerOff className="w-4 h-4 text-amber-400" />
                      Disable
                    </>
                  )}
                </Button>
                {canDelete && (
                  <Button
                    variant="destructive"
                    onClick={() => handleDeletePeer(selectedPeerDetail)}
                    className="gap-2 ml-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeerDetailOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
