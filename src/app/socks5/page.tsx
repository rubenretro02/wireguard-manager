"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import { StatCard } from "@/components/StatCard";
import {
  Server,
  Trash2,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Globe,
  Network,
  Play,
  Square,
  Download,
  Copy,
  Eye,
  EyeOff,
  Zap,
  Pencil,
  Users,
  Check,
  ChevronsUpDown,
  Power,
  PowerOff,
  Search,
  ArrowUpDown,
  Timer,
  Wifi,
  WifiOff,
  Activity,
  ArrowUp,
  User,
  Calendar,
  CalendarClock,
  RotateCcw,
  ExternalLink,
  TestTube,
  Signal,
} from "lucide-react";
import type { Profile, UserCapabilities, TimeUnit } from "@/lib/types";

const SOCKS5_LAST_ROUTER_KEY = "wg-socks5-last-router";

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

interface Router {
  id: string;
  name: string;
  host: string;
}

interface Socks5Proxy {
  id: string;
  router_id: string;
  username: string;
  password: string;
  public_ip: string;
  port: number;
  max_connections: number;
  enabled: boolean;
  created_at: string;
  created_by: string;
  name: string | null;
  expires_at: string | null;
  scheduled_enable: string | null;
  bytes_sent: number;
  bytes_received: number;
  last_connected_at: string | null;
  creator?: { email: string } | null;
}

interface Socks5Status {
  running: boolean;
  installed: boolean;
  connectionWarning?: string;
}

interface TestResult {
  success: boolean;
  ip?: string;
  error?: string;
  latency?: number;
}

export default function Socks5Page() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [routers, setRouters] = useState<Router[]>([]);
  const [selectedRouterId, setSelectedRouterId] = useState<string>("");
  const [proxies, setProxies] = useState<Socks5Proxy[]>([]);
  const [publicIps, setPublicIps] = useState<string[]>([]);
  const [status, setStatus] = useState<Socks5Status>({ running: false, installed: false });
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showPasswordFor, setShowPasswordFor] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);

  // Search and filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [sortBy, setSortBy] = useState<"created" | "traffic" | "name">("created");

  // Form state
  const [newProxy, setNewProxy] = useState({
    name: "",
    username: "",
    password: "",
    publicIp: "",
    port: "1080",
    maxConnections: "0",
  });

  // Expiration settings
  const [enableExpiration, setEnableExpiration] = useState(false);
  const [expirationValue, setExpirationValue] = useState<number>(24);
  const [expirationUnit, setExpirationUnit] = useState<TimeUnit>("hours");

  // Edit state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingProxy, setEditingProxy] = useState<Socks5Proxy | null>(null);
  const [editForm, setEditForm] = useState({ name: "", password: "", maxConnections: "0" });

  // Edit expiration dialog
  const [editExpirationOpen, setEditExpirationOpen] = useState(false);
  const [editingExpirationProxy, setEditingExpirationProxy] = useState<Socks5Proxy | null>(null);
  const [editExpEnabled, setEditExpEnabled] = useState(false);
  const [editExpValue, setEditExpValue] = useState<number>(24);
  const [editExpUnit, setEditExpUnit] = useState<TimeUnit>("hours");
  const [editExpScheduledEnable, setEditExpScheduledEnable] = useState(false);
  const [editExpEnableDate, setEditExpEnableDate] = useState<string>("");
  const [savingExpiration, setSavingExpiration] = useState(false);

  // Renew dialog
  const [renewDialogOpen, setRenewDialogOpen] = useState(false);
  const [renewingProxy, setRenewingProxy] = useState<Socks5Proxy | null>(null);
  const [renewValue, setRenewValue] = useState<number>(24);
  const [renewUnit, setRenewUnit] = useState<TimeUnit>("hours");
  const [renewing, setRenewing] = useState(false);

  // Test proxy state
  const [testingProxyId, setTestingProxyId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  // Active connections state (real-time)
  const [activeConnections, setActiveConnections] = useState<Record<string, number>>({});

  // Proxy details dialog state
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedProxyForDetails, setSelectedProxyForDetails] = useState<Socks5Proxy | null>(null);

  // Loading states
  const [updating, setUpdating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [startingService, setStartingService] = useState(false);
  const [stoppingService, setStoppingService] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [ipComboboxOpen, setIpComboboxOpen] = useState(false);

  // Peer count per IP state
  const [peerCountByIp, setPeerCountByIp] = useState<Record<string, number>>({});
  const [peersByIp, setPeersByIp] = useState<Record<string, Array<{ id: string; name: string; address: string; disabled: boolean }>>>({});

  // Peers modal state
  const [ipPeersModalOpen, setIpPeersModalOpen] = useState(false);
  const [selectedIpForModal, setSelectedIpForModal] = useState<string>("");

  // SOCKS5 proxy count per IP
  const socksCountByIp = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const proxy of proxies) {
      const ip = proxy.public_ip;
      if (ip) {
        counts[ip] = (counts[ip] || 0) + 1;
      }
    }
    return counts;
  }, [proxies]);

  // Creator emails map
  const [creatorEmails, setCreatorEmails] = useState<Record<string, string>>({});

  // Stats calculation
  const stats = useMemo(() => {
    const total = proxies.length;
    const active = proxies.filter(p => p.enabled).length;
    const disabled = total - active;
    const withTimer = proxies.filter(p => p.expires_at).length;
    // Count online proxies based on active connections
    const online = proxies.filter(p => {
      const connections = activeConnections[p.public_ip];
      return connections && connections > 0;
    }).length;
    const totalBytesReceived = proxies.reduce((sum, p) => sum + (p.bytes_received || 0), 0);
    const totalBytesSent = proxies.reduce((sum, p) => sum + (p.bytes_sent || 0), 0);

    return { total, active, disabled, withTimer, online, totalBytesReceived, totalBytesSent };
  }, [proxies, activeConnections]);

  // Filter proxies
  const filteredProxies = useMemo(() => {
    let filtered = proxies;

    // Filter by ownership for non-admins
    if (!isAdmin && currentUser) {
      filtered = filtered.filter(p => p.created_by === currentUser.id);
    }

    // Apply status filter
    filtered = filtered.filter(proxy => {
      const isOnline = proxy.last_connected_at &&
        new Date(proxy.last_connected_at) > new Date(Date.now() - 3 * 60 * 1000);

      if (statusFilter === "online" && !isOnline) return false;
      if (statusFilter === "enabled" && !proxy.enabled) return false;
      if (statusFilter === "disabled" && proxy.enabled) return false;
      if (statusFilter === "with-timer" && !proxy.expires_at) return false;
      return true;
    });

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(proxy => {
        return (
          proxy.username.toLowerCase().includes(query) ||
          proxy.public_ip.toLowerCase().includes(query) ||
          (proxy.name && proxy.name.toLowerCase().includes(query))
        );
      });
    }

    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case "created": {
          const dateA = new Date(a.created_at).getTime();
          const dateB = new Date(b.created_at).getTime();
          comparison = dateB - dateA;
          break;
        }
        case "traffic": {
          const trafficA = (a.bytes_sent || 0) + (a.bytes_received || 0);
          const trafficB = (b.bytes_sent || 0) + (b.bytes_received || 0);
          comparison = trafficB - trafficA;
          break;
        }
        case "name": {
          const nameA = (a.name || a.username).toLowerCase();
          const nameB = (b.name || b.username).toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
      }
      return sortOrder === "asc" ? -comparison : comparison;
    });

    return sorted;
  }, [proxies, isAdmin, currentUser, statusFilter, searchQuery, sortBy, sortOrder]);

  // Check auth and load routers
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profile) {
        router.push("/login");
        return;
      }

      setCurrentUser(profile as Profile);
      const userIsAdmin = profile?.role === "admin";
      setIsAdmin(userIsAdmin);

      let loadedRouters: Router[] = [];

      if (userIsAdmin) {
        const { data: routersData } = await supabase
          .from("routers")
          .select("id, name, host")
          .order("name");
        loadedRouters = routersData || [];
      } else {
        const { data: accessData } = await supabase
          .from("user_socks5_server_access")
          .select("router_id, routers(id, name, host)")
          .eq("user_id", user.id);

        if (!accessData || accessData.length === 0) {
          toast.error("No SOCKS5 server access. Contact an admin.");
          router.push("/dashboard");
          return;
        }

        loadedRouters = accessData
          .map((a: { routers: Router | null }) => a.routers)
          .filter((r: Router | null): r is Router => r !== null);
      }

      setRouters(loadedRouters);

      if (loadedRouters.length > 0) {
        const lastRouter = localStorage.getItem(SOCKS5_LAST_ROUTER_KEY);
        const routerExists = loadedRouters.some((r: Router) => r.id === lastRouter);
        if (lastRouter && routerExists) {
          setSelectedRouterId(lastRouter);
        } else {
          setSelectedRouterId(loadedRouters[0].id);
        }
      }

      setLoading(false);
    };

    checkAuth();
  }, [router]);

  // Load proxies and status when router is selected
  const loadProxiesAndStatus = useCallback(async () => {
    if (!selectedRouterId) return;

    setRefreshing(true);
    try {
      const statusRes = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getStatus", routerId: selectedRouterId }),
      });
      const statusData = await statusRes.json();

      if (statusData.error) {
        if (!statusData.status?.installed) {
          toast.error(`Error: ${statusData.error}`);
        }
        setStatus(statusData.status || { running: false, installed: false });
      } else if (statusData.status) {
        if (statusData.warning) {
          setStatus({ ...statusData.status, connectionWarning: statusData.warning });
        } else {
          setStatus(statusData.status);
        }
      }

      if (statusData.publicIps) {
        setPublicIps(statusData.publicIps);
      }

      const proxiesRes = await fetch(`/api/socks5?routerId=${selectedRouterId}`);
      const proxiesData = await proxiesRes.json();

      if (proxiesData.error) {
        toast.error(`Error: ${proxiesData.error}`);
        setProxies([]);
      } else if (proxiesData.proxies) {
        setProxies(proxiesData.proxies);

        // Fetch creator emails
        const creatorIds = [...new Set(proxiesData.proxies.map((p: Socks5Proxy) => p.created_by))];
        if (creatorIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("id, email")
            .in("id", creatorIds);

          if (profiles) {
            const emailMap: Record<string, string> = {};
            for (const p of profiles) {
              emailMap[p.id] = p.email;
            }
            setCreatorEmails(emailMap);
          }
        }
      }
    } catch (error) {
      console.error("Error loading SOCKS5 data:", error);
      toast.error("Error loading SOCKS5 data");
    } finally {
      setRefreshing(false);
    }
  }, [selectedRouterId, supabase]);

  useEffect(() => {
    loadProxiesAndStatus();
  }, [loadProxiesAndStatus]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!selectedRouterId) return;
    const interval = setInterval(() => {
      loadProxiesAndStatus();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedRouterId, loadProxiesAndStatus]);

  // Polling for active connections every 5 seconds
  const fetchActiveConnections = useCallback(async () => {
    if (!selectedRouterId) return;

    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getActiveConnections", routerId: selectedRouterId }),
      });
      const data = await res.json();

      if (data.success && data.activeConnections) {
        setActiveConnections(data.activeConnections);
      }
    } catch (error) {
      console.error("Error fetching active connections:", error);
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (!selectedRouterId) return;

    // Fetch immediately
    fetchActiveConnections();

    // Then poll every 5 seconds
    const interval = setInterval(() => {
      fetchActiveConnections();
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedRouterId, fetchActiveConnections]);

  // Auto-disable expired proxies
  const autoDisableExpiredProxies = useCallback(async () => {
    if (!selectedRouterId || proxies.length === 0) return;

    const now = new Date();
    const proxiesToDisable: Socks5Proxy[] = [];
    const proxiesToEnable: Socks5Proxy[] = [];

    for (const proxy of proxies) {
      if (proxy.expires_at && proxy.enabled) {
        const expiresAt = new Date(proxy.expires_at);
        if (expiresAt < now) {
          proxiesToDisable.push(proxy);
        }
      }

      if (proxy.scheduled_enable && !proxy.enabled) {
        const scheduledEnable = new Date(proxy.scheduled_enable);
        if (scheduledEnable <= now) {
          proxiesToEnable.push(proxy);
        }
      }
    }

    let hasChanges = false;

    for (const proxy of proxiesToDisable) {
      try {
        const res = await fetch("/api/socks5", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "toggleProxy",
            routerId: selectedRouterId,
            proxyId: proxy.id,
            enabled: false,
          }),
        });
        const data = await res.json();
        if (data.success) {
          toast.info(`Proxy "${proxy.name || proxy.username}" auto-disabled (expired)`);
          hasChanges = true;
        }
      } catch (err) {
        console.error("Failed to auto-disable proxy:", err);
      }
    }

    for (const proxy of proxiesToEnable) {
      try {
        const res = await fetch("/api/socks5", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "toggleProxy",
            routerId: selectedRouterId,
            proxyId: proxy.id,
            enabled: true,
            clearScheduledEnable: true,
          }),
        });
        const data = await res.json();
        if (data.success) {
          toast.info(`Proxy "${proxy.name || proxy.username}" auto-enabled (scheduled)`);
          hasChanges = true;
        }
      } catch (err) {
        console.error("Failed to auto-enable proxy:", err);
      }
    }

    if (hasChanges) {
      loadProxiesAndStatus();
    }
  }, [selectedRouterId, proxies, loadProxiesAndStatus]);

  // Run auto-disable check periodically
  useEffect(() => {
    if (proxies.length > 0) {
      autoDisableExpiredProxies();
    }
    const intervalId = setInterval(() => {
      if (proxies.length > 0) {
        autoDisableExpiredProxies();
      }
    }, 60000);
    return () => clearInterval(intervalId);
  }, [proxies.length, autoDisableExpiredProxies]);

  // Fetch peer counts for each public IP
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
        const counts: Record<string, number> = {};
        const grouped: Record<string, Array<{ id: string; name: string; address: string; disabled: boolean }>> = {};
        for (const peer of data.peers) {
          const comment = peer.comment || "";
          if (comment) {
            counts[comment] = (counts[comment] || 0) + 1;
            if (!grouped[comment]) grouped[comment] = [];
            grouped[comment].push({
              id: peer[".id"],
              name: peer.name || "Unnamed",
              address: peer["allowed-address"] || "",
              disabled: peer.disabled === true || String(peer.disabled) === "true"
            });
          }
        }
        setPeerCountByIp(counts);
        setPeersByIp(grouped);
      }
    } catch (err) {
      console.error("Failed to fetch peer counts:", err);
    }
  }, [selectedRouterId]);

  useEffect(() => {
    if (selectedRouterId) {
      fetchPeerCounts();
    }
  }, [selectedRouterId, fetchPeerCounts]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Install 3proxy (admin only)
  const handleInstall = async () => {
    if (!selectedRouterId || !isAdmin) return;

    setInstalling(true);
    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install", routerId: selectedRouterId }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("3proxy installed successfully");
        await loadProxiesAndStatus();
      } else {
        toast.error(data.message || "Installation failed");
      }
    } catch (error) {
      toast.error("Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  // Start/Stop 3proxy (admin only)
  const handleToggleService = async (action: "start" | "stop") => {
    if (!selectedRouterId || !isAdmin) return;

    if (action === "start") {
      setStartingService(true);
    } else {
      setStoppingService(true);
    }

    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, routerId: selectedRouterId }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`3proxy ${action === "start" ? "started" : "stopped"}`);
        await loadProxiesAndStatus();
      } else {
        toast.error(data.message || `Failed to ${action}`);
      }
    } catch (error) {
      toast.error(`Failed to ${action}`);
    } finally {
      setStartingService(false);
      setStoppingService(false);
    }
  };

  // Sync proxies from server (admin only)
  const handleSyncFromServer = async () => {
    if (!selectedRouterId || !isAdmin) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "syncFromServer", routerId: selectedRouterId }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Synced: ${data.added} added, ${data.removed} removed`);
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Sync failed");
      }
    } catch (error) {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Toggle proxy enabled/disabled
  const handleToggleProxy = async (proxy: Socks5Proxy) => {
    if (!isAdmin && proxy.created_by !== currentUser?.id) {
      toast.error("You can only manage your own proxies");
      return;
    }

    // If trying to enable an expired proxy, show renew dialog
    if (!proxy.enabled && proxy.expires_at) {
      const expiresAt = new Date(proxy.expires_at);
      if (expiresAt < new Date()) {
        setRenewingProxy(proxy);
        setRenewValue(24);
        setRenewUnit("hours");
        setRenewDialogOpen(true);
        return;
      }
    }

    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggleProxy",
          routerId: selectedRouterId,
          proxyId: proxy.id,
          enabled: !proxy.enabled,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(proxy.enabled ? "Proxy suspended" : "Proxy enabled");
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to toggle proxy");
      }
    } catch (error) {
      toast.error("Failed to toggle proxy");
    }
  };

  // Renew expired proxy
  const handleRenewProxy = async () => {
    if (!renewingProxy || !selectedRouterId) return;

    setRenewing(true);
    try {
      // Calculate new expiration
      const newExpiresAt = new Date();
      newExpiresAt.setTime(newExpiresAt.getTime() + convertToMilliseconds(renewValue, renewUnit));

      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "renewProxy",
          routerId: selectedRouterId,
          proxyId: renewingProxy.id,
          expiresAt: newExpiresAt.toISOString(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(`Proxy renewed for ${formatDuration(renewValue, renewUnit)}`);
        setRenewDialogOpen(false);
        setRenewingProxy(null);
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to renew proxy");
      }
    } catch (error) {
      toast.error("Failed to renew proxy");
    } finally {
      setRenewing(false);
    }
  };

  // Test proxy
  const handleTestProxy = async (proxy: Socks5Proxy) => {
    setTestingProxyId(proxy.id);
    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "testProxy",
          routerId: selectedRouterId,
          proxyId: proxy.id,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setTestResults(prev => ({
          ...prev,
          [proxy.id]: { success: true, ip: data.ip, latency: data.latency }
        }));
        toast.success(`Proxy working! Exit IP: ${data.ip}`);
      } else {
        setTestResults(prev => ({
          ...prev,
          [proxy.id]: { success: false, error: data.error }
        }));
        toast.error(data.error || "Proxy test failed");
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [proxy.id]: { success: false, error: "Test failed" }
      }));
      toast.error("Proxy test failed");
    } finally {
      setTestingProxyId(null);
    }
  };

  // Create proxy
  const handleCreateProxy = async () => {
    if (!selectedRouterId || !newProxy.username || !newProxy.password || !newProxy.publicIp) {
      toast.error("All fields are required");
      return;
    }

    setCreating(true);
    try {
      let expiresAt: string | null = null;
      if (enableExpiration && expirationValue > 0) {
        const expDate = new Date();
        expDate.setTime(expDate.getTime() + convertToMilliseconds(expirationValue, expirationUnit));
        expiresAt = expDate.toISOString();
      }

      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createProxy",
          routerId: selectedRouterId,
          name: newProxy.name || null,
          username: newProxy.username,
          password: newProxy.password,
          publicIp: newProxy.publicIp,
          maxConnections: parseInt(newProxy.maxConnections) || 0,
          expiresAt,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("SOCKS5 proxy created");
        setShowCreateDialog(false);
        setNewProxy({ name: "", username: "", password: "", publicIp: "", port: "1080", maxConnections: "0" });
        setEnableExpiration(false);
        setExpirationValue(24);
        setExpirationUnit("hours");
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to create proxy");
      }
    } catch (error) {
      toast.error("Failed to create proxy");
    } finally {
      setCreating(false);
    }
  };

  // Edit proxy
  const openEditDialog = (proxy: Socks5Proxy) => {
    if (!isAdmin && proxy.created_by !== currentUser?.id) {
      toast.error("You can only edit your own proxies");
      return;
    }
    setEditingProxy(proxy);
    setEditForm({
      name: proxy.name || "",
      password: proxy.password,
      maxConnections: String(proxy.max_connections || 0)
    });
    setShowEditDialog(true);
  };

  const handleUpdateProxy = async () => {
    if (!editingProxy) return;

    setUpdating(true);
    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateProxy",
          routerId: selectedRouterId,
          proxyId: editingProxy.id,
          name: editForm.name || null,
          password: editForm.password,
          maxConnections: parseInt(editForm.maxConnections) || 0,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("Proxy updated");
        setShowEditDialog(false);
        setEditingProxy(null);
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to update proxy");
      }
    } catch (error) {
      toast.error("Failed to update proxy");
    } finally {
      setUpdating(false);
    }
  };

  // Edit expiration
  const openEditExpiration = (proxy: Socks5Proxy) => {
    setEditingExpirationProxy(proxy);
    setEditExpEnabled(!!proxy.expires_at);
    setEditExpValue(24);
    setEditExpUnit("hours");
    setEditExpScheduledEnable(!!proxy.scheduled_enable);
    setEditExpEnableDate(proxy.scheduled_enable ? new Date(proxy.scheduled_enable).toISOString().slice(0, 16) : "");
    setEditExpirationOpen(true);
  };

  const handleSaveExpiration = async () => {
    if (!editingExpirationProxy || !selectedRouterId) return;

    setSavingExpiration(true);
    try {
      let expiresAt: string | null = null;
      let scheduledEnable: string | null = null;

      if (editExpEnabled && editExpValue > 0) {
        const expDate = new Date();
        expDate.setTime(expDate.getTime() + convertToMilliseconds(editExpValue, editExpUnit));
        expiresAt = expDate.toISOString();
      }

      if (editExpScheduledEnable && editExpEnableDate) {
        scheduledEnable = new Date(editExpEnableDate).toISOString();
      }

      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateExpiration",
          routerId: selectedRouterId,
          proxyId: editingExpirationProxy.id,
          expiresAt,
          scheduledEnable,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success(editExpEnabled
          ? `Proxy will expire in ${formatDuration(editExpValue, editExpUnit)}`
          : "Expiration disabled"
        );
        setEditExpirationOpen(false);
        setEditingExpirationProxy(null);
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to save expiration");
      }
    } catch (error) {
      toast.error("Failed to save expiration");
    } finally {
      setSavingExpiration(false);
    }
  };

  // Delete proxy
  const handleDeleteProxy = async (proxy: Socks5Proxy) => {
    // Check if user has delete permission
    if (!canDelete) {
      toast.error("You don't have permission to delete proxies");
      return;
    }

    if (!isAdmin && proxy.created_by !== currentUser?.id) {
      toast.error("You can only delete your own proxies");
      return;
    }

    if (!confirm("Are you sure you want to delete this proxy?")) return;

    try {
      const res = await fetch("/api/socks5", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deleteProxy",
          routerId: selectedRouterId,
          proxyId: proxy.id,
        }),
      });
      const data = await res.json();

      if (data.success) {
        toast.success("Proxy deleted");
        await loadProxiesAndStatus();
      } else {
        toast.error(data.error || "Failed to delete proxy");
      }
    } catch (error) {
      toast.error("Failed to delete proxy");
    }
  };

  // Copy proxy string - format: ip:port:username:password
  const copyProxyString = (proxy: Socks5Proxy) => {
    const proxyString = `${proxy.public_ip}:1080:${proxy.username}:${proxy.password}`;
    navigator.clipboard.writeText(proxyString);
    toast.success("Proxy copied to clipboard");
  };

  // Get proxy string for display
  const getProxyString = (proxy: Socks5Proxy) => {
    return `${proxy.public_ip}:1080:${proxy.username}:${proxy.password}`;
  };

  // Generate random password
  const generatePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewProxy({ ...newProxy, password });
  };

  // Helper functions
  const canManageProxy = (proxy: Socks5Proxy) => {
    return isAdmin || proxy.created_by === currentUser?.id;
  };

  // Check if user can delete (requires can_delete capability)
  const canDelete = isAdmin || currentUser?.capabilities?.can_delete === true;

  const formatBytes = (bytes?: number | string) => {
    const numBytes = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
    if (!numBytes || isNaN(numBytes) || numBytes === 0) return "0 B";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(numBytes) / Math.log(1024));
    return `${(numBytes / 1024 ** i).toFixed(2)} ${sizes[i]}`;
  };

  const isProxyOnline = (proxy: Socks5Proxy) => {
    // Check if there are active connections for this proxy's IP
    const connections = activeConnections[proxy.public_ip];
    if (connections && connections > 0) {
      return true;
    }
    return false;
  };

  const isProxyExpired = (proxy: Socks5Proxy) => {
    if (!proxy.expires_at) return false;
    return new Date(proxy.expires_at) < new Date();
  };

  const getTimeRemaining = (proxy: Socks5Proxy) => {
    if (!proxy.expires_at) return null;
    const expiresAt = new Date(proxy.expires_at);
    const now = new Date();
    const diff = expiresAt.getTime() - now.getTime();
    if (diff <= 0) return "Expired";

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
  };

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

  const formatLastConnection = (dateString: string | null | undefined): string => {
    if (!dateString) return "Never";
    try {
      const date = new Date(dateString);
      const now = Date.now();
      const diff = now - date.getTime();

      if (diff < 0) return "Just now";
      if (diff < 60000) return "Just now";
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

      return date.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
    } catch {
      return "Never";
    }
  };

  if (loading) {
    return (
      <DashboardLayout
        userRole={currentUser?.role}
        userEmail={currentUser?.email}
        userCapabilities={currentUser?.capabilities}
        hasSocks5Access={true}
        onLogout={handleLogout}
      >
        <div className="flex items-center justify-center h-full min-h-[50vh]">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-500" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      userRole={currentUser?.role}
      userEmail={currentUser?.email}
      userCapabilities={currentUser?.capabilities}
      hasSocks5Access={true}
      onLogout={handleLogout}
    >
      <PageHeader
        title="SOCKS5 Proxies"
        description={isAdmin ? "Manage SOCKS5 proxy servers with dedicated public IPs" : "Create and manage your SOCKS5 proxy connections"}
      >
        <Select value={selectedRouterId} onValueChange={setSelectedRouterId}>
          <SelectTrigger className="w-[250px] bg-secondary border-border">
            <Server className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Select server" />
          </SelectTrigger>
          <SelectContent>
            {routers.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.name} ({r.host})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>
      <PageContent>
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            <StatCard
              title="Total Proxies"
              value={stats.total}
              subtitle={`${publicIps.length} IPs available`}
              icon={Network}
              iconColor="blue"
              onClick={() => setStatusFilter("all")}
              active={statusFilter === "all"}
            />
            <StatCard
              title="Recent Activity"
              value={stats.online}
              subtitle={stats.online > 0 ? "Last 3 min" : "None recent"}
              icon={Wifi}
              iconColor="emerald"
              pulse={stats.online > 0}
              onClick={() => setStatusFilter("online")}
              active={statusFilter === "online"}
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

          {/* Admin Status Card */}
          {isAdmin && selectedRouterId && (
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    3proxy Status
                  </span>
                  <div className="flex items-center gap-2">
                    {refreshing && (
                      <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                    )}
                    {status.installed ? (
                      <Badge variant={status.running ? "default" : "secondary"} className={status.running ? "bg-emerald-500" : ""}>
                        {status.running ? "Running" : "Stopped"}
                        {status.connectionWarning && " (estimated)"}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Not Installed</Badge>
                    )}
                  </div>
                </CardTitle>
                {status.connectionWarning && (
                  <CardDescription className="text-amber-500 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    SSH connection issue - status estimated from database
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {!status.installed ? (
                    <Button onClick={handleInstall} disabled={installing}>
                      {installing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Installing...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          Install 3proxy
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      {status.running ? (
                        <Button variant="outline" onClick={() => handleToggleService("stop")} disabled={stoppingService}>
                          {stoppingService ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Stopping...
                            </>
                          ) : (
                            <>
                              <Square className="w-4 h-4 mr-2" />
                              Stop
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button onClick={() => handleToggleService("start")} disabled={startingService}>
                          {startingService ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                              Starting...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" />
                              Start
                            </>
                          )}
                        </Button>
                      )}
                      <Button variant="outline" onClick={() => loadProxiesAndStatus()} disabled={refreshing}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                        Refresh
                      </Button>
                      <Button variant="outline" onClick={handleSyncFromServer} disabled={syncing}>
                        <Download className={`w-4 h-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                        Sync
                      </Button>
                    </>
                  )}
                </div>

                {publicIps.length > 0 && (
                  <div className="mt-4">
                    <Label className="text-sm text-gray-500">Available Public IPs ({publicIps.length})</Label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {publicIps.slice(0, 10).map((ip) => (
                        <Badge key={ip} variant="outline" className="text-xs">
                          {ip}
                        </Badge>
                      ))}
                      {publicIps.length > 10 && (
                        <Badge variant="outline" className="text-xs">
                          +{publicIps.length - 10} more
                        </Badge>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Proxies Table Card */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {/* Table Header */}
            <div className="px-6 py-4 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold">
                  Proxies
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({filteredProxies.length})
                  </span>
                </h2>
                {!isAdmin && (
                  <Badge variant="outline" className="text-xs">
                    <User className="w-3 h-3 mr-1" />
                    My Proxies
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search proxies..."
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
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="enabled">Enabled</SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="with-timer">With Timer</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as "created" | "traffic" | "name")}>
                  <SelectTrigger className="w-[120px] bg-secondary border-border">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="created">By Created</SelectItem>
                    <SelectItem value="traffic">By Traffic</SelectItem>
                    <SelectItem value="name">By Name</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
                >
                  <ArrowUpDown className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => loadProxiesAndStatus()}
                  disabled={refreshing}
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
                </Button>
                <Button onClick={() => setShowCreateDialog(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create Proxy
                </Button>
              </div>
            </div>

            {/* Table */}
            {filteredProxies.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                {searchQuery || statusFilter !== "all"
                  ? "No proxies match your filters"
                  : "No proxies found. Create your first proxy above."}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead className="text-muted-foreground">Name</TableHead>
                    <TableHead className="text-muted-foreground">Username</TableHead>
                    <TableHead className="text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Signal className="w-3 h-3" />
                        Status
                      </div>
                    </TableHead>
                    <TableHead className="text-muted-foreground">Host:Port</TableHead>
                    <TableHead className="text-muted-foreground">Traffic</TableHead>
                    <TableHead className="text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Created By
                      </div>
                    </TableHead>
                    <TableHead className="text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Timer className="w-3 h-3" />
                        Expires
                      </div>
                    </TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProxies.map((proxy) => {
                    const online = isProxyOnline(proxy);
                    const expired = isProxyExpired(proxy);
                    const timeRemaining = getTimeRemaining(proxy);
                    const canManage = canManageProxy(proxy);
                    const testResult = testResults[proxy.id];

                    return (
                      <TableRow
                        key={proxy.id}
                        className={`table-row-hover border-border ${expired ? "opacity-60" : ""} ${!canManage ? "opacity-70" : ""}`}
                      >
                        {/* Name Column */}
                        <TableCell className="font-medium">
                          <span>{proxy.name || "-"}</span>
                        </TableCell>

                        {/* Username Column */}
                        <TableCell className="font-mono text-sm">
                          {proxy.username}
                        </TableCell>

                        {/* Connection Status Column */}
                        <TableCell>
                          {!proxy.enabled ? (
                            // Disabled state - gray with WifiOff icon
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <WifiOff className="w-4 h-4 text-gray-500" />
                                <span className="text-xs text-gray-500">Disabled</span>
                              </div>
                            </div>
                          ) : online ? (
                            // Online state - green with animation (real active connections)
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                </span>
                                <span className="text-xs text-emerald-400 font-medium">Online</span>
                              </div>
                              {activeConnections[proxy.public_ip] && (
                                <span className="text-[10px] text-emerald-400/70 ml-4">
                                  {activeConnections[proxy.public_ip]} connection{activeConnections[proxy.public_ip] > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                          ) : (
                            // Offline state - yellow/orange with last connection time
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                                </span>
                                <span className="text-xs text-amber-400 font-medium">Offline</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground ml-4">
                                {proxy.last_connected_at ? formatLastConnection(proxy.last_connected_at) : "Never"}
                              </span>
                            </div>
                          )}
                        </TableCell>

                        {/* Host:Port Column */}
                        <TableCell className="font-mono text-sm text-cyan-400">
                          {proxy.public_ip}:1080
                        </TableCell>

                        {/* Traffic Column */}
                        <TableCell className="text-sm">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <ArrowUp className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400 text-xs">{formatBytes(proxy.bytes_sent)}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <ArrowUp className="w-3 h-3 text-blue-400 rotate-180" />
                              <span className="text-blue-400 text-xs">{formatBytes(proxy.bytes_received)}</span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Created By Column */}
                        <TableCell className="text-sm">
                          {creatorEmails[proxy.created_by] ? (
                            <span className="truncate max-w-[100px] block" title={creatorEmails[proxy.created_by]}>
                              {creatorEmails[proxy.created_by].split("@")[0]}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>

                        {/* Expires Column */}
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

                        {/* Status Column */}
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={!proxy.enabled ? "text-red-400 border-red-400" : "text-emerald-400 border-emerald-400"}
                          >
                            {proxy.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                        </TableCell>

                        {/* Actions Column */}
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* View proxy details */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setSelectedProxyForDetails(proxy);
                                setDetailsDialogOpen(true);
                              }}
                              title="View proxy details"
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            {/* Copy proxy string */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyProxyString(proxy)}
                              title="Copy proxy string"
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            {/* Test connection */}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTestProxy(proxy)}
                              disabled={testingProxyId === proxy.id || !proxy.enabled}
                              title="Test proxy connection and show exit IP"
                              className={`h-8 px-2 text-xs font-medium ${testResult?.success ? "text-emerald-400" : testResult?.error ? "text-red-400" : ""}`}
                            >
                              {testingProxyId === proxy.id ? (
                                <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                              ) : null}
                              Test Connection
                            </Button>
                            {canManage && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditDialog(proxy)}
                                  title="Edit proxy"
                                >
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => openEditExpiration(proxy)}
                                  title="Edit expiration"
                                  className={proxy.expires_at ? "text-amber-400" : ""}
                                >
                                  <CalendarClock className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleToggleProxy(proxy)}
                                  title={proxy.enabled ? "Suspend" : "Enable"}
                                >
                                  {proxy.enabled ? (
                                    <PowerOff className="w-4 h-4 text-amber-400" />
                                  ) : (
                                    <Power className="w-4 h-4 text-emerald-400" />
                                  )}
                                </Button>
                                {expired && !proxy.enabled && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      setRenewingProxy(proxy);
                                      setRenewValue(24);
                                      setRenewUnit("hours");
                                      setRenewDialogOpen(true);
                                    }}
                                    title="Renew expired proxy"
                                    className="text-amber-400"
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </Button>
                                )}
                                {canDelete && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDeleteProxy(proxy)}
                                    className="text-red-500 hover:text-red-600"
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
        </div>
      </PageContent>

      {/* Create Proxy Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle>Create SOCKS5 Proxy</DialogTitle>
            <DialogDescription>
              Create a new SOCKS5 proxy with a dedicated public IP
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name (Internal Record)</Label>
              <Input
                placeholder="My Proxy Server"
                value={newProxy.name}
                onChange={(e) => setNewProxy({ ...newProxy, name: e.target.value })}
                className="bg-secondary border-border"
              />
              <p className="text-xs text-muted-foreground">
                Optional internal name to identify this proxy
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  placeholder="proxy_user1"
                  value={newProxy.username}
                  onChange={(e) => setNewProxy({ ...newProxy, username: e.target.value })}
                  className="bg-secondary border-border"
                />
              </div>

              <div className="space-y-2">
                <Label>Password</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    placeholder="Password"
                    value={newProxy.password}
                    onChange={(e) => setNewProxy({ ...newProxy, password: e.target.value })}
                    className="bg-secondary border-border"
                  />
                  <Button variant="outline" onClick={generatePassword} size="sm">
                    Gen
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Public IP (Host & Outgoing)</Label>
              <Popover open={ipComboboxOpen} onOpenChange={setIpComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={ipComboboxOpen}
                    className="w-full justify-between font-mono bg-secondary border-border"
                  >
                    {newProxy.publicIp || "Select public IP..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[350px] p-0 z-[9999]"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                >
                  <Command className="border-0">
                    <CommandInput placeholder="Type IP to search..." className="font-mono" />
                    <CommandList className="max-h-[200px] overflow-y-auto">
                      <CommandEmpty>No IP found.</CommandEmpty>
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
                            key={ip}
                            value={ip}
                            onSelect={() => {
                              setNewProxy({ ...newProxy, publicIp: ip });
                              setIpComboboxOpen(false);
                            }}
                            className="font-mono cursor-pointer"
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                newProxy.publicIp === ip ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <span className="flex-1">{ip}</span>
                            <div className="flex items-center gap-2">
                              <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded min-w-[40px] justify-center ${
                                peerCountByIp[ip] > 0 ? "text-cyan-400" : "text-muted-foreground"
                              }`}>
                                <Users className="h-3 w-3" />
                                {peerCountByIp[ip] || 0}
                              </span>
                              <span className={`flex items-center gap-1 text-xs min-w-[40px] justify-center ${
                                socksCountByIp[ip] > 0 ? "text-emerald-400" : "text-muted-foreground"
                              }`}>
                                <Network className="h-3 w-3" />
                                {socksCountByIp[ip] || 0}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                Port is always 1080. Connect to IP:1080 to exit with that IP.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Max Connections (0 = unlimited)</Label>
              <Input
                type="number"
                min="0"
                placeholder="0"
                value={newProxy.maxConnections}
                onChange={(e) => setNewProxy({ ...newProxy, maxConnections: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>

            {/* Expiration Settings */}
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
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProxy} disabled={creating || !newProxy.username || !newProxy.password || !newProxy.publicIp}>
              {creating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Create
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Proxy Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Edit Proxy</DialogTitle>
            <DialogDescription>
              Edit {editingProxy?.username} @ {editingProxy?.public_ip}:1080
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name (Internal Record)</Label>
              <Input
                placeholder="My Proxy Server"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  className="bg-secondary border-border"
                />
                <Button variant="outline" onClick={() => {
                  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
                  let password = "";
                  for (let i = 0; i < 12; i++) {
                    password += chars.charAt(Math.floor(Math.random() * chars.length));
                  }
                  setEditForm({ ...editForm, password });
                }}>
                  Generate
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Max Connections (0 = unlimited)</Label>
              <Input
                type="number"
                min="0"
                value={editForm.maxConnections}
                onChange={(e) => setEditForm({ ...editForm, maxConnections: e.target.value })}
                className="bg-secondary border-border"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateProxy} disabled={updating}>
              {updating ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
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
              Configure auto-disable and scheduled enable for this proxy.
            </DialogDescription>
          </DialogHeader>

          {editingExpirationProxy && (
            <div className="space-y-4 py-4">
              {/* Proxy Info */}
              <div className="p-4 bg-secondary rounded-lg space-y-2">
                <p className="font-medium">{editingExpirationProxy.name || editingExpirationProxy.username}</p>
                <p className="text-sm text-muted-foreground font-mono">{editingExpirationProxy.public_ip}:1080</p>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={editingExpirationProxy.enabled ? "text-emerald-400" : "text-red-400"}>
                    {editingExpirationProxy.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                  {editingExpirationProxy.expires_at && (
                    <Badge variant="outline" className={isProxyExpired(editingExpirationProxy) ? "text-red-400 border-red-400" : "text-amber-400 border-amber-400"}>
                      <Timer className="w-3 h-3 mr-1" />
                      {getTimeRemaining(editingExpirationProxy)}
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
                      The proxy will be automatically disabled after the specified time.
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
                      The proxy will be automatically enabled at the specified date/time.
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
                      Proxy will auto-disable in {formatDuration(editExpValue, editExpUnit)}
                    </p>
                  )}
                  {editExpScheduledEnable && editExpEnableDate && (
                    <p className="text-sm text-muted-foreground">
                      Proxy will auto-enable at {new Date(editExpEnableDate).toLocaleString()}
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

      {/* Renew Proxy Dialog */}
      <Dialog open={renewDialogOpen} onOpenChange={setRenewDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Timer className="w-5 h-5 text-amber-400" />
              Renew Expired Proxy
            </DialogTitle>
            <DialogDescription>
              This proxy has expired. Choose how long to renew it for.
            </DialogDescription>
          </DialogHeader>

          {renewingProxy && (
            <div className="space-y-4 py-4">
              <div className="p-4 bg-secondary rounded-lg space-y-2">
                <p className="font-medium">{renewingProxy.name || renewingProxy.username}</p>
                <p className="text-sm text-muted-foreground font-mono">{renewingProxy.public_ip}:1080</p>
                {renewingProxy.expires_at && (
                  <p className="text-sm text-red-400">
                    Expired: {formatDate(renewingProxy.expires_at)}
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
                  The proxy will be enabled and set to expire in {formatDuration(renewValue, renewUnit)}.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRenewProxy} disabled={renewing} className="gap-2">
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

      {/* Proxy Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="bg-card border-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Proxy Details
            </DialogTitle>
            <DialogDescription>
              Complete information for this SOCKS5 proxy
            </DialogDescription>
          </DialogHeader>

          {selectedProxyForDetails && (() => {
            const proxy = selectedProxyForDetails;
            const proxyOnline = isProxyOnline(proxy);
            const proxyExpired = isProxyExpired(proxy);
            const timeLeft = getTimeRemaining(proxy);
            const connections = activeConnections[proxy.public_ip] || 0;
            const proxyString = getProxyString(proxy);

            const copyToClipboard = (text: string, label: string) => {
              navigator.clipboard.writeText(text);
              toast.success(`${label} copied`);
            };

            return (
              <div className="space-y-4">
                {/* Status Badges */}
                <div className="flex flex-wrap gap-2">
                  {!proxy.enabled ? (
                    <Badge variant="outline" className="text-gray-400 border-gray-400">
                      <WifiOff className="w-3 h-3 mr-1" />
                      Disabled
                    </Badge>
                  ) : proxyOnline ? (
                    <Badge variant="outline" className="text-emerald-400 border-emerald-400">
                      <Wifi className="w-3 h-3 mr-1" />
                      Online ({connections} connection{connections !== 1 ? 's' : ''})
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-400 border-amber-400">
                      <WifiOff className="w-3 h-3 mr-1" />
                      Offline
                    </Badge>
                  )}
                  {proxyExpired && (
                    <Badge variant="outline" className="text-red-400 border-red-400">
                      <Timer className="w-3 h-3 mr-1" />
                      Expired
                    </Badge>
                  )}
                  {timeLeft && !proxyExpired && (
                    <Badge variant="outline" className="text-amber-400 border-amber-400">
                      <Timer className="w-3 h-3 mr-1" />
                      {timeLeft}
                    </Badge>
                  )}
                </div>

                {/* Proxy String - Main copyable field */}
                <div className="bg-secondary/50 rounded-lg p-3 border border-border">
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs text-muted-foreground">Proxy String</Label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(proxyString, "Proxy string")}
                      className="h-6 px-2"
                    >
                      <Copy className="w-3 h-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <code className="text-sm text-cyan-400 font-mono break-all">
                    {proxyString}
                  </code>
                </div>

                {/* Grid of details */}
                <div className="grid grid-cols-2 gap-3">
                  {/* ID */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">ID</Label>
                    <div className="flex items-center gap-1">
                      <code className="text-xs font-mono truncate flex-1">{proxy.id.slice(0, 8)}...</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(proxy.id, "ID")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Name */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm truncate flex-1">{proxy.name || "-"}</span>
                      {proxy.name && (
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(proxy.name!, "Name")}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Username */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Username</Label>
                    <div className="flex items-center gap-1">
                      <code className="text-sm font-mono truncate flex-1">{proxy.username}</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(proxy.username, "Username")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Password</Label>
                    <div className="flex items-center gap-1">
                      <code className="text-sm font-mono truncate flex-1">{proxy.password}</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(proxy.password, "Password")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Host:Port */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Host:Port</Label>
                    <div className="flex items-center gap-1">
                      <code className="text-sm font-mono text-cyan-400 truncate flex-1">{proxy.public_ip}:1080</code>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyToClipboard(`${proxy.public_ip}:1080`, "Host:Port")}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>

                  {/* Max Connections */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Max Connections</Label>
                    <span className="text-sm">{proxy.max_connections === 0 ? "Unlimited" : proxy.max_connections}</span>
                  </div>
                </div>

                {/* Separator */}
                <div className="border-t border-border" />

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {/* Created By */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <User className="w-3 h-3" />
                      Created By
                    </Label>
                    <span className="text-muted-foreground">
                      {creatorEmails[proxy.created_by] || proxy.created_by.slice(0, 8) + "..."}
                    </span>
                  </div>

                  {/* Created At */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Created
                    </Label>
                    <span className="text-muted-foreground">{formatDate(proxy.created_at)}</span>
                  </div>

                  {/* Last Connection */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Activity className="w-3 h-3" />
                      Last Connection
                    </Label>
                    <span className="text-muted-foreground">
                      {proxy.last_connected_at ? formatDate(proxy.last_connected_at) : "Never"}
                    </span>
                  </div>

                  {/* Expires At */}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Timer className="w-3 h-3" />
                      Expires
                    </Label>
                    <span className={proxyExpired ? "text-red-400" : "text-muted-foreground"}>
                      {proxy.expires_at ? formatDate(proxy.expires_at) : "Never"}
                    </span>
                  </div>

                  {/* Scheduled Enable */}
                  {proxy.scheduled_enable && (
                    <div className="space-y-1 col-span-2">
                      <Label className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        Scheduled Enable
                      </Label>
                      <span className="text-muted-foreground">{formatDate(proxy.scheduled_enable)}</span>
                    </div>
                  )}
                </div>

                {/* Traffic */}
                <div className="border-t border-border pt-3">
                  <Label className="text-xs text-muted-foreground mb-2 block">Traffic</Label>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2">
                      <ArrowUp className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400 font-medium">{formatBytes(proxy.bytes_sent)}</span>
                      <span className="text-xs text-muted-foreground">sent</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ArrowUp className="w-4 h-4 text-blue-400 rotate-180" />
                      <span className="text-blue-400 font-medium">{formatBytes(proxy.bytes_received)}</span>
                      <span className="text-xs text-muted-foreground">received</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsDialogOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => {
                if (selectedProxyForDetails) {
                  copyProxyString(selectedProxyForDetails);
                }
              }}
            >
              <Copy className="w-4 h-4 mr-2" />
              Copy Proxy String
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  );
}
