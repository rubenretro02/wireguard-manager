"use client";

import { ReactNode, useState } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { cn } from "@/lib/utils";
import type { UserCapabilities } from "@/lib/types";

interface DashboardLayoutProps {
  children: ReactNode;
  userRole?: "admin" | "user";
  userEmail?: string;
  userCapabilities?: UserCapabilities;
  hasSocks5Access?: boolean;
  onLogout?: () => void;
}

export function DashboardLayout({ children, userRole, userEmail, userCapabilities, hasSocks5Access, onLogout }: DashboardLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        userRole={userRole}
        userEmail={userEmail}
        userCapabilities={userCapabilities}
        hasSocks5Access={hasSocks5Access}
        onLogout={onLogout}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Hamburger (mobile only) — opens the nav drawer */}
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        aria-label="Open menu"
        className="md:hidden fixed top-[calc(0.75rem+var(--tg-top))] left-3 z-40 p-2 rounded-lg bg-card border border-border text-foreground shadow-sm"
      >
        <Menu className="w-5 h-5" />
      </button>

      <main className={cn(
        "transition-all duration-300 ml-0 md:ml-[240px]",
        "min-h-screen pb-[var(--tg-bottom)]"
      )}>
        {children}
      </main>
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30 pt-[var(--tg-top)]">
      <div className="px-4 md:px-8 py-6 pl-16 md:pl-8 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {children && (
          <div className="flex items-center gap-3">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

interface PageContentProps {
  children: ReactNode;
  className?: string;
}

export function PageContent({ children, className }: PageContentProps) {
  return (
    <div className={cn("p-4 md:p-8", className)}>
      {children}
    </div>
  );
}
