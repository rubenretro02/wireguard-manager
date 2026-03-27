"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ToggleRight
} from "lucide-react";
import type { Profile, Router, ConnectionType, UserRole, PublicIP, UserRouter, WireGuardInterface, UserCapabilities } from "@/lib/types";

interface UserRouterWithRelations extends UserRouter {
  profiles: { id: string; email: string; username: string | null } | null;
  routers: { id: string; name: string } | null;
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

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [routers, setRouters] = useState<Router[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [publicIps, setPublicIps] = useState<PublicIP[]>([]);
  const [userRouters, setUserRouters] = useState<UserRouterWithRelations[]>([]);
  const [loading, setLoading] = useState(true);

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
  });

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
  const [importing, setImporting] = useState(false);
  const [savingImported, setSavingImported] = useState(false);
  const [detectedIps, setDetectedIps] = useState<DetectedIp[]>([]);
  const [partiallyConfiguredIps, setPartiallyConfiguredIps] = useState<DetectedIp[]>([]);
  const [natTraffic, setNatTraffic] = useState<Record<number, NatTraffic>>({});
  const [loadingTraffic, setLoadingTraffic] = useState(false);
  const [creatingRulesFor, setCreatingRulesFor] = useState<number | null>(null);
  const [ipSearchQuery, setIpSearchQuery] = useState("");
  const [peersByIp, setPeersByIp] = useState<Record<string, { count: number; names: string[]; peers: Array<{ id: string; name: string; address: string }> }>>({});

  // Peers detail modal
  const [peersModalOpen, setPeersModalOpen] = useState(false);
  const [selectedIpForPeers, setSelectedIpForPeers] = useState<PublicIP | null>(null);
  const [selectedIpPeers, setSelectedIpPeers] = useState<Array<{ id: string; name: string; address: string; publicKey?: string; interface?: string; disabled?: boolean; rx?: number; tx?: number }>>([]);

  // Single peer detail dialog
  const [peerDetailOpen, setPeerDetailOpen] = useState(false);
  const [selectedPeerDetail, setSelectedPeerDetail] = useState<{ id: string; name: string; address: string; publicKey?: string; interface?: string; disabled?: boolean; rx?: number; tx?: number; comment?: string } | null>(null);

  // User Router Access states
  const [addAccessOpen, setAddAccessOpen] = useState(false);
  const [newAccess, setNewAccess] = useState({ user_id: "", router_id: "" });
  const [addingAccess, setAddingAccess] = useState(false);

  // User Capabilities states
  const [editCapabilitiesOpen, setEditCapabilitiesOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [editingCapabilities, setEditingCapabilities] = useState<UserCapabilities>({});
  const [savingCapabilities, setSavingCapabilities] = useState(false);

  // Fetch routers
  const fetchRouters = useCallback(async () => {
    const { data } = await supabase.from("routers").select("*").order("created_at", { ascending: false });
    if (data) {
      setRouters(data as Router[]);
      if (data.length > 0 && !selectedRouterForIps) {
        setSelectedRouterForIps(data[0].id);
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
      await Promise.all([fetchRouters(), fetchUsers(), fetchUserRouters()]);
      setLoading(false);
    };
    checkAuth();
  }, [router, supabase, fetchRouters, fetchUsers, fetchUserRouters]);

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

  useEffect(() => {
    if (selectedRouterForIps) {
      fetchPublicIps();
      fetchPeerCounts();
    }
  }, [selectedRouterForIps, fetchPublicIps, fetchPeerCounts]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Add router
  const handleAddRouter = async () => {
    if (!newRouter.name || !newRouter.host || !newRouter.username || !newRouter.password) {
      toast.error("Please fill all required fields");
      return;
    }
    setAdding(true);
    try {
      const { error } = await supabase.from("routers").insert({
        name: newRouter.name,
        host: newRouter.host,
        port: parseInt(newRouter.port) || 443,
        api_port: parseInt(newRouter.api_port) || 8728,
        username: newRouter.username,
        password: newRouter.password,
        use_ssl: newRouter.use_ssl,
        connection_type: newRouter.connection_type,
      });
      if (error) throw error;
      toast.success("Router added");
      setAddRouterOpen(false);
      setNewRouter({ name: "", host: "", port: "443", api_port: "8728", username: "", password: "", use_ssl: false, connection_type: "api" });
      fetchRouters();
    } catch (err) {
      toast.error("Failed to add router");
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
        toast.success("Connection successful!");
      } else {
        toast.error(data.error || "Connection failed");
      }
    } catch {
      toast.error("Connection test failed");
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
        toast.success("IP added");
        setAddIpOpen(false);
        setNewIpNumber("");
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to add IP");
    }
    setAddingIp(false);
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
  const handleDeleteIp = async (id: string) => {
    if (!confirm("Delete this IP?")) return;
    try {
      const res = await fetch(`/api/public-ips?id=${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("IP deleted");
        fetchPublicIps();
      }
    } catch {
      toast.error("Failed to delete IP");
    }
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
        } else if (data.alreadySavedCount > 0) {
          toast.info(`All ${data.alreadySavedCount} IPs already saved`);
        } else {
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
      if (data.success) {
        toast.success("Rules created successfully");
        fetchPublicIps();
      } else {
        toast.error(data.errors?.join(", ") || "Failed to create some rules");
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

  // Open edit capabilities dialog
  const openEditCapabilities = (user: Profile) => {
    setEditingUser(user);
    setEditingCapabilities(user.capabilities || {
      can_auto_expire: false,
      can_see_all_peers: false,
      can_use_restricted_ips: false,
      can_see_restricted_peers: false
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
      onLogout={handleLogout}
    >
      <PageHeader title="Admin Panel" description="Manage routers, users and public IPs">
        <Badge variant="outline" className="text-emerald-400 border-emerald-400">
          <Shield className="w-3 h-3 mr-1" />
          Admin
        </Badge>
      </PageHeader>

      <PageContent>
        <Tabs defaultValue="routers" className="space-y-6">
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
          </TabsList>

          {/* Routers Tab */}
          <TabsContent value="routers" className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Routers</h3>
              <Button onClick={() => setAddRouterOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add Router
              </Button>
            </div>

            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border">
                    <TableHead>Name</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Connection</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {routers.map((r) => (
                    <TableRow key={r.id} className="border-border">
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.host}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.connection_type || "api"}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="badge-success">Active</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleTestConnection(r.id)}
                            disabled={testingId === r.id}
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
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
                <Button variant="outline" onClick={handleImportIps} disabled={importing} className="gap-2">
                  <Download className="w-4 h-4" />
                  {importing ? "Importing..." : "Import"}
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIps.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
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
                              {ip.wg_ip_created && <Badge variant="outline" className="text-xs px-1">WG</Badge>}
                              {ip.ip_address_created && <Badge variant="outline" className="text-xs px-1">IP</Badge>}
                              {ip.nat_rule_created && <Badge variant="outline" className="text-xs px-1">NAT</Badge>}
                              {!ip.wg_ip_created && !ip.ip_address_created && !ip.nat_rule_created && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCreateRules(ip.ip_number)}
                                  disabled={creatingRulesFor === ip.ip_number}
                                  className="h-6 text-xs"
                                >
                                  {creatingRulesFor === ip.ip_number ? (
                                    <RefreshCw className="w-3 h-3 animate-spin" />
                                  ) : (
                                    "Create"
                                  )}
                                </Button>
                              )}
                            </div>
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
                                onClick={() => handleDeleteIp(ip.id)}
                                className="text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
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
                      <TableRow key={u.id} className="border-border">
                        <TableCell className="font-medium">{u.email}</TableCell>
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
                              {!caps.can_auto_expire && !caps.can_see_all_peers && !caps.can_use_restricted_ips && !caps.can_see_restricted_peers && (
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
                            {u.role !== "admin" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEditCapabilities(u)}
                                title="Edit capabilities"
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                            )}
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
        </Tabs>
      </PageContent>

      {/* Add Router Dialog */}
      <Dialog open={addRouterOpen} onOpenChange={setAddRouterOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Add Router</DialogTitle>
            <DialogDescription>Add a new MikroTik router</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  placeholder="My Router"
                  value={newRouter.name}
                  onChange={(e) => setNewRouter({ ...newRouter, name: e.target.value })}
                  className="bg-secondary"
                />
              </div>
              <div className="space-y-2">
                <Label>Host</Label>
                <Input
                  placeholder="192.168.1.1"
                  value={newRouter.host}
                  onChange={(e) => setNewRouter({ ...newRouter, host: e.target.value })}
                  className="bg-secondary"
                />
              </div>
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
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  placeholder="admin"
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
                  <SelectItem value="api">API (8728)</SelectItem>
                  <SelectItem value="api-ssl">API SSL (8729)</SelectItem>
                  <SelectItem value="rest">REST (443)</SelectItem>
                  <SelectItem value="rest-8443">REST (8443)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRouterOpen(false)}>Cancel</Button>
            <Button onClick={handleAddRouter} disabled={adding}>
              {adding ? "Adding..." : "Add Router"}
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
                            body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterForIps, data: { id: peer.id } })
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
                  onClick={async () => {
                    const action = selectedPeerDetail.disabled ? "enablePeer" : "disablePeer";
                    const res = await fetch("/api/wireguard", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action, routerId: selectedRouterForIps, data: { id: selectedPeerDetail.id } })
                    });
                    const data = await res.json();
                    if (data.success) {
                      toast.success(selectedPeerDetail.disabled ? "Peer enabled" : "Peer disabled");
                      fetchPeerCounts();
                      setPeerDetailOpen(false);
                    } else {
                      toast.error(data.error || "Failed");
                    }
                  }}
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
                  onClick={async () => {
                    if (!confirm("Delete this peer?")) return;
                    const res = await fetch("/api/wireguard", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "deletePeer", routerId: selectedRouterForIps, data: { id: selectedPeerDetail.id } })
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
