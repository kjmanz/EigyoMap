import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type L from "leaflet";
import { AppHeader } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { DesktopAppShell } from "../components/DesktopAppShell";
import type { MapViewHandle } from "../components/MapViewLeaflet";
import { labelChipTextColor, pinColorFromLastVisit, toCustomerMapRow } from "../lib/customerLabels";
import {
  getMapAttributionText,
  MAP_BASE_LAYER_OPTIONS,
  readPreferredMapBaseLayer,
  writePreferredMapBaseLayer,
  type MapBaseLayer,
} from "../lib/mapBaseLayer";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOnline,
  type OfflineContactPayload,
  type OfflineCustomerPayload,
} from "../lib/offline";
import { relativeDate } from "../lib/relativeDate";
import { supabase } from "../lib/supabase";
import type { CustomerMapRow, LabelRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

const MapViewLeaflet = lazy(() =>
  import("../components/MapViewLeaflet").then((m) => ({ default: m.MapViewLeaflet }))
);

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : `${(m / 1000).toFixed(1)}km`;
}

function normalizeCustomerSearch(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

export function MapPage() {
  const { user, configured } = useAuth();
  const nav = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const highlightFromSearch = params.get("highlight");
  const relocateId = params.get("relocate");

  const mapRef = useRef<MapViewHandle>(null);
  const [customers, setCustomers] = useState<CustomerMapRow[]>([]);
  const [customersLoaded, setCustomersLoaded] = useState(false);
  const [labelMaster, setLabelMaster] = useState<LabelRow[]>([]);
  const [search, setSearch] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [tapLat, setTapLat] = useState<number | null>(null);
  const [tapLng, setTapLng] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const quickMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recordingCustomerId, setRecordingCustomerId] = useState<string | null>(null);
  const [recentlyRecordedCustomerId, setRecentlyRecordedCustomerId] = useState<string | null>(null);
  const recentRecordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const lastSheetToggleAt = useRef(0);
  const [relocateDraft, setRelocateDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [baseLayer, setBaseLayer] = useState<MapBaseLayer>(() => readPreferredMapBaseLayer());
  const [legendOpen, setLegendOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  useEffect(() => {
    writePreferredMapBaseLayer(baseLayer);
  }, [baseLayer]);

  useEffect(() => {
    return () => {
      if (quickMsgTimer.current) clearTimeout(quickMsgTimer.current);
      if (recentRecordTimer.current) clearTimeout(recentRecordTimer.current);
    };
  }, []);

  const relocateTarget = useMemo(() => {
    if (!relocateId) return null;
    return customers.find((c) => c.id === relocateId) ?? null;
  }, [relocateId, customers]);

  const selectedCustomer = useMemo(
    () => (selectedCustomerId ? customers.find((c) => c.id === selectedCustomerId) ?? null : null),
    [selectedCustomerId, customers]
  );

  const searchSuggestions = useMemo(() => {
    const q = normalizeCustomerSearch(search);
    const source = q
      ? customers.filter((c) => normalizeCustomerSearch(c.name).includes(q))
      : customers;
    return source.slice(0, 20);
  }, [customers, search]);

  const mapPins = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        markerColor: pinColorFromLastVisit(c.lastVisitedAt),
      })),
    [customers]
  );

  const visibleCustomers = useMemo(() => {
    if (!mapBounds) return [];
    const inBounds = customers.filter((c) => mapBounds.contains([c.lat, c.lng]));
    if (userLat == null || userLng == null) return inBounds;
    return [...inBounds].sort(
      (a, b) =>
        haversineMeters(userLat, userLng, a.lat, a.lng) -
        haversineMeters(userLat, userLng, b.lat, b.lng)
    );
  }, [customers, mapBounds, userLat, userLng]);

  const onBoundsChange = useCallback((bounds: L.LatLngBounds) => {
    setMapBounds(bounds);
  }, []);

  const onLocationChange = useCallback((lat: number, lng: number) => {
    setUserLat(lat);
    setUserLng(lng);
  }, []);

  const load = useCallback(async () => {
    if (!user) {
      setCustomersLoaded(false);
      return;
    }
    const [{ data: cus, error }, { data: visits }] = await Promise.all([
      supabase
        .from("customers")
        .select("*, customer_labels(label_id, labels(id, name, color))")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false }),
      supabase
        .from("contact_logs")
        .select("customer_id, visited_at")
        .eq("user_id", user.id)
        .is("deleted_at", null)
        .order("visited_at", { ascending: false }),
    ]);
    if (!error && cus) {
      const lastVisitMap = new Map<string, string>();
      for (const v of (visits ?? []) as { customer_id: string; visited_at: string }[]) {
        if (!lastVisitMap.has(v.customer_id)) lastVisitMap.set(v.customer_id, v.visited_at);
      }
      setCustomers(
        (cus as Parameters<typeof toCustomerMapRow>[0][]).map((row) => ({
          ...toCustomerMapRow(row),
          lastVisitedAt: lastVisitMap.get(row.id) ?? null,
        }))
      );
    }
    setCustomersLoaded(true);
  }, [user]);

  const loadLabels = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("labels")
      .select("*")
      .eq("user_id", user.id)
      .order("name");
    if (!error && data) setLabelMaster(data as LabelRow[]);
  }, [user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadLabels(); }, [loadLabels]);

  useEffect(() => {
    if (!highlightFromSearch) return;
    const c = customers.find((x) => x.id === highlightFromSearch);
    if (c) mapRef.current?.setView(c.lat, c.lng, 17);
  }, [highlightFromSearch, customers]);

  useEffect(() => {
    if (!relocateTarget) return;
    mapRef.current?.setView(relocateTarget.lat, relocateTarget.lng, 17);
  }, [relocateTarget]);

  useEffect(() => {
    if (!relocateId || !user || !customersLoaded) return;
    if (!customers.some((c) => c.id === relocateId)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("relocate");
        return next;
      }, { replace: true });
    }
  }, [relocateId, user, customersLoaded, customers, setSearchParams]);

  const clearRelocateParam = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("relocate");
      return next;
    }, { replace: true });
    setRelocateDraft(null);
  }, [setSearchParams]);

  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!configured || !user) return;
      if (relocateTarget) {
        if (!isOnline()) { setSyncMsg("位置の更新はオンラインで行ってください。"); return; }
        setRelocateDraft({ lat, lng });
        return;
      }
      setSelectedCustomerId(null);
      setTapLat(lat);
      setTapLng(lng);
      setRegisterOpen(true);
      setDupWarning(null);
      setNameDraft("");
      setMemoDraft("");
      setSelectedLabelIds([]);
      void supabase
        .rpc("find_nearby_customers", { p_lat: lat, p_lng: lng, p_meters: 30 })
        .then(({ data }) => {
          if (data && Array.isArray(data) && data.length > 0) {
            setDupWarning("近くに既存の顧客があります。重複登録に注意してください。");
          }
        });
    },
    [configured, user, relocateTarget]
  );

  const onMarkerClick = useCallback(
    (id: string) => {
      if (relocateTarget) return;
      setSelectedCustomerId(id);
      setSheetOpen(false);
    },
    [relocateTarget]
  );

  const toggleSheetOpen = useCallback(() => {
    const now = Date.now();
    if (now - lastSheetToggleAt.current < 380) return;
    lastSheetToggleAt.current = now;
    setSheetOpen((v) => !v);
  }, []);

  function dismissMiniCard() {
    setSelectedCustomerId(null);
    setSheetOpen(true);
  }

  function submitSearch() {
    const q = search.trim();
    nav(q ? `/list?q=${encodeURIComponent(q)}` : "/list");
  }

  async function saveCustomer() {
    if (tapLat == null || tapLng == null || !user || !nameDraft.trim()) return;
    const labelIds = selectedLabelIds;
    const payload: OfflineCustomerPayload = {
      name: nameDraft.trim(),
      address: null,
      phone: null,
      memo: memoDraft.trim() || null,
      lat: tapLat,
      lng: tapLng,
      labelIds,
    };
    if (!isOnline()) {
      await enqueueOffline({ id: crypto.randomUUID(), kind: "customer", payload });
      setRegisterOpen(false);
      setSyncMsg("オフラインのためキューに保存しました。オンラインで同期します。");
      return;
    }
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert({ user_id: user.id, name: payload.name, address: null, phone: null, memo: payload.memo, lat: payload.lat, lng: payload.lng })
      .select("id")
      .single();
    if (error || !inserted?.id) { alert(error?.message ?? "登録に失敗しました"); return; }
    const customerId = inserted.id as string;
    for (const lid of labelIds) {
      const { error: e2 } = await supabase.from("customer_labels").insert({ customer_id: customerId, label_id: lid });
      if (e2) { alert(e2.message); await load(); return; }
    }
    setRegisterOpen(false);
    await load();
  }

  async function confirmRelocate() {
    if (!relocateDraft || !relocateTarget || !user) return;
    const { error } = await supabase
      .from("customers")
      .update({ lat: relocateDraft.lat, lng: relocateDraft.lng })
      .eq("id", relocateTarget.id)
      .eq("user_id", user.id);
    if (error) { alert(error.message); return; }
    setRelocateDraft(null);
    clearRelocateParam();
    await load();
    nav(`/customer/${relocateTarget.id}`);
  }

  async function onSyncOffline() {
    setSyncMsg(null);
    const r = await flushOfflineQueue((m) => setSyncMsg(m));
    if (r.err) setSyncMsg(`同期エラー: ${r.err}`);
    else setSyncMsg(`${r.ok} 件を同期しました。`);
    await load();
  }

  async function quickRecord(customerId: string) {
    if (!user || recordingCustomerId === customerId) return;
    setRecordingCustomerId(customerId);
    const visitedAt = new Date().toISOString();
    const payload: OfflineContactPayload = { customerId, memo: "", visitedAt, photoBlobs: [] };
    try {
      if (!isOnline()) {
        await enqueueOffline({ id: crypto.randomUUID(), kind: "contact_log", payload });
        markQuickRecorded(customerId, visitedAt);
        showQuickMsg("訪問を記録しました（同期待ち）");
        return;
      }
      const { error } = await supabase.from("contact_logs").insert({
        customer_id: customerId, user_id: user.id, memo: "", visited_at: visitedAt, pinned: false,
      });
      if (error) { showQuickMsg(`エラー: ${error.message}`); return; }
      markQuickRecorded(customerId, visitedAt);
      showQuickMsg("訪問を記録しました");
    } finally {
      setRecordingCustomerId((current) => (current === customerId ? null : current));
    }
  }

  function markQuickRecorded(customerId: string, visitedAt: string) {
    setCustomers((prev) => prev.map((c) => (c.id === customerId ? { ...c, lastVisitedAt: visitedAt } : c)));
    setRecentlyRecordedCustomerId(customerId);
    if (recentRecordTimer.current) clearTimeout(recentRecordTimer.current);
    recentRecordTimer.current = setTimeout(() => {
      setRecentlyRecordedCustomerId((current) => (current === customerId ? null : current));
    }, 3500);
  }

  function showQuickMsg(msg: string) {
    setQuickMsg(msg);
    if (quickMsgTimer.current) clearTimeout(quickMsgTimer.current);
    quickMsgTimer.current = setTimeout(() => setQuickMsg(null), 2500);
  }

  return (
    <DesktopAppShell sidebarActive="map" fullViewportHeight>
      {relocateTarget && (
        <div className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-2 py-2 text-xs text-blue-900">
          <span className="min-w-0">「{relocateTarget.name}」の位置を修正：地図をタップして新しい地点を指定してください。</span>
          <button type="button" className="shrink-0 underline" onClick={clearRelocateParam}>キャンセル</button>
        </div>
      )}

      <AppHeader
        variant="main"
        title="まちマップ"
        search={{
          value: search,
          onChange: setSearch,
          onSubmit: submitSearch,
          listId: "customer-search-list",
          datalist: (
            <datalist id="customer-search-list">
              {searchSuggestions.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          ),
        }}
      />

      {syncMsg && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <span>{syncMsg}</span>
          <button type="button" className="underline" onClick={() => setSyncMsg(null)}>閉じる</button>
        </div>
      )}

      {quickMsg && (
        <div className="flex items-center gap-2 border-b border-green-200 bg-green-50 px-3 py-1.5 text-xs text-green-900">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span>{quickMsg}</span>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-gray-500">地図を読み込み中…</div>}>

          {/* 訪問日凡例（折りたたみ式）: Leaflet ズーム(topleft)との間隔を確保 */}
          <div className="pointer-events-auto absolute left-3 top-[8.5rem] z-[900]">
            <button
              type="button"
              onClick={() => setLegendOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-md ring-1 ring-black/10 backdrop-blur-sm"
            >
              <span className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#d97706]" />
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
              </span>
              {legendOpen ? "閉じる" : "凡例"}
            </button>
            {legendOpen && (
              <div className="mt-1 rounded-lg bg-white/95 px-3 py-2 shadow-md ring-1 ring-black/10 backdrop-blur-sm">
                <ul className="space-y-1.5 text-[11px] text-gray-700">
                  <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[#16a34a]" />7日以内</li>
                  <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[#d97706]" />〜30日</li>
                  <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[#dc2626]" />30日超</li>
                  <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full bg-[#9ca3af]" />未訪問</li>
                </ul>
              </div>
            )}
          </div>

          {/* ベースレイヤー切替 */}
          <div className="pointer-events-none absolute right-3 top-3 z-[900]">
            <div className="pointer-events-auto inline-flex rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-black/10 backdrop-blur-sm">
              {MAP_BASE_LAYER_OPTIONS.map((option) => {
                const active = baseLayer === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      active ? "bg-gray-900 text-white shadow-sm" : "text-gray-700 hover:bg-gray-100"
                    }`}
                    onClick={() => setBaseLayer(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 現在地ボタン（浮動） */}
          <button
            type="button"
            onClick={() => mapRef.current?.goToCurrentLocation()}
            className="pointer-events-auto absolute bottom-[calc(55%+16px)] right-3 z-[900] flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10 active:bg-gray-50 lg:bottom-8 lg:left-8 lg:right-auto lg:h-11 lg:w-11"
            title="現在地へ"
          >
            <svg className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
            </svg>
          </button>

          <MapViewLeaflet
            ref={mapRef}
            baseLayer={baseLayer}
            customers={mapPins}
            onMapClick={onMapClick}
            onMarkerClick={onMarkerClick}
            skipInitialGpsFocus={Boolean(highlightFromSearch || relocateTarget)}
            onBoundsChange={onBoundsChange}
            onLocationChange={onLocationChange}
          />
        </Suspense>
        <p className="pointer-events-none absolute bottom-1 left-1 right-1 text-center text-[10px] text-gray-500">
          {getMapAttributionText(baseLayer)}
        </p>

        {/* 顧客ミニカード（マーカータップ時） */}
        {selectedCustomer && (
          <div className="absolute bottom-0 left-0 right-0 z-[1050] rounded-t-2xl bg-white shadow-2xl lg:bottom-6 lg:left-auto lg:right-6 lg:max-w-md lg:rounded-2xl lg:border lg:border-gray-200 lg:shadow-2xl">
            <div className="px-4 pb-4 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-gray-900">{selectedCustomer.name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{relativeDate(selectedCustomer.lastVisitedAt)}</p>
                  {selectedCustomer.labels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {selectedCustomer.labels.map((lb) => (
                        <span
                          key={lb.id}
                          className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                          style={{ backgroundColor: lb.color, color: labelChipTextColor(lb.color) }}
                        >
                          {lb.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 active:bg-gray-100"
                  onClick={dismissMiniCard}
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-100 py-2.5 text-sm font-semibold text-green-800 active:bg-green-200"
                  onClick={() => void quickRecord(selectedCustomer.id)}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  訪問記録
                </button>
                <button
                  type="button"
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent py-2.5 text-sm font-semibold text-white active:opacity-90"
                  onClick={() => nav(`/customer/${selectedCustomer.id}`)}
                >
                  詳細を見る
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ボトムシート */}
        {!selectedCustomer && (
          <div
            className={`absolute bottom-0 left-0 right-0 z-[2200] flex min-h-0 flex-col rounded-t-3xl bg-white shadow-[0_-6px_24px_rgba(0,0,0,0.18)] transition-[max-height] duration-300 ease-in-out lg:bottom-6 lg:left-auto lg:right-6 lg:w-[min(400px,calc(100vw-3rem))] lg:rounded-2xl lg:border lg:border-gray-200 lg:shadow-xl ${
              sheetOpen ? "max-h-[55dvh] lg:max-h-[min(520px,calc(100vh-8rem))]" : "max-h-[5.75rem] overflow-hidden"
            }`}
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="relative flex w-full shrink-0 touch-manipulation select-none items-center justify-between rounded-t-3xl bg-white px-5 py-3.5 text-left [touch-action:manipulation] active:bg-gray-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSheetOpen();
              }}
            >
              <div className="pointer-events-none absolute left-1/2 top-2.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-gray-300" />
              <span className="mt-1.5 text-[15px] font-semibold text-gray-800">この地図にある顧客</span>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">{visibleCustomers.length}件</span>
                <svg
                  className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-300 ${sheetOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
              </div>
            </button>
            <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain border-t border-gray-100 [-webkit-overflow-scrolling:touch]">
              {visibleCustomers.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-gray-400">この範囲に顧客はいません</p>
              ) : (
                <ul>
                  {visibleCustomers.map((c) => {
                    const dist = userLat != null && userLng != null
                      ? haversineMeters(userLat, userLng, c.lat, c.lng) : null;
                    const visitLabel = relativeDate(c.lastVisitedAt);
                    const isRecording = recordingCustomerId === c.id;
                    const isJustRecorded = recentlyRecordedCustomerId === c.id;
                    return (
                      <li
                        key={c.id}
                        className={`flex items-center border-b border-gray-100 transition-colors duration-300 last:border-0 ${
                          isRecording || isJustRecorded ? "bg-green-50" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="flex min-h-[48px] min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left [touch-action:manipulation] active:bg-blue-50"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSheetOpen(false);
                            nav(`/customer/${c.id}`);
                          }}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-gray-800">{c.name}</span>
                            <span
                              className={`mt-0.5 block truncate text-xs font-medium ${
                                isRecording || isJustRecorded
                                  ? "text-green-700"
                                  : c.lastVisitedAt
                                    ? "text-gray-500"
                                    : "text-gray-400"
                              }`}
                            >
                              {isRecording ? "記録中..." : isJustRecorded ? "訪問済み・今日" : visitLabel}
                            </span>
                          </span>
                          {dist != null && (
                            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">{formatDistance(dist)}</span>
                          )}
                          <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className={`mr-3 flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-xs font-bold transition-all duration-200 [touch-action:manipulation] ${
                            isRecording
                              ? "bg-green-600 text-white shadow-sm ring-2 ring-green-200"
                              : isJustRecorded
                              ? "bg-green-600 text-white shadow-sm ring-2 ring-green-200"
                              : "bg-green-100 text-green-700 active:bg-green-200"
                          } ${isRecording ? "cursor-wait" : ""}`}
                          title={isRecording ? "記録中" : isJustRecorded ? "訪問済み" : "訪問を記録"}
                          aria-label={`${c.name}の訪問を記録`}
                          disabled={isRecording}
                          onClick={(e) => {
                            e.stopPropagation();
                            void quickRecord(c.id);
                          }}
                        >
                          {isRecording ? (
                            <>
                              <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={3} />
                                <path className="opacity-90" fill="currentColor" d="M21 12a9 9 0 0 0-9-9v3a6 6 0 0 1 6 6h3z" />
                              </svg>
                              <span className="ml-1">中</span>
                            </>
                          ) : (
                            <>
                              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              {isJustRecorded && <span className="ml-1">済</span>}
                            </>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {!configured && (
        <div className="shrink-0 border-t border-gray-200 p-2 text-center text-xs text-gray-600">
          <Link to="/login" className="text-accent underline">ログインして顧客を登録</Link>
        </div>
      )}

      {configured && user && !isOnline() && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-2 py-2 text-xs">
          <span>オフラインです。入力はキューに保存されます。</span>
          <button type="button" className="text-accent underline" onClick={() => void onSyncOffline()}>同期を試す</button>
        </div>
      )}

      {/* BottomNav のスペーサー（モバイルのみ） */}
      <div
        className="h-14 shrink-0 lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      />

      {registerOpen && (
        <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}>
            <h2 className="text-lg font-semibold text-gray-800">顧客を登録</h2>
            {dupWarning && <p className="mt-2 text-sm text-amber-700">{dupWarning}</p>}
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <label className="text-gray-700">
                お客様名 *
                <input className="mt-1 w-full rounded border border-gray-300 px-2 py-2" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="必須" />
              </label>
              <label className="text-gray-700">
                メモ（任意）
                <textarea className="mt-1 w-full rounded border border-gray-300 px-2 py-2" rows={2} value={memoDraft} onChange={(e) => setMemoDraft(e.target.value)} />
              </label>
              {labelMaster.length > 0 && (
                <fieldset className="text-gray-700">
                  <legend className="text-sm">ラベル（任意）</legend>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {labelMaster.map((lb) => (
                      <li key={lb.id}>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedLabelIds.includes(lb.id)}
                            onChange={(e) => {
                              setSelectedLabelIds((prev) =>
                                e.target.checked ? [...prev, lb.id] : prev.filter((x) => x !== lb.id)
                              );
                            }}
                          />
                          <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300" style={{ backgroundColor: lb.color }} />
                          {lb.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={() => setRegisterOpen(false)}>キャンセル</button>
              <button type="button" className="rounded bg-accent px-4 py-2 text-sm text-white" onClick={() => void saveCustomer()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {relocateDraft && relocateTarget && (
        <div className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom, 0px))" }}>
            <h2 className="text-lg font-semibold text-gray-800">位置を更新</h2>
            <p className="mt-2 text-sm text-gray-600">「{relocateTarget.name}」のピンをこの座標に移しますか？</p>
            <p className="mt-1 font-mono text-xs text-gray-500">{relocateDraft.lat.toFixed(6)}, {relocateDraft.lng.toFixed(6)}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded border border-gray-300 px-4 py-2 text-sm" onClick={() => setRelocateDraft(null)}>戻る</button>
              <button type="button" className="rounded bg-accent px-4 py-2 text-sm text-white" onClick={() => void confirmRelocate()}>更新する</button>
            </div>
          </div>
        </div>
      )}

      <BottomNav active="map" />
    </DesktopAppShell>
  );
}
