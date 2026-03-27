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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
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
  ArrowUp,
  ChevronsUpDown,
  Clock,
  User,
  Calendar,
  Timer
} from "lucide-react";
import { generateKeyPair } from "@/lib/wireguard-keys";
import type { Profile, Router as RouterType, WireGuardInterface, WireGuardPeer, PublicIP, PeerMetadata, UserCapabilities } from "@/lib/types";

interface PeerWithMetadata extends WireGuardPeer {
  metadata?: PeerMetadata;
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<RouterType[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>("");
  const [interfaces, setInterfaces] = useState<WireGuardInterface[]>([]);
  const [peers, setPeers] = useState<PeerWithMetadata[]>([]);
  const [peerMetadata, setPeerMetadata] = useState<Record<string, PeerMetadata>>({});
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [allPublicIps, setAllPublicIps] = useState<PublicIP[]>([]); // All IPs including restricted
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Create peer dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newPeer, setNewPeer] = useState({ interface: "", name: "", "allowed-address": "", comment: "" });
  const [selectedPublicIpId, setSelectedPublicIpId] = useState<string>("");
  const [ipComboboxOpen, setIpComboboxOpen] = useState(false);

  // Expiration settings for new peer
  const [enableExpiration, setEnableExpiration] = useState(false);
  const [expirationHours, setExpirationHours] = useState<number>(24);

  // View config dialog
  const [viewConfigOpen, setViewConfigOpen] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<PeerWithMetadata | null>(null);

  // Edit mode in view dialog
  const [dialogEditMode, setDialogEditMode] = useState(false);
  const [dialogEditConfig, setDialogEditConfig] = useState("");
  const [dialogUpdating, setDialogUpdating] = useState(false);
  const [dialogPublicKey, setDialogPublicKey] = useState("");

  // Peer management dialog (from admin IP modal)
  const [peerManageOpen, setPeerManageOpen] = useState(false);
  const [managingPeer, setManagingPeer] = useState<PeerWithMetadata | null>(null);
  const [peerAction, setPeerAction] = useState<"edit" | "view" | null>(null);

  // Renew peer dialog (for expired peers)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewingPeer, setRenewingPeer] = useState<PeerWithMetadata | null>(null);
  const [renewHours, setRenewHours] = useState<number>(24);
  const [renewing, setRenewing] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Inline Edit
  const [editingPeerId, setEditingPeerId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAllowedAddress, setEditAllowedAddress] = useState("");
  const [editComment, setEditComment] = useState("");
  const [updating, setUpdating] = useState(false);

  // User capabilities
  const capabilities: UserCapabilities = profile?.capabilities || {};
  const isAdmin = profile?.role === "admin";
  const canAutoExpire = isAdmin || capabilities.can_auto_expire;
  const canSeeAllPeers = isAdmin || capabilities.can_see_all_peers;
  const canUseRestrictedIps = isAdmin || capabilities.can_use_restricted_ips;     // For CREATING peers
  const canSeeRestrictedPeers = isAdmin || capabilities.can_see_restricted_peers; // For VIEWING peers

  // Get restricted IPs for filtering
  const restrictedIps = useMemo(() => {
    return new Set(allPublicIps.filter(ip => ip.restricted).map(ip => ip.public_ip));
  }, [allPublicIps]);

  // Get visible peers for this user (for stats calculation)
  // This uses the same filtering logic as filteredPeers but without search/status filters
  const visiblePeers = useMemo(() => {
    let visible = peers;

    if (!canSeeAllPeers && profile) {
      visible = visible.filter((peer) => {
        const meta = peerMetadata[peer["public-key"]];
        if (!meta) return false;
        return meta.created_by_user_id === profile.id || meta.created_by_email === profile.email;
      });
    }

    // Filter by restricted IPs visibility (separate from creation capability)
    if (!canSeeRestrictedPeers) {
      visible = visible.filter((peer) => {
        const peerIp = peer.comment || "";
        return !restrictedIps.has(peerIp);
      });
    }

    return visible;
  }, [peers, canSeeAllPeers, profile, peerMetadata, canSeeRestrictedPeers, restrictedIps]);

  // Stats - only show stats for peers the user can see
  const stats = useMemo(() => {
    const total = visiblePeers.length;
    const active = visiblePeers.filter(p => {
      const isDisabled = p.disabled === true || String(p.disabled) === "true";
      return !isDisabled;
    }).length;
    const disabled = total - active;
    const uniqueSubnets = new Set(
      visiblePeers.map(p => {
        const addr = p["allowed-address"]?.split(",")[0]?.split("/")[0] || "";
        const parts = addr.split(".");
        return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "";
      }).filter(Boolean)
    ).size;

    return { total, active, disabled, uniqueSubnets };
  }, [visiblePeers]);

  // Filter peers based on user permissions
  const filteredPeers = useMemo(() => {
    let filtered = peers;

    // Filter by creator if user can't see all peers
    if (!canSeeAllPeers && profile) {
      filtered = filtered.filter((peer) => {
        const meta = peerMetadata[peer["public-key"]];
        // Only show peer if created by this user (has matching metadata)
        // Peers without metadata (legacy) are NOT shown to regular users
        if (!meta) return false;
        return meta.created_by_user_id === profile.id || meta.created_by_email === profile.email;
      });
    }

    // Filter out peers with restricted IPs if user can't SEE them
    if (!canSeeRestrictedPeers) {
      filtered = filtered.filter((peer) => {
        const peerIp = peer.comment || "";
        // If peer's public IP (in comment) is restricted, hide it
        return !restrictedIps.has(peerIp);
      });
    }

    // Apply status filter
    filtered = filtered.filter((peer) => {
      const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
      if (statusFilter === "enabled" && isDisabled) return false;
      if (statusFilter === "disabled" && !isDisabled) return false;
      return true;
    });

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((peer) => {
        const name = String(peer.name || "");
        const comment = String(peer.comment || "");
        const allowedAddress = String(peer["allowed-address"] || "");
        return (
          name.toLowerCase().includes(query) ||
          comment.toLowerCase().includes(query) ||
          allowedAddress.toLowerCase().includes(query)
        );
      });
    }

    // Sort by ID
    const sorted = [...filtered].sort((a, b) => {
      const idA = a[".id"] || "";
      const idB = b[".id"] || "";
      return sortOrder === "desc" ? idB.localeCompare(idA) : idA.localeCompare(idB);
    });

    return sorted;
  }, [peers, searchQuery, statusFilter, sortOrder, canSeeAllPeers, profile, peerMetadata, canSeeRestrictedPeers, restrictedIps]);

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

  // Fetch peer metadata from database
  const fetchPeerMetadata = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const { data } = await supabase
        .from("peer_metadata")
        .select("*")
        .eq("router_id", selectedRouterId);

      if (data) {
        const metadataMap: Record<string, PeerMetadata> = {};
        for (const meta of data) {
          metadataMap[meta.peer_public_key] = meta as PeerMetadata;
        }
        setPeerMetadata(metadataMap);
      }
    } catch (err) {
      console.error("Failed to fetch peer metadata:", err);
    }
  }, [selectedRouterId, supabase]);

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

      // Also fetch metadata
      await fetchPeerMetadata();
    } catch {
      toast.error("Failed to fetch data");
    }
    setRefreshing(false);
  }, [selectedRouterId, newPeer.interface, fetchPeerMetadata]);

  // Auto-disable expired peers
  const autoDisableExpiredPeers = useCallback(async () => {
    if (!selectedRouterId || Object.keys(peerMetadata).length === 0) return;

    const now = new Date();
    const expiredPeers: PeerWithMetadata[] = [];

    for (const peer of peers) {
      const meta = peerMetadata[peer["public-key"]];
      if (!meta?.expires_at || !meta.auto_disable_enabled) continue;

      const expiresAt = new Date(meta.expires_at);
      const isExpired = expiresAt < now;
      const isEnabled = !(peer.disabled === true || String(peer.disabled) === "true");

      // If peer is expired and still enabled, add to list to disable
      if (isExpired && isEnabled) {
        expiredPeers.push(peer);
      }
    }

    // Disable all expired peers
    for (const peer of expiredPeers) {
      try {
        const res = await fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disablePeer", routerId: selectedRouterId, data: { id: peer[".id"] } })
        });
        const data = await res.json();
        if (data.success) {
          toast.info(`Peer "${peer.name || 'Unnamed'}" auto-disabled (expired)`);
        }
      } catch (err) {
        console.error("Failed to auto-disable peer:", err);
      }
    }

    // Refresh data if any peers were disabled
    if (expiredPeers.length > 0) {
      fetchWireGuardData();
    }
  }, [selectedRouterId, peers, peerMetadata, fetchWireGuardData]);

  // Run auto-disable check when peers and metadata are loaded
  useEffect(() => {
    if (peers.length > 0 && Object.keys(peerMetadata).length > 0) {
      autoDisableExpiredPeers();
    }
  }, [peers.length, Object.keys(peerMetadata).length]); // Only run when counts change, not on every render

  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const res = await fetch(`/api/public-ips?routerId=${selectedRouterId}`);
      const data = await res.json();
      if (data.publicIps) {
        // Store all IPs for filtering peers visibility
        setAllPublicIps(data.publicIps);

        // Filter: only enabled IPs, and if user is not admin and doesn't have capability, exclude restricted IPs
        const canUseRestricted = isAdmin || capabilities.can_use_restricted_ips;
        setPublicIps(data.publicIps.filter((ip: PublicIP) => {
          if (!ip.enabled) return false;
          // If user can't use restricted IPs, exclude them
          if (!canUseRestricted && ip.restricted) return false;
          return true;
        }));
      }
    } catch {
      console.error("Failed to fetch public IPs");
    }
  }, [selectedRouterId, isAdmin, capabilities.can_use_restricted_ips]);

  useEffect(() => {
    if (selectedRouterId && profile) {
      fetchWireGuardData();
      fetchPublicIps();
    }
  }, [selectedRouterId, fetchWireGuardData, fetchPublicIps, profile]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Save peer metadata to database
  const savePeerMetadata = async (peer: WireGuardPeer, expiresAt?: Date) => {
    if (!profile || !selectedRouterId) return;

    try {
      const metadata = {
        router_id: selectedRouterId,
        peer_public_key: peer["public-key"],
        peer_name: peer.name || null,
        peer_interface: peer.interface || null,
        allowed_address: peer["allowed-address"] || null,
        created_by_email: profile.email,
        created_by_user_id: profile.id,
        expires_at: expiresAt?.toISOString() || null,
        auto_disable_enabled: !!expiresAt,
        expiration_hours: expiresAt ? expirationHours : null,
      };

      await supabase
        .from("peer_metadata")
        .upsert(metadata, { onConflict: "router_id,peer_public_key" });
    } catch (err) {
      console.error("Failed to save peer metadata:", err);
    }
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
        // Calculate expiration if enabled
        let expiresAt: Date | undefined;
        if (enableExpiration && canAutoExpire && expirationHours > 0) {
          expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + expirationHours);
        }

        // Save metadata
        await savePeerMetadata(data.peer, expiresAt);

        toast.success(`Peer created! IP: ${data.assignedIp}${expiresAt ? ` (expires in ${expirationHours}h)` : ""}`);
        setCreateDialogOpen(false);
        setNewPeer({ interface: interfaces[0]?.name || "", name: "", "allowed-address": "", comment: "" });
        setSelectedPublicIpId("");
        setEnableExpiration(false);
        setExpirationHours(24);
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to create peer");
      }
    } catch {
      toast.error("Failed to create peer");
    }
    setCreating(false);
  };

  const handleDeletePeer = async (id: string, publicKey?: string) => {
    if (!confirm("Delete this peer?")) return;
    const res = await fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterId, data: { id } })
    });
    const data = await res.json();
    if (data.success) {
      // Also delete metadata if exists
      if (publicKey) {
        await supabase
          .from("peer_metadata")
          .delete()
          .eq("router_id", selectedRouterId)
          .eq("peer_public_key", publicKey);
      }
      toast.success("Peer deleted");
      fetchWireGuardData();
      setPeerManageOpen(false);
    } else {
      toast.error(data.error || "Failed to delete");
    }
  };

  const handleTogglePeer = async (id: string, disabled: boolean) => {
    // Find the peer
    const peer = peers.find(p => p[".id"] === id);
    if (!peer) {
      toast.error("Peer not found");
      return;
    }

    // If trying to enable a disabled peer, check if it's expired
    if (disabled) {
      const meta = peerMetadata[peer["public-key"]];
      if (meta?.expires_at) {
        const expiresAt = new Date(meta.expires_at);
        const isExpired = expiresAt < new Date();

        if (isExpired) {
          // Open renewal dialog instead of enabling directly
          setRenewingPeer(peer);
          setRenewHours(meta.expiration_hours || 24);
          setRenewDialogOpen(true);
          return;
        }
      }
    }

    // Normal toggle
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

  // Handle renewing an expired peer
  const handleRenewPeer = async () => {
    if (!renewingPeer || !selectedRouterId) return;

    setRenewing(true);
    try {
      // First, enable the peer
      const enableRes = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enablePeer", routerId: selectedRouterId, data: { id: renewingPeer[".id"] } })
      });
      const enableData = await enableRes.json();

      if (!enableData.success) {
        toast.error(enableData.error || "Failed to enable peer");
        setRenewing(false);
        return;
      }

      // Calculate new expiration date
      const newExpiresAt = new Date();
      newExpiresAt.setHours(newExpiresAt.getHours() + renewHours);

      // Update metadata with new expiration
      const { error } = await supabase
        .from("peer_metadata")
        .update({
          expires_at: newExpiresAt.toISOString(),
          expiration_hours: renewHours,
          auto_disable_enabled: true
        })
        .eq("router_id", selectedRouterId)
        .eq("peer_public_key", renewingPeer["public-key"]);

      if (error) {
        console.error("Failed to update metadata:", error);
        toast.warning("Peer enabled but failed to update expiration");
      } else {
        toast.success(`Peer renewed for ${renewHours} hours`);
      }

      setRenewDialogOpen(false);
      setRenewingPeer(null);
      fetchWireGuardData();
      fetchPeerMetadata();
    } catch (err) {
      console.error("Failed to renew peer:", err);
      toast.error("Failed to renew peer");
    }
    setRenewing(false);
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

  // Open peer management dialog
  const openPeerManagement = (peer: PeerWithMetadata, action: "edit" | "view") => {
    setManagingPeer(peer);
    setPeerAction(action);
    setPeerManageOpen(true);
  };

  // Format date helper
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch {
      return "-";
    }
  };

  // Check if peer is expired
  const isPeerExpired = (peer: PeerWithMetadata) => {
    const meta = peerMetadata[peer["public-key"]];
    if (!meta?.expires_at) return false;
    return new Date(meta.expires_at) < new Date();
  };

  // Get time remaining for peer
  const getTimeRemaining = (peer: PeerWithMetadata) => {
    const meta = peerMetadata[peer["public-key"]];
    if (!meta?.expires_at) return null;
    const expiresAt = new Date(meta.expires_at);
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    if (diff <= 0) return "Expired";

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
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

  const formatBytes = (bytes?: number | string) => {
    const numBytes = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (!numBytes || isNaN(numBytes) || numBytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
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
                  {canSeeAllPeers
                    ? `(${filteredPeers.length})`
                    : `(${filteredPeers.length})`
                  }
                </span>
              </h2>
              {!canSeeAllPeers && (
                <Badge variant="outline" className="text-xs">
                  <User className="w-3 h-3 mr-1" />
                  My Peers
                </Badge>
              )}
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
                  <TableHead className="text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Created
                    </div>
                  </TableHead>
                  <TableHead className="text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      Created By
                    </div>
                  </TableHead>
                  {canAutoExpire && (
                    <TableHead className="text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Timer className="w-3 h-3" />
                        Expires
                      </div>
                    </TableHead>
                  )}
                  <TableHead className="text-muted-foreground">Status</TableHead>
                  <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPeers.map((peer) => {
                  const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
                  const isEditing = editingPeerId === peer[".id"];
                  const meta = peerMetadata[peer["public-key"]];
                  const expired = isPeerExpired(peer);
                  const timeRemaining = getTimeRemaining(peer);

                  return (
                    <TableRow
                      key={peer[".id"]}
                      className={`table-row-hover border-border ${expired ? "opacity-60" : ""}`}
                    >
                      {/* Name Column */}
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
                          <button
                            onClick={() => openPeerManagement(peer, "view")}
                            className="font-medium hover:text-primary transition-colors text-left"
                          >
                            {peer.name || "-"}
                          </button>
                        )}
                      </TableCell>

                      {/* Interface Column */}
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {peer.interface || "-"}
                        </Badge>
                      </TableCell>

                      {/* Allowed Address Column */}
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

                      {/* Public IP Column */}
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

                      {/* Created At Column */}
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(meta?.created_at)}
                      </TableCell>

                      {/* Created By Column */}
                      <TableCell className="text-sm">
                        {meta?.created_by_email ? (
                          <span className="truncate max-w-[100px] block" title={meta.created_by_email}>
                            {meta.created_by_email.split("@")[0]}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>

                      {/* Expires Column */}
                      {canAutoExpire && (
                        <TableCell className="text-sm">
                          {timeRemaining ? (
                            <Badge
                              variant="outline"
                              className={expired ? "text-red-400 border-red-400" : "text-amber-400 border-amber-400"}
                            >
                              <Timer className="w-3 h-3 mr-1" />
                              {timeRemaining}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      )}

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
                                onClick={() => openPeerManagement(peer, "view")}
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
                                onClick={() => handleDeletePeer(peer[".id"], peer["public-key"])}
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
              <Popover open={ipComboboxOpen} onOpenChange={setIpComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={ipComboboxOpen}
                    className="w-full justify-between bg-secondary border-border font-mono"
                  >
                    {selectedPublicIpId
                      ? publicIps.find((ip) => ip.id === selectedPublicIpId)?.public_ip || "Select public IP"
                      : "Select public IP"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type IP to search..." className="font-mono" />
                    <CommandList className="max-h-[250px] overflow-y-auto">
                      <CommandEmpty>No IP found.</CommandEmpty>
                      <CommandGroup>
                        {publicIps.map((ip) => (
                          <CommandItem
                            key={ip.id}
                            value={ip.public_ip}
                            onSelect={() => {
                              setSelectedPublicIpId(ip.id);
                              setIpComboboxOpen(false);
                            }}
                            className="font-mono cursor-pointer"
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                selectedPublicIpId === ip.id ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            {ip.public_ip}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {publicIps.length === 0 && (
                <p className="text-xs text-amber-400">
                  {routers.length === 0
                    ? "No routers available. Contact admin for access."
                    : "No public IPs available for this router."}
                </p>
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

            {/* Expiration Settings */}
            {canAutoExpire && (
              <div className="space-y-3 pt-2 border-t border-border">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enableExpiration"
                    checked={enableExpiration}
                    onChange={(e) => setEnableExpiration(e.target.checked)}
                    className="rounded border-border"
                  />
                  <Label htmlFor="enableExpiration" className="flex items-center gap-2 cursor-pointer">
                    <Timer className="w-4 h-4 text-amber-400" />
                    Auto-disable after time
                  </Label>
                </div>
                {enableExpiration && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      value={expirationHours}
                      onChange={(e) => setExpirationHours(parseInt(e.target.value) || 1)}
                      className="bg-secondary border-border w-24"
                    />
                    <span className="text-sm text-muted-foreground">hours</span>
                    <div className="flex gap-2 ml-auto">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setExpirationHours(24)}
                      >
                        1 day
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setExpirationHours(24 * 7)}
                      >
                        7 days
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setExpirationHours(24 * 30)}
                      >
                        30 days
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
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

      {/* Peer Management Dialog */}
      <Dialog open={peerManageOpen} onOpenChange={setPeerManageOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>{managingPeer?.name || "Peer Details"}</DialogTitle>
            <DialogDescription>
              {managingPeer?.comment || managingPeer?.["allowed-address"]}
            </DialogDescription>
          </DialogHeader>
          {managingPeer && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Name</Label>
                  <p className="font-mono text-sm">{managingPeer.name || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Interface</Label>
                  <p className="font-mono text-sm">{managingPeer.interface || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Allowed Address</Label>
                  <p className="font-mono text-sm text-cyan-400">{managingPeer["allowed-address"] || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Public IP</Label>
                  <p className="font-mono text-sm text-emerald-400">{managingPeer.comment || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Status</Label>
                  <Badge variant="outline" className={managingPeer.disabled ? "text-red-400" : "text-emerald-400"}>
                    {managingPeer.disabled ? "Disabled" : "Enabled"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Created By</Label>
                  <p className="text-sm">{peerMetadata[managingPeer["public-key"]]?.created_by_email || "-"}</p>
                </div>
                <div className="space-y-2">
                  <Label className="text-muted-foreground text-xs">Created At</Label>
                  <p className="text-sm">{formatDate(peerMetadata[managingPeer["public-key"]]?.created_at)}</p>
                </div>
                {peerMetadata[managingPeer["public-key"]]?.expires_at && (
                  <div className="space-y-2">
                    <Label className="text-muted-foreground text-xs">Expires At</Label>
                    <p className="text-sm text-amber-400">
                      {formatDate(peerMetadata[managingPeer["public-key"]]?.expires_at)}
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground text-xs">Configuration</Label>
                <pre className="bg-secondary p-4 rounded-lg text-sm overflow-x-auto font-mono border border-border">
                  {generateConfig(managingPeer)}
                </pre>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <Button
                  variant="outline"
                  onClick={() => {
                    const isDisabled = managingPeer.disabled === true || String(managingPeer.disabled) === "true";
                    handleTogglePeer(managingPeer[".id"], isDisabled);
                    setPeerManageOpen(false);
                  }}
                  className="gap-2"
                >
                  {managingPeer.disabled ? (
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
                  variant="outline"
                  onClick={() => downloadConfig(managingPeer)}
                  className="gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => handleDeletePeer(managingPeer[".id"], managingPeer["public-key"])}
                  className="gap-2 ml-auto"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPeerManageOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew Peer Dialog */}
      <Dialog open={renewDialogOpen} onOpenChange={setRenewDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-400" />
              Renew Expired Peer
            </DialogTitle>
            <DialogDescription>
              This peer has expired. Choose how long to renew it for.
            </DialogDescription>
          </DialogHeader>
          {renewingPeer && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-secondary rounded-lg space-y-2">
                <p className="font-medium">{renewingPeer.name || "Unnamed Peer"}</p>
                <p className="text-sm text-muted-foreground font-mono">{renewingPeer["allowed-address"]}</p>
                <p className="text-sm text-muted-foreground">
                  Public IP: <span className="text-emerald-400">{renewingPeer.comment || "-"}</span>
                </p>
                {peerMetadata[renewingPeer["public-key"]]?.expires_at && (
                  <p className="text-sm text-red-400">
                    Expired: {formatDate(peerMetadata[renewingPeer["public-key"]]?.expires_at)}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Renewal Duration</Label>
                <div className="grid grid-cols-4 gap-2">
                  {[24, 48, 72, 168].map((hours) => (
                    <Button
                      key={hours}
                      variant={renewHours === hours ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRenewHours(hours)}
                      className="w-full"
                    >
                      {hours < 24 ? `${hours}h` : `${hours / 24}d`}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-sm">Custom:</Label>
                  <Input
                    type="number"
                    value={renewHours}
                    onChange={(e) => setRenewHours(parseInt(e.target.value) || 24)}
                    className="w-24 bg-secondary"
                    min={1}
                  />
                  <span className="text-sm text-muted-foreground">hours</span>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-sm text-amber-400">
                  The peer will be enabled and set to expire in {renewHours} hours ({Math.floor(renewHours / 24)} days {renewHours % 24} hours).
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenewPeer} disabled={renewing} className="gap-2">
              {renewing ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Renewing...
                </>
              ) : (
                <>
                  <Power className="w-4 h-4" />
                  Renew & Enable
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
