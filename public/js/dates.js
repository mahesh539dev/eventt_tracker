export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthStr() {
  return todayStr().slice(0, 7);
}
