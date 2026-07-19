export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function previousDays(days: number) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

export function nextIncrementalRange(lastSyncedAt?: string) {
  if (!lastSyncedAt) return previousDays(90);
  const start = new Date(lastSyncedAt);
  start.setUTCDate(start.getUTCDate() - 2);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}
