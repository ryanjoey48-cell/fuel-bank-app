import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_SERVER_API_KEY;
const publicGoogleMapsApiKey =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    [
      "Supabase environment variables are missing for the client build.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in local and Vercel."
    ].join(" ")
  );
}

if (!googleMapsApiKey) {
  console.warn(
    [
      "Google Maps server key is missing.",
      "Missing GOOGLE_MAPS_SERVER_API_KEY. Server Place verification and route estimates need a separate server-only key."
    ].join(" ")
  );
}

if (!publicGoogleMapsApiKey) {
  console.warn(
    [
      "Google Maps public browser key is missing.",
      "Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Browser-side Google Maps JavaScript/Places loading needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.",
      "This value is baked into the frontend at build time on Vercel; add it to Production, Preview, and Development then redeploy."
    ].join(" ")
  );
}

const nextConfig: NextConfig = {
  // Keep local verification builds separate from a running development server.
  distDir: process.env.FUEL_BANK_ISOLATED_BUILD === "1" ? ".next-maintenance-qa" : ".next",
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey
  }
};

export default nextConfig;
