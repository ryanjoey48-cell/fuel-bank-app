import type { Map as LeafletMap } from "leaflet";
import {
  EES_LEAFLET_RASTER_TILE_OPTIONS,
  EES_MAP_ATTRIBUTION,
  EES_MAP_RASTER_ATTRIBUTION,
  EES_MAP_RASTER_TILE_URL,
  EES_MAP_VECTOR_STYLE_URL
} from "@/lib/ees-map-tiles";

type LeafletModule = typeof import("leaflet");

type MapLibreBridgeLayer = import("leaflet").Layer & {
  getMaplibreMap?: () => {
    jumpTo: (options: { center: [number, number]; zoom: number }) => void;
    resize: () => void;
    getCanvas: () => HTMLCanvasElement;
    on: (event: string, handler: () => void) => void;
  };
  getCanvas?: () => HTMLCanvasElement;
};

/**
 * Attach the EES basemap to an existing Leaflet map.
 * Prefer OpenFreeMap Liberty vector tiles; honour a licensed raster override when configured.
 * Does not recreate the map ? call once during map initialization.
 *
 * MapLibre-GL-Leaflet keeps a separate WebGL camera. Zoom *animation* transforms on
 * that canvas are a known source of basemap drift (markers look fine at street zoom
 * but sit over water when zoomed out) and blurry/enlarged tiles. Callers must disable
 * Leaflet zoomAnimation (see eesLeafletMapInitOptions) and we resync on zoomend.
 */
export async function attachEesLeafletBasemap(Leaflet: LeafletModule, map: LeafletMap) {
  if (EES_MAP_RASTER_TILE_URL) {
    return Leaflet.tileLayer(EES_MAP_RASTER_TILE_URL, {
      ...EES_LEAFLET_RASTER_TILE_OPTIONS,
      attribution: EES_MAP_RASTER_ATTRIBUTION
    }).addTo(map);
  }

  await import("maplibre-gl");
  const { maplibreGL } = await import("@maplibre/maplibre-gl-leaflet");
  const layer = maplibreGL({
    style: EES_MAP_VECTOR_STYLE_URL,
    attributionControl: false,
    interactive: false,
    // Extra GL padding shifts the WebGL canvas relative to Leaflet markers.
    ...({ padding: 0 } as Record<string, number>)
  }).addTo(map) as MapLibreBridgeLayer;

  const resyncBasemap = () => {
    const gl = layer.getMaplibreMap?.();
    if (!gl || !map) return;
    const canvas = layer.getCanvas?.() ?? gl.getCanvas?.();
    if (canvas && Leaflet.DomUtil?.setTransform) {
      // Clear any leftover zoom-animation scale that enlarges/blurs tiles.
      Leaflet.DomUtil.setTransform(canvas, Leaflet.point(0, 0), 1);
    }
    const center = map.getCenter();
    gl.jumpTo({
      center: [center.lng, center.lat],
      // MapLibre-GL-Leaflet uses 512px world tiles; keep its documented Leaflet offset.
      zoom: map.getZoom() - 1
    });
    gl.resize();
  };

  map.on("zoomend", resyncBasemap);
  map.on("moveend", resyncBasemap);
  map.on("resize", resyncBasemap);
  window.requestAnimationFrame(resyncBasemap);
  return layer;
}

export function eesLeafletMapInitOptions() {
  return {
    // Keep MapLibre and Leaflet latitude ranges aligned when using the vector basemap.
    maxBounds: [[-85, -180], [85, 180]] as [[number, number], [number, number]],
    maxBoundsViscosity: 1,
    minZoom: 4,
    // leaflet.markercluster requires an explicit maxZoom (throws if missing).
    maxZoom: 19,
    attributionControl: true,
    // Critical: animated zoom applies CSS transforms to the MapLibre canvas and
    // desyncs roads from Leaflet marker lat/lng (vehicles appear in the sea).
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false
  };
}

export function eesLeafletAttributionHtml() {
  return EES_MAP_RASTER_TILE_URL ? EES_MAP_RASTER_ATTRIBUTION : EES_MAP_ATTRIBUTION;
}
