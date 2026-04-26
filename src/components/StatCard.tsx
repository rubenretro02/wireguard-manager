"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  iconColor?: "primary" | "emerald" | "red" | "cyan" | "amber" | "violet" | "blue";
  trend?: {
    value: number;
    isPositive: boolean;
  };
  className?: string;
  onClick?: () => void;
  active?: boolean;
  gradient?: boolean;
  pulse?: boolean;
}

const gradientColors = {
  primary: "from-primary/20 via-primary/10 to-transparent",
  emerald: "from-emerald-500/20 via-emerald-500/10 to-transparent",
  red: "from-red-500/20 via-red-500/10 to-transparent",
  cyan: "from-cyan-500/20 via-cyan-500/10 to-transparent",
  amber: "from-amber-500/20 via-amber-500/10 to-transparent",
  violet: "from-violet-500/20 via-violet-500/10 to-transparent",
  blue: "from-blue-500/20 via-blue-500/10 to-transparent",
};

const iconColors = {
  primary: "bg-primary/20 text-primary shadow-primary/25",
  emerald: "bg-emerald-500/20 text-emerald-400 shadow-emerald-500/25",
  red: "bg-red-500/20 text-red-400 shadow-red-500/25",
  cyan: "bg-cyan-500/20 text-cyan-400 shadow-cyan-500/25",
  amber: "bg-amber-500/20 text-amber-400 shadow-amber-500/25",
  violet: "bg-violet-500/20 text-violet-400 shadow-violet-500/25",
  blue: "bg-blue-500/20 text-blue-400 shadow-blue-500/25",
};

const textColors = {
  primary: "text-primary",
  emerald: "text-emerald-400",
  red: "text-red-400",
  cyan: "text-cyan-400",
  amber: "text-amber-400",
  violet: "text-violet-400",
  blue: "text-blue-400",
};

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "primary",
  trend,
  className,
  onClick,
  active,
  gradient = true,
  pulse = false
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/50 bg-card p-6 transition-all duration-300",
        onClick && "cursor-pointer hover:border-border hover:shadow-lg hover:shadow-black/5 hover:-translate-y-0.5",
        active && "border-primary/50 ring-2 ring-primary/20 shadow-lg shadow-primary/10",
        className
      )}
      onClick={onClick}
    >
      {/* Gradient Background */}
      {gradient && (
        <div className={cn(
          "absolute inset-0 bg-gradient-to-br opacity-50",
          gradientColors[iconColor]
        )} />
      )}

      {/* Content */}
      <div className="relative z-10">
        <div className="flex items-start justify-between">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
            <div className="flex items-baseline gap-2">
              <p className={cn("text-4xl font-bold tracking-tight", textColors[iconColor])}>{value}</p>
              {pulse && (
                <span className="relative flex h-3 w-3">
                  <span className={cn(
                    "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                    iconColor === "emerald" ? "bg-emerald-400" : "bg-red-400"
                  )}></span>
                  <span className={cn(
                    "relative inline-flex rounded-full h-3 w-3",
                    iconColor === "emerald" ? "bg-emerald-500" : "bg-red-500"
                  )}></span>
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
            {trend && (
              <div className={cn(
                "inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full",
                trend.isPositive
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400"
              )}>
                <svg
                  className={cn("w-3 h-3", !trend.isPositive && "rotate-180")}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                <span>{trend.isPositive ? "+" : ""}{trend.value}%</span>
              </div>
            )}
          </div>
          <div className={cn(
            "w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:scale-110",
            iconColors[iconColor]
          )}>
            <Icon className="w-7 h-7" />
          </div>
        </div>
      </div>
    </div>
  );
}
