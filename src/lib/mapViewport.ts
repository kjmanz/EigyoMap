/** 前回の地図中心（現在地寄せのたびに更新）。再読み込み時のチラつきを減らす */
const CACHE_KEY = "eigyomap_map_last_latlng";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function readCachedMapCenter(): { lat: number; lng: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { lat?: unknown; lng?: unknown; zoom?: unknown; t?: unknown };
    if (typeof o.lat !== "number" || typeof o.lng !== "number") return null;
    if (typeof o.t === "number" && Date.now() - o.t > MAX_AGE_MS) return null;
    const zoom = typeof o.zoom === "number" ? o.zoom : 17;
    return { lat: o.lat, lng: o.lng, zoom };
  } catch {
    return null;
  }
}

export function writeCachedMapCenter(lat: number, lng: number, zoom: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lng, zoom, t: Date.now() }));
  } catch {
    /* プライベートモード等 */
  }
}
