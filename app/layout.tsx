import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import { LanguageProvider } from "@/lib/language-provider";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Expert Express Sender Logistics Control",
  title: "Expert Express Sender Logistics Control",
  description: "Logistics operations, dispatch, fuel, fleet, and trip control for Expert Express Sender.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }]
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Fuel App"
  },
  formatDetection: {
    telephone: false
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "default",
    "apple-mobile-web-app-title": "Fuel App"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
  colorScheme: "light"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaRegister />
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
