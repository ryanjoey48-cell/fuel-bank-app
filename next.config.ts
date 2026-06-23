import type { NextConfig } from "next";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY;
const publicGoogleMapsApiKey =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

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
      "Google Maps server key is missing.",
      "Missing GOOGLE_MAPS_API_KEY. Server autocomplete, place details, and route estimates need GOOGLE_MAPS_API_KEY.",
      "Legacy aliases such as GOOGLE_MAPS_KEY are no longer used because they hide Vercel environment-scope mistakes.",
      "Autocomplete and route estimates will fall back to manual entry until Maps is configured and the app is redeployed."
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
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseAnonKey,
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey,
    VITE_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey
  }
};

export default nextConfig;
