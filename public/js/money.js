export function formatCents(cents) {
  return (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseToCents(input) {
  const n = Number(String(input).trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
