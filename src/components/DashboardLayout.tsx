"use client";

import { ReactNode } from "react";
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
  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        userRole={userRole}
        userEmail={userEmail}
        userCapabilities={userCapabilities}
        hasSocks5Access={hasSocks5Access}
        onLogout={onLogout}
      />
      <main className={cn(
        "transition-all duration-300 ml-[240px]",
        "min-h-screen"
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
    <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-30">
      <div className="px-8 py-6 flex items-center justify-between">
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
    <div className={cn("p-8", className)}>
      {children}
    </div>
  );
}
