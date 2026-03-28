/** ローカル日付の 0:00〜23:59:59.999 を ISO 文字列で返す（visited_at の範囲検索用） */
export function getLocalDayRangeISO(d: Date = new Date()): { start: string; end: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}
