/** 国土地理院 逆ジオコーディング（LonLatToAddress） */
const GEOCODER =
  "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";

export type GeocodeResult = {
  address: string;
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
