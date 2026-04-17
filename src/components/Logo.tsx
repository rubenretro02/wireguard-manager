'use client';

import { Shield } from 'lucide-react';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
}

export function Logo({ size = 'md', showText = true }: LogoProps) {
  const sizes = {
    sm: { icon: 20, text: 'text-lg' },
    md: { icon: 28, text: 'text-xl' },
    lg: { icon: 36, text: 'text-2xl' },
    xl: { icon: 48, text: 'text-3xl' },
  };

  const { icon, text } = sizes[size];

  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-full" />
        <div className="relative bg-gradient-to-br from-emerald-400 to-green-600 p-2 rounded-xl">
          <Shield size={icon} className="text-black" strokeWidth={2.5} />
        </div>
      </div>
      {showText && (
        <div className={`font-bold ${text} tracking-tight`}>
          <span className="text-white">BLACK</span>
          <span className="text-emerald-400">GOTT</span>
          <span className="text-zinc-500 font-normal ml-1">VPN</span>
        </div>
      )}
    </div>
  );
}
