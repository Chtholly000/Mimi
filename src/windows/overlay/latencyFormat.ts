export function formatLatency(milliseconds: number | null | undefined): string {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  return milliseconds >= 1_000
    ? `${(milliseconds / 1_000).toFixed(1)} s`
    : `${Math.round(milliseconds)} ms`;
}
