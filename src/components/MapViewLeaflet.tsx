import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { MapBaseLayer } from "../lib/mapBaseLayer";
import { readCachedMapCenter, writeCachedMapCenter } from "../lib/mapViewport";

/** 地図マーカー用（色は呼び出し側で計算） */
export type MapCustomerPin = {
  id: string;
  lat: number;
  lng: number;
  markerColor: string;
};

const DEFAULT_CENTER: L.LatLngTuple = [34.8161, 135.5686];
const OSM_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const GSI_PHOTO_TILE = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";

/** OSM タイルのネイティブ最大ズーム */
const TILE_MAX_NATIVE = 19;
const PHOTO_TILE_MAX_NATIVE = 18;
/** ユーザーがピンチ等でさらに寄れる最大ズーム（タイルは拡大） */
const MAP_MAX_ZOOM = 22;

const BASE_LAYER_CONFIG: Record<
  MapBaseLayer,
  { url: string; attribution: string; maxNativeZoom: number }
> = {
  default: {
    url: OSM_TILE,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    maxNativeZoom: TILE_MAX_NATIVE,
  },
  photo: {
    url: GSI_PHOTO_TILE,
    attribution:
      '出典: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
    maxNativeZoom: PHOTO_TILE_MAX_NATIVE,
  },
};

function createBaseLayer(baseLayer: MapBaseLayer): L.TileLayer {
  const config = BASE_LAYER_CONFIG[baseLayer];
  return L.tileLayer(config.url, {
    attribution: config.attribution,
    maxZoom: MAP_MAX_ZOOM,
    maxNativeZoom: config.maxNativeZoom,
  });
}

export type MapViewHandle = {
  setView: (lat: number, lng: number, zoom?: number) => void;
  goToCurrentLocation: () => void;
};

type Props = {
  baseLayer: MapBaseLayer;
  customers: MapCustomerPin[];
  onMapClick: (lat: number, lng: number) => void;
  onMarkerClick: (customerId: string) => void;
  /** true のときは初回 GPS で地図中心を動かさない（?highlight= で顧客に寄せるため） */
  skipInitialGpsFocus?: boolean;
  /** 地図のビューポートが変わるたびに呼ばれる */
  onBoundsChange?: (bounds: L.LatLngBounds) => void;
  /** GPS 位置が更新されるたびに呼ばれる */
  onLocationChange?: (lat: number, lng: number) => void;
};

const userLocationIcon = L.divIcon({
  className: "machimap-user-loc",
  html: `<div style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;pointer-events:none">
    <span style="width:18px;height:18px;background:#0ea5e9;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.45)"></span>
  </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

export const MapViewLeaflet = forwardRef<MapViewHandle, Props>(function MapViewLeaflet(
  { baseLayer, customers, onMapClick, onMarkerClick, skipInitialGpsFocus = false,
    onBoundsChange, onLocationChange },
  ref
) {
  const skipGpsFocusRef = useRef(skipInitialGpsFocus);
  const initialBaseLayerRef = useRef(baseLayer);
  skipGpsFocusRef.current = skipInitialGpsFocus;

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const onBoundsChangeRef = useRef(onBoundsChange);
  const onLocationChangeRef = useRef(onLocationChange);
  onMapClickRef.current = onMapClick;
  onMarkerClickRef.current = onMarkerClick;
  onBoundsChangeRef.current = onBoundsChange;
  onLocationChangeRef.current = onLocationChange;

  useImperativeHandle(ref, () => ({
    setView(lat, lng, zoom = 16) {
      mapRef.current?.setView([lat, lng], zoom);
    },
    goToCurrentLocation() {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          mapRef.current?.setView([lat, lng], 19);
          writeCachedMapCenter(lat, lng, 19);
        },
        () => {
          mapRef.current?.setView(DEFAULT_CENTER, 16);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    },
  }));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      zoomControl: false,
      preferCanvas: true,
      maxZoom: MAP_MAX_ZOOM,
    });
    L.control.zoom({ position: "topleft" }).addTo(map);
    const cached = readCachedMapCenter();
    const initialCenter: L.LatLngTuple = cached ? [cached.lat, cached.lng] : DEFAULT_CENTER;
    const initialZoom = cached?.zoom ?? 16;
    map.setView(initialCenter, initialZoom);
    const base = createBaseLayer(initialBaseLayerRef.current);
    base.addTo(map);
    baseRef.current = base;
    const markers = L.layerGroup().addTo(map);
    markersLayerRef.current = markers;

    const userLayer = L.layerGroup().addTo(map);
    let userMarker: L.Marker | null = null;
    let accuracyCircle: L.Circle | null = null;
    let centeredFromGps = false;

    const onLocationFound = (e: L.LocationEvent) => {
      const { latlng, accuracy } = e;
      if (!skipGpsFocusRef.current && !centeredFromGps) {
        map.setView(latlng, 18);
        writeCachedMapCenter(latlng.lat, latlng.lng, 18);
        centeredFromGps = true;
      }
      onLocationChangeRef.current?.(latlng.lat, latlng.lng);
      if (!userMarker) {
        userMarker = L.marker(latlng, {
          icon: userLocationIcon,
          zIndexOffset: 2000,
          interactive: false,
        }).addTo(userLayer);
        accuracyCircle = L.circle(latlng, {
          radius: Math.max(accuracy, 8),
          color: "#0ea5e9",
          weight: 1,
          fillColor: "#38bdf8",
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(userLayer);
      } else {
        userMarker.setLatLng(latlng);
        accuracyCircle!.setLatLng(latlng);
        accuracyCircle!.setRadius(Math.max(accuracy, 8));
      }
    };

    const onLocationError = () => {
      userLayer.clearLayers();
      userMarker = null;
      accuracyCircle = null;
    };

    map.on("locationfound", onLocationFound);
    map.on("locationerror", onLocationError);
    map.locate({
      watch: true,
      setView: false,
      enableHighAccuracy: true,
      timeout: 20000,
      /** ブラウザ／OS の直近位置をすぐ使い、初回の大きなジャンプを減らす */
      maximumAge: 60000,
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    const fireBounds = () => onBoundsChangeRef.current?.(map.getBounds());
    setTimeout(() => {
      map.invalidateSize();
      fireBounds();
    }, 0);
    map.on("move", fireBounds);
    map.on("zoomend", fireBounds);

    mapRef.current = map;
    return () => {
      map.stopLocate();
      map.off("locationfound", onLocationFound);
      map.off("locationerror", onLocationError);
      map.off("move", fireBounds);
      map.off("zoomend", fireBounds);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      baseRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = createBaseLayer(baseLayer);
    const prev = baseRef.current;
    if (prev) map.removeLayer(prev);
    next.addTo(map);
    baseRef.current = next;
  }, [baseLayer]);


  useEffect(() => {
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    for (const c of customers) {
      const fill = c.markerColor;
      const icon = L.divIcon({
        className: "machimap-pin",
        html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${fill};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const m = L.marker([c.lat, c.lng], { icon });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onMarkerClickRef.current(c.id);
      });
      m.addTo(group);
    }
  }, [customers]);

  return <div ref={containerRef} className="h-full w-full min-h-[240px]" />;
});
