const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_MILE = 1.609344;

export const toKm = (value, unit) => (unit === 'mi' ? value * KM_PER_MILE : value);
export const fromKm = (km, unit) => (unit === 'mi' ? km / KM_PER_MILE : km);

export function distanceKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** Lat/lng box that contains every point within `km` of the origin (used to pre-filter in SQL). */
export function boundingBox(lat, lng, km) {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

/**
 * Resolve a postal code to an approximate centre point. Looks in the local
 * postal_codes table first, then (optionally) api.zippopotam.us, caching hits.
 */
export async function geocodePostal(db, country, postalCode, { remote = true, fetchImpl = fetch } = {}) {
  const local = db
    .prepare('SELECT place, state, lat, lng FROM postal_codes WHERE country = ? AND postal_code = ?')
    .get(country, postalCode);
  if (local) return { ...local };
  if (!remote) return null;

  let body;
  try {
    const res = await fetchImpl(`https://api.zippopotam.us/${country.toLowerCase()}/${postalCode}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    body = await res.json();
  } catch {
    return null;
  }
  const places = body?.places ?? [];
  if (!places.length) return null;
  // A PIN code can cover several post offices; use their average as the centre.
  const lat = places.reduce((sum, p) => sum + Number(p.latitude), 0) / places.length;
  const lng = places.reduce((sum, p) => sum + Number(p.longitude), 0) / places.length;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hit = { place: places[0]['place name'], state: places[0].state ?? null, lat, lng };
  db.prepare(
    'INSERT OR REPLACE INTO postal_codes (country, postal_code, place, state, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(country, postalCode, hit.place, hit.state, hit.lat, hit.lng);
  return hit;
}
