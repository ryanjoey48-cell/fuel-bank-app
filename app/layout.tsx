import type { Metadata, Viewport } from "next";
import { PwaRegister } from "@/components/pwa-register";
import { LanguageProvider } from "@/lib/language-provider";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Fuel & Bank App",
  title: "Fuel & Bank App",
  description: "Fuel log and bank transfer management for logistics teams.",
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
  maximumScale: 1,
  userScalable: false,
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
