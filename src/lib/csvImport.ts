export type CustomerImportDraft = {
  rowNumber: number;
  name: string;
  address: string;
  phone: string | null;
  memo: string | null;
  lat: number | null;
  lng: number | null;
  labels: string[];
  source: "coordinates" | "address" | "none";
  errors: string[];
  warnings: string[];
};

const COLUMN_ALIASES = {
  name: [
    "customer_name",
    "customer",
    "client",
    "name",
    "お客様名",
    "顧客名",
    "顧客",
    "会社名",
    "氏名",
    "名前",
  ],
  address: ["address", "住所", "所在地"],
  phone: ["phone", "tel", "telephone", "電話", "電話番号", "携帯", "携帯番号"],
  memo: ["customer_memo", "memo", "note", "notes", "メモ", "備考"],
  lat: ["lat", "latitude", "緯度"],
  lng: ["lng", "lon", "long", "longitude", "経度"],
  labels: ["labels", "label", "tags", "tag", "ラベル", "タグ"],
} as const;

export function parseCustomerImportCsv(text: string): CustomerImportDraft[] {
  const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeHeader);
  const indexByField = {
    name: findColumn(headers, COLUMN_ALIASES.name),
    address: findColumn(headers, COLUMN_ALIASES.address),
    phone: findColumn(headers, COLUMN_ALIASES.phone),
    memo: findColumn(headers, COLUMN_ALIASES.memo),
    lat: findColumn(headers, COLUMN_ALIASES.lat),
    lng: findColumn(headers, COLUMN_ALIASES.lng),
    labels: findColumn(headers, COLUMN_ALIASES.labels),
  };

  return rows.slice(1).flatMap((cells, i) => {
    const rowNumber = i + 2;
    if (cells.every((cell) => !cell.trim())) return [];

    const address = cell(cells, indexByField.address);
    const explicitName = cell(cells, indexByField.name);
    const name = explicitName || address || `顧客 ${rowNumber}`;
    const lat = parseCoordinate(cell(cells, indexByField.lat));
    const lng = parseCoordinate(cell(cells, indexByField.lng));
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!explicitName) {
      warnings.push(address ? "お客様名が空のため住所を名前に使います" : "お客様名が空です");
    }
    if (!address && (lat == null || lng == null)) {
      errors.push("住所または緯度・経度が必要です");
    }
    if ((lat == null) !== (lng == null)) {
      errors.push("緯度・経度は両方入力してください");
    }
    if (lat != null && (lat < -90 || lat > 90)) errors.push("緯度が範囲外です");
    if (lng != null && (lng < -180 || lng > 180)) errors.push("経度が範囲外です");

    return [{
      rowNumber,
      name,
      address,
      phone: cell(cells, indexByField.phone) || null,
      memo: cell(cells, indexByField.memo) || null,
      lat,
      lng,
      labels: splitLabels(cell(cells, indexByField.labels)),
      source: lat != null && lng != null ? "coordinates" : address ? "address" : "none",
      errors,
      warnings,
    }];
  });
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === "\t") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  row.push(field.trim());
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-()（）]/g, "");
}

function findColumn(headers: string[], aliases: readonly string[]): number {
  const normalized = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalized.includes(header));
}

function cell(cells: string[], index: number): string {
  return index >= 0 ? (cells[index] ?? "").trim() : "";
}

function parseCoordinate(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value.trim().normalize("NFKC"));
  return Number.isFinite(n) ? n : null;
}

function splitLabels(value: string): string[] {
  if (!value.trim()) return [];
  return [...new Set(
    value
      .split(/[;|,、，]/)
      .map((label) => label.trim())
      .filter(Boolean)
  )];
}
