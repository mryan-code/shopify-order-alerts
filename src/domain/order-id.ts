export function normalizeOrderId(id: string | number): string {
  const value = String(id).trim();
  const match = /(\d+)$/.exec(value);
  return match?.[1] ?? value;
}
