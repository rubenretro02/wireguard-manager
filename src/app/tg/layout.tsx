import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "VPN Store",
  description: "Buy and manage your WireGuard access",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function TgLayout({ children }: { children: React.ReactNode }) {
  // The Telegram WebApp SDK is loaded app-wide in the root layout.
  return <>{children}</>;
}
