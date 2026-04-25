"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import {
  Settings,
  Globe,
  Users,
  Server,
  Trash2,
  Plus,
  Check,
  X,
  Shield,
  Network,
  RefreshCw,
  Download,
  CheckCircle,
  AlertCircle,
  Zap,
  Activity,
  Search,
  UserCheck,
  Lock,
  LockOpen,
  Clock,
  User,
  Pencil,
  Eye,
  Power,
  PowerOff,
  Timer,
  ToggleLeft,
  ToggleRight,
  Cpu,
  HardDrive,
  History,
  ChevronDown,
  ChevronUp,
  Calendar,
  Filter,
  XCircle,
  BarChart3,
  TrendingUp,
  PieChart,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { formatLogMessage, getActionColor } from "@/lib/activity-logger";
import type { Profile, Router, ConnectionType, UserRole, PublicIP, UserRouter, WireGuardInterface, UserCapabilities } from "@/lib/types";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
} from "recharts";

interface UserRouterWithRelations extends UserRouter {
  profiles: { id: string; email: string; username: string | null } | null;
  routers: { id: string; name: string } | null;
}

interface UserSocks5ProxyWithRelations {
  id: string;
  user_id: string;
  socks5_proxy_id: string;
  created_at: string;
  profiles: { id: string; email: string; username: string | null } | null;
  socks5_proxies: { id: string; public_ip: string; name: string | null; username: string } | null;
}

interface Socks5ProxyBasic {
  id: string;
  public_ip: string;
  name: string | null;
  username: string;
  router_id: string;
  routers?: { name: string } | null;
}

interface DetectedIp {
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  has_nat_rule: boolean;
  has_ip_address: boolean;
  has_wg_ip: boolean;
  nat_rule_id?: string;
  ip_address_id?: string;
  wg_ip_id?: string;
  nat_bytes?: number;
  nat_packets?: number;
}

interface NatTraffic {
  ip_number: number;
  public_ip: string;
  internal_subnet: string;
  bytes: number;
  packets: number;
  nat_rule_id: string;
}

interface RouterResources {
  cpuLoad: number;
  freeMemory: number;
  totalMemory: number;
  uptime: string;
  version: string;
  boardName: string;
  architecture: string;
  cpuCount: string;
  cpuFrequency: string;
}

interface ActivityLog {
  id: string;
  router_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
  profiles?: { id: string; email: string; username: string | null } | null;
  routers?: { id: string; name: string } | null;
}

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [userRouters, setUserRouters] = useState<UserRouterWithRelations[]>([]);
  const [userSocks5Proxies, setUserSocks5Proxies] = useState<UserSocks5ProxyWithRelations[]>([]);
  const [socks5Proxies, setSocks5Proxies] = useState<Socks5ProxyBasic[]>([]);
  const [loading, setLoading] = useState(true);

  // Tab state - read from URL parameter on client side only
  const [activeTab, setActiveTab] = useState("routers");

  // Function to get tab from URL
  const getTabFromUrl = useCallback(() => {
    if (typeof window === "undefined") return "routers";
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "ips") return "public-ips";
    if (tab === "access") return "access";
    if (tab === "users") return "users";
    if (tab === "socks5") return "socks5";
    return "routers";
  }, []);

  // Read tab from URL on mount and listen for URL changes
  useEffect(() => {
    // Set initial tab
    setActiveTab(getTabFromUrl());

    // Listen for popstate (browser back/forward)
    const handlePopState = () => {
      setActiveTab(getTabFromUrl());
    };

    // Listen for pushstate/replacestate (Next.js Link navigation)
    const handleUrlChange = () => {
      setTimeout(() => {
        setActiveTab(getTabFromUrl());
      }, 0);
    };

    window.addEventListener("popstate", handlePopState);

    // Patch history methods to detect URL changes from Link components
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      handleUrlChange();
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      handleUrlChange();
    };

    return () => {
      window.removeEventListener("popstate", handlePopState);
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    };
  }, [getTabFromUrl]);

  // Router states
  const [addRouterOpen, setAddRouterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingRouter, setEditingRouter] = useState<Router | null>(null);
  const [editRouterOpen, setEditRouterOpen] = useState(false);
  const [wgInterfaces, setWgInterfaces] = useState<WireGuardInterface[]>([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(false);
  const [newRouter, setNewRouter] = useState({
    name: "",
    host: "",
    port: "443",
    api_port: "8728",
    username: "",
    password: "",
    use_ssl: false,
    connection_type: "api" as ConnectionType,
    ssh_port: "22",
    ssh_key: "",
    ssh_auth_method: "both" as "password" | "key" | "both",
  });

  // Edit Router state
  const [editRouterData, setEditRouterData] = useState({
    name: "",
    host: "",
    port: "443",
    api_port: "8728",
    username: "",
    password: "",
    use_ssl: false,
    connection_type: "api" as ConnectionType,
    ssh_port: "22",
    ssh_key: "",
    ssh_auth_method: "both" as "password" | "key" | "both",
    public_ip_prefix: "",
    internal_prefix: "10.10",
    wg_interface: "wg0",
    out_interface: "ether2",
    public_ip_mask: "/24",
  });
  const [savingRouter, setSavingRouter] = useState(false);
  const [detectedNetworkInterfaces, setDetectedNetworkInterfaces] = useState<string[]>([]);
  const [detectedWgInterfaces, setDetectedWgInterfaces] = useState<string[]>([]);
  const [loadingEditInterfaces, setLoadingEditInterfaces] = useState(false);

  // User states
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    username: "",
    role: "user" as UserRole,
  });

  // Public IP states
  const [selectedRouterForIps, setSelectedRouterForIps] = useState<string>("");
  const [addIpOpen, setAddIpOpen] = useState(false);
  const [newIpNumber, setNewIpNumber] = useState("");
  const [addingIp, setAddingIp] = useState(false);
  // Bulk Add IP states
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkStartIp, setBulkStartIp] = useState("");
  const [bulkEndIp, setBulkEndIp] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [detectedIps, setDetectedIps] = useState<DetectedIp[]>([]);
  const [partiallyConfiguredIps, setPartiallyConfiguredIps] = useState<DetectedIp[]>([]);
  const [natTraffic, setNatTraffic] = useState<Record<number, NatTraffic>>({});
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [showPartialIps, setShowPartialIps] = useState(false);
  const [routerConnectionStatus, setRouterConnectionStatus] = useState<"checking" | "connected" | "disconnected" | null>(null);
  const [creatingRulesFor, setCreatingRulesFor] = useState<number | null>(null);
  const [ipSearchQuery, setIpSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState<Record<string, { count: number; names: string[]; peers: Array<{ id: string; name: string; address: string }> }>>({});

  // Peers detail modal
  const [peersModalOpen, setPeersModalOpen] = useState(false);
  const [selectedIpForPeers, setSelectedIpForPeers] = useState<PublicIP | null>(null);
  const [selectedIpPeers, setSelectedIpPeers] = useState<Array<{ id: string; name: string; address: string; publicKey?: string; interface?: string; disabled?: boolean; rx?: number; tx?: number; comment?: string }>>([]);

  // Single peer detail dialog
  const [peerDetailOpen, setPeerDetailOpen] = useState(false);
  const [selectedPeerDetail, setSelectedPeerDetail] = useState<{ id: string; name: string; address: string; publicKey?: string; privateKey?: string; interface?: string; disabled?: boolean; rx?: number; tx?: number; comment?: string } | null>(null);

  // User Router Access states
  const [addAccessOpen, setAddAccessOpen] = useState(false);
  const [newAccess, setNewAccess] = useState({ user_id: "", router_id: "" });
  const [addingAccess, setAddingAccess] = useState(false);

  // User SOCKS5 Proxy Access states
  const [addSocks5AccessOpen, setAddSocks5AccessOpen] = useState(false);
  const [newSocks5Access, setNewSocks5Access] = useState({ user_id: "", socks5_proxy_id: "" });
  const [addingSocks5Access, setAddingSocks5Access] = useState(false);

  // User Capabilities states
  const [editCapabilitiesOpen, setEditCapabilitiesOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editingCapabilities, setEditingCapabilities] = useState<UserCapabilities>({});
  const [savingCapabilities, setSavingCapabilities] = useState(false);

  // Router Resources states
  const [routerResources, setRouterResources] = useState<Record<string, RouterResources>>({});
  const [loadingResources, setLoadingResources] = useState<Record<string, boolean>>({});
  const [expandedRouter, setExpandedRouter] = useState<string | null>(null);

  // Activity Logs states
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedRouterForLogs, setSelectedRouterForLogs] = useState<string | null>(null);
  const [logsSearchQuery, setLogsSearchQuery] = useState("");
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsHasMore, setLogsHasMore] = useState(false);
  const [logsOffset, setLogsOffset] = useState(0);
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [logsStartDate, setLogsStartDate] = useState("");
  const [logsEndDate, setLogsEndDate] = useState("");
  const LOGS_PAGE_SIZE = 50;

  // Activity Stats states
  const [logsModalTab, setLogsModalTab] = useState<"logs" | "charts">("logs");
  const [activityStats, setActivityStats] = useState<{
    chartData: Array<{
      date: string;
      total: number;
      creates: number;
      updates: number;
      deletes: number;
      enables: number;
      disables: number;
      peers: number;
      publicIps: number;
      users: number;
    }>;
    summary: {
      total: number;
      dailyAverage: number;
      actionTotals: Record<string, number>;
      entityTotals: Record<string, number>;
      period: number;
      groupBy: string;
    };
  } | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsPeriod, setStatsPeriod] = useState("30");
  const [statsGroupBy, setStatsGroupBy] = useState("day");

  // Fetch routers
  const fetchRouters = useCallback(async () => {
    const { data } = await supabase.from("routers").select("*").order("created_at", { ascending: false });
    if (data) {
      setRouters(data as Router[]);
      if (data.length > 0 && !selectedRouterForIps) {
        // Check localStorage for last selected router in admin IPs
        const lastAdminRouter = localStorage.getItem("wg-admin-last-router");
        const routerExists = data.some((r: Router) => r.id === lastAdminRouter);
        setSelectedRouterForIps(lastAdminRouter && routerExists ? lastAdminRouter : data[0].id);
      }
    }
  }, [supabase, selectedRouterForIps]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (data) setUsers(data as Profile[]);
  }, [supabase]);

  // Fetch user routers
  const fetchUserRouters = useCallback(async () => {
    const { data } = await supabase
      .from("user_routers")
      .select("*, profiles(id, email, username), routers(id, name)")
      .order("created_at", { ascending: false });
    if (data) setUserRouters(data as UserRouterWithRelations[]);
  }, [supabase]);

  // Fetch SOCKS5 proxies
  const fetchSocks5Proxies = useCallback(async () => {
    const { data } = await supabase
      .from("socks5_proxies")
      .select("id, public_ip, name, username, router_id, routers(name)")
      .order("created_at", { ascending: false });
    if (data) setSocks5Proxies(data as Socks5ProxyBasic[]);
  }, [supabase]);

  // Fetch user SOCKS5 proxy access
  const fetchUserSocks5Proxies = useCallback(async () => {
    const { data } = await supabase
      .from("user_socks5_proxies")
      .select("*, profiles(id, email, username), socks5_proxies(id, public_ip, name, username)")
      .order("created_at", { ascending: false });
    if (data) setUserSocks5Proxies(data as UserSocks5ProxyWithRelations[]);
  }, [supabase]);

  // Initial data fetch
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profileData || profileData.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setProfile(profileData as Profile);
      await Promise.all([fetchRouters(), fetchUsers(), fetchUserRouters(), fetchSocks5Proxies(), fetchUserSocks5Proxies()]);
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase, fetchRouters, fetchUsers, fetchUserRouters, fetchSocks5Proxies, fetchUserSocks5Proxies]);

  // Fetch public IPs
  const fetchPublicIps = useCallback(async () => {
    if (!selectedRouterForIps) return;
    const { data } = await supabase
      .from("public_ips")
      .select("*")
      .eq("router_id", selectedRouterForIps)
      .order("ip_number", { ascending: true });
    if (data) setPublicIps(data as PublicIP[]);
  }, [selectedRouterForIps, supabase]);

  // Fetch router resources (CPU, RAM, uptime)
  const fetchRouterResources = useCallback(async (routerId: string) => {
    setLoadingResources(prev => ({ ...prev, [routerId]: true }));
    try {
      const res = await fetch("/api/routers/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routerId })
      });
      const data = await res.json();
      if (data.success && data.resources) {
        setRouterResources(prev => ({ ...prev, [routerId]: data.resources }));
      } else {
        toast.error(data.error || "Failed to fetch resources");
      }
    } catch (error) {
      toast.error("Failed to connect to router");
    } finally {
      setLoadingResources(prev => ({ ...prev, [routerId]: false }));
    }
  }, []);

  // Fetch activity logs
  const fetchActivityLogs = useCallback(async (routerId?: string | null, reset: boolean = true) => {
    if (reset) {
      setLoadingLogs(true);
      setLogsOffset(0);
    } else {
      setLoadingMoreLogs(true);
    }

    try {
      const currentOffset = reset ? 0 : logsOffset;
      const params = new URLSearchParams({
        limit: String(LOGS_PAGE_SIZE),
        offset: String(currentOffset),
      });

      if (routerId) {
        params.set("routerId", routerId);
      }

      if (logsSearchQuery.trim()) {
        params.set("search", logsSearchQuery.trim());
      }

      if (logsStartDate) {
        params.set("startDate", logsStartDate);
      }

      if (logsEndDate) {
        // Add end of day for endDate
        params.set("endDate", `${logsEndDate}T23:59:59.999Z`);
      }

      const res = await fetch(`/api/activity-logs?${params.toString()}`);
      const data = await res.json();

      if (data.logs) {
        if (reset) {
          setActivityLogs(data.logs);
        } else {
          setActivityLogs(prev => [...prev, ...data.logs]);
        }
        setLogsTotal(data.total || 0);
        setLogsHasMore(data.hasMore || false);
        setLogsOffset(currentOffset + data.logs.length);
      }
    } catch (error) {
      toast.error("Failed to fetch activity logs");
    } finally {
      setLoadingLogs(false);
      setLoadingMoreLogs(false);
    }
  }, [logsOffset, logsSearchQuery, logsStartDate, logsEndDate]);

  // Load more logs
  const loadMoreLogs = useCallback(() => {
    if (!loadingMoreLogs && logsHasMore) {
      fetchActivityLogs(selectedRouterForLogs, false);
    }
  }, [fetchActivityLogs, selectedRouterForLogs, loadingMoreLogs, logsHasMore]);

  // Fetch activity stats for charts
  const fetchActivityStats = useCallback(async (routerId?: string | null) => {
    setLoadingStats(true);
    try {
      const params = new URLSearchParams({
        period: statsPeriod,
        groupBy: statsGroupBy,
      });

      if (routerId) {
        params.set("routerId", routerId);
      }

      const res = await fetch(`/api/activity-logs/stats?${params.toString()}`);
      const data = await res.json();

      if (data.chartData) {
        setActivityStats(data);
      }
    } catch (error) {
      toast.error("Failed to fetch activity statistics");
    } finally {
      setLoadingStats(false);
    }
  }, [statsPeriod, statsGroupBy]);

  // Open activity logs modal
  const openLogsModal = useCallback((routerId?: string | null) => {
    setSelectedRouterForLogs(routerId || null);
    setLogsSearchQuery("");
    setLogsStartDate("");
    setLogsEndDate("");
    setLogsOffset(0);
    setLogsModalTab("logs");
    setLogsModalOpen(true);
    fetchActivityLogs(routerId, true);
    fetchActivityStats(routerId);
  }, [fetchActivityLogs, fetchActivityStats]);

  // Clear logs filters
  const clearLogsFilters = useCallback(() => {
    setLogsSearchQuery("");
    setLogsStartDate("");
    setLogsEndDate("");
    setLogsOffset(0);
    fetchActivityLogs(selectedRouterForLogs, true);
  }, [fetchActivityLogs, selectedRouterForLogs]);

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  // Format memory to human readable
  const formatMemory = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return (mb / 1024).toFixed(1) + " GB";
    }
    return mb.toFixed(0) + " MB";
  };

  // Fetch peer counts for each IP
  const fetchPeerCounts = useCallback(async () => {
    if (!selectedRouterForIps) return;
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getPeers", routerId: selectedRouterForIps })
      });
      const data = await res.json();
      if (data.peers) {
        const counts: Record<string, { count: number; names: string[]; peers: Array<{ id: string; name: string; address: string; publicKey?: string; interface?: string; disabled?: boolean; rx?: number; tx?: number; comment?: string }> }> = {};
        for (const peer of data.peers) {
          const comment = peer.comment || "";
          if (comment) {
            if (!counts[comment]) counts[comment] = { count: 0, names: [], peers: [] };
            counts[comment].count++;
            counts[comment].names.push(peer.name || "Unnamed");
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
  }, [selectedRouterForIps]);

  // Fetch NAT traffic statistics
  const fetchNatTraffic = useCallback(async () => {
    if (!selectedRouterForIps) return;
    setLoadingTraffic(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getNatRuleTraffic", routerId: selectedRouterForIps })
      });
      const data = await res.json();
      if (data.traffic && Array.isArray(data.traffic)) {
        const trafficMap: Record<number, NatTraffic> = {};
        for (const t of data.traffic) {
          trafficMap[t.ip_number] = t;
        }
        setNatTraffic(trafficMap);
      }
    } catch (err) {
      console.error("Failed to fetch NAT traffic:", err);
    }
    setLoadingTraffic(false);
  }, [selectedRouterForIps]);

  // Check router connection status
  const checkRouterConnection = useCallback(async () => {
    if (!selectedRouterForIps) {
      setRouterConnectionStatus(null);
      return;
    }
    setRouterConnectionStatus("checking");
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "testConnection", routerId: selectedRouterForIps })
      });
      const data = await res.json();
      setRouterConnectionStatus(data.connected ? "connected" : "disconnected");
    } catch {
      setRouterConnectionStatus("disconnected");
    }
  }, [selectedRouterForIps]);

  // Save selected router to localStorage for admin IPs
  useEffect(() => {
    if (selectedRouterForIps) {
      localStorage.setItem("wg-admin-last-router", selectedRouterForIps);
    }
  }, [selectedRouterForIps]);

  useEffect(() => {
    if (selectedRouterForIps) {
      fetchPublicIps();
      fetchPeerCounts();
      fetchNatTraffic();
      checkRouterConnection();
    }
  }, [selectedRouterForIps, fetchPublicIps, fetchPeerCounts, fetchNatTraffic, checkRouterConnection]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Add router
  const handleAddRouter = async () => {
    const isLinux = newRouter.connection_type === "linux-ssh";

    if (!newRouter.name || !newRouter.host || !newRouter.username) {
      toast.error("Please fill all required fields");
      return;
    }

    if (!isLinux && !newRouter.password) {
      toast.error("Password is required");
      return;
    }

    setAdding(true);
    try {
      const routerData: Record<string, unknown> = {
        name: newRouter.name,
        host: newRouter.host,
        port: parseInt(newRouter.port) || 443,
        api_port: parseInt(newRouter.api_port) || 8728,
        username: newRouter.username,
        password: newRouter.password,
        use_ssl: newRouter.use_ssl,
        connection_type: newRouter.connection_type,
      };

      if (isLinux) {
        routerData.ssh_port = parseInt(newRouter.ssh_port) || 22;
        routerData.ssh_key = newRouter.ssh_key || null;
        routerData.ssh_auth_method = newRouter.ssh_auth_method;
      }

      console.log("[Admin] Inserting router data:", JSON.stringify(routerData, null, 2));

      const { error } = await supabase.from("routers").insert(routerData);

      if (error) {
        console.error("[Admin] Supabase error:", error);
        toast.error(`Database error: ${error.message}`, { duration: 8000 });
        setAdding(false);
        return;
      }

      toast.success(isLinux ? "Linux server added" : "Router added");
      setAddRouterOpen(false);
      setNewRouter({
        name: "", host: "", port: "443", api_port: "8728",
        username: "", password: "", use_ssl: false, connection_type: "api",
        ssh_port: "22", ssh_key: "", ssh_auth_method: "both"
      });
      fetchRouters();
    } catch (err) {
      console.error("[Admin] Error adding router:", err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to add router: ${errorMessage}`, { duration: 8000 });
    }
    setAdding(false);
  };

  // Test router connection
  const handleTestConnection = async (routerId: string) => {
    setTestingId(routerId);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "testConnection", routerId })
      });
      const data = await res.json();
      if (data.connected) {
        toast.success("Connection successful!", {
          description: data.details || undefined
        });
      } else {
        // Check for sudo-specific errors
        if (data.sudoRequired) {
          toast.error("Sudo password required", {
            description: "Configure passwordless sudo on the server. See console for instructions.",
            duration: 15000
          });
          console.error("[Connection Test] SUDO CONFIGURATION NEEDED:\n" + data.details);
        } else {
          // Show detailed error for debugging
          toast.error(data.error || "Connection failed", {
            description: data.details || "Check server logs for more info",
            duration: 8000
          });
        }
        console.error("[Connection Test] Failed:", data);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Connection test failed", {
        description: errMsg,
        duration: 8000
      });
      console.error("[Connection Test] Exception:", err);
    }
    setTestingId(null);
  };

  // Delete router
  const handleDeleteRouter = async (id: string) => {
    if (!confirm("Delete this router?")) return;
    const { error } = await supabase.from("routers").delete().eq("id", id);
    if (error) {
      toast.error("Failed to delete router");
    } else {
      toast.success("Router deleted");
      fetchRouters();
    }
  };

  // Open edit router dialog
  const openEditRouter = async (router: Router) => {
    setEditingRouter(router);
    setEditRouterData({
      name: router.name,
      host: router.host,
      port: String(router.port || 443),
      api_port: String(router.api_port || 8728),
      username: router.username,
      password: "",
      use_ssl: router.use_ssl || false,
      connection_type: router.connection_type || "api",
      ssh_port: String(router.ssh_port || 22),
      ssh_key: router.ssh_key || "",
      ssh_auth_method: (router.ssh_auth_method as "password" | "key" | "both") || "both",
      public_ip_prefix: router.public_ip_prefix || "",
      internal_prefix: router.internal_prefix || "10.10",
      wg_interface: router.wg_interface || (router.connection_type === "linux-ssh" ? "wg1" : "wg0"),
      out_interface: router.out_interface || (router.connection_type === "linux-ssh" ? "ens192" : "ether2"),
      public_ip_mask: router.public_ip_mask || "/24",
    });
    setDetectedNetworkInterfaces([]);
    setDetectedWgInterfaces([]);
    setEditRouterOpen(true);

    // Load interfaces from router
    setLoadingEditInterfaces(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getSystemInterfaces", routerId: router.id })
      });
      const data = await res.json();
      if (data.success) {
        setDetectedNetworkInterfaces(data.networkInterfaces || []);
        setDetectedWgInterfaces(data.wgInterfaces || []);
      }
    } catch (err) {
      console.error("Failed to load interfaces:", err);
    }
    setLoadingEditInterfaces(false);
  };

  // Save edited router
  const handleEditRouter = async () => {
    if (!editingRouter) return;

    if (!editRouterData.name || !editRouterData.host || !editRouterData.username) {
      toast.error("Please fill all required fields");
      return;
    }

    setSavingRouter(true);
    try {
      const isLinux = editRouterData.connection_type === "linux-ssh";

      const updateData: Record<string, unknown> = {
        name: editRouterData.name,
        host: editRouterData.host,
        port: parseInt(editRouterData.port) || 443,
        api_port: parseInt(editRouterData.api_port) || 8728,
        username: editRouterData.username,
        use_ssl: editRouterData.use_ssl,
        connection_type: editRouterData.connection_type,
        public_ip_prefix: editRouterData.public_ip_prefix || null,
        internal_prefix: editRouterData.internal_prefix || "10.10",
        wg_interface: editRouterData.wg_interface || (isLinux ? "wg1" : "wg0"),
        out_interface: editRouterData.out_interface || (isLinux ? "ens192" : "ether2"),
        public_ip_mask: editRouterData.public_ip_mask || "/24",
      };

      if (editRouterData.password) {
        updateData.password = editRouterData.password;
      }

      if (isLinux) {
        updateData.ssh_port = parseInt(editRouterData.ssh_port) || 22;
        updateData.ssh_key = editRouterData.ssh_key || null;
        updateData.ssh_auth_method = editRouterData.ssh_auth_method;
      }

      const { error } = await supabase
        .from("routers")
        .update(updateData)
        .eq("id", editingRouter.id);

      if (error) {
        toast.error(`Failed to update router: ${error.message}`);
      } else {
        toast.success("Router updated successfully");
        setEditRouterOpen(false);
        setEditingRouter(null);
        fetchRouters();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Failed to update router: ${errorMessage}`);
    }
    setSavingRouter(false);
  };

  // Add IP
  const handleAddIp = async () => {
    if (!newIpNumber || !selectedRouterForIps) {
      toast.error("Please enter IP number");
      return;
    }
    setAddingIp(true);
    try {
      const res = await fetch("/api/public-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ router_id: selectedRouterForIps, ip_number: parseInt(newIpNumber) })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("IP added. Click 'Create' to create MikroTik rules.");
        setAddIpOpen(false);
        setNewIpNumber("");
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to add IP");
    }
    setAddingIp(false);
  };

  // Bulk Add IPs
  const handleBulkAddIps = async () => {
    if (!bulkStartIp || !bulkEndIp || !selectedRouterForIps) {
      toast.error("Please enter start and end IP numbers");
      return;
    }
    const start = parseInt(bulkStartIp);
    const end = parseInt(bulkEndIp);
    if (isNaN(start) || isNaN(end) || start > end) {
      toast.error("Invalid range. Start must be less than or equal to end.");
      return;
    }
    if (end - start > 254) {
      toast.error("Range too large. Maximum 254 IPs at once.");
      return;
    }
    setBulkAdding(true);
    try {
      const res = await fetch("/api/public-ips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          router_id: selectedRouterForIps,
          start_ip: start,
          end_ip: end
        })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(data.message || `Added ${data.count} IPs successfully!`);
        setBulkAddOpen(false);
        setBulkStartIp("");
        setBulkEndIp("");
        fetchPublicIps();
        fetchNatTraffic();
      }
    } catch {
      toast.error("Failed to bulk add IPs");
    }
    setBulkAdding(false);
  };

  // Toggle IP enabled/disabled
  const handleToggleIp = async (ip: PublicIP) => {
    try {
      const res = await fetch("/api/public-ips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ip.id, enabled: !ip.enabled })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(ip.enabled ? "IP disabled" : "IP enabled");
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to update IP");
    }
  };

  // Toggle IP restriction
  const handleToggleRestriction = async (ip: PublicIP) => {
    try {
      const res = await fetch("/api/public-ips", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ip.id, restricted: !ip.restricted })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(ip.restricted ? "IP unrestricted - now available to users" : "IP restricted - only admin can use");
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to update IP restriction");
    }
  };

  // Delete IP
  // State for deleting IP
  const [deletingIpId, setDeletingIpId] = useState<string | null>(null);

  const handleDeleteIp = async (ip: PublicIP) => {
    if (!confirm(`Delete IP ${ip.public_ip}? This will also remove MikroTik rules (WG, IP, NAT).`)) return;

    setDeletingIpId(ip.id);

    try {
      // First, delete MikroTik rules if they exist
      if (ip.wg_ip_created || ip.ip_address_created || ip.nat_rule_created) {
        const rulesRes = await fetch("/api/wireguard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "deleteMikroTikRules",
            routerId: selectedRouterForIps,
            data: { ip_number: ip.ip_number }
          })
        });
        const rulesData = await rulesRes.json();

        if (rulesData.errors && rulesData.errors.length > 0) {
          toast.warning(`Some MikroTik rules could not be deleted: ${rulesData.errors.join(", ")}`);
        } else if (rulesData.success) {
          toast.success("MikroTik rules deleted");
        }
      }

      // Then delete from database
      const res = await fetch(`/api/public-ips?id=${ip.id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("IP deleted from database");
        fetchPublicIps();
        fetchNatTraffic();
      }
    } catch {
      toast.error("Failed to delete IP");
    }
    setDeletingIpId(null);
  };

  // Import IPs from MikroTik
  const handleImportIps = async () => {
    if (!selectedRouterForIps) return;
    setImporting(true);
    setDetectedIps([]);
    setPartiallyConfiguredIps([]);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "importPublicIps", routerId: selectedRouterForIps })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        setDetectedIps(data.detectedIps || []);
        setPartiallyConfiguredIps(data.partiallyConfiguredIps || []);
        if (data.detectedIps?.length > 0) {
          toast.success(`Found ${data.detectedIps.length} fully configured IPs`);
        }
        if (data.partiallyConfiguredIps?.length > 0) {
          toast.warning(`Found ${data.partiallyConfiguredIps.length} IPs with incomplete rules`, { duration: 5000 });
          setShowPartialIps(true);
        }
        if (data.alreadySavedCount > 0) {
          toast.info(`${data.alreadySavedCount} IPs already saved`);
        }
        if (!data.detectedIps?.length && !data.partiallyConfiguredIps?.length && !data.alreadySavedCount) {
          toast.info("No new IPs found");
        }
      }
    } catch {
      toast.error("Failed to import IPs");
    }
    setImporting(false);
  };

  // Save imported IPs
  const handleSaveImportedIps = async () => {
    if (detectedIps.length === 0) return;
    setSavingImported(true);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "saveImportedIps", routerId: selectedRouterForIps, data: { ips: detectedIps } })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success(`Saved ${data.savedCount} IPs`);
        setDetectedIps([]);
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to save IPs");
    }
    setSavingImported(false);
  };

  // Create MikroTik rules
  const handleCreateRules = async (ipNumber: number) => {
    if (!selectedRouterForIps) return;
    setCreatingRulesFor(ipNumber);
    try {
      const res = await fetch("/api/wireguard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createMikroTikRules", routerId: selectedRouterForIps, data: { ip_number: ipNumber } })
      });
      const data = await res.json();

      const createdRules = [];
      if (data.wg_ip_created) createdRules.push("WG");
      if (data.ip_address_created) createdRules.push("IP");
      if (data.nat_rule_created) createdRules.push("NAT");

      if (data.success) {
        toast.success(`Rules created: ${createdRules.join(", ")}`);
      } else if (createdRules.length > 0) {
        toast.warning(`Partial success: ${createdRules.join(", ")} created`);
        if (data.errors?.length > 0) {
          for (const err of data.errors) {
            toast.error(err, { duration: 5000 });
          }
        }
      } else {
        toast.error(data.errors?.join(", ") || "Failed to create rules");
      }

      fetchPublicIps();
      fetchNatTraffic();
      // Also refresh import results if we were fixing partial IPs
      if (partiallyConfiguredIps.some(ip => ip.ip_number === ipNumber)) {
        handleImportIps();
      }
    } catch {
      toast.error("Failed to create rules");
    }
    setCreatingRulesFor(null);
  };

  // Add user
  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password) {
      toast.error("Please fill email and password");
      return;
    }
    setCreatingUser(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser)
      });
      const data = await res.json();
      if (data.error) {
        if (data.code === "SERVICE_ROLE_REQUIRED") {
          toast.error("Server config error: Service role key required", {
            description: "Contact your administrator to configure SUPABASE_SERVICE_ROLE_KEY",
            duration: 8000
          });
        } else {
          toast.error(data.error);
        }
      } else {
        toast.success("User created successfully");
        if (data.warning) {
          toast.warning(data.warning, { duration: 5000 });
        }
        setAddUserOpen(false);
        setNewUser({ email: "", password: "", username: "", role: "user" });
        fetchUsers();
      }
    } catch {
      toast.error("Failed to create user");
    }
    setCreatingUser(false);
  };

  // Delete user
  const handleDeleteUser = async (id: string) => {
    if (!confirm("Delete this user?")) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("User deleted");
        fetchUsers();
      }
    } catch {
      toast.error("Failed to delete user");
    }
  };

  // Add user router access
  const handleAddAccess = async () => {
    if (!newAccess.user_id || !newAccess.router_id) {
      toast.error("Select user and router");
      return;
    }
    setAddingAccess(true);
    try {
      const { error } = await supabase.from("user_routers").insert({
        user_id: newAccess.user_id,
        router_id: newAccess.router_id
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("User already has access to this router");
        } else {
          throw error;
        }
      } else {
        toast.success("Access granted");
        setAddAccessOpen(false);
        setNewAccess({ user_id: "", router_id: "" });
        fetchUserRouters();
      }
    } catch {
      toast.error("Failed to add access");
    }
    setAddingAccess(false);
  };

  // Delete user router access
  const handleDeleteAccess = async (id: string) => {
    if (!confirm("Remove this access?")) return;
    const { error } = await supabase.from("user_routers").delete().eq("id", id);
    if (error) {
      toast.error("Failed to remove access");
    } else {
      toast.success("Access removed");
      fetchUserRouters();
    }
  };

  // Add user SOCKS5 proxy access
  const handleAddSocks5Access = async () => {
    if (!newSocks5Access.user_id || !newSocks5Access.socks5_proxy_id) {
      toast.error("Select user and proxy");
      return;
    }
    setAddingSocks5Access(true);
    try {
      const { error } = await supabase.from("user_socks5_proxies").insert({
        user_id: newSocks5Access.user_id,
        socks5_proxy_id: newSocks5Access.socks5_proxy_id
      });
      if (error) {
        if (error.code === "23505") {
          toast.error("User already has access to this proxy");
        } else {
          throw error;
        }
      } else {
        toast.success("Proxy access granted");
        setAddSocks5AccessOpen(false);
        setNewSocks5Access({ user_id: "", socks5_proxy_id: "" });
        fetchUserSocks5Proxies();
      }
    } catch {
      toast.error("Failed to add proxy access");
    }
    setAddingSocks5Access(false);
  };

  // Delete user SOCKS5 proxy access
  const handleDeleteSocks5Access = async (id: string) => {
    if (!confirm("Remove proxy access?")) return;
    const { error } = await supabase.from("user_socks5_proxies").delete().eq("id", id);
    if (error) {
      toast.error("Failed to remove proxy access");
    } else {
      toast.success("Proxy access removed");
      fetchUserSocks5Proxies();
    }
  };

  // Open edit capabilities dialog
  const openEditCapabilities = (user: Profile) => {
    setEditingUser(user);
    setEditingCapabilities(user.capabilities || {
      can_auto_expire: false,
      can_see_all_peers: false,
      can_use_restricted_ips: false,
      can_see_restricted_peers: false,
      can_create_users: false,
      can_manage_user_ips: false,
      can_delete: false
    });
    setEditCapabilitiesOpen(true);
  };

  // Save user capabilities using dedicated API endpoint
  const handleSaveCapabilities = async () => {
    if (!editingUser) return;
    setSavingCapabilities(true);
    try {
      // Ensure all capability values are explicit booleans
      const capabilitiesToSave = {
        can_auto_expire: editingCapabilities.can_auto_expire === true,
        can_see_all_peers: editingCapabilities.can_see_all_peers === true,
        can_use_restricted_ips: editingCapabilities.can_use_restricted_ips === true,
        can_see_restricted_peers: editingCapabilities.can_see_restricted_peers === true,
        can_create_users: editingCapabilities.can_create_users === true,
        can_manage_user_ips: editingCapabilities.can_manage_user_ips === true,
        can_delete: editingCapabilities.can_delete === true,
      };

      const res = await fetch("/api/users/capabilities", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: editingUser.id,
          capabilities: capabilitiesToSave
        })
      });

      const data = await res.json();

      if (data.error) {
        toast.error("Failed to update capabilities: " + data.error);
      } else {
        toast.success("Capabilities updated successfully");
        setEditCapabilitiesOpen(false);
        fetchUsers();
      }
    } catch (err) {
      toast.error("Failed to update capabilities");
    }
    setSavingCapabilities(false);
  };

  // View peers for IP
  const handleViewPeers = (ip: PublicIP) => {
    const peersInfo = peersByIp[ip.public_ip];
    setSelectedIpForPeers(ip);
    setSelectedIpPeers(peersInfo?.peers || []);
    setPeersModalOpen(true);
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

  // Filter IPs by search
  const filteredIps = publicIps.filter((ip) => {
    if (!ipSearchQuery) return true;
    const query = ipSearchQuery.toLowerCase();
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
      hasSocks5Access={true}
      onLogout={handleLogout}
    >
      <PageHeader title="Admin Panel" description="Manage routers, users and public IPs">
        <Badge variant="outline" className="text-emerald-400 border-emerald-400">
          <Shield className="w-3 h-3 mr-1" />
          Admin
        </Badge>
      </PageHeader>

      <PageContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="routers" className="gap-2">
              <Server className="w-4 h-4" />
              Routers
            </TabsTrigger>
            <TabsTrigger value="public-ips" className="gap-2">
              <Globe className="w-4 h-4" />
              Public IPs
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-2">
              <Users className="w-4 h-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="access" className="gap-2">
              <UserCheck className="w-4 h-4" />
              Access
            </TabsTrigger>
            <TabsTrigger value="socks5" className="gap-2">
              <Network className="w-4 h-4" />
              SOCKS5
            </TabsTrigger>
          </TabsList>

          {/* Routers Tab */}
          <TabsContent value="routers" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Routers</h3>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => openLogsModal(null)} className="gap-2">
                  <History className="w-4 h-4" />
                  Activity Logs
                </Button>
                <Button onClick={() => setAddRouterOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Router
                </Button>
              </div>
            </div>

            <div className="grid gap-4">
              {routers.map((r) => {
                const resources = routerResources[r.id];
                const isLoading = loadingResources[r.id];
                const isExpanded = expandedRouter === r.id;
                const memoryUsedPercent = resources
                  ? Math.round(((resources.totalMemory - resources.freeMemory) / resources.totalMemory) * 100)
                  : 0;

                return (
                  <Card key={r.id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-primary/10 rounded-lg">
                            <Server className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">{r.name}</CardTitle>
                            <CardDescription className="font-mono text-xs">{r.host}</CardDescription>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{r.connection_type || "api"}</Badge>
                          <Badge variant="outline" className="badge-success">Active</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (isExpanded) {
                                setExpandedRouter(null);
                              } else {
                                setExpandedRouter(r.id);
                                if (!resources) {
                                  fetchRouterResources(r.id);
                                }
                              }
                            }}
                            className="gap-2"
                          >
                            {isLoading ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Activity className="w-4 h-4" />
                            )}
                            {isExpanded ? "Hide Stats" : "Show Stats"}
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openLogsModal(r.id)}
                            className="gap-2"
                          >
                            <History className="w-4 h-4" />
                            Logs
                          </Button>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditRouter(r)}
                            title="Edit Router"
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTestConnection(r.id)}
                            disabled={testingId === r.id}
                            title="Test Connection"
                          >
                            {testingId === r.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Zap className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteRouter(r.id)}
                            className="text-destructive"
                            title="Delete Router"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Expanded Resources Section */}
                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t border-border">
                          {isLoading ? (
                            <div className="flex items-center justify-center py-6">
                              <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                              <span className="ml-2 text-sm text-muted-foreground">Loading resources...</span>
                            </div>
                          ) : resources ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                              {/* CPU */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Cpu className="w-4 h-4" />
                                  <span>CPU</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Progress value={resources.cpuLoad} className="flex-1 h-2" />
                                  <span className="text-sm font-mono font-bold w-12 text-right">{resources.cpuLoad}%</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {resources.cpuCount} cores @ {resources.cpuFrequency} MHz
                                </p>
                              </div>

                              {/* Memory */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <HardDrive className="w-4 h-4" />
                                  <span>Memory</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Progress value={memoryUsedPercent} className="flex-1 h-2" />
                                  <span className="text-sm font-mono font-bold w-12 text-right">{memoryUsedPercent}%</span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {formatMemory(resources.totalMemory - resources.freeMemory)} / {formatMemory(resources.totalMemory)}
                                </p>
                              </div>

                              {/* Uptime */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Clock className="w-4 h-4" />
                                  <span>Uptime</span>
                                </div>
                                <p className="text-sm font-mono">{resources.uptime}</p>
                              </div>

                              {/* Version */}
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Settings className="w-4 h-4" />
                                  <span>Version</span>
                                </div>
                                <p className="text-sm font-mono">{resources.version}</p>
                                <p className="text-xs text-muted-foreground">{resources.boardName}</p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center py-6">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fetchRouterResources(r.id)}
                                className="gap-2"
                              >
                                <Activity className="w-4 h-4" />
                                Load Resources
                              </Button>
                            </div>
                          )}

                          {resources && (
                            <div className="mt-3 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => fetchRouterResources(r.id)}
                                disabled={isLoading}
                                className="gap-2 text-muted-foreground"
                              >
                                <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                                Refresh
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          {/* Public IPs Tab */}
          <TabsContent value="public-ips" className="space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold">Public IPs</h3>
                <Select value={selectedRouterForIps} onValueChange={setSelectedRouterForIps}>
                  <SelectTrigger className="w-[200px] bg-secondary">
                    <SelectValue placeholder="Select router" />
                  </SelectTrigger>
                  <SelectContent>
                    {routers.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Router connection status indicator */}
                {routerConnectionStatus && (
                  <div className="flex items-center gap-2">
                    {routerConnectionStatus === "checking" && (
                      <Badge variant="outline" className="text-muted-foreground border-muted-foreground/50 gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        Checking...
                      </Badge>
                    )}
                    {routerConnectionStatus === "connected" && (
                      <Badge variant="outline" className="text-emerald-400 border-emerald-400/50 gap-1">
                        <CheckCircle className="w-3 h-3" />
                        Connected
                      </Badge>
                    )}
                    {routerConnectionStatus === "disconnected" && (
                      <Badge variant="outline" className="text-red-400 border-red-400/50 gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Disconnected
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Search IPs..."
                    value={ipSearchQuery}
                    onChange={(e) => setIpSearchQuery(e.target.value)}
                    className="pl-9 w-[180px] bg-secondary"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    fetchPublicIps();
                    fetchNatTraffic();
                    fetchPeerCounts();
                  }}
                  disabled={loadingTraffic}
                  title="Refresh data"
                >
                  <RefreshCw className={`w-4 h-4 ${loadingTraffic ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="outline" onClick={handleImportIps} disabled={importing} className="gap-2">
                  <Download className="w-4 h-4" />
                  {importing ? "Importing..." : "Import"}
                </Button>
                <Button variant="outline" onClick={() => setBulkAddOpen(true)} className="gap-2 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/10">
                  <Plus className="w-4 h-4" />
                  Bulk Add
                </Button>
                <Button onClick={() => setAddIpOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add IP
                </Button>
              </div>
            </div>

            {/* Import results */}
            {detectedIps.length > 0 && (
              <Card className="border-emerald-500/50 bg-emerald-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    Detected IPs ({detectedIps.length})
                  </CardTitle>
                  <CardDescription>These IPs are fully configured in MikroTik</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {detectedIps.map((ip) => (
                      <Badge key={ip.ip_number} variant="outline" className="font-mono">
                        {ip.public_ip}
                      </Badge>
                    ))}
                  </div>
                  <Button onClick={handleSaveImportedIps} disabled={savingImported} className="gap-2">
                    <Check className="w-4 h-4" />
                    {savingImported ? "Saving..." : "Save All"}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Partially configured IPs */}
            {partiallyConfiguredIps.length > 0 && showPartialIps && (
              <Card className="border-amber-500/50 bg-amber-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                    Incomplete IPs ({partiallyConfiguredIps.length})
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPartialIps(false)}
                      className="ml-auto h-6 text-xs"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </CardTitle>
                  <CardDescription>These IPs are missing some MikroTik rules (WG, IP, or NAT)</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {partiallyConfiguredIps.map((ip) => (
                      <div key={ip.ip_number} className="flex items-center justify-between p-2 bg-secondary/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="font-mono font-bold w-12">{ip.ip_number}</span>
                          <span className="font-mono text-emerald-400">{ip.public_ip}</span>
                          <div className="flex items-center gap-1">
                            <Badge
                              variant="outline"
                              className={`text-xs px-1 ${ip.has_wg_ip ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`}
                            >
                              WG {ip.has_wg_ip ? <Check className="w-2 h-2 ml-0.5" /> : <X className="w-2 h-2 ml-0.5" />}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs px-1 ${ip.has_ip_address ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`}
                            >
                              IP {ip.has_ip_address ? <Check className="w-2 h-2 ml-0.5" /> : <X className="w-2 h-2 ml-0.5" />}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`text-xs px-1 ${ip.has_nat_rule ? "text-emerald-400 border-emerald-400/50" : "text-red-400 border-red-400/50"}`}
                            >
                              NAT {ip.has_nat_rule ? <Check className="w-2 h-2 ml-0.5" /> : <X className="w-2 h-2 ml-0.5" />}
                            </Badge>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCreateRules(ip.ip_number)}
                          disabled={creatingRulesFor === ip.ip_number}
                          className="h-7 text-xs gap-1"
                        >
                          {creatingRulesFor === ip.ip_number ? (
                            <RefreshCw className="w-3 h-3 animate-spin" />
                          ) : (
                            <>
                              <Zap className="w-3 h-3" />
                              Fix Rules
                            </>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

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
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <Lock className="w-3 h-3" />
                        Restricted
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Created At
                      </div>
                    </TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        Created By
                      </div>
                    </TableHead>
                    <TableHead>Rules</TableHead>
                    <TableHead>
                      <div className="flex items-center gap-1">
                        <Activity className="w-3 h-3" />
                        NAT Traffic
                      </div>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        {ipSearchQuery ? "No IPs match your search" : "No IPs configured"}
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
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleToggleRestriction(ip)}
                              className={`gap-1 h-7 px-2 ${ip.restricted ? "text-amber-400" : "text-muted-foreground"}`}
                              title={ip.restricted ? "Restricted - Only admin can use" : "Available to all users"}
                            >
                              {ip.restricted ? (
                                <>
                                  <Lock className="w-3 h-3" />
                                  Yes
                                </>
                              ) : (
                                <>
                                  <LockOpen className="w-3 h-3" />
                                  No
                                </>
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(ip.created_at)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {ip.created_by ? (
                              <div className="flex items-center gap-1">
                                <User className="w-3 h-3 text-muted-foreground" />
                                <span className="truncate max-w-[120px]" title={ip.created_by}>
                                  {ip.created_by}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {ip.wg_ip_created && <Badge variant="outline" className="text-xs px-1 text-emerald-400 border-emerald-400/50">WG</Badge>}
                              {ip.ip_address_created && <Badge variant="outline" className="text-xs px-1 text-cyan-400 border-cyan-400/50">IP</Badge>}
                              {ip.nat_rule_created && <Badge variant="outline" className="text-xs px-1 text-purple-400 border-purple-400/50">NAT</Badge>}
                              {(!ip.wg_ip_created || !ip.ip_address_created || !ip.nat_rule_created) && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCreateRules(ip.ip_number)}
                                  disabled={creatingRulesFor === ip.ip_number}
                                  className="h-6 text-xs ml-1 text-amber-400 border-amber-400/50 hover:bg-amber-400/10"
                                  title={`Missing: ${[!ip.wg_ip_created && "WG", !ip.ip_address_created && "IP", !ip.nat_rule_created && "NAT"].filter(Boolean).join(", ")}`}
                                >
                                  {creatingRulesFor === ip.ip_number ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <>
                                      <Plus className="w-3 h-3 mr-1" />
                                      Create
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {natTraffic[ip.ip_number] ? (
                              <div className="flex flex-col">
                                <span className="text-sm font-mono text-emerald-400">{formatBytes(natTraffic[ip.ip_number].bytes)}</span>
                                <span className="text-xs text-muted-foreground">{natTraffic[ip.ip_number].packets.toLocaleString()} pkts</span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleIp(ip)}
                                title={ip.enabled ? "Disable" : "Enable"}
                              >
                                {ip.enabled ? (
                                  <X className="w-4 h-4 text-amber-400" />
                                ) : (
                                  <Check className="w-4 h-4 text-emerald-400" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDeleteIp(ip)}
                                className="text-destructive"
                                disabled={deletingIpId === ip.id}
                              >
                                {deletingIpId === ip.id ? (
                                  <RefreshCw className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Restricted IPs are only visible to admins when creating peers</span>
              </div>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Users</h3>
              <Button onClick={() => setAddUserOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add User
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead>Email</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => {
                    const caps = u.capabilities || {};
                    return (
                      <TableRow key={u.id} className="border-border hover:bg-secondary/50 transition-colors">
                        <TableCell>
                          <button
                            onClick={() => router.push(`/admin/users/${u.id}`)}
                            className="font-medium hover:text-primary transition-colors text-left"
                          >
                            {u.email}
                          </button>
                        </TableCell>
                        <TableCell>{u.username || "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={u.role === "admin" ? "text-emerald-400" : ""}>
                            {u.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {u.role === "admin" ? (
                            <span className="text-muted-foreground text-xs">All access</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {caps.can_auto_expire && (
                                <Badge variant="outline" className="text-xs px-1 text-amber-400 border-amber-400">
                                  <Timer className="w-3 h-3 mr-1" />
                                  Expire
                                </Badge>
                              )}
                              {caps.can_see_all_peers && (
                                <Badge variant="outline" className="text-xs px-1 text-cyan-400 border-cyan-400">
                                  <Eye className="w-3 h-3 mr-1" />
                                  All
                                </Badge>
                              )}
                              {caps.can_use_restricted_ips && (
                                <Badge variant="outline" className="text-xs px-1 text-emerald-400 border-emerald-400">
                                  <Lock className="w-3 h-3 mr-1" />
                                  UseIP
                                </Badge>
                              )}
                              {caps.can_see_restricted_peers && (
                                <Badge variant="outline" className="text-xs px-1 text-purple-400 border-purple-400">
                                  <Eye className="w-3 h-3 mr-1" />
                                  SeeIP
                                </Badge>
                              )}
                              {caps.can_create_users && (
                                <Badge variant="outline" className="text-xs px-1 text-blue-400 border-blue-400">
                                  <Users className="w-3 h-3 mr-1" />
                                  Create
                                </Badge>
                              )}
                              {caps.can_delete && (
                                <Badge variant="outline" className="text-xs px-1 text-red-400 border-red-400">
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  Delete
                                </Badge>
                              )}
                              {!caps.can_auto_expire && !caps.can_see_all_peers && !caps.can_use_restricted_ips && !caps.can_see_restricted_peers && !caps.can_create_users && !caps.can_delete && (
                                <span className="text-muted-foreground text-xs">None</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(u.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(`/admin/users/${u.id}`)}
                              className="gap-1 text-primary"
                              title="Manage user"
                            >
                              <Settings className="w-4 h-4" />
                              Manage
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteUser(u.id)}
                              className="text-destructive"
                              disabled={u.id === profile?.id}
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
            </div>
          </TabsContent>

          {/* Access Tab */}
          <TabsContent value="access" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">User Router Access</h3>
              <Button onClick={() => setAddAccessOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Grant Access
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead>User</TableHead>
                    <TableHead>Router</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userRouters.map((ur) => (
                    <TableRow key={ur.id} className="border-border">
                      <TableCell className="font-medium">
                        {ur.profiles?.email || ur.user_id}
                      </TableCell>
                      <TableCell>{ur.routers?.name || ur.router_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(ur.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteAccess(ur.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* SOCKS5 Tab */}
          <TabsContent value="socks5" className="space-y-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Network className="w-5 h-5 text-primary" />
                  SOCKS5 Proxy Management
                </CardTitle>
                <CardDescription>
                  Create and manage SOCKS5 proxies on your routers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button onClick={() => router.push("/socks5")} className="gap-2">
                  <Settings className="w-4 h-4" />
                  Manage Proxies
                </Button>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-semibold">User Proxy Access</h3>
                <Button onClick={() => setAddSocks5AccessOpen(true)} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Grant Proxy Access
                </Button>
              </div>

              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border">
                      <TableHead>User</TableHead>
                      <TableHead>Proxy</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead>Granted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {userSocks5Proxies.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                          No proxy access assigned yet
                        </TableCell>
                      </TableRow>
                    ) : (
                      userSocks5Proxies.map((up) => (
                        <TableRow key={up.id} className="border-border">
                          <TableCell className="font-medium">
                            {up.profiles?.email || up.user_id}
                          </TableCell>
                          <TableCell>
                            {up.socks5_proxies?.name || up.socks5_proxies?.username || "-"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">
                              {up.socks5_proxies?.public_ip || "-"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(up.created_at)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteSocks5Access(up.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle>Proxy Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center p-4 bg-secondary/50 rounded-lg">
                    <div className="text-2xl font-bold text-primary">{socks5Proxies.length}</div>
                    <div className="text-sm text-muted-foreground">Total Proxies</div>
                  </div>
                  <div className="text-center p-4 bg-secondary/50 rounded-lg">
                    <div className="text-2xl font-bold text-emerald-500">{userSocks5Proxies.length}</div>
                    <div className="text-sm text-muted-foreground">Assigned</div>
                  </div>
                  <div className="text-center p-4 bg-secondary/50 rounded-lg">
                    <div className="text-2xl font-bold text-amber-500">
                      {new Set(socks5Proxies.map(p => p.router_id)).size}
                    </div>
                    <div className="text-sm text-muted-foreground">Routers</div>
                  </div>
                  <div className="text-center p-4 bg-secondary/50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-500">
                      {new Set(userSocks5Proxies.map(up => up.user_id)).size}
                    </div>
                    <div className="text-sm text-muted-foreground">Users with Access</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>

      {/* Add SOCKS5 Proxy Access Dialog */}
      <Dialog open={addSocks5AccessOpen} onOpenChange={setAddSocks5AccessOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Grant Proxy Access</DialogTitle>
            <DialogDescription>
              Assign a SOCKS5 proxy to a user
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={newSocks5Access.user_id}
                onValueChange={(v) => setNewSocks5Access({ ...newSocks5Access, user_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Proxy</Label>
              <Select
                value={newSocks5Access.socks5_proxy_id}
                onValueChange={(v) => setNewSocks5Access({ ...newSocks5Access, socks5_proxy_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select proxy" />
                </SelectTrigger>
                <SelectContent>
                  {socks5Proxies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name || p.username} - {p.public_ip} ({p.routers?.name || "Unknown router"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddSocks5AccessOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddSocks5Access} disabled={addingSocks5Access}>
              {addingSocks5Access ? "Granting..." : "Grant Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Router Dialog */}
      <Dialog open={addRouterOpen} onOpenChange={setAddRouterOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Router / Server</DialogTitle>
            <DialogDescription>
              {newRouter.connection_type === "linux-ssh"
                ? "Add a Linux WireGuard server via SSH"
                : "Add a new MikroTik router"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Connection Type</Label>
              <Select
                value={newRouter.connection_type}
                onValueChange={(v) => setNewRouter({ ...newRouter, connection_type: v as ConnectionType })}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">MikroTik API (8728)</SelectItem>
                  <SelectItem value="api-ssl">MikroTik API SSL (8729)</SelectItem>
                  <SelectItem value="rest">MikroTik REST (443)</SelectItem>
                  <SelectItem value="rest-8443">MikroTik REST (8443)</SelectItem>
                  <SelectItem value="linux-ssh">Linux SSH</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder={newRouter.connection_type === "linux-ssh" ? "My Linux Server" : "My Router"}
                  value={newRouter.name}
                  onChange={(e) => setNewRouter({ ...newRouter, name: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>Host / IP</Label>
                <Input
                  placeholder="192.168.1.1"
                  value={newRouter.host}
                  onChange={(e) => setNewRouter({ ...newRouter, host: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              {newRouter.connection_type !== "linux-ssh" && (
                <>
                  <div className="space-y-2">
                    <Label>REST Port</Label>
                    <Input
                      placeholder="443"
                      value={newRouter.port}
                      onChange={(e) => setNewRouter({ ...newRouter, port: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>API Port</Label>
                    <Input
                      placeholder="8728"
                      value={newRouter.api_port}
                      onChange={(e) => setNewRouter({ ...newRouter, api_port: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                </>
              )}
              {newRouter.connection_type === "linux-ssh" && (
                <div className="space-y-2">
                  <Label>SSH Port</Label>
                  <Input
                    placeholder="22"
                    value={newRouter.ssh_port}
                    onChange={(e) => setNewRouter({ ...newRouter, ssh_port: e.target.value })}
                    className="bg-secondary"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  placeholder={newRouter.connection_type === "linux-ssh" ? "root" : "admin"}
                  value={newRouter.username}
                  onChange={(e) => setNewRouter({ ...newRouter, username: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  placeholder="••••••••"
                  value={newRouter.password}
                  onChange={(e) => setNewRouter({ ...newRouter, password: e.target.value })}
                  className="bg-secondary"
                />
              </div>
            </div>
            {newRouter.connection_type === "linux-ssh" && (
              <>
                <div className="space-y-2">
                  <Label>SSH Auth Method</Label>
                  <Select
                    value={newRouter.ssh_auth_method}
                    onValueChange={(v) => setNewRouter({ ...newRouter, ssh_auth_method: v as "password" | "key" | "both" })}
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password Only</SelectItem>
                      <SelectItem value="key">SSH Key Only</SelectItem>
                      <SelectItem value="both">Both (Key preferred)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(newRouter.ssh_auth_method === "key" || newRouter.ssh_auth_method === "both") && (
                  <div className="space-y-2">
                    <Label>SSH Private Key (optional)</Label>
                    <Textarea
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      value={newRouter.ssh_key}
                      onChange={(e) => setNewRouter({ ...newRouter, ssh_key: e.target.value })}
                      className="bg-secondary font-mono text-xs h-24"
                    />
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRouterOpen(false)}>Cancel</Button>
            <Button onClick={handleAddRouter} disabled={adding}>
              {adding ? "Adding..." : newRouter.connection_type === "linux-ssh" ? "Add Linux Server" : "Add Router"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Router Dialog */}
      <Dialog open={editRouterOpen} onOpenChange={setEditRouterOpen}>
        <DialogContent className="bg-card border-border max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Router / Server</DialogTitle>
            <DialogDescription>
              Update router configuration and IP settings
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Connection Type</Label>
              <Select
                value={editRouterData.connection_type}
                onValueChange={(v) => setEditRouterData({ ...editRouterData, connection_type: v as ConnectionType })}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="api">MikroTik API (8728)</SelectItem>
                  <SelectItem value="api-ssl">MikroTik API SSL (8729)</SelectItem>
                  <SelectItem value="rest">MikroTik REST (443)</SelectItem>
                  <SelectItem value="rest-8443">MikroTik REST (8443)</SelectItem>
                  <SelectItem value="linux-ssh">Linux SSH</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  placeholder="My Router"
                  value={editRouterData.name}
                  onChange={(e) => setEditRouterData({ ...editRouterData, name: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>Host / IP *</Label>
                <Input
                  placeholder="192.168.1.1"
                  value={editRouterData.host}
                  onChange={(e) => setEditRouterData({ ...editRouterData, host: e.target.value })}
                  className="bg-secondary"
                />
              </div>

              {editRouterData.connection_type !== "linux-ssh" && (
                <>
                  <div className="space-y-2">
                    <Label>REST Port</Label>
                    <Input
                      placeholder="443"
                      value={editRouterData.port}
                      onChange={(e) => setEditRouterData({ ...editRouterData, port: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>API Port</Label>
                    <Input
                      placeholder="8728"
                      value={editRouterData.api_port}
                      onChange={(e) => setEditRouterData({ ...editRouterData, api_port: e.target.value })}
                      className="bg-secondary"
                    />
                  </div>
                </>
              )}

              {editRouterData.connection_type === "linux-ssh" && (
                <div className="space-y-2">
                  <Label>SSH Port</Label>
                  <Input
                    placeholder="22"
                    value={editRouterData.ssh_port}
                    onChange={(e) => setEditRouterData({ ...editRouterData, ssh_port: e.target.value })}
                    className="bg-secondary"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Username *</Label>
                <Input
                  placeholder={editRouterData.connection_type === "linux-ssh" ? "root" : "admin"}
                  value={editRouterData.username}
                  onChange={(e) => setEditRouterData({ ...editRouterData, username: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>Password (leave empty to keep current)</Label>
                <Input
                  type="password"
                  placeholder="********"
                  value={editRouterData.password}
                  onChange={(e) => setEditRouterData({ ...editRouterData, password: e.target.value })}
                  className="bg-secondary"
                />
              </div>
            </div>

            {editRouterData.connection_type === "linux-ssh" && (
              <>
                <div className="space-y-2">
                  <Label>SSH Auth Method</Label>
                  <Select
                    value={editRouterData.ssh_auth_method}
                    onValueChange={(v) => setEditRouterData({ ...editRouterData, ssh_auth_method: v as "password" | "key" | "both" })}
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="password">Password Only</SelectItem>
                      <SelectItem value="key">SSH Key Only</SelectItem>
                      <SelectItem value="both">Both (Key preferred)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(editRouterData.ssh_auth_method === "key" || editRouterData.ssh_auth_method === "both") && (
                  <div className="space-y-2">
                    <Label>SSH Private Key</Label>
                    <Textarea
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      value={editRouterData.ssh_key}
                      onChange={(e) => setEditRouterData({ ...editRouterData, ssh_key: e.target.value })}
                      className="bg-secondary font-mono text-xs h-24"
                    />
                  </div>
                )}
              </>
            )}

            <div className="pt-4 border-t border-border">
              <h4 className="font-semibold mb-4 flex items-center gap-2">
                <Network className="w-4 h-4 text-emerald-400" />
                IP Configuration (Required for Public IPs)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Public IP Prefix *</Label>
                  <Input
                    placeholder={editRouterData.connection_type === "linux-ssh" ? "69.176.94" : "76.245.59"}
                    value={editRouterData.public_ip_prefix}
                    onChange={(e) => setEditRouterData({ ...editRouterData, public_ip_prefix: e.target.value })}
                    className="bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">First 3 octets (e.g., 69.176.94)</p>
                </div>
                <div className="space-y-2">
                  <Label>Internal Prefix</Label>
                  <Input
                    placeholder="10.10"
                    value={editRouterData.internal_prefix}
                    onChange={(e) => setEditRouterData({ ...editRouterData, internal_prefix: e.target.value })}
                    className="bg-secondary"
                  />
                  <p className="text-xs text-muted-foreground">First 2 octets (e.g., 10.10)</p>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    WireGuard Interface
                    {loadingEditInterfaces && <RefreshCw className="w-3 h-3 animate-spin" />}
                  </Label>
                  {detectedWgInterfaces.length > 0 ? (
                    <Select
                      value={editRouterData.wg_interface}
                      onValueChange={(v) => setEditRouterData({ ...editRouterData, wg_interface: v })}
                    >
                      <SelectTrigger className="bg-secondary">
                        <SelectValue placeholder="Select WG interface" />
                      </SelectTrigger>
                      <SelectContent>
                        {detectedWgInterfaces.map((iface) => (
                          <SelectItem key={iface} value={iface}>{iface}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder={editRouterData.connection_type === "linux-ssh" ? "wg1" : "wg0"}
                      value={editRouterData.wg_interface}
                      onChange={(e) => setEditRouterData({ ...editRouterData, wg_interface: e.target.value })}
                      className="bg-secondary"
                    />
                  )}
                  {detectedWgInterfaces.length > 0 && (
                    <p className="text-xs text-emerald-400">Detected {detectedWgInterfaces.length} WG interface(s)</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    Output Interface
                    {loadingEditInterfaces && <RefreshCw className="w-3 h-3 animate-spin" />}
                  </Label>
                  {detectedNetworkInterfaces.length > 0 ? (
                    <Select
                      value={editRouterData.out_interface}
                      onValueChange={(v) => setEditRouterData({ ...editRouterData, out_interface: v })}
                    >
                      <SelectTrigger className="bg-secondary">
                        <SelectValue placeholder="Select output interface" />
                      </SelectTrigger>
                      <SelectContent>
                        {detectedNetworkInterfaces.map((iface) => (
                          <SelectItem key={iface} value={iface}>{iface}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder={editRouterData.connection_type === "linux-ssh" ? "ens192" : "ether2"}
                      value={editRouterData.out_interface}
                      onChange={(e) => setEditRouterData({ ...editRouterData, out_interface: e.target.value })}
                      className="bg-secondary"
                    />
                  )}
                  {detectedNetworkInterfaces.length > 0 && (
                    <p className="text-xs text-emerald-400">Detected {detectedNetworkInterfaces.length} interface(s)</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Public IP Mask</Label>
                  <Input
                    placeholder="/24"
                    value={editRouterData.public_ip_mask}
                    onChange={(e) => setEditRouterData({ ...editRouterData, public_ip_mask: e.target.value })}
                    className="bg-secondary"
                  />
                </div>
              </div>
            </div>

            <div className="bg-secondary/50 p-4 rounded-lg text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-2">How IP Configuration Works:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>If you add IP number <strong>200</strong>:</li>
                <li className="ml-4">Public IP: {editRouterData.public_ip_prefix || "X.X.X"}.200</li>
                <li className="ml-4">Internal Subnet: {editRouterData.internal_prefix || "10.10"}.200.0/24</li>
                <li className="ml-4">WG Gateway: {editRouterData.internal_prefix || "10.10"}.200.1</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRouterOpen(false)}>Cancel</Button>
            <Button onClick={handleEditRouter} disabled={savingRouter}>
              {savingRouter ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add IP Dialog */}
      <Dialog open={addIpOpen} onOpenChange={setAddIpOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Add Public IP</DialogTitle>
            <DialogDescription>Add a new public IP number</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>IP Number (last octet)</Label>
              <Input
                type="number"
                placeholder="200"
                value={newIpNumber}
                onChange={(e) => setNewIpNumber(e.target.value)}
                className="bg-secondary"
              />
              <p className="text-xs text-muted-foreground">
                This will create IP based on router prefix configuration
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddIpOpen(false)}>Cancel</Button>
            <Button onClick={handleAddIp} disabled={addingIp}>
              {addingIp ? "Adding..." : "Add IP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Add IPs Dialog */}
      <Dialog open={bulkAddOpen} onOpenChange={setBulkAddOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-emerald-400" />
              Bulk Add Public IPs
            </DialogTitle>
            <DialogDescription>
              Add multiple IPs at once by specifying a range
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start IP Number</Label>
                <Input
                  type="number"
                  placeholder="111"
                  min="1"
                  max="254"
                  value={bulkStartIp}
                  onChange={(e) => setBulkStartIp(e.target.value)}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>End IP Number</Label>
                <Input
                  type="number"
                  placeholder="126"
                  min="1"
                  max="254"
                  value={bulkEndIp}
                  onChange={(e) => setBulkEndIp(e.target.value)}
                  className="bg-secondary"
                />
              </div>
            </div>
            {bulkStartIp && bulkEndIp && parseInt(bulkEndIp) >= parseInt(bulkStartIp) && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <p className="text-sm text-emerald-400 font-medium">
                  Will add {parseInt(bulkEndIp) - parseInt(bulkStartIp) + 1} IPs
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  From {routers.find(r => r.id === selectedRouterForIps)?.public_ip_prefix || "X.X.X"}.{bulkStartIp} to {routers.find(r => r.id === selectedRouterForIps)?.public_ip_prefix || "X.X.X"}.{bulkEndIp}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              IPs will be created based on router prefix configuration. Existing IPs in the range will be skipped.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleBulkAddIps}
              disabled={bulkAdding || !bulkStartIp || !bulkEndIp}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              {bulkAdding ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Add {bulkStartIp && bulkEndIp ? `${parseInt(bulkEndIp) - parseInt(bulkStartIp) + 1} IPs` : "IPs"}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add User Dialog */}
      <Dialog open={addUserOpen} onOpenChange={setAddUserOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
            <DialogDescription>Create a new user account</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="user@example.com"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <Label>Username (optional)</Label>
              <Input
                placeholder="johndoe"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                className="bg-secondary"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select
                value={newUser.role}
                onValueChange={(v) => setNewUser({ ...newUser, role: v as UserRole })}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddUserOpen(false)}>Cancel</Button>
            <Button onClick={handleAddUser} disabled={creatingUser}>
              {creatingUser ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Grant Access Dialog */}
      <Dialog open={addAccessOpen} onOpenChange={setAddAccessOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Grant Router Access</DialogTitle>
            <DialogDescription>Allow a user to access a router</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Select
                value={newAccess.user_id}
                onValueChange={(v) => setNewAccess({ ...newAccess, user_id: v })}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue placeholder="Select user" />
                </SelectTrigger>
                <SelectContent>
                  {users.filter(u => u.role !== "admin").map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Router</Label>
              <Select
                value={newAccess.router_id}
                onValueChange={(v) => setNewAccess({ ...newAccess, router_id: v })}
              >
                <SelectTrigger className="bg-secondary">
                  <SelectValue placeholder="Select router" />
                </SelectTrigger>
                <SelectContent>
                  {routers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddAccessOpen(false)}>Cancel</Button>
            <Button onClick={handleAddAccess} disabled={addingAccess}>
              {addingAccess ? "Granting..." : "Grant Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Capabilities Dialog */}
      <Dialog open={editCapabilitiesOpen} onOpenChange={setEditCapabilitiesOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Edit User Capabilities</DialogTitle>
            <DialogDescription>
              Configure permissions for {editingUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-4">
              {/* Can Auto Expire */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Timer className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="font-medium">Auto-Expire Peers</p>
                    <p className="text-sm text-muted-foreground">
                      Can set expiration time when creating peers
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_auto_expire: !editingCapabilities.can_auto_expire
                  })}
                  className={editingCapabilities.can_auto_expire ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_auto_expire ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>

              {/* Can See All Peers */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Eye className="w-5 h-5 text-cyan-400" />
                  <div>
                    <p className="font-medium">See All Peers</p>
                    <p className="text-sm text-muted-foreground">
                      Can view all peers, not just their own
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_see_all_peers: !editingCapabilities.can_see_all_peers
                  })}
                  className={editingCapabilities.can_see_all_peers ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_see_all_peers ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>

              {/* Can Use Restricted IPs */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-emerald-400" />
                  <div>
                    <p className="font-medium">Use Restricted IPs</p>
                    <p className="text-sm text-muted-foreground">
                      Can CREATE peers with restricted IPs
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_use_restricted_ips: !editingCapabilities.can_use_restricted_ips
                  })}
                  className={editingCapabilities.can_use_restricted_ips ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_use_restricted_ips ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>

              {/* Can See Restricted Peers */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Eye className="w-5 h-5 text-amber-400" />
                  <div>
                    <p className="font-medium">See Restricted Peers</p>
                    <p className="text-sm text-muted-foreground">
                      Can SEE peers that use restricted IPs
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_see_restricted_peers: !editingCapabilities.can_see_restricted_peers
                  })}
                  className={editingCapabilities.can_see_restricted_peers ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_see_restricted_peers ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>

              {/* Can Create Users */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Users className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="font-medium">Create Users</p>
                    <p className="text-sm text-muted-foreground">
                      Can create new users (non-admin only)
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_create_users: !editingCapabilities.can_create_users
                  })}
                  className={editingCapabilities.can_create_users ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_create_users ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>

              {/* Can Delete */}
              <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                <div className="flex items-center gap-3">
                  <Trash2 className="w-5 h-5 text-red-400" />
                  <div>
                    <p className="font-medium">Delete Peers & Users</p>
                    <p className="text-sm text-muted-foreground">
                      Can delete peers and users they created
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingCapabilities({
                    ...editingCapabilities,
                    can_delete: !editingCapabilities.can_delete
                  })}
                  className={editingCapabilities.can_delete ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {editingCapabilities.can_delete ? (
                    <ToggleRight className="w-8 h-8" />
                  ) : (
                    <ToggleLeft className="w-8 h-8" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCapabilitiesOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCapabilities} disabled={savingCapabilities}>
              {savingCapabilities ? "Saving..." : "Save Capabilities"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Peers Modal - Interactive */}
      <Dialog open={peersModalOpen} onOpenChange={setPeersModalOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle>Peers using {selectedIpForPeers?.public_ip}</DialogTitle>
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
                        onClick={async () => {
                          const action = peer.disabled ? "enablePeer" : "disablePeer";
                          const res = await fetch("/api/wireguard", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action, routerId: selectedRouterForIps, data: { id: peer.id } })
                          });
                          const data = await res.json();
                          if (data.success) {
                            toast.success(peer.disabled ? "Peer enabled" : "Peer disabled");
                            fetchPeerCounts();
                          } else {
                            toast.error(data.error || "Failed");
                          }
                        }}
                        className={peer.disabled ? "gap-1 text-emerald-400 hover:text-emerald-300" : "gap-1 text-amber-400 hover:text-amber-300"}
                        title={peer.disabled ? "Enable peer" : "Disable peer"}
                      >
                        {peer.disabled ? <Power className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (!confirm("Delete this peer?")) return;
                          const res = await fetch("/api/wireguard", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterForIps, data: { id: peer.id, "public-key": peer.publicKey, publicKey: peer.publicKey } })
                          });
                          const data = await res.json();
                          if (data.success) {
                            toast.success("Peer deleted");
                            fetchPeerCounts();
                            setSelectedIpPeers(prev => prev.filter(p => p.id !== peer.id));
                          } else {
                            toast.error(data.error || "Failed to delete");
                          }
                        }}
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

      {/* Peer Detail Dialog - Same style as Dashboard */}
      <Dialog open={peerDetailOpen} onOpenChange={setPeerDetailOpen}>
        <DialogContent className="bg-card border-border max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{selectedPeerDetail?.name || "Peer Configuration"}</span>
            </DialogTitle>
            <DialogDescription>
              View and manage peer configuration
            </DialogDescription>
          </DialogHeader>
          {selectedPeerDetail && (
            <div className="space-y-4 py-4">
              {/* Peer Info */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-secondary rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">Interface</Label>
                  <p className="font-mono text-sm">{selectedPeerDetail.interface || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Badge variant="outline" className={(selectedPeerDetail.disabled === true || String(selectedPeerDetail.disabled) === "true") ? "text-red-400" : "text-emerald-400"}>
                    {(selectedPeerDetail.disabled === true || String(selectedPeerDetail.disabled) === "true") ? "Disabled" : "Enabled"}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Allowed Address</Label>
                  <p className="font-mono text-sm text-cyan-400">{selectedPeerDetail.address || "-"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Public IP</Label>
                  <p className="font-mono text-sm text-emerald-400">{selectedPeerDetail.comment || "-"}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                {/* Enable/Disable Button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    const isDisabled = selectedPeerDetail.disabled === true || String(selectedPeerDetail.disabled) === "true";
                    const action = isDisabled ? "enablePeer" : "disablePeer";
                    const res = await fetch("/api/wireguard", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action, routerId: selectedRouterForIps, data: { id: selectedPeerDetail.id } })
                    });
                    const data = await res.json();
                    if (data.success) {
                      toast.success(isDisabled ? "Peer enabled" : "Peer disabled");
                      fetchPeerCounts();
                      // Update local state
                      setSelectedPeerDetail(prev => prev ? {...prev, disabled: !isDisabled} : null);
                      setSelectedIpPeers(prev => prev.map(p =>
                        p.id === selectedPeerDetail.id ? {...p, disabled: !isDisabled} : p
                      ));
                    } else {
                      toast.error(data.error || "Failed");
                    }
                  }}
                  className="gap-1"
                >
                  {(selectedPeerDetail.disabled === true || String(selectedPeerDetail.disabled) === "true") ? (
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
              </div>

              {/* Config Editor - Textarea Style */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>WireGuard Configuration</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const config = `[Interface]
PrivateKey = ${selectedPeerDetail.privateKey || "[CLIENT_PRIVATE_KEY]"}
Address = ${selectedPeerDetail.address?.split("/")[0]}/32
DNS = 8.8.8.8

[Peer]
PublicKey = [SERVER_PUBLIC_KEY]
AllowedIPs = 0.0.0.0/0
Endpoint = ${selectedPeerDetail.comment || "server"}:13231
PersistentKeepalive = 25`;
                        navigator.clipboard.writeText(config);
                        toast.success("Configuration copied to clipboard");
                      }}
                      className="gap-1"
                    >
                      <Check className="w-3 h-3" />
                      Copy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const config = `[Interface]
PrivateKey = ${selectedPeerDetail.privateKey || "[CLIENT_PRIVATE_KEY]"}
Address = ${selectedPeerDetail.address?.split("/")[0]}/32
DNS = 8.8.8.8

[Peer]
PublicKey = [SERVER_PUBLIC_KEY]
AllowedIPs = 0.0.0.0/0
Endpoint = ${selectedPeerDetail.comment || "server"}:13231
PersistentKeepalive = 25`;
                        const blob = new Blob([config], { type: "text/plain" });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement("a");
                        link.href = url;
                        link.download = `${selectedPeerDetail.name || "wireguard"}.conf`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        toast.success("Configuration downloaded");
                      }}
                      className="gap-1"
                    >
                      <Download className="w-3 h-3" />
                      Download
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={`[Interface]
PrivateKey = ${selectedPeerDetail.privateKey || "[CLIENT_PRIVATE_KEY]"}
Address = ${selectedPeerDetail.address?.split("/")[0]}/32
DNS = 8.8.8.8

[Peer]
PublicKey = [SERVER_PUBLIC_KEY]
AllowedIPs = 0.0.0.0/0
Endpoint = ${selectedPeerDetail.comment || "server"}:13231
PersistentKeepalive = 25`}
                  readOnly
                  className="font-mono text-xs bg-secondary border-border h-[250px] resize-none"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPeerDetailOpen(false)}>
              Close
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!selectedPeerDetail) return;
                if (!confirm("Delete this peer?")) return;
                const res = await fetch("/api/wireguard", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterForIps, data: { id: selectedPeerDetail.id, "public-key": selectedPeerDetail.publicKey } })
                });
                const data = await res.json();
                if (data.success) {
                  toast.success("Peer deleted");
                  fetchPeerCounts();
                  setSelectedIpPeers(prev => prev.filter(p => p.id !== selectedPeerDetail.id));
                  setPeerDetailOpen(false);
                } else {
                  toast.error(data.error || "Failed to delete");
                }
              }}
              className="gap-1"
            >
              <Trash2 className="w-4 h-4" />
              Delete Peer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activity Logs Modal */}
      <Dialog open={logsModalOpen} onOpenChange={setLogsModalOpen}>
        <DialogContent className="bg-card border-border max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="w-5 h-5" />
              Activity Logs
              {selectedRouterForLogs && routers.find(r => r.id === selectedRouterForLogs) && (
                <Badge variant="outline" className="ml-2">
                  {routers.find(r => r.id === selectedRouterForLogs)?.name}
                </Badge>
              )}
              <Badge variant="secondary" className="ml-auto">
                {logsTotal.toLocaleString()} total records
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {selectedRouterForLogs
                ? "Activity history for this router. Use the search to filter by IP, name, HWID, license, or any text."
                : "System-wide activity history. Search across all fields including details."
              }
            </DialogDescription>
          </DialogHeader>

          {/* Tabs for Logs/Charts */}
          <div className="flex gap-2 border-b border-border pb-3">
            <Button
              variant={logsModalTab === "logs" ? "default" : "outline"}
              size="sm"
              onClick={() => setLogsModalTab("logs")}
              className="gap-2"
            >
              <History className="w-4 h-4" />
              Logs
            </Button>
            <Button
              variant={logsModalTab === "charts" ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setLogsModalTab("charts");
                if (!activityStats) {
                  fetchActivityStats(selectedRouterForLogs);
                }
              }}
              className="gap-2"
            >
              <BarChart3 className="w-4 h-4" />
              Charts
            </Button>
          </div>

          {logsModalTab === "logs" && (
            <>
          {/* Search and Filters */}
          <div className="space-y-3 border-b border-border pb-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by IP, name, HWID, license, location, or any text... (like Ctrl+F)"
                value={logsSearchQuery}
                onChange={(e) => setLogsSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    fetchActivityLogs(selectedRouterForLogs, true);
                  }
                }}
                className="pl-9 pr-20 bg-secondary"
              />
              {logsSearchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setLogsSearchQuery("");
                    fetchActivityLogs(selectedRouterForLogs, true);
                  }}
                  className="absolute right-12 top-1/2 -translate-y-1/2 h-6 px-2"
                >
                  <XCircle className="w-3 h-3" />
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchActivityLogs(selectedRouterForLogs, true)}
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7"
              >
                Search
              </Button>
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-3">
              {/* Router Filter */}
              <Select
                value={selectedRouterForLogs || "all"}
                onValueChange={(v) => {
                  const routerId = v === "all" ? null : v;
                  setSelectedRouterForLogs(routerId);
                  fetchActivityLogs(routerId, true);
                }}
              >
                <SelectTrigger className="w-[180px] bg-secondary h-8 text-sm">
                  <Server className="w-3 h-3 mr-2" />
                  <SelectValue placeholder="Filter by router" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Routers</SelectItem>
                  {routers.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Date Range */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-muted-foreground" />
                  <Input
                    type="date"
                    value={logsStartDate}
                    onChange={(e) => setLogsStartDate(e.target.value)}
                    className="w-[130px] h-8 text-sm bg-secondary"
                    placeholder="Start date"
                  />
                </div>
                <span className="text-muted-foreground text-sm">to</span>
                <Input
                  type="date"
                  value={logsEndDate}
                  onChange={(e) => setLogsEndDate(e.target.value)}
                  className="w-[130px] h-8 text-sm bg-secondary"
                  placeholder="End date"
                />
              </div>

              {/* Apply Date Filter Button */}
              {(logsStartDate || logsEndDate) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchActivityLogs(selectedRouterForLogs, true)}
                  className="h-8 gap-1"
                >
                  <Filter className="w-3 h-3" />
                  Apply
                </Button>
              )}

              {/* Clear Filters */}
              {(logsSearchQuery || logsStartDate || logsEndDate || selectedRouterForLogs) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearLogsFilters}
                  className="h-8 gap-1 text-muted-foreground"
                >
                  <XCircle className="w-3 h-3" />
                  Clear all filters
                </Button>
              )}

              {/* Refresh Button */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => fetchActivityLogs(selectedRouterForLogs, true)}
                disabled={loadingLogs}
                className="h-8 w-8 ml-auto"
              >
                <RefreshCw className={`w-3 h-3 ${loadingLogs ? "animate-spin" : ""}`} />
              </Button>
            </div>

            {/* Search Tips */}
            <div className="text-xs text-muted-foreground flex items-center gap-4">
              <span className="flex items-center gap-1">
                <Search className="w-3 h-3" />
                Tip: Search works on IP addresses, names, HWIDs, licenses, locations, and all log details
              </span>
            </div>
          </div>

          {/* Logs List */}
          <div className="overflow-y-auto max-h-[50vh] space-y-2">
            {loadingLogs ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Loading logs...</span>
              </div>
            ) : activityLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <History className="w-10 h-10 mb-2 opacity-50" />
                <p>No activity logs found</p>
                <p className="text-xs">
                  {logsSearchQuery
                    ? `No results matching "${logsSearchQuery}"`
                    : "Activity will be recorded as you use the system"
                  }
                </p>
              </div>
            ) : (
              <>
                {activityLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                  >
                    <div className={`p-1.5 rounded-full bg-background ${getActionColor(log.action as "create" | "update" | "delete" | "enable" | "disable" | "renew" | "connect" | "disconnect" | "login" | "logout")}`}>
                      {log.action === "create" && <Plus className="w-3 h-3" />}
                      {log.action === "update" && <Pencil className="w-3 h-3" />}
                      {log.action === "delete" && <Trash2 className="w-3 h-3" />}
                      {log.action === "enable" && <Power className="w-3 h-3" />}
                      {log.action === "disable" && <PowerOff className="w-3 h-3" />}
                      {!["create", "update", "delete", "enable", "disable"].includes(log.action) && <Activity className="w-3 h-3" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {formatLogMessage(
                          log.action as "create" | "update" | "delete" | "enable" | "disable" | "renew" | "connect" | "disconnect" | "login" | "logout",
                          log.entity_type as "peer" | "public_ip" | "router" | "user" | "interface" | "nat_rule" | "session",
                          log.entity_name
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                        {log.profiles && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {log.profiles.username || log.profiles.email}
                          </span>
                        )}
                        {log.routers && (
                          <span className="flex items-center gap-1">
                            <Server className="w-3 h-3" />
                            {log.routers.name}
                          </span>
                        )}
                        {log.ip_address && (
                          <span className="flex items-center gap-1 font-mono text-cyan-400">
                            <Globe className="w-3 h-3" />
                            {log.ip_address}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      {/* Show details if they exist and contain useful info */}
                      {log.details && Object.keys(log.details).length > 0 && (
                        <div className="mt-2 p-2 bg-background/50 rounded text-xs font-mono text-muted-foreground overflow-x-auto">
                          {Object.entries(log.details).map(([key, value]) => (
                            <div key={key} className="flex gap-2">
                              <span className="text-amber-400">{key}:</span>
                              <span className="truncate">{JSON.stringify(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {/* Load More Button */}
                {logsHasMore && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      onClick={loadMoreLogs}
                      disabled={loadingMoreLogs}
                      className="gap-2"
                    >
                      {loadingMoreLogs ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" />
                          Load More ({activityLogs.length} of {logsTotal.toLocaleString()})
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* Showing count */}
                {!logsHasMore && activityLogs.length > 0 && (
                  <div className="text-center pt-4 text-sm text-muted-foreground">
                    Showing all {activityLogs.length.toLocaleString()} records
                  </div>
                )}
              </>
            )}
          </div>
            </>
          )}

          {/* Charts Tab Content */}
          {logsModalTab === "charts" && (
            <div className="space-y-6 overflow-y-auto max-h-[60vh]">
              {/* Chart Controls */}
              <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  <span className="font-semibold">Activity Statistics</span>
                </div>
                <Select
                  value={statsPeriod}
                  onValueChange={(v) => {
                    setStatsPeriod(v);
                    setTimeout(() => fetchActivityStats(selectedRouterForLogs), 100);
                  }}
                >
                  <SelectTrigger className="w-[130px] bg-secondary h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="365">Last year</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={statsGroupBy}
                  onValueChange={(v) => {
                    setStatsGroupBy(v);
                    setTimeout(() => fetchActivityStats(selectedRouterForLogs), 100);
                  }}
                >
                  <SelectTrigger className="w-[120px] bg-secondary h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">By Day</SelectItem>
                    <SelectItem value="week">By Week</SelectItem>
                    <SelectItem value="month">By Month</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => fetchActivityStats(selectedRouterForLogs)}
                  disabled={loadingStats}
                  className="h-8 w-8"
                  title="Refresh stats"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingStats ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {loadingStats ? (
                <div className="flex items-center justify-center py-12">
                  <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground">Loading statistics...</span>
                </div>
              ) : !activityStats || activityStats.chartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <BarChart3 className="w-10 h-10 mb-2 opacity-50" />
                  <p>No statistics available</p>
                  <p className="text-xs">Activity will appear here once logs are recorded</p>
                </div>
              ) : (
                <>
                  {/* Summary Cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card className="bg-secondary/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-emerald-400">{activityStats.summary.total.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Total Events</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-secondary/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-cyan-400">{activityStats.summary.dailyAverage}</p>
                        <p className="text-xs text-muted-foreground">Avg per {statsGroupBy}</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-secondary/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-purple-400">{activityStats.summary.actionTotals.create || 0}</p>
                        <p className="text-xs text-muted-foreground">Creates</p>
                      </CardContent>
                    </Card>
                    <Card className="bg-secondary/50">
                      <CardContent className="p-4 text-center">
                        <p className="text-2xl font-bold text-red-400">{activityStats.summary.actionTotals.delete || 0}</p>
                        <p className="text-xs text-muted-foreground">Deletes</p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Activity Timeline Chart */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Activity Over Time
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={activityStats.chartData}>
                            <defs>
                              <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                              labelStyle={{ color: '#f3f4f6' }}
                            />
                            <Area type="monotone" dataKey="total" stroke="#10b981" fillOpacity={1} fill="url(#colorTotal)" name="Total Events" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Actions Breakdown Bar Chart */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Actions Breakdown
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={activityStats.chartData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="#9ca3af" />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                              labelStyle={{ color: '#f3f4f6' }}
                            />
                            <Legend />
                            <Bar dataKey="creates" fill="#10b981" name="Creates" stackId="a" />
                            <Bar dataKey="updates" fill="#6366f1" name="Updates" stackId="a" />
                            <Bar dataKey="deletes" fill="#ef4444" name="Deletes" stackId="a" />
                            <Bar dataKey="enables" fill="#06b6d4" name="Enables" stackId="a" />
                            <Bar dataKey="disables" fill="#f59e0b" name="Disables" stackId="a" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Entity Types Pie Chart */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <PieChart className="w-4 h-4" />
                          By Entity Type
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[200px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPieChart>
                              <Pie
                                data={Object.entries(activityStats.summary.entityTotals).map(([name, value]) => ({ name, value }))}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={70}
                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                labelLine={false}
                              >
                                {Object.entries(activityStats.summary.entityTotals).map((_, i) => (
                                  <Cell key={i} fill={["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#06b6d4", "#a855f7"][i % 6]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                              />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          By Action Type
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[200px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <RechartsPieChart>
                              <Pie
                                data={Object.entries(activityStats.summary.actionTotals).map(([name, value]) => ({ name, value }))}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={70}
                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                labelLine={false}
                              >
                                {Object.entries(activityStats.summary.actionTotals).map((_, i) => (
                                  <Cell key={i} fill={["#10b981", "#6366f1", "#ef4444", "#06b6d4", "#f59e0b", "#a855f7"][i % 6]} />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
                              />
                            </RechartsPieChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </>
              )}
            </div>
          )}

          <DialogFooter className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-sm text-muted-foreground">
              {logsSearchQuery && (
                <span>Filtered results for "{logsSearchQuery}"</span>
              )}
            </div>
            <Button variant="outline" onClick={() => setLogsModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
