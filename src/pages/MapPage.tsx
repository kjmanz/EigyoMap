import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type L from "leaflet";
import type { MapViewHandle } from "../components/MapViewLeaflet";
import { pinColorFromLabels, toCustomerMapRow } from "../lib/customerLabels";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOnline,
  type OfflineCustomerPayload,
} from "../lib/offline";
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
  const [highlightId, setHighlightId] = useState<string | null>(highlightFromSearch);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [tapLat, setTapLat] = useState<number | null>(null);
  const [tapLng, setTapLng] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<L.LatLngBounds | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [sheetOpen, setSheetOpen] = useState(true);
  const [relocateDraft, setRelocateDraft] = useState<{ lat: number; lng: number } | null>(null);

  const relocateTarget = useMemo(() => {
    if (!relocateId) return null;
    return customers.find((c) => c.id === relocateId) ?? null;
  }, [relocateId, customers]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, search]);

  const mapPins = useMemo(
    () =>
      filteredCustomers.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        markerColor: pinColorFromLabels(c.labels),
      })),
    [filteredCustomers]
  );

  const visibleCustomers = useMemo(() => {
    if (!mapBounds) return [];
    const inBounds = filteredCustomers.filter((c) =>
      mapBounds.contains([c.lat, c.lng])
    );
    if (userLat == null || userLng == null) return inBounds;
    return [...inBounds].sort(
      (a, b) =>
        haversineMeters(userLat, userLng, a.lat, a.lng) -
        haversineMeters(userLat, userLng, b.lat, b.lng)
    );
  }, [filteredCustomers, mapBounds, userLat, userLng]);

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
    const { data: cus, error } = await supabase
      .from("customers")
      .select("*, customer_labels(label_id, labels(id, name, color))")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (!error && cus) {
      setCustomers(
        (cus as Parameters<typeof toCustomerMapRow>[0][]).map((row) =>
          toCustomerMapRow(row)
        )
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadLabels();
  }, [loadLabels]);

  useEffect(() => {
    if (!highlightFromSearch) return;
    setHighlightId(highlightFromSearch);
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
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("relocate");
          return next;
        },
        { replace: true }
      );
    }
  }, [relocateId, user, customersLoaded, customers, setSearchParams]);

  const clearRelocateParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("relocate");
        return next;
      },
      { replace: true }
    );
    setRelocateDraft(null);
  }, [setSearchParams]);

  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!configured || !user) return;
      if (relocateTarget) {
        if (!isOnline()) {
          setSyncMsg("位置の更新はオンラインで行ってください。");
          return;
        }
        setRelocateDraft({ lat, lng });
        return;
      }
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
      setHighlightId(id);
      nav(`/customer/${id}`);
    },
    [nav]
  );

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
      await enqueueOffline({
        id: crypto.randomUUID(),
        kind: "customer",
        payload,
      });
      setRegisterOpen(false);
      setSyncMsg("オフラインのためキューに保存しました。オンラインで同期します。");
      return;
    }
    const { data: inserted, error } = await supabase
      .from("customers")
      .insert({
        user_id: user.id,
        name: payload.name,
        address: null,
        phone: null,
        memo: payload.memo,
        lat: payload.lat,
        lng: payload.lng,
      })
      .select("id")
      .single();
    if (error || !inserted?.id) {
      alert(error?.message ?? "登録に失敗しました");
      return;
    }
    const customerId = inserted.id as string;
    for (const lid of labelIds) {
      const { error: e2 } = await supabase.from("customer_labels").insert({
        customer_id: customerId,
        label_id: lid,
      });
      if (e2) {
        alert(e2.message);
        await load();
        return;
      }
    }
    setRegisterOpen(false);
    await load();
  }

  async function confirmRelocate() {
    if (!relocateDraft || !relocateTarget || !user) return;
    const { error } = await supabase
      .from("customers")
      .update({
        lat: relocateDraft.lat,
        lng: relocateDraft.lng,
      })
      .eq("id", relocateTarget.id)
      .eq("user_id", user.id);
    if (error) {
      alert(error.message);
      return;
    }
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

  return (
    <div className="flex h-[100dvh] flex-col bg-white">
      {relocateTarget && (
        <div className="relative z-20 flex shrink-0 items-center justify-between gap-2 border-b border-blue-200 bg-blue-50 px-2 py-2 text-xs text-blue-900">
          <span className="min-w-0">
            「{relocateTarget.name}」の位置を修正：地図をタップして新しい地点を指定してください。
          </span>
          <button type="button" className="shrink-0 underline" onClick={clearRelocateParam}>
            キャンセル
          </button>
        </div>
      )}

      <header className="relative z-10 flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-2 py-2">
        <input
          type="search"
          placeholder="名前で検索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-2 text-sm"
          list="customer-search-list"
        />
        <datalist id="customer-search-list">
          {filteredCustomers.slice(0, 20).map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
<button
          type="button"
          className="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs text-gray-800"
          onClick={() => mapRef.current?.goToCurrentLocation()}
        >
          現在地
        </button>
        <Link
          to="/list"
          className="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs text-gray-800"
        >
          一覧
        </Link>
        <Link
          to="/settings"
          className="shrink-0 rounded border border-gray-300 px-2 py-2 text-xs text-gray-800"
        >
          設定
        </Link>
      </header>

      {syncMsg && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
          <span>{syncMsg}</span>
          <button type="button" className="underline" onClick={() => setSyncMsg(null)}>
            閉じる
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-gray-500">地図を読み込み中…</div>
          }
        >
          <MapViewLeaflet
            ref={mapRef}
            customers={mapPins}
            highlightId={highlightId}
            onMapClick={onMapClick}
            onMarkerClick={onMarkerClick}
            skipInitialGpsFocus={Boolean(highlightFromSearch || relocateTarget)}
            onBoundsChange={onBoundsChange}
            onLocationChange={onLocationChange}
          />
        </Suspense>
        <p className="pointer-events-none absolute bottom-1 left-1 right-1 text-center text-[10px] text-gray-500">
          &copy; OpenStreetMap contributors
        </p>

        {/* ボトムシート */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-[1000] flex flex-col rounded-t-3xl bg-white transition-transform duration-300 ease-in-out`}
          style={{
            maxHeight: "55%",
            boxShadow: "0 -6px 24px rgba(0,0,0,0.18)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            transform: sheetOpen
              ? "translateY(0)"
              : "translateY(calc(100% - 68px - env(safe-area-inset-bottom, 0px)))",
          }}
        >
          {/* ハンドル＋ヘッダー（常に表示、タップで開閉） */}
          <button
            type="button"
            className="relative flex shrink-0 items-center justify-between rounded-t-3xl bg-white px-5 py-4 active:bg-gray-50"
            onClick={() => setSheetOpen((v) => !v)}
          >
            {/* ドラッグハンドル */}
            <div className="absolute left-1/2 top-[10px] h-[5px] w-12 -translate-x-1/2 rounded-full bg-gray-300" />
            {/* ラベル */}
            <span className="mt-1 text-[15px] font-semibold text-gray-800">
              この地図にある顧客
            </span>
            {/* 右側：件数バッジ＋矢印 */}
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-bold text-white">
                {visibleCustomers.length}件
              </span>
              <svg
                className={`h-5 w-5 text-gray-400 transition-transform duration-300 ${sheetOpen ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </div>
          </button>

          {/* 顧客リスト */}
          <div className="flex-1 overflow-y-auto border-t border-gray-100">
            {visibleCustomers.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">この範囲に顧客はいません</p>
            ) : (
              <ul>
                {visibleCustomers.map((c) => {
                  const dist =
                    userLat != null && userLng != null
                      ? haversineMeters(userLat, userLng, c.lat, c.lng)
                      : null;
                  return (
                    <li key={c.id} className="border-b border-gray-100 last:border-0">
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-5 py-3.5 text-left active:bg-blue-50"
                        onClick={() => nav(`/customer/${c.id}`)}
                      >
                        {/* 顧客名 */}
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-gray-800">
                          {c.name}
                        </span>
                        {/* 距離バッジ */}
                        {dist != null && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                            {formatDistance(dist)}
                          </span>
                        )}
                        {/* 矢印 */}
                        <svg className="h-4 w-4 shrink-0 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {!configured && (
        <div className="border-t border-gray-200 p-2 text-center text-xs text-gray-600">
          <Link to="/login" className="text-accent underline">
            ログインして顧客を登録
          </Link>
        </div>
      )}

      {configured && user && !isOnline() && (
        <div className="flex items-center justify-between gap-2 border-t border-gray-200 bg-gray-50 px-2 py-2 text-xs">
          <span>オフラインです。入力はキューに保存されます。</span>
          <button type="button" className="text-accent underline" onClick={() => void onSyncOffline()}>
            同期を試す
          </button>
        </div>
      )}

      {registerOpen && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg">
            <h2 className="text-lg font-semibold text-gray-800">顧客を登録</h2>
            {dupWarning && <p className="mt-2 text-sm text-amber-700">{dupWarning}</p>}
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <label className="text-gray-700">
                お客様名 *
                <input
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  placeholder="必須"
                />
              </label>
              <label className="text-gray-700">
                メモ（任意）
                <textarea
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-2"
                  rows={2}
                  value={memoDraft}
                  onChange={(e) => setMemoDraft(e.target.value)}
                />
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
                                e.target.checked
                                  ? [...prev, lb.id]
                                  : prev.filter((x) => x !== lb.id)
                              );
                            }}
                          />
                          <span
                            className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                            style={{ backgroundColor: lb.color }}
                          />
                          {lb.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-4 py-2 text-sm"
                onClick={() => setRegisterOpen(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="rounded bg-accent px-4 py-2 text-sm text-white"
                onClick={() => void saveCustomer()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {relocateDraft && relocateTarget && (
        <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-lg bg-white p-4 shadow-lg sm:rounded-lg">
            <h2 className="text-lg font-semibold text-gray-800">位置を更新</h2>
            <p className="mt-2 text-sm text-gray-600">
              「{relocateTarget.name}」のピンをこの座標に移しますか？
            </p>
            <p className="mt-1 font-mono text-xs text-gray-500">
              {relocateDraft.lat.toFixed(6)}, {relocateDraft.lng.toFixed(6)}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-gray-300 px-4 py-2 text-sm"
                onClick={() => setRelocateDraft(null)}
              >
                戻る
              </button>
              <button
                type="button"
                className="rounded bg-accent px-4 py-2 text-sm text-white"
                onClick={() => void confirmRelocate()}
              >
                更新する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
