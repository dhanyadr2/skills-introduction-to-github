// Import blood banks from a CSV file.
//   npm run import:banks -- --country IN path/to/blood-banks.csv [--source data.gov.in] [--replace]
//
// Column names are matched case-insensitively, so the India "Blood Bank Directory"
// CSV from data.gov.in works as-is. Recognised columns:
//   name:        name | blood bank name | blood_bank_name
//   address:     address
//   city:        city | district
//   state:       state
//   postal code: postal_code | pincode | pin code | zip | zip code
//   phone:       phone | contact no | contact | mobile
//   website:     website | web site | url
//   latitude:    latitude | lat
//   longitude:   longitude | lng | lon | long
//   stock:       one column per blood group, e.g. "A+", "O-" (units in stock; optional)
// Rows without coordinates are placed at their postal code's centre, if it is known
// (run import:postal first for full coverage). Rows that can't be located are skipped.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BLOOD_GROUPS, COUNTRIES, normalizePostalCode } from '../src/blood.js';
import { loadConfig } from '../src/config.js';
import { parseCsv } from '../src/csv.js';
import { nowIso, openDb, transaction } from '../src/db.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { country: { type: 'string' }, source: { type: 'string', default: 'csv' }, replace: { type: 'boolean' } },
});
const country = values.country?.toUpperCase();
if (!COUNTRIES[country] || positionals.length !== 1) {
  console.error('Usage: npm run import:banks -- --country IN|US file.csv [--source name] [--replace]');
  process.exit(1);
}

const ALIASES = {
  name: ['name', 'blood bank name', 'blood_bank_name'],
  address: ['address'],
  city: ['city', 'district'],
  state: ['state'],
  postal: ['postal_code', 'postal code', 'pincode', 'pin code', 'pin', 'zip', 'zip code', 'zipcode'],
  phone: ['phone', 'contact no', 'contact_no', 'contact', 'mobile'],
  website: ['website', 'web site', 'url'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'lon', 'long'],
};

const rows = parseCsv(readFileSync(positionals[0], 'utf8'));
const pick = (row, field) => {
  const key = Object.keys(row).find((k) => ALIASES[field].includes(k.toLowerCase()));
  return key ? row[key] || null : null;
};

const db = openDb(loadConfig().dbPath);
const centre = db.prepare('SELECT lat, lng FROM postal_codes WHERE country = ? AND postal_code = ?');
const insert = db.prepare(
  `INSERT INTO blood_banks (name, country, postal_code, address, city, state, phone, website, lat, lng,
     stock_json, stock_updated_at, source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

let imported = 0;
const skipped = [];
transaction(db, () => {
  if (values.replace) db.prepare('DELETE FROM blood_banks WHERE country = ? AND source = ?').run(country, values.source);
  rows.forEach((row, i) => {
    const name = pick(row, 'name');
    const postalCode = normalizePostalCode(country, pick(row, 'postal') ?? '');
    let lat = Number(pick(row, 'lat'));
    let lng = Number(pick(row, 'lng'));
    if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      const c = postalCode && centre.get(country, postalCode);
      if (c) ({ lat, lng } = c);
      else lat = lng = NaN;
    }
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped.push(i + 2); // +2: header row and 1-based line numbers
      return;
    }
    const stockEntries = BLOOD_GROUPS.filter((g) => row[g] !== undefined && row[g] !== '').map((g) => [g, Number(row[g]) || 0]);
    insert.run(
      name, country, postalCode, pick(row, 'address'), pick(row, 'city'), pick(row, 'state'), pick(row, 'phone'),
      pick(row, 'website'), lat, lng, stockEntries.length ? JSON.stringify(Object.fromEntries(stockEntries)) : null,
      stockEntries.length ? nowIso() : null, values.source,
    );
    imported++;
  });
});
console.log(`Imported ${imported} blood banks.`);
if (skipped.length) console.log(`Skipped ${skipped.length} rows without a name or location (lines ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ', …' : ''}).`);
