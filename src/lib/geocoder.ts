/** 国土地理院 逆ジオコーディング（LonLatToAddress） */
const GEOCODER =
  "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const ADDRESS_SEARCH =
  "https://msearch.gsi.go.jp/address-search/AddressSearch";

export type GeocodeResult = {
  address: string;
  raw: unknown;
};

export type ForwardGeocodeResult = {
  lat: number;
  lng: number;
  title: string;
  raw: unknown;
};

export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodeResult> {
  const u = new URL(GEOCODER);
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lng));
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`逆ジオコーディングに失敗しました (${res.status})`);
  const data = (await res.json()) as {
    results?: { lv01Nm?: string }[];
  };
  const name = data.results?.[0]?.lv01Nm?.trim();
  return {
    address: name ?? "",
    raw: data,
  };
}

/** 国土地理院 住所検索（AddressSearch） */
export async function geocodeAddress(address: string): Promise<ForwardGeocodeResult> {
  const q = address.trim();
  if (!q) throw new Error("住所が空です");

  const u = new URL(ADDRESS_SEARCH);
  u.searchParams.set("q", q);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`住所の座標変換に失敗しました (${res.status})`);

  const data = (await res.json()) as {
    geometry?: { coordinates?: [number, number] };
    properties?: { title?: string };
  }[];
  const first = data[0];
  const coordinates = first?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) {
    throw new Error("住所から座標を取得できませんでした");
  }

  const [lng, lat] = coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("座標が不正です");
  }

  return {
    lat,
    lng,
    title: first.properties?.title?.trim() || q,
    raw: data,
  };
}
