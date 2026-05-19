import type { NextConfig } from "next";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ??
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
  process.env.VITE_GOOGLE_MAPS_API_KEY;
const publicGoogleMapsApiKey =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    [
      "Supabase environment variables are missing for the client build.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in local and Vercel.",
      "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are accepted as compatibility aliases."
    ].join(" ")
  );
}

if (!googleMapsApiKey) {
  console.warn(
    [
      "Google Maps environment variable is missing.",
      "Set GOOGLE_MAPS_API_KEY for server routes, or NEXT_PUBLIC_GOOGLE_MAPS_API_KEY / VITE_GOOGLE_MAPS_API_KEY when the browser loader needs a public key.",
      "Autocomplete and route estimates will fall back to manual entry until Maps is configured."
    ].join(" ")
  );
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey,
    VITE_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey
  }
};

export default nextConfig;
