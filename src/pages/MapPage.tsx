import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { MapViewHandle } from "../components/MapViewLeaflet";
import {
  enqueueOffline,
  flushOfflineQueue,
  isOnline,
  type OfflineCustomerPayload,
} from "../lib/offline";
import { supabase } from "../lib/supabase";
import type { CustomerRow } from "../lib/types";
import { useAuth } from "../contexts/AuthContext";

const MapViewLeaflet = lazy(() =>
  import("../components/MapViewLeaflet").then((m) => ({ default: m.MapViewLeaflet }))
);

export function MapPage() {
  const { user, configured } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const highlightFromSearch = params.get("highlight");

  const mapRef = useRef<MapViewHandle>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [search, setSearch] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(highlightFromSearch);
  const [layer, setLayer] = useState<"std" | "photo">("std");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [tapLat, setTapLat] = useState<number | null>(null);
  const [tapLng, setTapLng] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, search]);

  const load = useCallback(async () => {
    if (!user) return;
    const { data: cus, error } = await supabase
      .from("customers")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (!error && cus) setCustomers(cus as CustomerRow[]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightFromSearch) return;
    setHighlightId(highlightFromSearch);
    const c = customers.find((x) => x.id === highlightFromSearch);
    if (c) mapRef.current?.setView(c.lat, c.lng, 17);
  }, [highlightFromSearch, customers]);

  const onMapClick = useCallback(
    (lat: number, lng: number) => {
      if (!configured || !user) return;
      setTapLat(lat);
      setTapLng(lng);
      setRegisterOpen(true);
      setDupWarning(null);
      setNameDraft("");
      setMemoDraft("");

      void supabase
        .rpc("find_nearby_customers", { p_lat: lat, p_lng: lng, p_meters: 30 })
        .then(({ data }) => {
          if (data && Array.isArray(data) && data.length > 0) {
            setDupWarning("近くに既存の顧客があります。重複登録に注意してください。");
          }
        });
    },
    [configured, user]
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
    const payload: OfflineCustomerPayload = {
      name: nameDraft.trim(),
      address: null,
      phone: null,
      memo: memoDraft.trim() || null,
      lat: tapLat,
      lng: tapLng,
      labelIds: [],
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
    const { error } = await supabase.from("customers").insert({
      user_id: user.id,
      name: payload.name,
      address: null,
      phone: null,
      memo: payload.memo,
      lat: payload.lat,
      lng: payload.lng,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setRegisterOpen(false);
    await load();
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
      <header className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-2">
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
        <select
          value={layer}
          onChange={(e) => setLayer(e.target.value as "std" | "photo")}
          className="rounded border border-gray-300 px-1 py-2 text-xs text-gray-700"
          aria-label="地図の種類"
        >
          <option value="std">標準</option>
          <option value="photo">写真</option>
        </select>
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
            customers={search.trim() ? filteredCustomers : customers}
            highlightId={highlightId}
            onMapClick={onMapClick}
            onMarkerClick={onMarkerClick}
            layer={layer}
            skipInitialGpsFocus={Boolean(highlightFromSearch)}
          />
        </Suspense>
        <p className="pointer-events-none absolute bottom-1 left-1 right-1 text-center text-[10px] text-gray-500">
          地図の表示には国土地理院のデータを使用しています。
        </p>
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
    </div>
  );
}
