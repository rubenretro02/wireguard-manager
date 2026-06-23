import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { TelegramViewport } from "@/components/TelegramViewport";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "WireGuard Manager",
  description: "Manage WireGuard peers on MikroTik routers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Telegram Mini App SDK — app-wide so the embedded admin panel can
            expand + disable swipe-to-close (see TelegramViewport). */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <TelegramViewport />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
