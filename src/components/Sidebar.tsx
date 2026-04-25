"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Globe,
  Settings,
  Shield,
  Server,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Network,
  UserCog,
  Key
} from "lucide-react";
import { useState, Suspense } from "react";
import { cn } from "@/lib/utils";
import type { UserCapabilities } from "@/lib/types";

interface SidebarProps {
  userRole?: "admin" | "user";
  userEmail?: string;
  userCapabilities?: UserCapabilities;
  hasSocks5Access?: boolean; // New prop to indicate if user has access to SOCKS5 servers
  onLogout?: () => void;
}

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, adminOnly: false, requiresCapability: null as keyof UserCapabilities | null, requiresSocks5Access: false },
  { name: "Public IPs", href: "/public-ips", icon: Globe, adminOnly: false, requiresCapability: null as keyof UserCapabilities | null, requiresSocks5Access: false },
  { name: "SOCKS5", href: "/socks5", icon: Network, adminOnly: false, requiresCapability: null as keyof UserCapabilities | null, requiresSocks5Access: true },
  { name: "My Users", href: "/my-users", icon: Users, adminOnly: false, requiresCapability: "can_create_users" as keyof UserCapabilities | null, requiresSocks5Access: false },
];

const adminSubMenu = [
  { name: "Routers", href: "/admin", icon: Server, tab: null },
  { name: "SOCKS5", href: "/admin?tab=socks5", icon: Network, tab: "socks5" },
  { name: "IPs", href: "/admin?tab=ips", icon: Globe, tab: "ips" },
  { name: "Users", href: "/admin?tab=users", icon: UserCog, tab: "users" },
  { name: "Access", href: "/admin?tab=access", icon: Key, tab: "access" },
];

// Inner component that uses useSearchParams
function SidebarContent({ userRole = "user", userEmail, userCapabilities, hasSocks5Access, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [collapsed, setCollapsed] = useState(false);
  const [adminExpanded, setAdminExpanded] = useState(true);

  const filteredNav = navigation.filter(item => {
    // Admin check
    if (item.adminOnly && userRole !== "admin") return false;
    // Capability check
    if (item.requiresCapability && !userCapabilities?.[item.requiresCapability]) return false;
    // SOCKS5 access check - admin always has access, users need hasSocks5Access
    if (item.requiresSocks5Access && userRole !== "admin" && !hasSocks5Access) return false;
    return true;
  });
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin");
  const currentTab = searchParams.get("tab");

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-card border-r border-border transition-all duration-300 flex flex-col",
        collapsed ? "w-[70px]" : "w-[240px]"
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border">
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary" />
            </div>
            <span className="font-semibold gradient-text">WireGuard</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center mx-auto">
            <Shield className="w-4 h-4 text-primary" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {filteredNav.map((item) => {
          const isActive = pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                collapsed && "justify-center px-2"
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
            </Link>
          );
        })}

        {/* Admin Panel with Submenu */}
        {userRole === "admin" && (
          <div className="space-y-1">
            {collapsed ? (
              <Link
                href="/admin"
                className={cn(
                  "flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-200",
                  isAdminPage
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                title="Admin Panel"
              >
                <Server className="w-5 h-5" />
              </Link>
            ) : (
              <>
                <button
                  onClick={() => setAdminExpanded(!adminExpanded)}
                  className={cn(
                    "w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
                    isAdminPage
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Server className="w-5 h-5 flex-shrink-0" />
                    <span className="text-sm font-medium">Admin Panel</span>
                  </div>
                  <ChevronDown className={cn(
                    "w-4 h-4 transition-transform",
                    adminExpanded && "rotate-180"
                  )} />
                </button>

                {adminExpanded && (
                  <div className="ml-4 pl-4 border-l border-border space-y-1">
                    {adminSubMenu.map((subItem) => {
                      // Check if this submenu item is active
                      const isSubActive = pathname === "/admin" &&
                        (subItem.tab === null ? !currentTab : currentTab === subItem.tab);

                      return (
                        <Link
                          key={subItem.name}
                          href={subItem.href}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200",
                            isSubActive
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                          )}
                        >
                          <subItem.icon className="w-4 h-4 flex-shrink-0" />
                          <span>{subItem.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-border">
        {!collapsed ? (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
              <span className="text-xs font-medium text-foreground">
                {userEmail?.charAt(0).toUpperCase() || "U"}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{userEmail || "User"}</p>
              <p className="text-xs text-muted-foreground capitalize">{userRole}</p>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onLogout}
            className="w-full flex justify-center p-2.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-destructive transition-colors"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </div>
    </aside>
  );
}

// Wrapper component with Suspense
export function Sidebar(props: SidebarProps) {
  return (
    <Suspense fallback={
      <aside className="fixed left-0 top-0 z-40 h-screen w-[240px] bg-card border-r border-border" />
    }>
      <SidebarContent {...props} />
    </Suspense>
  );
}
