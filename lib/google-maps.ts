export function getServerGoogleMapsApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ??
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ??
    process.env.VITE_GOOGLE_MAPS_API_KEY ??
    ""
  );
}

export function getClientGoogleMapsApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.VITE_GOOGLE_MAPS_API_KEY ?? "";
}

export function getClientGoogleMapsConfig() {
  const key = getClientGoogleMapsApiKey();
  const source = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    ? "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"
    : process.env.VITE_GOOGLE_MAPS_API_KEY
      ? "VITE_GOOGLE_MAPS_API_KEY"
      : null;

  return {
    hasKey: Boolean(key),
    key,
    source
  };
}
