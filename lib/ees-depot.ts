// Existing verified Shipments depot; shared so driver routing uses the same source.
export const VERIFIED_DEPOT_LOCATION = {
  name: "Expert Express Sender co., ltd.",
  label: "Expert Express Sender depot / lorry park",
  address: "88 Happy Place, Khwaeng Khlong Sam Prawet, Khet Lat Krabang, Krung Thep Maha Nakhon 10520, Thailand",
  placeId: "ChIJ8fXnGABnHTERYQ4KR0ZGF-E",
  mapsReference: "0x0:0xe1174646470a0e61",
  lat: 13.7688008,
  lng: 100.7657385
} as const;

export function getEesDepot() {
  const address = process.env.NEXT_PUBLIC_DEFAULT_DEPOT_ADDRESS || process.env.VITE_DEFAULT_DEPOT_ADDRESS || VERIFIED_DEPOT_LOCATION.address;
  const lat = process.env.NEXT_PUBLIC_DEFAULT_DEPOT_LAT || process.env.VITE_DEFAULT_DEPOT_LAT;
  const lng = process.env.NEXT_PUBLIC_DEFAULT_DEPOT_LNG || process.env.VITE_DEFAULT_DEPOT_LNG;
  const overridden = address !== VERIFIED_DEPOT_LOCATION.address;
  return {
    name: process.env.NEXT_PUBLIC_DEFAULT_DEPOT_NAME || process.env.VITE_DEFAULT_DEPOT_NAME || VERIFIED_DEPOT_LOCATION.name,
    address,
    placeId: process.env.NEXT_PUBLIC_DEFAULT_DEPOT_PLACE_ID || process.env.VITE_DEFAULT_DEPOT_PLACE_ID || (overridden ? null : VERIFIED_DEPOT_LOCATION.placeId),
    latitude: lat && Number.isFinite(Number(lat)) ? Number(lat) : overridden ? null : VERIFIED_DEPOT_LOCATION.lat,
    longitude: lng && Number.isFinite(Number(lng)) ? Number(lng) : overridden ? null : VERIFIED_DEPOT_LOCATION.lng
  };
}
