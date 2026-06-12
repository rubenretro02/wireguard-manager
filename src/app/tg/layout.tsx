import Script from "next/script";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "VPN Store",
  description: "Compra y administra tu acceso WireGuard",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      {children}
    </>
  );
}
