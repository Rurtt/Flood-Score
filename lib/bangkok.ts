// Keep in sync with public.in_bangkok() in supabase/migrations/20261003000002_score.sql
export const BANGKOK_BOUNDS = { minLat: 13.49, maxLat: 13.96, minLng: 100.32, maxLng: 100.94 } as const;

export function inBangkok(lat: number, lng: number): boolean {
  const b = BANGKOK_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

const STEP = 0.0005; // ~50 m; nearby searches share one cache entry

export function roundToGrid(lat: number, lng: number): { lat: number; lng: number } {
  const r = (v: number) => Number((Math.round(v / STEP) * STEP).toFixed(4));
  return { lat: r(lat), lng: r(lng) };
}
