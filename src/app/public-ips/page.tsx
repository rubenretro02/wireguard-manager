"use client";

import { useEffect, useState, useCallback } from "react";
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
  RefreshCw
} from "lucide-react";
import type { Profile, Router as RouterType, PublicIP, UserCapabilities } from "@/lib/types";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState<Record<string, { count: number; peers: PeerInfo[] }>>({});

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
  const canUseRestrictedIps = isAdmin || capabilities.can_use_restricted_ips;

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

      // Get routers - for admin get all, for user get assigned routers
      if (profileData?.role === "admin") {
        const { data: routersData } = await supabase
          .from("routers")
          .select("id, name, host, port, api_port, username, use_ssl, created_at");

        if (routersData && routersData.length > 0) {
          setRouters(routersData as RouterType[]);
          const lastRouterId = localStorage.getItem("wg-last-router");
          const routerExists = routersData.some((r) => r.id === lastRouterId);
          setSelectedRouterId(lastRouterId && routerExists ? lastRouterId : routersData[0].id);
        }
      } else {
        // For regular users, get routers they have access to
        const { data: userRouterIds } = await supabase
          .from("user_routers")
          .select("router_id")
          .eq("user_id", user.id);

        if (userRouterIds && userRouterIds.length > 0) {
          const routerIds = userRouterIds.map(ur => ur.router_id);
          const { data: routersData } = await supabase
            .from("routers")
            .select("id, name, host, port, api_port, username, use_ssl, created_at")
            .in("id", routerIds);

          if (routersData && routersData.length > 0) {
            setRouters(routersData as RouterType[]);
            const lastRouterId = localStorage.getItem("wg-last-router");
            const routerExists = routersData.some((r) => r.id === lastRouterId);
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

  // Fetch public IPs
  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterId) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/public-ips?routerId=${selectedRouterId}`);
      const data = await res.json();
      if (data.publicIps) {
        // Filter out restricted IPs if user can't use them
        const filteredIps = data.publicIps.filter((ip: PublicIP) => {
          if (!ip.enabled) return false;
          if (!canUseRestrictedIps && ip.restricted) return false;
          return true;
        });
        setPublicIps(filteredIps);
      }
    } catch {
      console.error("Failed to fetch public IPs");
    }
    setRefreshing(false);
  }, [selectedRouterId, canUseRestrictedIps]);

  // Fetch peer counts for each IP
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
          if (comment) {
            if (!counts[comment]) counts[comment] = { count: 0, peers: [] };
            counts[comment].count++;
            counts[comment].peers.push({
              id: peer[".id"],
              name: peer.name || "Unnamed",
              address: peer["allowed-address"] || "",
              publicKey: peer["public-key"],
              interface: peer.interface,
              disabled: peer.disabled === true || String(peer.disabled) === "true",
              rx: peer.rx,
              tx: peer.tx,
              comment: peer.comment
            });
          }
        }
        setPeersByIp(counts);
      }
    } catch (err) {
      console.error("Failed to fetch peer counts:", err);
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (selectedRouterId && profile) {
      fetchPublicIps();
      fetchPeerCounts();
    }
  }, [selectedRouterId, fetchPublicIps, fetchPeerCounts, profile]);

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
    if (!confirm("Delete this peer?")) return;
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterId, data: { id: peer.id } })
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
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search IPs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              fetchPublicIps();
              fetchPeerCounts();
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
                    {searchQuery ? "No IPs match your search" : "No public IPs available"}
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
                        {peersInfo ? (
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
        </div>
      </PageContent>

      {/* Peers Modal - Interactive */}
      <Dialog open={peersModalOpen} onOpenChange={setPeersModalOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peers using {selectedIp?.public_ip}</DialogTitle>
            <DialogDescription>
              {selectedIpPeers.length} peer(s) configured with this public IP. Click on a peer to view details.
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePeer(peer)}
                        className="gap-1 text-red-400 hover:text-red-300"
                        title="Delete peer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
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
                <Button
                  variant="destructive"
                  onClick={() => handleDeletePeer(selectedPeerDetail)}
                  className="gap-2 ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </Button>
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
