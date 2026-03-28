export type CustomerRow = {
  id: string;
  user_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  memo: string | null;
  lat: number;
  lng: number;
  created_at: string;
  updated_at: string;
};

export type LabelRow = {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
};

/** 地図・チップ表示用（マスタの一部フィールド） */
export type LabelSummary = Pick<LabelRow, "id" | "name" | "color">;

/** 顧客＋紐づくラベル（アプリ内で正規化した形） */
export type CustomerMapRow = CustomerRow & {
  labels: LabelSummary[];
};

export type ContactLogRow = {
  id: string;
  customer_id: string;
  user_id: string;
  memo: string;
  visited_at: string;
  /** ピン留めをタイムライン最上部に表示 */
  pinned?: boolean;
  created_at: string;
  lat: number | null;
  lng: number | null;
};

export type PhotoRow = {
  id: string;
  contact_log_id: string;
  storage_path: string;
  thumbnail_path: string | null;
  created_at: string;
};
