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
import { toast } from "sonner";
import { DashboardLayout, PageHeader, PageContent } from "@/components/DashboardLayout";
import {
  Users,
  Plus,
  Trash2,
  RefreshCw,
  User,
  Clock,
  Settings
} from "lucide-react";
import type { Profile, UserCapabilities } from "@/lib/types";

export default function MyUsersPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasSocks5Access, setHasSocks5Access] = useState(false);

  // Create user dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", username: "" });

  // User capabilities
  const capabilities: UserCapabilities = profile?.capabilities || {};
  const canCreateUsers = capabilities.can_create_users;
  const canDelete = capabilities.can_delete;

  // Fetch users created by this user
  const fetchUsers = useCallback(async () => {
    if (!profile) return;
    setRefreshing(true);
    try {
      // Fetch users created by this user (directly)
      const { data: directUsers } = await supabase
        .from("profiles")
        .select("*")
        .eq("created_by_user_id", profile.id)
        .order("created_at", { ascending: false });

      if (directUsers) {
        setUsers(directUsers as Profile[]);
      }
    } catch (err) {
      console.error("Failed to fetch users:", err);
      toast.error("Failed to fetch users");
    }
    setRefreshing(false);
  }, [profile, supabase]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (!profileData) {
        router.push("/login");
        return;
      }

      // Check if user has can_create_users capability
      if (!profileData.capabilities?.can_create_users && profileData.role !== "admin") {
        router.push("/dashboard");
        return;
      }

      setProfile(profileData as Profile);

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

      setLoading(false);
    };
    checkAuth();
  }, [router, supabase]);

  useEffect(() => {
    if (profile) {
      fetchUsers();
    }
  }, [profile, fetchUsers]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  // Create user
  const handleCreateUser = async () => {
    if (!newUser.email || !newUser.password) {
      toast.error("Please fill email and password");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newUser.email,
          password: newUser.password,
          username: newUser.username,
          role: "user" // Non-admins can only create regular users
        })
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
        setCreateDialogOpen(false);
        setNewUser({ email: "", password: "", username: "" });
        fetchUsers();
      }
    } catch {
      toast.error("Failed to create user");
    }
    setCreating(false);
  };

  // Delete user
  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Delete this user? This action cannot be undone.")) return;
    try {
      const res = await fetch(`/api/users?id=${userId}`, { method: "DELETE" });
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
      <PageHeader title="My Users" description="Manage users you have created">
        <Badge variant="outline" className="text-blue-400 border-blue-400">
          <Users className="w-3 h-3 mr-1" />
          {users.length} Users
        </Badge>
      </PageHeader>

      <PageContent>
        {/* Actions */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold">Users Created by You</h3>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchUsers}
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            </Button>
            {canCreateUsers && (
              <Button onClick={() => setCreateDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Add User
              </Button>
            )}
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead>Email</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Created
                  </div>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No users created yet. Click "Add User" to create your first user.
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id} className="border-border">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell>{u.username || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(u.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => router.push(`/my-users/${u.id}`)}
                          title="Manage user"
                        >
                          <Settings className="w-4 h-4" />
                        </Button>
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteUser(u.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>


      </PageContent>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>Create a new user account under your supervision</DialogDescription>
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
            <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
              <p className="text-sm text-blue-400">
                This user will be created as a regular user. You will need to grant them access to routers through the admin panel.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateUser} disabled={creating}>
              {creating ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
