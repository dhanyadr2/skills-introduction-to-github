import { BLOOD_GROUPS, normalizePostalCode } from './blood.js';
import { nowIso, transaction } from './db.js';

// Accepted column names (compared after lower-casing and turning "_", "." etc. into spaces),
// so "Blood Bank Name", "blood_bank_name" and "_blood_bank_name" all match `name`.
const ALIASES = {
  name: ['name', 'blood bank name', 'bloodbank name', 'blood bank'],
  address: ['address'],
  city: ['city', 'district'],
  state: ['state'],
  postal: ['postal code', 'pincode', 'pin code', 'pin', 'zip', 'zip code', 'zipcode'],
  phone: ['phone', 'contact no', 'contact number', 'contact', 'mobile', 'helpline'],
  website: ['website', 'web site', 'url'],
  lat: ['latitude', 'lat'],
  lng: ['longitude', 'lng', 'lon', 'long'],
};

const normalizeKey = (key) => key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function picker(row) {
  const keys = Object.keys(row).map((k) => [normalizeKey(k), k]);
  return (field) => {
    const match = keys.find(([norm]) => ALIASES[field].includes(norm));
    const value = match ? row[match[1]] : null;
    return value == null || String(value).trim() === '' ? null : String(value).trim();
  };
}

/**
 * Inserts blood bank rows (objects keyed by column name) for one country and source.
 * Rows without coordinates are placed at their postal code's centre when it is known.
 * With `replace`, existing banks from the same country + source are removed first.
 * Returns { imported, skipped } where skipped holds the indexes of rows that were left out.
 */
export function importBankRows(db, rows, { country, source, replace = false }) {
  const centre = db.prepare('SELECT lat, lng FROM postal_codes WHERE country = ? AND postal_code = ?');
  const insert = db.prepare(
    `INSERT INTO blood_banks (name, country, postal_code, address, city, state, phone, website, lat, lng,
       stock_json, stock_updated_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let imported = 0;
  const skipped = [];
  transaction(db, () => {
    if (replace) db.prepare('DELETE FROM blood_banks WHERE country = ? AND source = ?').run(country, source);
    rows.forEach((row, i) => {
      const pick = picker(row);
      const name = pick('name');
      const postalCode = normalizePostalCode(country, pick('postal') ?? '');
      let lat = Number(pick('lat'));
      let lng = Number(pick('lng'));
      if (!lat || !lng || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        const c = postalCode && centre.get(country, postalCode);
        if (c) ({ lat, lng } = c);
        else lat = lng = NaN;
      }
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        skipped.push(i);
        return;
      }
      const stock = BLOOD_GROUPS.filter((g) => row[g] != null && row[g] !== '').map((g) => [g, Number(row[g]) || 0]);
      insert.run(
        name, country, postalCode, pick('address'), pick('city'), pick('state'), pick('phone'), pick('website'),
        lat, lng, stock.length ? JSON.stringify(Object.fromEntries(stock)) : null, stock.length ? nowIso() : null, source,
      );
      imported++;
    });
    if (replace && rows.length && !imported) {
      // Rolls back the delete above, so a bad file or API change never wipes existing banks.
      throw new Error(`None of the ${rows.length} rows had a usable name and location; existing data kept.`);
    }
  });
  return { imported, skipped };
}
