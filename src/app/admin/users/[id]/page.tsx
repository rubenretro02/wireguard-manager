"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import {
  ArrowLeft,
  User,
  Server,
  Globe,
  Shield,
  Clock,
  Mail,
  RefreshCw,
  Save,
  Check,
  X,
  Plus,
  Trash2,
  Network,
  Settings,
  Key,
  Users,
  CheckCircle,
  XCircle,
  Lock,
} from "lucide-react";
import type { Profile, Router as RouterType, PublicIP, UserRouter, UserIpAccess, UserCapabilities } from "@/lib/types";

interface UserRouterWithRelations extends UserRouter {
  routers: { id: string; name: string; host: string } | null;
}

// Interface for SOCKS5 server access
interface UserSocks5ServerAccess {
  id: string;
  user_id: string;
  router_id: string;
  created_at: string;
  routers?: { id: string; name: string; host: string } | null;
}

export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;
  const supabase = createClient();

  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [targetUser, setTargetUser] = useState<Profile | null>(null);
  const [allRouters, setAllRouters] = useState<RouterType[]>([]);
  const [userRouterAccess, setUserRouterAccess] = useState<UserRouterWithRelations[]>([]);
  const [userIpAccess, setUserIpAccess] = useState<UserIpAccess[]>([]);
  const [publicIpsByRouter, setPublicIpsByRouter] = useState<Record<string, PublicIP[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("info");

  // Current user's IP access (for non-admin users)
  const [currentUserIpAccess, setCurrentUserIpAccess] = useState<Set<string>>(new Set());

  // SOCKS5 Server Access states
  const [userSocks5ServerAccess, setUserSocks5ServerAccess] = useState<UserSocks5ServerAccess[]>([]);
  const [currentUserSocks5ServerAccess, setCurrentUserSocks5ServerAccess] = useState<Set<string>>(new Set());

  // Selected router for IP management
  const [selectedRouterId, setSelectedRouterId] = useState<string>("");

  // Edit user info
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editCapabilities, setEditCapabilities] = useState<UserCapabilities>({});

  // Password change
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Check if current user is admin
  const isAdmin = currentUser?.role === "admin";
  const canManageUserIps = currentUser?.capabilities?.can_manage_user_ips;

  // Fetch current user's IP access (for non-admins)
  const fetchCurrentUserIpAccess = useCallback(async () => {
    if (!currentUser || isAdmin) {
      setCurrentUserIpAccess(new Set());
      return;
    }

    const { data } = await supabase
      .from("user_ip_access")
      .select("ip_id")
      .eq("user_id", currentUser.id)
      .eq("can_use", true);

    if (data) {
      setCurrentUserIpAccess(new Set(data.map((a: { ip_id: string }) => a.ip_id)));
    }
  }, [currentUser, isAdmin, supabase]);

  // Fetch current user's SOCKS5 server access (for non-admins)
  const fetchCurrentUserSocks5ServerAccess = useCallback(async () => {
    if (!currentUser || isAdmin) {
      setCurrentUserSocks5ServerAccess(new Set());
      return;
    }

    const { data } = await supabase
      .from("user_socks5_server_access")
      .select("router_id")
      .eq("user_id", currentUser.id);

    if (data) {
      setCurrentUserSocks5ServerAccess(new Set(data.map((a: { router_id: string }) => a.router_id)));
    }
  }, [currentUser, isAdmin, supabase]);

  // Fetch user data
  const fetchUserData = useCallback(async () => {
    if (!userId) return;

    try {
      // Get target user profile
      const { data: userData, error: userError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (userError || !userData) {
        toast.error("User not found");
        router.push("/admin?tab=users");
        return;
      }

      setTargetUser(userData as Profile);
      setEditUsername(userData.username || "");
      setEditEmail(userData.email || "");
      setEditCapabilities(userData.capabilities || {});

      // Get user's router access
      const { data: routerAccess } = await supabase
        .from("user_routers")
        .select("*, routers(id, name, host)")
        .eq("user_id", userId);

      if (routerAccess) {
        setUserRouterAccess(routerAccess as UserRouterWithRelations[]);
        if (routerAccess.length > 0 && !selectedRouterId) {
          setSelectedRouterId(routerAccess[0].router_id);
        }
      }

      // Get user's IP access
      const { data: ipAccess } = await supabase
        .from("user_ip_access")
        .select("*, public_ips(*), routers(id, name)")
        .eq("user_id", userId);

      if (ipAccess) {
        setUserIpAccess(ipAccess as UserIpAccess[]);
      }

      // Get user's SOCKS5 server access
      const { data: socks5Access } = await supabase
        .from("user_socks5_server_access")
        .select("*, routers(id, name, host)")
        .eq("user_id", userId);

      if (socks5Access) {
        setUserSocks5ServerAccess(socks5Access as UserSocks5ServerAccess[]);
      }

    } catch (err) {
      console.error("Error fetching user data:", err);
      toast.error("Failed to load user data");
    }
  }, [userId, supabase, router, selectedRouterId]);

  // Fetch all routers (or only accessible ones for non-admins)
  const fetchRouters = useCallback(async () => {
    if (isAdmin) {
      const { data } = await supabase
        .from("routers")
        .select("*")
        .order("name");

      if (data) {
        setAllRouters(data as RouterType[]);
      }
    } else if (currentUser) {
      // For non-admins, only get routers they have access to
      const { data: userRouterIds } = await supabase
        .from("user_routers")
        .select("router_id")
        .eq("user_id", currentUser.id);

      if (userRouterIds && userRouterIds.length > 0) {
        const routerIds = userRouterIds.map((ur: { router_id: string }) => ur.router_id);
        const { data } = await supabase
          .from("routers")
          .select("*")
          .in("id", routerIds)
          .order("name");

        if (data) {
          setAllRouters(data as RouterType[]);
        }
      }
    }
  }, [supabase, isAdmin, currentUser]);

  // Fetch public IPs for selected router
  const fetchPublicIps = useCallback(async (routerId: string) => {
    if (!routerId) return;

    const { data } = await supabase
      .from("public_ips")
      .select("*")
      .eq("router_id", routerId)
      .eq("enabled", true)
      .order("ip_number");

    if (data) {
      setPublicIpsByRouter(prev => ({ ...prev, [routerId]: data as PublicIP[] }));
    }
  }, [supabase]);

  // Check auth and load data
  useEffect(() => {
    const checkAuth = async () => {
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

      if (!profile || profile.role !== "admin") {
        // Check if user has can_manage_user_ips capability
        const canManage = profile?.capabilities?.can_manage_user_ips;
        if (!canManage) {
          router.push("/dashboard");
          return;
        }
      }

      setCurrentUser(profile as Profile);
      setLoading(false);
    };

    checkAuth();
  }, [router, supabase]);

  // Load data after current user is set
  useEffect(() => {
    if (currentUser) {
      fetchRouters();
      fetchUserData();
      fetchCurrentUserIpAccess();
      fetchCurrentUserSocks5ServerAccess();
    }
  }, [currentUser, fetchRouters, fetchUserData, fetchCurrentUserIpAccess, fetchCurrentUserSocks5ServerAccess]);

  // Fetch IPs when router changes
  useEffect(() => {
    if (selectedRouterId) {
      fetchPublicIps(selectedRouterId);
    }
  }, [selectedRouterId, fetchPublicIps]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Grant router access (admin only)
  const handleGrantRouterAccess = async (routerId: string) => {
    if (!isAdmin) {
      toast.error("Only admins can grant router access");
      return;
    }

    try {
      const { error } = await supabase
        .from("user_routers")
        .insert({ user_id: userId, router_id: routerId });

      if (error) {
        if (error.code === "23505") {
          toast.error("User already has access to this router");
        } else {
          throw error;
        }
      } else {
        toast.success("Router access granted");
        fetchUserData();
      }
    } catch (err) {
      toast.error("Failed to grant access");
    }
  };

  // Revoke router access (admin only)
  const handleRevokeRouterAccess = async (accessId: string) => {
    if (!isAdmin) {
      toast.error("Only admins can revoke router access");
      return;
    }

    if (!confirm("Remove access to this router? This will also remove all IP access for this router.")) return;

    try {
      // First remove IP access for this router
      await supabase
        .from("user_ip_access")
        .delete()
        .eq("user_id", userId)
        .eq("router_id", userRouterAccess.find(r => r.id === accessId)?.router_id);

      // Then remove router access
      const { error } = await supabase
        .from("user_routers")
        .delete()
        .eq("id", accessId);

      if (error) throw error;

      toast.success("Router access revoked");
      fetchUserData();
    } catch (err) {
      toast.error("Failed to revoke access");
    }
  };

  // Grant SOCKS5 server access
  const handleGrantSocks5ServerAccess = async (routerId: string) => {
    // Check if user can grant this access
    if (!isAdmin && !currentUserSocks5ServerAccess.has(routerId)) {
      toast.error("You don't have access to this SOCKS5 server");
      return;
    }

    try {
      const { error } = await supabase
        .from("user_socks5_server_access")
        .insert({
          user_id: userId,
          router_id: routerId,
          created_by: currentUser?.id
        });

      if (error) {
        if (error.code === "23505") {
          toast.error("User already has access to this SOCKS5 server");
        } else {
          throw error;
        }
      } else {
        toast.success("SOCKS5 server access granted - User can now create their own proxies");
        fetchUserData();
      }
    } catch (err) {
      toast.error("Failed to grant SOCKS5 server access");
    }
  };

  // Revoke SOCKS5 server access
  const handleRevokeSocks5ServerAccess = async (accessId: string) => {
    if (!confirm("Remove access to this SOCKS5 server? User will no longer be able to create proxies on this server.")) return;

    try {
      const { error } = await supabase
        .from("user_socks5_server_access")
        .delete()
        .eq("id", accessId);

      if (error) throw error;

      toast.success("SOCKS5 server access revoked");
      fetchUserData();
    } catch (err) {
      toast.error("Failed to revoke SOCKS5 server access");
    }
  };

  // Check if current user can manage a specific IP
  const canManageIp = (ipId: string): boolean => {
    // Admin can manage all IPs
    if (isAdmin) return true;
    // Non-admin can only manage IPs they have access to
    return currentUserIpAccess.has(ipId);
  };

  // Check if current user can grant SOCKS5 server access for a router
  const canGrantSocks5ServerAccess = (routerId: string): boolean => {
    if (isAdmin) return true;
    return currentUserSocks5ServerAccess.has(routerId);
  };

  // Toggle IP access
  const handleToggleIpAccess = async (ipId: string, routerId: string, currentAccess: boolean) => {
    // Check if user can manage this IP
    if (!canManageIp(ipId)) {
      toast.error("You don't have permission to manage this IP");
      return;
    }

    try {
      if (currentAccess) {
        // Remove access
        await supabase
          .from("user_ip_access")
          .delete()
          .eq("user_id", userId)
          .eq("ip_id", ipId);

        toast.success("IP access removed");
      } else {
        // Grant access
        await supabase
          .from("user_ip_access")
          .insert({
            user_id: userId,
            router_id: routerId,
            ip_id: ipId,
            can_use: true,
            created_by: currentUser?.id,
          });

        toast.success("IP access granted");
      }

      fetchUserData();
    } catch (err) {
      toast.error("Failed to update IP access");
    }
  };

  // Grant all IPs for a router (only IPs the current user has access to)
  const handleGrantAllIps = async (routerId: string) => {
    const ips = publicIpsByRouter[routerId] || [];
    if (ips.length === 0) {
      toast.error("No IPs available for this router");
      return;
    }

    try {
      const existingIpIds = new Set(
        userIpAccess
          .filter(a => a.router_id === routerId)
          .map(a => a.ip_id)
      );

      // Filter to only IPs the current user can manage
      const manageableIps = ips.filter(ip => canManageIp(ip.id));

      const newAccess = manageableIps
        .filter(ip => !existingIpIds.has(ip.id))
        .map(ip => ({
          user_id: userId,
          router_id: routerId,
          ip_id: ip.id,
          can_use: true,
          created_by: currentUser?.id,
        }));

      if (newAccess.length === 0) {
        toast.info("User already has access to all available IPs");
        return;
      }

      const { error } = await supabase
        .from("user_ip_access")
        .insert(newAccess);

      if (error) throw error;

      toast.success(`Granted access to ${newAccess.length} IPs`);
      fetchUserData();
    } catch (err) {
      toast.error("Failed to grant IP access");
    }
  };

  // Revoke all IPs for a router (only IPs the current user has access to)
  const handleRevokeAllIps = async (routerId: string) => {
    if (!confirm("Remove access to all IPs for this router?")) return;

    try {
      // Get IPs to revoke - only those the current user can manage
      const ipsToRevoke = userIpAccess
        .filter(a => a.router_id === routerId && canManageIp(a.ip_id))
        .map(a => a.ip_id);

      if (ipsToRevoke.length === 0) {
        toast.info("No IPs to revoke");
        return;
      }

      const { error } = await supabase
        .from("user_ip_access")
        .delete()
        .eq("user_id", userId)
        .eq("router_id", routerId)
        .in("ip_id", ipsToRevoke);

      if (error) throw error;

      toast.success(`Revoked access to ${ipsToRevoke.length} IPs`);
      fetchUserData();
    } catch (err) {
      toast.error("Failed to revoke IP access");
    }
  };

  // Save user info (admin only for capabilities)
  const handleSaveUserInfo = async () => {
    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        username: editUsername || null,
      };

      // Only admin can change capabilities
      if (isAdmin) {
        updateData.capabilities = editCapabilities;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updateData)
        .eq("id", userId);

      if (error) throw error;

      toast.success("User info saved");
      fetchUserData();
    } catch (err) {
      toast.error("Failed to save user info");
    }
    setSaving(false);
  };

  // Change password
  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/users/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, newPassword })
      });
      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success("Password changed successfully");
        setNewPassword("");
      }
    } catch {
      toast.error("Failed to change password");
    }
    setChangingPassword(false);
  };

  // Format date
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  // Check if user has IP access
  const hasIpAccess = (ipId: string) => {
    return userIpAccess.some(a => a.ip_id === ipId && a.can_use);
  };

  // Get routers user doesn't have access to
  const availableRouters = allRouters.filter(
    r => !userRouterAccess.some(ur => ur.router_id === r.id)
  );

  // Get routers available for SOCKS5 server access (that user doesn't already have)
  const availableSocks5Servers = allRouters.filter(
    r => !userSocks5ServerAccess.some(usa => usa.router_id === r.id) && canGrantSocks5ServerAccess(r.id)
  );

  // Get manageable IPs count for the summary
  const getManageableIpsCount = (routerId: string) => {
    const ips = publicIpsByRouter[routerId] || [];
    return ips.filter(ip => canManageIp(ip.id)).length;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Loading user...</p>
        </div>
      </div>
    );
  }

  if (!targetUser) {
    return null;
  }

  return (
    <DashboardLayout
      userRole={currentUser?.role}
      userEmail={currentUser?.email}
      onLogout={handleLogout}
    >
      <PageHeader
        title={targetUser.username || targetUser.email}
        description="Manage user access and permissions"
      >
        <Button variant="outline" onClick={() => router.push("/admin?tab=users")} className="gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Users
        </Button>
      </PageHeader>

      <PageContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-secondary">
            <TabsTrigger value="info" className="gap-2">
              <User className="w-4 h-4" />
              User Info
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="routers" className="gap-2">
                <Server className="w-4 h-4" />
                Router Access
              </TabsTrigger>
            )}
            <TabsTrigger value="ips" className="gap-2">
              <Globe className="w-4 h-4" />
              IP Access
            </TabsTrigger>
            <TabsTrigger value="socks5" className="gap-2">
              <Network className="w-4 h-4" />
              SOCKS5 Servers
            </TabsTrigger>
          </TabsList>

          {/* User Info Tab */}
          <TabsContent value="info" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Info Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Basic Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <div className="flex items-center gap-2 p-3 bg-secondary rounded-lg">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <span className="font-mono">{targetUser.email}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input
                      value={editUsername}
                      onChange={(e) => setEditUsername(e.target.value)}
                      placeholder="Enter username"
                      className="bg-secondary"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={targetUser.role === "admin" ? "text-emerald-400 border-emerald-400" : ""}>
                        <Shield className="w-3 h-3 mr-1" />
                        {targetUser.role}
                      </Badge>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Created</Label>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      {formatDate(targetUser.created_at)}
                    </div>
                  </div>
                  <div className="space-y-2 pt-4 border-t border-border">
                    <Label>Change Password</Label>
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New password"
                        className="bg-secondary"
                      />
                      <Button onClick={handleChangePassword} disabled={changingPassword} size="sm">
                        {changingPassword ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Change"}
                      </Button>
                    </div>
                  </div>
                  {!isAdmin && (
                    <Button onClick={handleSaveUserInfo} disabled={saving} className="w-full gap-2">
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Username
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Capabilities Card - Admin only */}
              {isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="w-5 h-5" />
                      Capabilities
                    </CardTitle>
                    <CardDescription>
                      Configure what this user can do
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Clock className="w-4 h-4 text-amber-400" />
                        <div>
                          <p className="font-medium text-sm">Auto-Expire Peers</p>
                          <p className="text-xs text-muted-foreground">Can set expiration time</p>
                        </div>
                      </div>
                      <Checkbox
                        checked={editCapabilities.can_auto_expire || false}
                        onCheckedChange={(checked) =>
                          setEditCapabilities(prev => ({ ...prev, can_auto_expire: !!checked }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Users className="w-4 h-4 text-cyan-400" />
                        <div>
                          <p className="font-medium text-sm">See All Peers</p>
                          <p className="text-xs text-muted-foreground">Can view all peers, not just own</p>
                        </div>
                      </div>
                      <Checkbox
                        checked={editCapabilities.can_see_all_peers || false}
                        onCheckedChange={(checked) =>
                          setEditCapabilities(prev => ({ ...prev, can_see_all_peers: !!checked }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Users className="w-4 h-4 text-emerald-400" />
                        <div>
                          <p className="font-medium text-sm">Create Users</p>
                          <p className="text-xs text-muted-foreground">Can create new users</p>
                        </div>
                      </div>
                      <Checkbox
                        checked={editCapabilities.can_create_users || false}
                        onCheckedChange={(checked) =>
                          setEditCapabilities(prev => ({ ...prev, can_create_users: !!checked }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Key className="w-4 h-4 text-purple-400" />
                        <div>
                          <p className="font-medium text-sm">Manage User IPs</p>
                          <p className="text-xs text-muted-foreground">Can manage IP access for created users</p>
                        </div>
                      </div>
                      <Checkbox
                        checked={editCapabilities.can_manage_user_ips || false}
                        onCheckedChange={(checked) =>
                          setEditCapabilities(prev => ({ ...prev, can_manage_user_ips: !!checked }))
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 bg-secondary rounded-lg">
                      <div className="flex items-center gap-3">
                        <Trash2 className="w-4 h-4 text-red-400" />
                        <div>
                          <p className="font-medium text-sm">Delete</p>
                          <p className="text-xs text-muted-foreground">Can delete peers and users</p>
                        </div>
                      </div>
                      <Checkbox
                        checked={editCapabilities.can_delete || false}
                        onCheckedChange={(checked) =>
                          setEditCapabilities(prev => ({ ...prev, can_delete: !!checked }))
                        }
                      />
                    </div>

                    <Button onClick={handleSaveUserInfo} disabled={saving} className="w-full gap-2">
                      {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save Changes
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Non-admin info card */}
              {!isAdmin && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Settings className="w-5 h-5" />
                      User Capabilities
                    </CardTitle>
                    <CardDescription>
                      Current permissions for this user (read-only)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {targetUser.capabilities?.can_auto_expire && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        Auto-Expire Peers
                      </div>
                    )}
                    {targetUser.capabilities?.can_see_all_peers && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        See All Peers
                      </div>
                    )}
                    {targetUser.capabilities?.can_create_users && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        Create Users
                      </div>
                    )}
                    {targetUser.capabilities?.can_manage_user_ips && (
                      <div className="flex items-center gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                        Manage User IPs
                      </div>
                    )}
                    {!targetUser.capabilities?.can_auto_expire &&
                     !targetUser.capabilities?.can_see_all_peers &&
                     !targetUser.capabilities?.can_create_users &&
                     !targetUser.capabilities?.can_manage_user_ips && (
                      <p className="text-sm text-muted-foreground">No special capabilities</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Router Access Tab - Admin only */}
          {isAdmin && (
            <TabsContent value="routers" className="space-y-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Server className="w-5 h-5" />
                      Router Access
                    </CardTitle>
                    <CardDescription>
                      Manage which routers this user can access
                    </CardDescription>
                  </div>
                  {availableRouters.length > 0 && (
                    <Select onValueChange={handleGrantRouterAccess}>
                      <SelectTrigger className="w-[200px] bg-secondary">
                        <Plus className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Add router access" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableRouters.map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </CardHeader>
                <CardContent>
                  {userRouterAccess.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                      <p>No router access configured</p>
                      <p className="text-sm">Add router access using the dropdown above</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {userRouterAccess.map((access) => (
                        <div
                          key={access.id}
                          className="flex items-center justify-between p-4 bg-secondary rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <Server className="w-5 h-5 text-primary" />
                            <div>
                              <p className="font-medium">{access.routers?.name}</p>
                              <p className="text-sm text-muted-foreground font-mono">
                                {access.routers?.host}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-emerald-400 border-emerald-400">
                              <CheckCircle className="w-3 h-3 mr-1" />
                              Access
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRevokeRouterAccess(access.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {/* IP Access Tab */}
          <TabsContent value="ips" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    IP Access
                  </CardTitle>
                  <CardDescription>
                    Manage which IPs this user can use for creating peers
                    {!isAdmin && (
                      <span className="block mt-1 text-amber-400">
                        You can only manage IPs that you have access to
                      </span>
                    )}
                  </CardDescription>
                </div>
                {userRouterAccess.length > 0 && (
                  <Select value={selectedRouterId} onValueChange={setSelectedRouterId}>
                    <SelectTrigger className="w-[250px] bg-secondary">
                      <Server className="w-4 h-4 mr-2" />
                      <SelectValue placeholder="Select router" />
                    </SelectTrigger>
                    <SelectContent>
                      {userRouterAccess.map(access => (
                        <SelectItem key={access.router_id} value={access.router_id}>
                          {access.routers?.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </CardHeader>
              <CardContent>
                {userRouterAccess.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>User needs router access first</p>
                    {isAdmin ? (
                      <p className="text-sm">Go to Router Access tab to grant access</p>
                    ) : (
                      <p className="text-sm">Contact an admin to grant router access</p>
                    )}
                  </div>
                ) : selectedRouterId ? (
                  <div className="space-y-4">
                    {/* Quick actions */}
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGrantAllIps(selectedRouterId)}
                        className="gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Grant {isAdmin ? "All" : "My"} IPs
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevokeAllIps(selectedRouterId)}
                        className="gap-2 text-destructive"
                      >
                        <X className="w-4 h-4" />
                        Revoke {isAdmin ? "All" : "My"} IPs
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => fetchPublicIps(selectedRouterId)}
                        className="gap-2 ml-auto"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                      </Button>
                    </div>

                    {/* IP list */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {(publicIpsByRouter[selectedRouterId] || []).map(ip => {
                        const hasAccess = hasIpAccess(ip.id);
                        const canManage = canManageIp(ip.id);

                        return (
                          <button
                            key={ip.id}
                            onClick={() => canManage && handleToggleIpAccess(ip.id, selectedRouterId, hasAccess)}
                            disabled={!canManage}
                            className={`p-3 rounded-lg border transition-all relative ${
                              hasAccess
                                ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400"
                                : canManage
                                  ? "bg-secondary border-border hover:border-muted-foreground"
                                  : "bg-secondary/50 border-border/50 opacity-50 cursor-not-allowed"
                            }`}
                          >
                            {!canManage && (
                              <Lock className="w-3 h-3 absolute top-2 right-2 text-muted-foreground" />
                            )}
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-mono font-bold">{ip.ip_number}</span>
                              {hasAccess ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : (
                                <XCircle className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="text-xs font-mono text-muted-foreground">
                              {ip.public_ip}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {(publicIpsByRouter[selectedRouterId] || []).length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No IPs configured for this router</p>
                      </div>
                    )}

                    {/* Summary */}
                    <div className="pt-4 border-t border-border space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          User's IPs:
                        </span>
                        <Badge variant="outline" className="text-emerald-400">
                          {userIpAccess.filter(a => a.router_id === selectedRouterId && a.can_use).length}
                          {" / "}
                          {(publicIpsByRouter[selectedRouterId] || []).length}
                        </Badge>
                      </div>
                      {!isAdmin && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            IPs you can manage:
                          </span>
                          <Badge variant="outline" className="text-cyan-400">
                            {getManageableIpsCount(selectedRouterId)}
                            {" / "}
                            {(publicIpsByRouter[selectedRouterId] || []).length}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Select a router to manage IP access</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SOCKS5 Server Access Tab */}
          <TabsContent value="socks5" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Network className="w-5 h-5" />
                    SOCKS5 Server Access
                  </div>
                  {availableSocks5Servers.length > 0 && (
                    <Select onValueChange={handleGrantSocks5ServerAccess}>
                      <SelectTrigger className="w-64">
                        <Plus className="w-4 h-4 mr-2" />
                        <SelectValue placeholder="Grant server access..." />
                      </SelectTrigger>
                      <SelectContent>
                        {availableSocks5Servers.map((r) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} ({r.host})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </CardTitle>
                <CardDescription>
                  Grant access to SOCKS5 proxy servers so this user can create their own proxy connections
                  {!isAdmin && (
                    <span className="block mt-1 text-amber-400">
                      You can only grant access to servers you have access to
                    </span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {userSocks5ServerAccess.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Network className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No SOCKS5 server access granted yet</p>
                    <p className="text-sm mt-2">
                      Grant access to a server so the user can create their own SOCKS5 proxies
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {userSocks5ServerAccess.map((access) => (
                      <div
                        key={access.id}
                        className="flex items-center justify-between p-4 bg-secondary rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Server className="w-5 h-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium">{access.routers?.name}</p>
                            <p className="text-sm text-muted-foreground font-mono">
                              {access.routers?.host}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-emerald-400 border-emerald-400">
                            <CheckCircle className="w-3 h-3 mr-1" />
                            Can Create Proxies
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRevokeSocks5ServerAccess(access.id)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Info box */}
                <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <Network className="w-5 h-5 text-blue-400 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-blue-400">How SOCKS5 Server Access Works</p>
                      <p className="text-muted-foreground mt-1">
                        When you grant server access, the user can go to the SOCKS5 page and create their own proxy connections on that server.
                        Each proxy they create will have a unique username/password and can be assigned to a specific public IP.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageContent>
    </DashboardLayout>
  );
}
