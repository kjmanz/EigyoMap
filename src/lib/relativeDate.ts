export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return "未訪問";
  const days = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 1) return "今日";
  if (days < 2) return "昨日";
  if (days < 7) return `${Math.floor(days)}日前`;
  if (days < 30) return `${Math.floor(days / 7)}週間前`;
  if (days < 365) return `${Math.floor(days / 30)}ヶ月前`;
  return `${Math.floor(days / 365)}年以上前`;
}
