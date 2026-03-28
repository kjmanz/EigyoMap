export const SOFT_DELETE_RETENTION_DAYS = 30;

const MS_PER_DAY = 86400000;

export function canRestore(deletedAt: string | null | undefined): boolean {
  if (deletedAt == null) return false;
  const t = new Date(deletedAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t < SOFT_DELETE_RETENTION_DAYS * MS_PER_DAY;
}

/** 完全削除までの残り日数（切り上げ）。復元不可なら null */
export function daysUntilPermanentDeletion(deletedAt: string | null | undefined): number | null {
  if (deletedAt == null) return null;
  const t = new Date(deletedAt).getTime();
  if (Number.isNaN(t)) return null;
  const deadline = t + SOFT_DELETE_RETENTION_DAYS * MS_PER_DAY;
  const ms = deadline - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / MS_PER_DAY);
}
