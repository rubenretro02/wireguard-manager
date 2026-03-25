"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: "primary" | "emerald" | "red" | "cyan";
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

const iconColors = {
  primary: "bg-primary/10 text-primary group-hover:bg-primary/20",
  emerald: "bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20",
  red: "bg-red-500/10 text-red-400 group-hover:bg-red-500/20",
  cyan: "bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20",
};

export function StatCard({ title, value, subtitle, icon: Icon, iconColor = "primary", trend, className, onClick, active }: StatCardProps) {
  return (
    <div
      className={cn(
        "stat-card group",
        onClick && "cursor-pointer hover:border-primary/50",
        active && "border-primary ring-1 ring-primary/20",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
          {trend && (
            <div className={cn(
              "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
              trend.isPositive
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            )}>
              <span>{trend.isPositive ? "+" : ""}{trend.value}%</span>
              <span className="text-muted-foreground">vs last week</span>
            </div>
          )}
        </div>
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center transition-colors", iconColors[iconColor])}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}
