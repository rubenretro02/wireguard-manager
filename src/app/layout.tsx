import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "BlackGott VPN - Real Dedicated Fresh Residential IP | WireGuard",
  description: "Premium VPN service with exclusive residential IPs. Powered by WireGuard protocol for maximum speed and security. Get your dedicated IP today.",
  keywords: "VPN, WireGuard, Residential IP, Dedicated IP, Privacy, Security, Anonymous",
  openGraph: {
    title: "BlackGott VPN - Real Dedicated Fresh Residential IP",
    description: "Premium VPN service with exclusive residential IPs powered by WireGuard protocol.",
    url: "https://vpn.blackgott.com",
    siteName: "BlackGott VPN",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
