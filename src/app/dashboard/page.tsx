"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Timer,
  CalendarClock,
  RotateCcw,
  Key,
  Copy,
  Save,
  RotateCw,
  Wifi,
  WifiOff,
  Signal,
  TrendingUp,
  TrendingDown,
  Network
} from "lucide-react";
import { generateKeyPair } from "@/lib/wireguard-keys";
import type { Profile, Router as RouterType, WireGuardInterface, WireGuardPeer, PublicIP, PeerMetadata, UserCapabilities, TimeUnit, UserIpAccess } from "@/lib/types";

// Helper function to convert time value + unit to hours
const convertToHours = (value: number, unit: TimeUnit): number => {
  switch (unit) {
    case "seconds": return value / 3600;
    case "minutes": return value / 60;
    case "hours": return value;
    case "days": return value * 24;
    case "weeks": return value * 24 * 7;
    case "months": return value * 24 * 30;
    case "years": return value * 24 * 365;
    default: return value;
  }
};

// Helper function to convert time value + unit to milliseconds
const convertToMilliseconds = (value: number, unit: TimeUnit): number => {
  switch (unit) {
    case "seconds": return value * 1000;
    case "minutes": return value * 60 * 1000;
    case "hours": return value * 60 * 60 * 1000;
    case "days": return value * 24 * 60 * 60 * 1000;
    case "weeks": return value * 7 * 24 * 60 * 60 * 1000;
    case "months": return value * 30 * 24 * 60 * 60 * 1000;
    case "years": return value * 365 * 24 * 60 * 60 * 1000;
    default: return value * 60 * 60 * 1000;
  }
};

// Helper function to format duration for display
const formatDuration = (value: number, unit: TimeUnit): string => {
  const totalHours = convertToHours(value, unit);
  if (totalHours < 1) {
    const totalMinutes = totalHours * 60;
    if (totalMinutes < 1) {
      return `${Math.round(totalMinutes * 60)}s`;
    }
    return `${Math.round(totalMinutes)}m`;
  }
  if (totalHours < 24) {
    return `${Math.round(totalHours)}h`;
  }
  const days = Math.floor(totalHours / 24);
  const remainingHours = Math.round(totalHours % 24);
  if (remainingHours === 0) {
    return `${days}d`;
  }
  return `${days}d ${remainingHours}h`;
};

interface PeerWithMetadata extends WireGuardPeer {
  metadata?: PeerMetadata;
}

// Cache for interface public keys (persisted in localStorage)
const INTERFACE_CACHE_KEY = "wg_interface_cache";

const getInterfaceCache = (routerId: string): WireGuardInterface[] => {
  if (typeof window === "undefined") return [];
  try {
    const cache = JSON.parse(localStorage.getItem(INTERFACE_CACHE_KEY) || "{}");
    return cache[routerId] || [];
  } catch {
    return [];
  }
};

const setInterfaceCache = (routerId: string, interfaces: WireGuardInterface[]) => {
  if (typeof window === "undefined") return;
  try {
    const cache = JSON.parse(localStorage.getItem(INTERFACE_CACHE_KEY) || "{}");
    cache[routerId] = interfaces;
    localStorage.setItem(INTERFACE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore localStorage errors
  }
};

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
  const [userIpAccess, setUserIpAccess] = useState<UserIpAccess[]>([]); // User's IP access
  const [createdUserIds, setCreatedUserIds] = useState<Set<string>>(new Set()); // IDs of users created by this user (for semiadmin)
  const [groupUserIds, setGroupUserIds] = useState<Set<string>>(new Set()); // IDs of users in same group (for can_see_group_peers)
  const [hasSocks5Access, setHasSocks5Access] = useState(false); // Whether user has access to any SOCKS5 servers
  const [socksCountByIp, setSocksCountByIp] = useState<Record<string, number>>({}); // SOCKS5 proxy count per IP
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
  const [expirationValue, setExpirationValue] = useState<number>(24);
  const [expirationUnit, setExpirationUnit] = useState<TimeUnit>("hours");

  // View config dialog
  const [viewConfigOpen, setViewConfigOpen] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState<PeerWithMetadata | null>(null);

  // Edit mode in view dialog (WireGuard PC App style)
  const [dialogEditMode, setDialogEditMode] = useState(false);
  const [dialogEditConfig, setDialogEditConfig] = useState("");
  const [dialogUpdating, setDialogUpdating] = useState(false);
  const [dialogPublicKey, setDialogPublicKey] = useState("");

  // Edit peer fields (WireGuard PC App style)
  const [editPeerName, setEditPeerName] = useState("");
  const [editPeerPublicKey, setEditPeerPublicKey] = useState("");
  const [editPeerPrivateKey, setEditPeerPrivateKey] = useState("");
  const [editPeerAllowedAddress, setEditPeerAllowedAddress] = useState("");
  const [editPeerComment, setEditPeerComment] = useState("");
  const [editPeerDns, setEditPeerDns] = useState("8.8.8.8");
  const [editPeerEndpoint, setEditPeerEndpoint] = useState("");
  const [editConfigText, setEditConfigText] = useState("");
  const [regeneratingKeys, setRegeneratingKeys] = useState(false);
  const [checkingPublicKey, setCheckingPublicKey] = useState(false);
  const [publicKeyExists, setPublicKeyExists] = useState(false);

  // Peer management dialog (from admin IP modal)
  const [peerManageOpen, setPeerManageOpen] = useState(false);
  const [managingPeer, setManagingPeer] = useState<PeerWithMetadata | null>(null);
  const [peerAction, setPeerAction] = useState<"edit" | "view" | null>(null);

  // Renew peer dialog (for expired peers)
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewingPeer, setRenewingPeer] = useState<PeerWithMetadata | null>(null);
  const [renewValue, setRenewValue] = useState<number>(24);
  const [renewUnit, setRenewUnit] = useState<TimeUnit>("hours");
  const [renewing, setRenewing] = useState(false);

  // Edit expiration dialog (for existing peers)
  const [editExpirationOpen, setEditExpirationOpen] = useState(false);
  const [editingExpirationPeer, setEditingExpirationPeer] = useState<PeerWithMetadata | null>(null);
  const [editExpEnabled, setEditExpEnabled] = useState(false);
  const [editExpValue, setEditExpValue] = useState<number>(24);
  const [editExpUnit, setEditExpUnit] = useState<TimeUnit>("hours");
  const [editExpScheduledEnable, setEditExpScheduledEnable] = useState(false);
  const [editExpEnableDate, setEditExpEnableDate] = useState<string>("");
  const [savingExpiration, setSavingExpiration] = useState(false);

  // Peers by IP modal (for viewing peers using a specific IP in the selector)
  const [ipPeersModalOpen, setIpPeersModalOpen] = useState(false);
  const [selectedIpForModal, setSelectedIpForModal] = useState<string>("");

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [sortBy, setSortBy] = useState<"created" | "ip" | "traffic" | "name">("created");

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
  const canSeeGroupPeers = capabilities.can_see_group_peers; // Can see peers from parent + siblings
  const canUseRestrictedIps = isAdmin || capabilities.can_use_restricted_ips;     // For CREATING peers
  const canSeeRestrictedPeers = isAdmin || capabilities.can_see_restricted_peers; // For VIEWING peers
  const canCreateUsers = capabilities.can_create_users; // For semiadmin functionality
  const canDelete = isAdmin || capabilities.can_delete; // Can delete peers and proxies
  // Get accessible IPs for filtering (based on user_ip_access)
  const accessibleIps = useMemo(() => {
    if (isAdmin) {
      // Admin can see all IPs
      return new Set(allPublicIps.map(ip => ip.public_ip));
    }
    // For non-admins, only IPs they have access to
    const accessibleIpIds = new Set(userIpAccess.filter(a => a.can_use).map(a => a.ip_id));
    return new Set(
      allPublicIps
        .filter(ip => accessibleIpIds.has(ip.id))
        .map(ip => ip.public_ip)
    );
  }, [allPublicIps, userIpAccess, isAdmin]);

  // DEPRECATED: Keep for backwards compatibility
  const restrictedIps = useMemo(() => {
    return new Set(allPublicIps.filter(ip => ip.restricted).map(ip => ip.public_ip));
  }, [allPublicIps]);

  // Get visible peers for this user (for stats calculation)
  // This uses the same filtering logic as filteredPeers but without search/status filters
  const visiblePeers = useMemo(() => {
    let visible = peers;

    // If admin or can_see_all_peers, show all peers
    if (!canSeeAllPeers && profile) {
      visible = visible.filter((peer) => {
        const meta = peerMetadata[peer["public-key"]];
        if (!meta) return false;
        // Include peers created by this user
        if (meta.created_by_user_id === profile.id || meta.created_by_email === profile.email) {
          return true;
        }
        // Include peers created by users they created (semiadmin)
        if (canCreateUsers && createdUserIds.has(meta.created_by_user_id || "")) {
          return true;
        }
        // Include peers from group (parent + siblings) if can_see_group_peers
        if (canSeeGroupPeers && groupUserIds.has(meta.created_by_user_id || "")) {
          return true;
        }
        return false;
      });
    }

    // Filter by accessible IPs (new system based on user_ip_access)
    // Skip this filter if user can see all peers OR for peers created by users they manage
    if (!isAdmin && !canSeeAllPeers) {
      visible = visible.filter((peer) => {
        const peerIp = peer.comment || "";
        const meta = peerMetadata[peer["public-key"]];
        // Allow if user has access to this IP
        if (accessibleIps.has(peerIp)) return true;
        // Allow if peer was created by a user they created
        if (canCreateUsers && meta && createdUserIds.has(meta.created_by_user_id || "")) return true;
        // Allow if peer is from group (can_see_group_peers)
        if (canSeeGroupPeers && meta && groupUserIds.has(meta.created_by_user_id || "")) return true;
        return false;
      });
    }

    return visible;
  }, [peers, canSeeAllPeers, canSeeGroupPeers, canCreateUsers, createdUserIds, groupUserIds, profile, peerMetadata, isAdmin, accessibleIps]);

  // Calculate peer count and group peers per public IP (using comment field that stores the public IP)
  const { peerCountByIp, peersByIp } = useMemo(() => {
    const counts: Record<string, number> = {};
    const grouped: Record<string, PeerWithMetadata[]> = {};
    for (const peer of visiblePeers) {
      const ip = peer.comment || "";
      if (ip) {
        counts[ip] = (counts[ip] || 0) + 1;
        if (!grouped[ip]) grouped[ip] = [];
        grouped[ip].push(peer);
      }
    }
    return { peerCountByIp: counts, peersByIp: grouped };
  }, [visiblePeers]);

  // Parse MikroTik duration format (e.g., "1h2m3s", "5m30s", "45s")
  const parseMikroTikDuration = useCallback((duration: string): number | null => {
    const regex = /(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
    const match = duration.match(regex);
    if (!match) return null;

    const weeks = parseInt(match[1] || "0", 10);
    const days = parseInt(match[2] || "0", 10);
    const hours = parseInt(match[3] || "0", 10);
    const minutes = parseInt(match[4] || "0", 10);
    const seconds = parseInt(match[5] || "0", 10);

    const totalMs = (
      weeks * 7 * 24 * 60 * 60 * 1000 +
      days * 24 * 60 * 60 * 1000 +
      hours * 60 * 60 * 1000 +
      minutes * 60 * 1000 +
      seconds * 1000
    );

    return totalMs > 0 ? totalMs : null;
  }, []);

  // Helper function to check if a peer is connected (handshake within last 3 minutes)
  const isPeerConnected = useCallback((peer: WireGuardPeer): boolean => {
    const lastHandshake = peer["last-handshake"];
    if (!lastHandshake) return false;

    let timeSinceHandshakeMs: number | null = null;

    if (typeof lastHandshake === "string") {
      // Check if it's a MikroTik duration format (e.g., "1h2m3s")
      if (/[wdhms]/.test(lastHandshake)) {
        timeSinceHandshakeMs = parseMikroTikDuration(lastHandshake);
        if (timeSinceHandshakeMs !== null) {
          // For MikroTik, the value is "time since last handshake"
          return timeSinceHandshakeMs < (3 * 60 * 1000);
        }
      }

      // Unix timestamp as string (e.g., "1713571200") - Linux format
      const parsed = parseInt(lastHandshake, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const handshakeMs = parsed * 1000;
        const threeMinutesAgo = Date.now() - (3 * 60 * 1000);
        return handshakeMs > threeMinutesAgo;
      }
    } else if (typeof lastHandshake === "number") {
      if (lastHandshake > 0) {
        const handshakeMs = lastHandshake * 1000;
        const threeMinutesAgo = Date.now() - (3 * 60 * 1000);
        return handshakeMs > threeMinutesAgo;
      }
    }

    return false;
  }, [parseMikroTikDuration]);

  // Format MikroTik duration to readable format (e.g., "1d19h25m53s" -> "1d 19h ago")
  const formatMikroTikDurationReadable = useCallback((duration: string): string => {
    const regex = /(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/;
    const match = duration.match(regex);
    if (!match) return duration;

    const weeks = parseInt(match[1] || "0", 10);
    const days = parseInt(match[2] || "0", 10);
    const hours = parseInt(match[3] || "0", 10);
    const minutes = parseInt(match[4] || "0", 10);

    // Format in a readable way, showing max 2 units
    if (weeks > 0) return `${weeks}w ${days}d ago`;
    if (days > 0) return `${days}d ${hours}h ago`;
    if (hours > 0) return `${hours}h ${minutes}m ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  }, []);

  // Format last handshake for display
  const formatLastHandshake = useCallback((peer: WireGuardPeer): string => {
    const lastHandshake = peer["last-handshake"];
    if (!lastHandshake) return "Never";

    if (typeof lastHandshake === "string") {
      // Check if it's a MikroTik duration format (e.g., "1h2m3s")
      if (/[wdhms]/.test(lastHandshake)) {
        return formatMikroTikDurationReadable(lastHandshake);
      }

      // Unix timestamp as string - Linux format
      const parsed = parseInt(lastHandshake, 10);
      if (!isNaN(parsed) && parsed > 0) {
        const handshakeMs = parsed * 1000;
        const now = Date.now();
        const diff = now - handshakeMs;

        if (diff < 0) return "Just now";
        if (diff < 60000) return "Just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return new Date(handshakeMs).toLocaleDateString();
      }
    } else if (typeof lastHandshake === "number") {
      if (lastHandshake > 0) {
        const handshakeMs = lastHandshake * 1000;
        const now = Date.now();
        const diff = now - handshakeMs;

        if (diff < 0) return "Just now";
        if (diff < 60000) return "Just now";
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

        return new Date(handshakeMs).toLocaleDateString();
      }
    }

    return "Never";
  }, [formatMikroTikDurationReadable]);

  // Stats - only show stats for peers the user can see
  const stats = useMemo(() => {
    const total = visiblePeers.length;
    const active = visiblePeers.filter(p => {
      const isDisabled = p.disabled === true || String(p.disabled) === "true";
      return !isDisabled;
    }).length;
    const disabled = total - active;
    const connected = visiblePeers.filter(p => {
      const isDisabled = p.disabled === true || String(p.disabled) === "true";
      return !isDisabled && isPeerConnected(p);
    }).length;
    const withTimer = visiblePeers.filter(p => {
      const meta = peerMetadata[p["public-key"]];
      return meta?.expires_at && meta?.auto_disable_enabled;
    }).length;
    const uniqueSubnets = new Set(
      visiblePeers.map(p => {
        const addr = p["allowed-address"]?.split(",")[0]?.split("/")[0] || "";
        const parts = addr.split(".");
        return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}` : "";
      }).filter(Boolean)
    ).size;

    // Calculate total traffic
    const totalRx = visiblePeers.reduce((sum, p) => sum + (p.rx || 0), 0);
    const totalTx = visiblePeers.reduce((sum, p) => sum + (p.tx || 0), 0);

    return { total, active, disabled, connected, withTimer, uniqueSubnets, totalRx, totalTx };
  }, [visiblePeers, peerMetadata, isPeerConnected]);

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
        // Include peers created by this user
        if (meta.created_by_user_id === profile.id || meta.created_by_email === profile.email) {
          return true;
        }
        // Include peers created by users they created (semiadmin)
        if (canCreateUsers && createdUserIds.has(meta.created_by_user_id || "")) {
          return true;
        }
        // Include peers from group (parent + siblings) if can_see_group_peers
        if (canSeeGroupPeers && groupUserIds.has(meta.created_by_user_id || "")) {
          return true;
        }
        return false;
      });
    }

    // Filter by accessible IPs (new system based on user_ip_access)
    // Skip this filter if user can see all peers OR for peers created by users they manage
    if (!isAdmin && !canSeeAllPeers) {
      filtered = filtered.filter((peer) => {
        const peerIp = peer.comment || "";
        const meta = peerMetadata[peer["public-key"]];
        // Allow if user has access to this IP
        if (accessibleIps.has(peerIp)) return true;
        // Allow if peer was created by a user they created
        if (canCreateUsers && meta && createdUserIds.has(meta.created_by_user_id || "")) return true;
        // Allow if peer is from group (can_see_group_peers)
        if (canSeeGroupPeers && meta && groupUserIds.has(meta.created_by_user_id || "")) return true;
        return false;
      });
    }

    // Apply status filter
    filtered = filtered.filter((peer) => {
      const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
      const meta = peerMetadata[peer["public-key"]];
      const hasExpiration = meta?.expires_at && meta?.auto_disable_enabled;
      const isConnected = !isDisabled && isPeerConnected(peer);

      if (statusFilter === "connected" && !isConnected) return false;
      if (statusFilter === "enabled" && isDisabled) return false;
      if (statusFilter === "disabled" && !isDisabled) return false;
      if (statusFilter === "with-timer" && !hasExpiration) return false;
      if (statusFilter === "no-timer" && hasExpiration) return false;
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

    // Sort peers based on sortBy and sortOrder
    // IMPORTANT: Use stable sorting by adding secondary sort key (public-key)
    // This prevents peers from jumping around on refresh
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case "created": {
          // Sort by created_at from metadata (newest first by default)
          const metaA = peerMetadata[a["public-key"]];
          const metaB = peerMetadata[b["public-key"]];
          const dateA = metaA?.created_at ? new Date(metaA.created_at).getTime() : 0;
          const dateB = metaB?.created_at ? new Date(metaB.created_at).getTime() : 0;
          comparison = dateB - dateA; // Newest first by default
          break;
        }
        case "ip": {
          // Sort by allowed-address IP numerically
          const getIpValue = (addr: string) => {
            const parts = (addr || "").split("/")[0].split(".");
            if (parts.length === 4) {
              return parts.reduce((acc, part, i) => acc + parseInt(part, 10) * Math.pow(256, 3 - i), 0);
            }
            return 0;
          };
          const ipA = getIpValue(a["allowed-address"] || "");
          const ipB = getIpValue(b["allowed-address"] || "");
          comparison = ipA - ipB;
          break;
        }
        case "traffic": {
          // Sort by total traffic (rx + tx) - use snapshot values, not live
          // Note: Traffic changes frequently, so this sort may cause movement
          const trafficA = (parseInt(String(a.rx || "0"), 10) || 0) + (parseInt(String(a.tx || "0"), 10) || 0);
          const trafficB = (parseInt(String(b.rx || "0"), 10) || 0) + (parseInt(String(b.tx || "0"), 10) || 0);
          comparison = trafficB - trafficA; // Most traffic first by default
          break;
        }
        case "name": {
          // Sort by name alphabetically
          const nameA = (a.name || "").toLowerCase();
          const nameB = (b.name || "").toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
        default: {
          // Fallback to ID
          const idA = a[".id"] || "";
          const idB = b[".id"] || "";
          comparison = idB.localeCompare(idA);
        }
      }

      // Apply sort order
      const primaryResult = sortOrder === "asc" ? -comparison : comparison;

      // STABLE SORT: If primary comparison is equal, use public-key as tiebreaker
      // This ensures consistent ordering even when values are the same
      if (primaryResult === 0) {
        const keyA = a["public-key"] || "";
        const keyB = b["public-key"] || "";
        return keyA.localeCompare(keyB);
      }

      return primaryResult;
    });

    return sorted;
  }, [peers, searchQuery, statusFilter, sortOrder, sortBy, canSeeAllPeers, canSeeGroupPeers, canCreateUsers, createdUserIds, groupUserIds, profile, peerMetadata, isAdmin, accessibleIps]);

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

  // Get the selected router to check if it's Linux
  const selectedRouter = useMemo(() => {
    return routers.find(r => r.id === selectedRouterId);
  }, [routers, selectedRouterId]);

  const isLinuxRouter = selectedRouter?.connection_type === "linux-ssh";

  // Fetch peer metadata from database
  const fetchPeerMetadata = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const metadataMap: Record<string, PeerMetadata> = {};

      // Always fetch from peer_metadata table
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
      // This ensures that peers created by non-admin users are visible
      const currentRouter = routers.find(r => r.id === selectedRouterId);
      if (currentRouter?.connection_type === "linux-ssh") {
        const { data: linuxPeersData } = await supabase
          .from("linux_peers")
          .select("*")
          .eq("router_id", selectedRouterId);

        if (linuxPeersData) {
          for (const linuxPeer of linuxPeersData) {
            // Only add if not already in metadataMap (peer_metadata takes priority)
            if (!metadataMap[linuxPeer.public_key]) {
              // Convert linux_peers format to PeerMetadata format
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

      if (intData.interfaces && intData.interfaces.length > 0) {
        setInterfaces(intData.interfaces);
        // Cache the interfaces for when connection fails
        setInterfaceCache(selectedRouterId, intData.interfaces);
        if (!newPeer.interface) {
          setNewPeer(p => ({ ...p, interface: intData.interfaces[0].name }));
        }
      } else {
        // Use cached interfaces if available
        const cachedInterfaces = getInterfaceCache(selectedRouterId);
        if (cachedInterfaces.length > 0) {
          setInterfaces(cachedInterfaces);
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
      // On error, try to use cached interfaces
      const cachedInterfaces = getInterfaceCache(selectedRouterId);
      if (cachedInterfaces.length > 0) {
        setInterfaces(cachedInterfaces);
      }
      toast.error("Failed to fetch data");
    }
    setRefreshing(false);
  }, [selectedRouterId, newPeer.interface, fetchPeerMetadata]);

  // Auto-refresh every 30 seconds for real-time connection tracking
  useEffect(() => {
    if (!selectedRouterId) return;

    const interval = setInterval(() => {
      fetchWireGuardData(false);
    }, 30000);

    return () => clearInterval(interval);
  }, [selectedRouterId, fetchWireGuardData]);

  // Auto-disable expired peers and auto-enable scheduled peers
  const autoDisableExpiredPeers = useCallback(async () => {
    if (!selectedRouterId || Object.keys(peerMetadata).length === 0) return;

    const now = new Date();
    const peersToDisable: PeerWithMetadata[] = [];
    const peersToEnable: PeerWithMetadata[] = [];

    for (const peer of peers) {
      const meta = peerMetadata[peer["public-key"]];
      const isDisabled = peer.disabled === true || String(peer.disabled) === "true";

      // Check for expired peers that need to be disabled
      if (meta?.expires_at && meta.auto_disable_enabled) {
        const expiresAt = new Date(meta.expires_at);
        const isExpired = expiresAt < now;

        // If peer is expired and still enabled, add to list to disable
        if (isExpired && !isDisabled) {
          peersToDisable.push(peer);
        }
      }

      // Check for scheduled peers that need to be enabled
      if (meta?.scheduled_enable_at && isDisabled) {
        const scheduledEnableAt = new Date(meta.scheduled_enable_at);
        const shouldEnable = scheduledEnableAt <= now;

        if (shouldEnable) {
          peersToEnable.push(peer);
        }
      }
    }

    let hasChanges = false;

    // Disable all expired peers
    for (const peer of peersToDisable) {
      try {
        const res = await fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "disablePeer", routerId: selectedRouterId, data: { id: peer[".id"] } })
        });
        const data = await res.json();
        if (data.success) {
          toast.info(`Peer "${peer.name || 'Unnamed'}" auto-disabled (expired)`);
          hasChanges = true;
        }
      } catch (err) {
        console.error("Failed to auto-disable peer:", err);
      }
    }

    // Enable all scheduled peers and clear their scheduled_enable_at
    for (const peer of peersToEnable) {
      try {
        const res = await fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "enablePeer", routerId: selectedRouterId, data: { id: peer[".id"] } })
        });
        const data = await res.json();
        if (data.success) {
          // Clear the scheduled_enable_at in metadata
          await supabase
            .from("peer_metadata")
            .update({ scheduled_enable_at: null })
            .eq("router_id", selectedRouterId)
            .eq("peer_public_key", peer["public-key"]);

          toast.info(`Peer "${peer.name || 'Unnamed'}" auto-enabled (scheduled)`);
          hasChanges = true;
        }
      } catch (err) {
        console.error("Failed to auto-enable peer:", err);
      }
    }

    // Refresh data if any changes were made
    if (hasChanges) {
      fetchWireGuardData();
      fetchPeerMetadata();
    }
  }, [selectedRouterId, peers, peerMetadata, fetchWireGuardData, fetchPeerMetadata, supabase]);

  // Track metadata count for dependency array
  const metadataCount = Object.keys(peerMetadata).length;

  // Run auto-disable check when peers and metadata are loaded
  // Also set up an interval to check periodically
  useEffect(() => {
    if (peers.length > 0 && metadataCount > 0) {
      autoDisableExpiredPeers();
    }

    // Set up periodic check every 60 seconds
    const intervalId = setInterval(() => {
      if (peers.length > 0 && metadataCount > 0) {
        autoDisableExpiredPeers();
      }
    }, 60000); // Check every minute

    return () => clearInterval(intervalId);
  }, [peers.length, metadataCount, autoDisableExpiredPeers]);

  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterId || !profile) return;
    try {
      // Fetch all public IPs for this router
      const res = await fetch(`/api/public-ips?routerId=${selectedRouterId}`);
      const data = await res.json();

      if (data.publicIps) {
        // Store all IPs for filtering peers visibility
        setAllPublicIps(data.publicIps);

        // If admin, show all enabled IPs
        if (isAdmin) {
          setPublicIps(data.publicIps.filter((ip: PublicIP) => ip.enabled));
          setUserIpAccess([]);
          return;
        }

        // For non-admins, fetch their IP access
        const accessRes = await fetch(`/api/user-ip-access?userId=${profile.id}&routerId=${selectedRouterId}`);
        const accessData = await accessRes.json();

        if (accessData.ipAccess) {
          setUserIpAccess(accessData.ipAccess);

          // Create a set of IP IDs the user has access to
          const accessibleIpIds = new Set(
            accessData.ipAccess
              .filter((a: UserIpAccess) => a.can_use)
              .map((a: UserIpAccess) => a.ip_id)
          );

          // Filter IPs: only enabled IPs that user has access to
          setPublicIps(data.publicIps.filter((ip: PublicIP) => {
            if (!ip.enabled) return false;
            // User must have explicit access to use this IP
            return accessibleIpIds.has(ip.id);
          }));
        } else {
          // No access records = no IPs available
          setUserIpAccess([]);
          setPublicIps([]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch public IPs:", err);
    }
  }, [selectedRouterId, isAdmin, profile]);

  // Fetch users created by the current user (for semiadmin functionality)
  const fetchCreatedUsers = useCallback(async () => {
    if (!profile || !capabilities.can_create_users) {
      setCreatedUserIds(new Set());
      return;
    }
    try {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("created_by_user_id", profile.id);

      if (data) {
        setCreatedUserIds(new Set(data.map((u: { id: string }) => u.id)));
      }
    } catch (err) {
      console.error("Failed to fetch created users:", err);
    }
  }, [profile, capabilities.can_create_users, supabase]);

  // Fetch group users (parent + siblings) for can_see_group_peers
  const fetchGroupUsers = useCallback(async () => {
    if (!profile || !capabilities.can_see_group_peers || !profile.created_by_user_id) {
      setGroupUserIds(new Set());
      return;
    }
    try {
      // Get all users created by the same parent (siblings)
      const { data: siblings } = await supabase
        .from("profiles")
        .select("id")
        .eq("created_by_user_id", profile.created_by_user_id);

      const siblingIds = siblings?.map((s: { id: string }) => s.id) || [];

      // Include parent + all siblings
      setGroupUserIds(new Set([profile.created_by_user_id, ...siblingIds]));
    } catch (err) {
      console.error("Failed to fetch group users:", err);
    }
  }, [profile, capabilities.can_see_group_peers, supabase]);

  // Fetch SOCKS5 proxy counts per IP
  const fetchSocksCountByIp = useCallback(async () => {
    if (!selectedRouterId) return;
    try {
      const res = await fetch(`/api/socks5?routerId=${selectedRouterId}`);
      const data = await res.json();
      if (data.proxies) {
        const counts: Record<string, number> = {};
        for (const proxy of data.proxies) {
          const ip = proxy.public_ip;
          if (ip) {
            counts[ip] = (counts[ip] || 0) + 1;
          }
        }
        setSocksCountByIp(counts);
      }
    } catch (err) {
      console.error("Failed to fetch SOCKS5 counts:", err);
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (selectedRouterId && profile) {
      fetchWireGuardData();
      fetchPublicIps();
      fetchCreatedUsers();
      fetchGroupUsers();
      fetchSocksCountByIp();
    }
  }, [selectedRouterId, fetchWireGuardData, fetchPublicIps, fetchCreatedUsers, fetchGroupUsers, fetchSocksCountByIp, profile]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Save peer metadata to database
  const savePeerMetadata = async (peer: WireGuardPeer, expiresAt?: Date, expirationValue?: number, expirationUnit?: TimeUnit) => {
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
        expiration_hours: expiresAt ? convertToHours(expirationValue || 24, expirationUnit || "hours") : null,
        expiration_value: expiresAt ? expirationValue : null,
        expiration_unit: expiresAt ? expirationUnit : null,
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
        if (enableExpiration && canAutoExpire && expirationValue > 0) {
          expiresAt = new Date();
          expiresAt = new Date(expiresAt.getTime() + convertToMilliseconds(expirationValue, expirationUnit));
        }
        // Save metadata
        await savePeerMetadata(data.peer, expiresAt, expirationValue, expirationUnit);
        toast.success(`Peer created! IP: ${data.assignedIp}${expiresAt ? ` (expires in ${formatDuration(expirationValue, expirationUnit)})` : ""}`);
        setCreateDialogOpen(false);
        setNewPeer({ interface: interfaces[0]?.name || "", name: "", "allowed-address": "", comment: "" });
        setSelectedPublicIpId("");
        setEnableExpiration(false);
        setExpirationValue(24);
        setExpirationUnit("hours");
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
    // Check if user has delete permission
    if (!canDelete) {
      toast.error("You don't have permission to delete peers");
      return;
    }
    if (!confirm("Delete this peer?")) return;
    const res = await fetch("/api/wireguard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "deletePeer",
        routerId: selectedRouterId,
        data: {
          id,
          "public-key": publicKey,
          publicKey: publicKey  // Include both formats for compatibility
        }
      })
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
          setRenewValue(meta.expiration_value || 24);
          setRenewUnit(meta.expiration_unit || "hours");
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

  // Open edit expiration dialog
  const openEditExpiration = (peer: PeerWithMetadata) => {
    const meta = peerMetadata[peer["public-key"]];
    setEditingExpirationPeer(peer);
    setEditExpEnabled(!!meta?.auto_disable_enabled);
    setEditExpValue(meta?.expiration_value || 24);
    setEditExpUnit(meta?.expiration_unit || "hours");
    setEditExpScheduledEnable(false);
    setEditExpEnableDate("");
    setEditExpirationOpen(true);
  };

  // Save expiration settings for existing peer
  const handleSaveExpiration = async () => {
    if (!editingExpirationPeer || !selectedRouterId) return;

    setSavingExpiration(true);
    try {
      let expiresAt: string | null = null;
      let scheduledEnableAt: string | null = null;
      let expirationHours: number | null = null;
      let expirationValue: number | null = null;
      let expirationUnit: TimeUnit | null = null;

      if (editExpEnabled && editExpValue > 0) {
        const expDate = new Date();
        expDate.setTime(expDate.getTime() + convertToMilliseconds(editExpValue, editExpUnit));
        expiresAt = expDate.toISOString();
        expirationHours = convertToHours(editExpValue, editExpUnit);
        expirationValue = editExpValue;
        expirationUnit = editExpUnit;
      }

      if (editExpScheduledEnable && editExpEnableDate) {
        scheduledEnableAt = new Date(editExpEnableDate).toISOString();
      }

      // Update metadata
      const { error } = await supabase
        .from("peer_metadata")
        .upsert({
          router_id: selectedRouterId,
          peer_public_key: editingExpirationPeer["public-key"],
          peer_name: editingExpirationPeer.name || null,
          peer_interface: editingExpirationPeer.interface || null,
          allowed_address: editingExpirationPeer["allowed-address"] || null,
          created_by_email: profile?.email,
          created_by_user_id: profile?.id,
          expires_at: expiresAt,
          auto_disable_enabled: editExpEnabled,
          expiration_hours: expirationHours,
          expiration_value: expirationValue,
          expiration_unit: expirationUnit,
          scheduled_enable_at: scheduledEnableAt,
        }, { onConflict: "router_id,peer_public_key" });

      if (error) {
        console.error("Failed to save expiration:", error);
        toast.error("Failed to save expiration settings");
      } else {
        toast.success(editExpEnabled
          ? `Peer will expire in ${formatDuration(editExpValue, editExpUnit)}`
          : "Expiration disabled for this peer"
        );
        setEditExpirationOpen(false);
        setEditingExpirationPeer(null);
        fetchPeerMetadata();
      }
    } catch (err) {
      console.error("Failed to save expiration:", err);
      toast.error("Failed to save expiration settings");
    }
    setSavingExpiration(false);
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
      newExpiresAt.setTime(newExpiresAt.getTime() + convertToMilliseconds(renewValue, renewUnit));

      // Update metadata with new expiration
      const { error } = await supabase
        .from("peer_metadata")
        .update({
          expires_at: newExpiresAt.toISOString(),
          expiration_hours: convertToHours(renewValue, renewUnit),
          expiration_value: renewValue,
          expiration_unit: renewUnit,
          auto_disable_enabled: true
        })
        .eq("router_id", selectedRouterId)
        .eq("peer_public_key", renewingPeer["public-key"]);

      if (error) {
        console.error("Failed to update metadata:", error);
        toast.warning("Peer enabled but failed to update expiration");
      } else {
        toast.success(`Peer renewed for ${formatDuration(renewValue, renewUnit)}`);
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

  // Generate editable config text for a peer
  const generateEditableConfig = (peer: PeerWithMetadata) => {
    const iface = interfaces.find((i) => i.name === peer.interface);
    const selectedRouter = routers.find((r) => r.id === selectedRouterId);
    const privateKey = peer["private-key"] || "[CLIENT_PRIVATE_KEY]";
    const endpointHost = peer.comment && /^\d+\.\d+\.\d+\.\d+$/.test(peer.comment)
      ? peer.comment
      : selectedRouter?.host || "server.example.com";
    const listenPort = iface?.["listen-port"] || 51820;
    const address = peer["allowed-address"]?.split(",")[0]?.split("/")[0] || "10.10.x.x";

    return `[Interface]
PrivateKey = ${privateKey}
Address = ${address}/32
DNS = 8.8.8.8

[Peer]
PublicKey = ${iface?.["public-key"] || "[SERVER_PUBLIC_KEY]"}
AllowedIPs = 0.0.0.0/0
Endpoint = ${endpointHost}:${listenPort}
PersistentKeepalive = 25`;
  };

  // Parse config text and update edit fields
  const handleConfigTextChange = (newConfigText: string) => {
    setEditConfigText(newConfigText);

    // Parse the config to extract values
    const lines = newConfigText.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+)\s*=\s*(.+)$/);
      if (match) {
        const key = match[1].toLowerCase();
        const value = match[2].trim();

        if (key === 'privatekey') setEditPeerPrivateKey(value);
        if (key === 'address') {
          const addr = value.includes('/') ? value : value + '/32';
          setEditPeerAllowedAddress(addr);
        }
        if (key === 'dns') setEditPeerDns(value);
        if (key === 'endpoint') {
          const endpointParts = value.split(':');
          if (endpointParts[0]) setEditPeerEndpoint(value);
        }
      }
    }
  };

  // Open peer management dialog
  const openPeerManagement = (peer: PeerWithMetadata, action: "edit" | "view") => {
    setManagingPeer(peer);
    setPeerAction(action);
    setPeerManageOpen(true);

    // Initialize edit fields
    setEditPeerName(peer.name || "");
    setEditPeerPublicKey(peer["public-key"] || "");
    setEditPeerPrivateKey(peer["private-key"] || "");
    setEditPeerAllowedAddress(peer["allowed-address"] || "");
    setEditPeerComment(peer.comment || "");
    setEditPeerDns("8.8.8.8");
    setEditConfigText(generateEditableConfig(peer));
    setDialogEditMode(false);
    setPublicKeyExists(false);
  };

  // Toggle edit mode in peer management dialog
  const toggleDialogEditMode = () => {
    if (!dialogEditMode && managingPeer) {
      setEditPeerName(managingPeer.name || "");
      setEditPeerPublicKey(managingPeer["public-key"] || "");
      setEditPeerPrivateKey(managingPeer["private-key"] || "");
      setEditPeerAllowedAddress(managingPeer["allowed-address"] || "");
      setEditPeerComment(managingPeer.comment || "");
      setEditPeerDns("8.8.8.8");
      setEditConfigText(generateEditableConfig(managingPeer));
      setPublicKeyExists(false);
    }
    setDialogEditMode(!dialogEditMode);
  };

  // Regenerate keys for peer
  const handleRegenerateKeys = async () => {
    setRegeneratingKeys(true);
    try {
      const newKeyPair = generateKeyPair();
      setEditPeerPrivateKey(newKeyPair.privateKey);
      setEditPeerPublicKey(newKeyPair.publicKey);
      await checkPublicKeyExists(newKeyPair.publicKey);
      toast.success("New keys generated");
    } catch (err) {
      console.error("Failed to generate keys:", err);
      toast.error("Failed to generate new keys");
    }
    setRegeneratingKeys(false);
  };

  // Check if public key already exists in router
  const checkPublicKeyExists = async (publicKey: string) => {
    if (!publicKey || !selectedRouterId || !managingPeer) {
      setPublicKeyExists(false);
      return false;
    }
    if (publicKey === managingPeer["public-key"]) {
      setPublicKeyExists(false);
      return false;
    }
    setCheckingPublicKey(true);
    try {
      const exists = peers.some(peer =>
        peer["public-key"] === publicKey && peer[".id"] !== managingPeer[".id"]
      );
      setPublicKeyExists(exists);
      if (exists) {
        toast.error("This public key already exists on another peer!");
      }
      return exists;
    } catch {
      setPublicKeyExists(false);
      return false;
    } finally {
      setCheckingPublicKey(false);
    }
  };

  // Save edited peer (WireGuard PC App style)
  const handleSaveDialogEdit = async () => {
    if (!managingPeer || !selectedRouterId) return;

    if (editPeerPublicKey !== managingPeer["public-key"]) {
      const exists = await checkPublicKeyExists(editPeerPublicKey);
      if (exists) {
        toast.error("Cannot save: Public key already exists on another peer");
        return;
      }
    }

    setDialogUpdating(true);
    try {
      const updateData: Record<string, unknown> = { id: managingPeer[".id"] };

      if (editPeerName !== managingPeer.name) updateData.name = editPeerName;
      if (editPeerAllowedAddress !== managingPeer["allowed-address"]) updateData["allowed-address"] = editPeerAllowedAddress;
      if (editPeerComment !== managingPeer.comment) updateData.comment = editPeerComment;
      if (editPeerPublicKey !== managingPeer["public-key"]) updateData["public-key"] = editPeerPublicKey;
      if (editPeerPrivateKey && editPeerPrivateKey !== managingPeer["private-key"]) updateData["private-key"] = editPeerPrivateKey;

      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updatePeerWithKeys", routerId: selectedRouterId, data: updateData })
      });

      const data = await res.json();
      if (data.success) {
        toast.success("Peer updated successfully");
        setDialogEditMode(false);
        setPeerManageOpen(false);
        fetchWireGuardData();
      } else {
        toast.error(data.error || "Failed to update peer");
      }
    } catch (err) {
      console.error("Failed to update peer:", err);
      toast.error("Failed to update peer");
    }
    setDialogUpdating(false);
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

    // If metadata has expiration_value and expiration_unit, use formatDuration
    if (meta.expiration_value && meta.expiration_unit) {
      // Calculate remaining time in the same unit
      // But for display, show the actual time left
      // We'll use the diff in ms to display
      const remaining = diff;
      if (remaining < 60000) {
        return `${Math.round(remaining / 1000)}s`;
      }
      if (remaining < 3600000) {
        return `${Math.round(remaining / 60000)}m`;
      }
      if (remaining < 86400000) {
        return `${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m`;
      }
      const days = Math.floor(remaining / 86400000);
      const hours = Math.floor((remaining % 86400000) / 3600000);
      return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
    }

    // Fallback to old logic
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
      userCapabilities={profile?.capabilities}
      hasSocks5Access={hasSocks5Access}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <StatCard
            title="Total Peers"
            value={stats.total}
            subtitle={`${stats.uniqueSubnets} subnets`}
            icon={Users}
            iconColor="blue"
            onClick={() => setStatusFilter("all")}
            active={statusFilter === "all"}
          />
          <StatCard
            title="Connected Now"
            value={stats.connected}
            subtitle={stats.active > 0 ? `${((stats.connected / stats.active) * 100).toFixed(0)}% online` : "0% online"}
            icon={Wifi}
            iconColor="emerald"
            pulse={stats.connected > 0}
            onClick={() => setStatusFilter("connected")}
            active={statusFilter === "connected"}
          />
          <StatCard
            title="Enabled"
            value={stats.active}
            subtitle={`${stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(0) : 0}% of total`}
            icon={Activity}
            iconColor="cyan"
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
            title="With Timer"
            value={stats.withTimer}
            subtitle={stats.withTimer > 0 ? "Expiration set" : ""}
            icon={Timer}
            iconColor="amber"
            onClick={() => setStatusFilter("with-timer")}
            active={statusFilter === "with-timer"}
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
                <SelectTrigger className="w-[150px] bg-secondary border-border">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="connected">Connected</SelectItem>
                  <SelectItem value="enabled">Enabled</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="with-timer">With Timer</SelectItem>
                  <SelectItem value="no-timer">No Timer</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as "created" | "ip" | "traffic" | "name")}>
                <SelectTrigger className="w-[130px] bg-secondary border-border">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created">By Created</SelectItem>
                  <SelectItem value="ip">By IP</SelectItem>
                  <SelectItem value="traffic">By Traffic</SelectItem>
                  <SelectItem value="name">By Name</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                title={sortOrder === "desc" ? (sortBy === "created" ? "Newest first" : "Descending") : (sortBy === "created" ? "Oldest first" : "Ascending")}
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
                  <TableHead className="text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Signal className="w-3 h-3" />
                      Connection
                    </div>
                  </TableHead>
                  <TableHead className="text-muted-foreground">Interface</TableHead>
                  <TableHead className="text-muted-foreground">Allowed Address</TableHead>
                  <TableHead className="text-muted-foreground">Public IP</TableHead>
                  <TableHead className="text-muted-foreground">Traffic</TableHead>
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

                      {/* Connection Status Column */}
                      <TableCell>
                        {isDisabled ? (
                          <div className="flex items-center gap-2">
                            <WifiOff className="w-4 h-4 text-muted-foreground" />
                            <span className="text-xs text-muted-foreground">Disabled</span>
                          </div>
                        ) : isPeerConnected(peer) ? (
                          <div className="flex items-center gap-2">
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                            </span>
                            <span className="text-xs text-emerald-400 font-medium">Online</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="relative flex h-2.5 w-2.5">
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500/50"></span>
                              </span>
                              <span className="text-xs text-amber-400">Offline</span>
                            </div>
                            <span className="text-[10px] text-muted-foreground ml-4">
                              {formatLastHandshake(peer)}
                            </span>
                          </div>
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
                          <div className="flex flex-col gap-1">
                            {timeRemaining ? (
                              <Badge
                                variant="outline"
                                className={expired ? "text-red-400 border-red-400" : "text-amber-400 border-amber-400"}
                              >
                                <Timer className="w-3 h-3 mr-1" />
                                {timeRemaining}
                              </Badge>
                            ) : null}
                            {meta?.scheduled_enable_at && (
                              <Badge
                                variant="outline"
                                className="text-emerald-400 border-emerald-400"
                              >
                                <Calendar className="w-3 h-3 mr-1" />
                                Enable: {formatDate(meta.scheduled_enable_at)}
                              </Badge>
                            )}
                            {!timeRemaining && !meta?.scheduled_enable_at && (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </div>
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
                              {/* Show Renew button for expired peers */}
                              {expired && isDisabled && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => {
                                    setRenewingPeer(peer);
                                    setRenewValue(meta?.expiration_value || 24);
                                    setRenewUnit(meta?.expiration_unit || "hours");
                                    setRenewDialogOpen(true);
                                  }}
                                  title="Renew expired peer"
                                  className="text-amber-400 hover:text-amber-300"
                                >
                                  <RotateCcw className="w-4 h-4" />
                                </Button>
                              )}
                              {/* Show Edit Expiration button for peers with canAutoExpire permission */}
                              {canAutoExpire && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditExpiration(peer)}
                                  title="Edit expiration"
                                  className={meta?.auto_disable_enabled ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"}
                                >
                                  <CalendarClock className="w-4 h-4" />
                                </Button>
                              )}
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
                              {canDelete && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleDeletePeer(peer[".id"], peer["public-key"])}
                                  className="text-destructive hover:text-destructive"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              )}
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
                <PopoverContent
                  className="w-[300px] p-0 z-[9999]"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  onWheel={(e) => e.stopPropagation()}
                  style={{ pointerEvents: 'auto' }}
                >
                  <Command className="border-0">
                    <CommandInput placeholder="Type IP to search..." className="font-mono" />
                    <CommandList
                      className="max-h-[200px] overflow-y-auto"
                      onWheel={(e) => {
                        e.stopPropagation();
                        const target = e.currentTarget;
                        target.scrollTop += e.deltaY;
                      }}
                    >
                      <CommandEmpty>No IP found.</CommandEmpty>
                      {/* Header row with titles */}
                      <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted-foreground border-b border-border">
                        <span className="flex-1">IP Address</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            Peers
                          </span>
                          <span className="flex items-center gap-1">
                            <Network className="h-3 w-3" />
                            Proxies
                          </span>
                        </div>
                      </div>
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
                            <span className="flex-1">{ip.public_ip}</span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (peerCountByIp[ip.public_ip] > 0) {
                                    setSelectedIpForModal(ip.public_ip);
                                    setIpPeersModalOpen(true);
                                  }
                                }}
                                className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded min-w-[40px] justify-center transition-all duration-150 ${
                                  peerCountByIp[ip.public_ip] > 0
                                    ? "text-cyan-400 hover:bg-cyan-400/20 hover:scale-110 cursor-pointer"
                                    : "text-muted-foreground cursor-default"
                                }`}
                                title={peerCountByIp[ip.public_ip] > 0 ? "Click to view peers" : "No peers"}
                              >
                                <Users className="h-3 w-3" />
                                {peerCountByIp[ip.public_ip] || 0}
                              </button>
                              <span className={`flex items-center gap-1 text-xs min-w-[40px] justify-center transition-all duration-150 ${
                                socksCountByIp[ip.public_ip] > 0
                                  ? "text-emerald-400 hover:scale-110"
                                  : "text-muted-foreground"
                              }`}>
                                <Network className="h-3 w-3" />
                                {socksCountByIp[ip.public_ip] || 0}
                              </span>
                            </div>
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
                      value={expirationValue}
                      onChange={(e) => setExpirationValue(parseInt(e.target.value) || 1)}
                      className="bg-secondary border-border w-24"
                    />
                    <Select value={expirationUnit} onValueChange={(v) => setExpirationUnit(v as TimeUnit)}>
                      <SelectTrigger className="w-[120px] bg-secondary border-border">
                        <SelectValue placeholder="Unit" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="seconds">Seconds</SelectItem>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                        <SelectItem value="days">Days</SelectItem>
                        <SelectItem value="weeks">Weeks</SelectItem>
                        <SelectItem value="months">Months</SelectItem>
                        <SelectItem value="years">Years</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">{formatDuration(expirationValue, expirationUnit)}</span>
                    <div className="flex gap-2 ml-auto">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setExpirationValue(1); setExpirationUnit("days"); }}
                      >
                        1 day
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setExpirationValue(7); setExpirationUnit("days"); }}
                      >
                        7 days
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setExpirationValue(1); setExpirationUnit("months"); }}
                      >
                        1 month
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

      {/* Peer Management Dialog - WireGuard PC App Style */}
      <Dialog open={peerManageOpen} onOpenChange={setPeerManageOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{managingPeer?.name || "Peer Configuration"}</span>
              <div className="flex items-center gap-2">
                {!dialogEditMode ? (
                  <Button variant="outline" size="sm" onClick={toggleDialogEditMode} className="gap-1">
                    <Pencil className="w-4 h-4" />
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={toggleDialogEditMode}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveDialogEdit} disabled={dialogUpdating || publicKeyExists} className="gap-1">
                      {dialogUpdating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </DialogTitle>
            <DialogDescription>
              {dialogEditMode ? "Edit peer configuration" : "View and copy peer configuration"}
            </DialogDescription>
          </DialogHeader>

          {managingPeer && (
            <div className="space-y-4 py-4">
              {/* Peer Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-secondary rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">Interface</Label>
                  <p className="font-mono text-sm">{managingPeer.interface}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge variant="outline" className={(managingPeer.disabled === true || String(managingPeer.disabled) === "true") ? "text-red-400" : "text-emerald-400"}>
                    {(managingPeer.disabled === true || String(managingPeer.disabled) === "true") ? "Disabled" : "Enabled"}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Allowed Address</Label>
                  <p className="font-mono text-sm text-cyan-400">{managingPeer["allowed-address"]}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Public IP</Label>
                  <p className="font-mono text-sm text-emerald-400">{managingPeer.comment || "-"}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {/* Enable/Disable Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const isDisabled = managingPeer.disabled === true || String(managingPeer.disabled) === "true";
                    handleTogglePeer(managingPeer[".id"], isDisabled);
                    setPeerManageOpen(false);
                  }}
                  className="gap-1"
                >
                  {(managingPeer.disabled === true || String(managingPeer.disabled) === "true") ? (
                    <>
                      <Power className="w-4 h-4 text-emerald-400" />
                      Enable Peer
                    </>
                  ) : (
                    <>
                      <PowerOff className="w-4 h-4 text-amber-400" />
                      Disable Peer
                    </>
                  )}
                </Button>

                {/* Timer/Expiration Button */}
                {canAutoExpire && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      openEditExpiration(managingPeer);
                      setPeerManageOpen(false);
                    }}
                    className="gap-1"
                  >
                    <CalendarClock className="w-4 h-4 text-cyan-400" />
                    {peerMetadata[managingPeer["public-key"]]?.auto_disable_enabled ? "Edit Timer" : "Set Timer"}
                  </Button>
                )}

                {/* Renew if Expired */}
                {isPeerExpired(managingPeer) && (managingPeer.disabled === true || String(managingPeer.disabled) === "true") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const meta = peerMetadata[managingPeer["public-key"]];
                      setRenewingPeer(managingPeer);
                      setRenewValue(meta?.expiration_value || 24);
                      setRenewUnit(meta?.expiration_unit || "hours");
                      setRenewDialogOpen(true);
                      setPeerManageOpen(false);
                    }}
                    className="gap-1 text-amber-400 border-amber-400 hover:bg-amber-400/10"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Renew Expired
                  </Button>
                )}

                {/* Show expiration info if set */}
                {peerMetadata[managingPeer["public-key"]]?.expires_at && (
                  <Badge
                    variant="outline"
                    className={isPeerExpired(managingPeer) ? "text-red-400 border-red-400" : "text-amber-400 border-amber-400"}
                  >
                    <Timer className="w-3 h-3 mr-1" />
                    {getTimeRemaining(managingPeer)}
                  </Badge>
                )}
              </div>

              {/* Config Editor - Textarea Style */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>WireGuard Configuration</Label>
                  <div className="flex gap-2">
                    {dialogEditMode && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRegenerateKeys}
                        disabled={regeneratingKeys}
                        className="gap-1"
                      >
                        <Key className={`w-3 h-3 ${regeneratingKeys ? "animate-spin" : ""}`} />
                        New Keys
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(dialogEditMode ? editConfigText : generateConfig(managingPeer));
                        toast.success("Configuration copied to clipboard");
                      }}
                      className="gap-1"
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadConfig(managingPeer)}
                      className="gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={dialogEditMode ? editConfigText : generateConfig(managingPeer)}
                  onChange={(e) => {
                    if (dialogEditMode) {
                      handleConfigTextChange(e.target.value);
                    }
                  }}
                  readOnly={!dialogEditMode}
                  className={`font-mono text-xs bg-secondary border-border h-[300px] resize-none ${dialogEditMode ? "bg-background" : ""}`}
                  placeholder="[Interface]
PrivateKey = ...
Address = ...
DNS = 8.8.8.8

[Peer]
PublicKey = ...
AllowedIPs = 0.0.0.0/0
Endpoint = ...
PersistentKeepalive = 25"
                />
                {dialogEditMode && (
                  <p className="text-xs text-muted-foreground">
                    Edit the configuration directly. Changes to PrivateKey, Address, and DNS will be applied.
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPeerManageOpen(false)}>
              Close
            </Button>
            {!dialogEditMode && canDelete && (
              <Button
                variant="destructive"
                onClick={() => {
                  if (managingPeer) {
                    handleDeletePeer(managingPeer[".id"], managingPeer["public-key"]);
                  }
                }}
                className="gap-1"
              >
                <Trash2 className="w-4 h-4" />
                Delete Peer
              </Button>
            )}
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
                <div className="flex gap-2 flex-wrap">
                  {[
                    { value: 1, unit: "days" as TimeUnit, label: "1d" },
                    { value: 2, unit: "days" as TimeUnit, label: "2d" },
                    { value: 1, unit: "weeks" as TimeUnit, label: "1w" },
                    { value: 1, unit: "months" as TimeUnit, label: "1mo" },
                  ].map(({ value, unit, label }) => (
                    <Button
                      key={label}
                      variant={renewValue === value && renewUnit === unit ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setRenewValue(value); setRenewUnit(unit); }}
                      className="w-full"
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <Label className="text-sm">Custom:</Label>
                  <Input
                    type="number"
                    value={renewValue}
                    onChange={(e) => setRenewValue(parseInt(e.target.value) || 1)}
                    className="w-24 bg-secondary"
                    min={1}
                  />
                  <Select value={renewUnit} onValueChange={(v) => setRenewUnit(v as TimeUnit)}>
                    <SelectTrigger className="w-[120px] bg-secondary border-border">
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seconds">Seconds</SelectItem>
                      <SelectItem value="minutes">Minutes</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="weeks">Weeks</SelectItem>
                      <SelectItem value="months">Months</SelectItem>
                      <SelectItem value="years">Years</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">{formatDuration(renewValue, renewUnit)}</span>
                </div>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-sm text-amber-400">
                  The peer will be enabled and set to expire in {formatDuration(renewValue, renewUnit)}.
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

      {/* Edit Expiration Dialog */}
      <Dialog open={editExpirationOpen} onOpenChange={setEditExpirationOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-cyan-400" />
              Edit Expiration Settings
            </DialogTitle>
            <DialogDescription>
              Configure auto-disable and scheduled enable for this peer.
            </DialogDescription>
          </DialogHeader>
          {editingExpirationPeer && (
            <div className="space-y-4 py-4">
              {/* Peer Info */}
              <div className="p-4 bg-secondary rounded-lg space-y-2">
                <p className="font-medium">{editingExpirationPeer.name || "Unnamed Peer"}</p>
                <p className="text-sm text-muted-foreground font-mono">{editingExpirationPeer["allowed-address"]}</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={editingExpirationPeer.disabled ? "text-red-400" : "text-emerald-400"}>
                    {editingExpirationPeer.disabled ? "Disabled" : "Enabled"}
                  </Badge>
                  {peerMetadata[editingExpirationPeer["public-key"]]?.expires_at && (
                    <Badge variant="outline" className={isPeerExpired(editingExpirationPeer) ? "text-red-400 border-red-400" : "text-amber-400 border-amber-400"}>
                      <Timer className="w-3 h-3 mr-1" />
                      {getTimeRemaining(editingExpirationPeer)}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Auto-Disable Section */}
              <div className="space-y-3 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editExpEnabled"
                    checked={editExpEnabled}
                    onChange={(e) => setEditExpEnabled(e.target.checked)}
                    className="rounded border-border"
                  />
                  <Label htmlFor="editExpEnabled" className="flex items-center gap-2 cursor-pointer">
                    <Timer className="w-4 h-4 text-amber-400" />
                    Enable Auto-Disable
                  </Label>
                </div>

                {editExpEnabled && (
                  <div className="space-y-3 pl-6">
                    <p className="text-sm text-muted-foreground">
                      The peer will be automatically disabled after the specified time.
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {[
                        { value: 1, unit: "days" as TimeUnit, label: "1d" },
                        { value: 2, unit: "days" as TimeUnit, label: "2d" },
                        { value: 1, unit: "weeks" as TimeUnit, label: "1w" },
                        { value: 1, unit: "months" as TimeUnit, label: "1mo" },
                      ].map(({ value, unit, label }) => (
                        <Button
                          key={label}
                          variant={editExpValue === value && editExpUnit === unit ? "default" : "outline"}
                          size="sm"
                          onClick={() => { setEditExpValue(value); setEditExpUnit(unit); }}
                          className="w-full"
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm">Custom:</Label>
                      <Input
                        type="number"
                        value={editExpValue}
                        onChange={(e) => setEditExpValue(parseInt(e.target.value) || 1)}
                        className="w-24 bg-secondary"
                        min={1}
                      />
                      <Select value={editExpUnit} onValueChange={(v) => setEditExpUnit(v as TimeUnit)}>
                        <SelectTrigger className="w-[120px] bg-secondary border-border">
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="seconds">Seconds</SelectItem>
                          <SelectItem value="minutes">Minutes</SelectItem>
                          <SelectItem value="hours">Hours</SelectItem>
                          <SelectItem value="days">Days</SelectItem>
                          <SelectItem value="weeks">Weeks</SelectItem>
                          <SelectItem value="months">Months</SelectItem>
                          <SelectItem value="years">Years</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-sm text-muted-foreground">{formatDuration(editExpValue, editExpUnit)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Scheduled Enable Section */}
              <div className="space-y-3 border border-border rounded-lg p-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editExpScheduledEnable"
                    checked={editExpScheduledEnable}
                    onChange={(e) => setEditExpScheduledEnable(e.target.checked)}
                    className="rounded border-border"
                  />
                  <Label htmlFor="editExpScheduledEnable" className="flex items-center gap-2 cursor-pointer">
                    <Calendar className="w-4 h-4 text-emerald-400" />
                    Schedule Auto-Enable
                  </Label>
                </div>

                {editExpScheduledEnable && (
                  <div className="space-y-3 pl-6">
                    <p className="text-sm text-muted-foreground">
                      The peer will be automatically enabled at the specified date/time.
                    </p>
                    <Input
                      type="datetime-local"
                      value={editExpEnableDate}
                      onChange={(e) => setEditExpEnableDate(e.target.value)}
                      className="bg-secondary"
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </div>
                )}
              </div>

              {/* Summary */}
              {(editExpEnabled || editExpScheduledEnable) && (
                <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg space-y-1">
                  <p className="text-sm font-medium text-cyan-400">Summary</p>
                  {editExpEnabled && (
                    <p className="text-sm text-muted-foreground">
                      Peer will auto-disable in {formatDuration(editExpValue, editExpUnit)}
                    </p>
                  )}
                  {editExpScheduledEnable && editExpEnableDate && (
                    <p className="text-sm text-muted-foreground">
                      Peer will auto-enable at {new Date(editExpEnableDate).toLocaleString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditExpirationOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveExpiration} disabled={savingExpiration} className="gap-2">
              {savingExpiration ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Settings
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peers by IP Modal (from IP selector) */}
      <Dialog open={ipPeersModalOpen} onOpenChange={setIpPeersModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Peers using {selectedIpForModal}</DialogTitle>
            <DialogDescription>
              {peersByIp[selectedIpForModal]?.length || 0} peer(s) configured with this public IP. Click on a peer to view details.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {(!peersByIp[selectedIpForModal] || peersByIp[selectedIpForModal].length === 0) ? (
              <p className="text-muted-foreground text-center py-8">No peers found for this IP</p>
            ) : (
              peersByIp[selectedIpForModal].map((peer) => {
                const isDisabled = peer.disabled === true || String(peer.disabled) === "true";
                const isConnected = isPeerConnected(peer);
                return (
                  <div
                    key={peer[".id"]}
                    className={`p-4 rounded-lg border ${
                      isDisabled ? "border-red-500/30 bg-red-500/5" : "border-border bg-card"
                    } hover:bg-accent/50 cursor-pointer transition-colors`}
                    onClick={() => {
                      setSelectedPeer(peer);
                      setViewConfigOpen(true);
                      setIpPeersModalOpen(false);
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            isDisabled ? "bg-red-500" : isConnected ? "bg-green-500" : "bg-gray-500"
                          }`} />
                          <span className="font-medium">{peer.name || "Unnamed"}</span>
                          {isDisabled && <Badge variant="destructive" className="text-xs">Disabled</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground font-mono mt-1">
                          {peer["allowed-address"]}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-cyan-500 hover:text-cyan-400 hover:bg-cyan-500/20 hover:scale-110 transition-all duration-150"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Close modal first, then open config with delay
                            setIpPeersModalOpen(false);
                            setTimeout(() => {
                              setSelectedPeer(peer);
                              setViewConfigOpen(true);
                            }, 100);
                          }}
                          title="View config"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 hover:scale-110 transition-all duration-150 ${isDisabled ? "text-green-500 hover:text-green-400 hover:bg-green-500/20" : "text-amber-500 hover:text-amber-400 hover:bg-amber-500/20"}`}
                          onClick={async (e) => {
                            e.stopPropagation();
                            const action = isDisabled ? "enablePeer" : "disablePeer";
                            try {
                              const res = await fetch("/api/wireguard", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action, routerId: selectedRouterId, data: { id: peer[".id"] } })
                              });
                              const data = await res.json();
                              if (data.success) {
                                toast.success(isDisabled ? "Peer enabled" : "Peer disabled");
                                fetchWireGuardData();
                              } else {
                                toast.error(data.error || "Failed");
                              }
                            } catch {
                              toast.error("Failed to toggle peer");
                            }
                          }}
                          title={isDisabled ? "Enable peer" : "Disable peer"}
                        >
                          {isDisabled ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
                        </Button>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-400 hover:bg-red-500/20 hover:scale-110 transition-all duration-150"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Delete peer "${peer.name || 'Unnamed'}"?`)) return;
                              try {
                                const res = await fetch("/api/wireguard", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterId, data: { id: peer[".id"] } })
                                });
                                const data = await res.json();
                                if (data.success) {
                                  toast.success("Peer deleted");
                                  fetchWireGuardData();
                                } else {
                                  toast.error(data.error || "Failed to delete");
                                }
                              } catch {
                                toast.error("Failed to delete peer");
                              }
                            }}
                            title="Delete peer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIpPeersModalOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
