export type MapBaseLayer = "default" | "photo";

const STORAGE_KEY = "eigyomap_map_base_layer";
const DEFAULT_BASE_LAYER: MapBaseLayer = "default";

export const MAP_BASE_LAYER_OPTIONS = [
  { value: "default", label: "地図" },
  { value: "photo", label: "航空写真" },
] as const;

export function readPreferredMapBaseLayer(): MapBaseLayer {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === "photo" ? "photo" : DEFAULT_BASE_LAYER;
  } catch {
    return DEFAULT_BASE_LAYER;
  }
}

export function writePreferredMapBaseLayer(baseLayer: MapBaseLayer): void {
  try {
    localStorage.setItem(STORAGE_KEY, baseLayer);
  } catch {
    /* プライベートモード等 */
  }
}

export function getMapAttributionText(_baseLayer: MapBaseLayer): string {
  return "出典: 国土地理院";
}
