import type { CustomerMapRow, CustomerRow, LabelSummary } from "./types";

export const DEFAULT_MARKER_COLOR = "#2563eb";

/** Supabase の customer_labels(labels(...)) ネストを LabelSummary[] にする */
export function labelsFromCustomerJoin(
  customer_labels:
    | { label_id?: string; labels?: LabelSummary | null }[]
    | null
    | undefined
): LabelSummary[] {
  const out: LabelSummary[] = [];
  for (const row of customer_labels ?? []) {
    const l = row.labels;
    if (l?.id && l.name != null && l.color != null) {
      out.push({ id: l.id, name: l.name, color: l.color });
    }
  }
  return out;
}

export function toCustomerMapRow(
  row: CustomerRow & {
    customer_labels?: { label_id?: string; labels?: LabelSummary | null }[];
  }
): CustomerMapRow {
  const { customer_labels, ...rest } = row;
  return {
    ...(rest as CustomerRow),
    labels: labelsFromCustomerJoin(customer_labels),
  };
}

/** ピン色: 名前昇順で最初のラベルの色、なければデフォルト */
export function pinColorFromLabels(labels: LabelSummary[]): string {
  if (labels.length === 0) return DEFAULT_MARKER_COLOR;
  const sorted = [...labels].sort((a, b) =>
    a.name.localeCompare(b.name, "ja")
  );
  return sorted[0].color || DEFAULT_MARKER_COLOR;
}

/** #rrggbb から相対輝度でテキスト色（黒 or 白） */
export function labelChipTextColor(hex: string): "#111827" | "#ffffff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.55 ? "#111827" : "#ffffff";
}
