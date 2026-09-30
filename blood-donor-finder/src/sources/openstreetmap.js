import { nowIso } from '../db.js';

// Live blood bank / donation centre lookup from OpenStreetMap via the public Overpass API.
// No API key needed. Data © OpenStreetMap contributors (ODbL) — the UI shows this attribution.
// Results are cached per postal code + radius to respect Overpass fair-use limits.
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const CACHE_HOURS = 24;
const USER_AGENT = 'BloodDonorFinder/0.1 (+https://github.com/dhanyadr2/skills-introduction-to-github)';

function toBank(el) {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    id: `osm:${el.type}/${el.id}`,
    name: t.name || t['name:en'] || t.operator || 'Blood donation centre',
    address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null,
    city: t['addr:city'] || null,
    state: t['addr:state'] || null,
    postal_code: t['addr:postcode'] || null,
    phone: t.phone || t['contact:phone'] || null,
    website: t.website || t['contact:website'] || null,
    opening_hours: t.opening_hours || null,
    lat,
    lng,
  };
}

async function fetchFromOverpass({ lat, lng, radiusKm, fetchImpl }) {
  const meters = Math.min(Math.round(radiusKm * 1000), 100_000);
  const query =
    `[out:json][timeout:20];` +
    `nwr["healthcare"~"^(blood_donation|blood_bank)$"](around:${meters},${lat},${lng});` +
    `out center tags 200;`;
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT, accept: 'application/json' },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  const body = await res.json();
  return (body.elements ?? []).map(toBank).filter(Boolean);
}

/**
 * Blood banks near a point from OpenStreetMap. Uses a 24h cache; on failure falls back to a
 * stale cache entry if there is one. Returns { banks, ok }.
 */
export async function openStreetMapBanks(db, { cacheKey, lat, lng, radiusKm, fetchImpl = fetch }) {
  const cached = db.prepare('SELECT fetched_at, data FROM source_cache WHERE key = ?').get(`osm:${cacheKey}`);
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_HOURS * 3_600_000) {
    return { banks: JSON.parse(cached.data), ok: true };
  }
  try {
    const banks = await fetchFromOverpass({ lat, lng, radiusKm, fetchImpl });
    db.prepare('INSERT OR REPLACE INTO source_cache (key, fetched_at, data) VALUES (?, ?, ?)').run(
      `osm:${cacheKey}`, nowIso(), JSON.stringify(banks),
    );
    return { banks, ok: true };
  } catch (err) {
    console.warn(`[openstreetmap] live lookup failed: ${err.message}`);
    return { banks: cached ? JSON.parse(cached.data) : [], ok: Boolean(cached) };
  }
}
