// Import postal-code centre points from a GeoNames file so any ZIP / PIN code works offline.
//   1. Download https://download.geonames.org/export/zip/US.zip and/or IN.zip
//   2. Unzip, then: npm run import:postal -- path/to/US.txt [path/to/IN.txt ...]
// GeoNames data is licensed CC BY 4.0 (https://www.geonames.org/).
import { readFileSync } from 'node:fs';
import { COUNTRIES } from '../src/blood.js';
import { loadConfig } from '../src/config.js';
import { openDb, transaction } from '../src/db.js';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: npm run import:postal -- US.txt [IN.txt ...]');
  process.exit(1);
}

const db = openDb(loadConfig().dbPath);
const insert = db.prepare(
  'INSERT OR REPLACE INTO postal_codes (country, postal_code, place, state, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
);

for (const file of files) {
  // Several post offices can share one PIN code: average their coordinates.
  const groups = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [country, code, place, state, , , , , , lat, lng] = line.split('\t');
    if (!COUNTRIES[country] || !code || !lat || !lng) continue;
    const key = `${country}|${code}`;
    const g = groups.get(key) ?? { country, code, place, state, lat: 0, lng: 0, n: 0 };
    g.lat += Number(lat);
    g.lng += Number(lng);
    g.n++;
    groups.set(key, g);
  }
  transaction(db, () => {
    for (const g of groups.values()) insert.run(g.country, g.code, g.place, g.state || null, g.lat / g.n, g.lng / g.n);
  });
  console.log(`${file}: imported ${groups.size} postal codes.`);
}
