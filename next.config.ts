import type { NextConfig } from "next";

const financeDemoOnly = process.env.NODE_ENV !== "production" && process.env.EES_FINANCE_DEMO_ONLY === "1";
const supabaseUrl = financeDemoOnly ? "" : process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = financeDemoOnly ? "" : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const googleMapsApiKey =
  process.env.GOOGLE_MAPS_SERVER_API_KEY;
const publicGoogleMapsApiKey =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

if (!financeDemoOnly && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    [
      "Supabase environment variables are missing for the client build.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in local and Vercel."
    ].join(" ")
  );
}

if (!financeDemoOnly && !googleMapsApiKey) {
  console.warn(
    [
      "Google Maps server key is missing.",
      "Missing GOOGLE_MAPS_SERVER_API_KEY. Server Place verification and route estimates need a separate server-only key."
    ].join(" ")
  );
}

if (!financeDemoOnly && !publicGoogleMapsApiKey) {
  console.warn(
    [
      "Google Maps public browser key is missing.",
      "Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Browser-side Google Maps JavaScript/Places loading needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY.",
      "This value is baked into the frontend at build time on Vercel; add it to Production, Preview, and Development then redeploy."
    ].join(" ")
  );
}

const isolatedBuild =
  process.env.FUEL_BANK_ISOLATED_BUILD === "1" || Boolean(process.env.FUEL_BANK_DIST_DIR?.trim());
const isolatedDistDir = process.env.FUEL_BANK_DIST_DIR?.trim() || ".next-maintenance-qa";
// `next build` and `next start` must agree, while a running local `next dev`
// keeps exclusive use of `.next`. Preserve Vercel's standard output directory.
const defaultDistDir = process.env.NODE_ENV === "production" && !process.env.VERCEL
  ? ".next-local-production"
  : ".next";

const nextConfig: NextConfig = {
  // page.demo.tsx is available to local development, never a production route.
  pageExtensions: process.env.NODE_ENV === "production" ? ["ts", "tsx", "js", "jsx"] : ["ts", "tsx", "js", "jsx", "demo.tsx"],
  // Local verification can cap concurrency on memory-constrained Windows hosts.
  ...(process.env.FUEL_BANK_LOW_MEMORY === "1" ? {experimental:{cpus:1,webpackMemoryOptimizations:true}} : {}),
  // Explicit QA directories still take precedence over the local build default.
  distDir: isolatedBuild ? isolatedDistDir : defaultDistDir,
  // MapLibre GL + Leaflet bridge ship as ESM packages that need transpilation in Next.
  transpilePackages: ["maplibre-gl", "@maplibre/maplibre-gl-leaflet"],
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
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: publicGoogleMapsApiKey,
    // Fixture preview only: start-finance-preview.cjs sets this and clears Supabase credentials.
    NEXT_PUBLIC_EES_FINANCE_PREVIEW: process.env.NEXT_PUBLIC_EES_FINANCE_PREVIEW || "",
    NEXT_PUBLIC_EES_FINANCE_FIXTURE: process.env.NEXT_PUBLIC_EES_FINANCE_FIXTURE || ""
  },
  async rewrites() {
    return [
      { source: "/ees-truck.jpg", destination: "/ees-truck.jpg.jpeg" }
    ];
  }
};

export default nextConfig;
