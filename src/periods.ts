export function monthToRange(month: string): { from: string; to: string } {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mo = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, mo, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${yearStr}-${monthStr}-01`, to: `${yearStr}-${monthStr}-${pad(lastDay)}` };
}

export function isValidRange(from: string, to: string): boolean {
  return from <= to;
}
