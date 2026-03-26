import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { readCachedMapCenter, writeCachedMapCenter } from "../lib/mapViewport";
import type { CustomerRow } from "../lib/types";

const DEFAULT_CENTER: L.LatLngTuple = [34.8161, 135.5686];
const OSM_TILE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/** OSM タイルのネイティブ最大ズーム */
const TILE_MAX_NATIVE = 19;
/** ユーザーがピンチ等でさらに寄れる最大ズーム（タイルは拡大） */
const MAP_MAX_ZOOM = 22;

export type MapViewHandle = {
  setView: (lat: number, lng: number, zoom?: number) => void;
  goToCurrentLocation: () => void;
};

type Props = {
  customers: CustomerRow[];
  highlightId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onMarkerClick: (customerId: string) => void;
  /** true のときは初回 GPS で地図中心を動かさない（?highlight= で顧客に寄せるため） */
  skipInitialGpsFocus?: boolean;
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
  { customers, highlightId, onMapClick, onMarkerClick, skipInitialGpsFocus = false },
  ref
) {
  const skipGpsFocusRef = useRef(skipInitialGpsFocus);
  skipGpsFocusRef.current = skipInitialGpsFocus;

  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const baseRef = useRef<L.TileLayer | null>(null);
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  onMapClickRef.current = onMapClick;
  onMarkerClickRef.current = onMarkerClick;

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
      zoomControl: true,
      preferCanvas: true,
      maxZoom: MAP_MAX_ZOOM,
    });
    const cached = readCachedMapCenter();
    const initialCenter: L.LatLngTuple = cached ? [cached.lat, cached.lng] : DEFAULT_CENTER;
    const initialZoom = cached?.zoom ?? 16;
    map.setView(initialCenter, initialZoom);
    const base = L.tileLayer(OSM_TILE, {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
      maxZoom: MAP_MAX_ZOOM,
      maxNativeZoom: TILE_MAX_NATIVE,
    });
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

    mapRef.current = map;
    return () => {
      map.stopLocate();
      map.off("locationfound", onLocationFound);
      map.off("locationerror", onLocationError);
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      baseRef.current = null;
    };
  }, []);


  useEffect(() => {
    const map = mapRef.current;
    const group = markersLayerRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const icon = L.divIcon({
      className: "machimap-pin",
      html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const hi = L.divIcon({
      className: "machimap-pin-hi",
      html: `<span style="display:block;width:18px;height:18px;border-radius:50%;background:#dc2626;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    for (const c of customers) {
      const isHi = highlightId === c.id;
      const m = L.marker([c.lat, c.lng], { icon: isHi ? hi : icon });
      m.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onMarkerClickRef.current(c.id);
      });
      m.addTo(group);
    }
  }, [customers, highlightId]);

  return <div ref={containerRef} className="h-full w-full min-h-[240px]" />;
});
