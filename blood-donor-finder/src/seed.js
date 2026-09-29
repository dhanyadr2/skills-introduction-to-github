import { BLOOD_GROUPS } from './blood.js';
import { nowIso, transaction } from './db.js';
import { newPublicId } from './tokens.js';

// Approximate centre points for a few postal codes so the demo works offline.
// Import the full GeoNames postal-code files for real coverage (see README).
export const SAMPLE_POSTAL_CODES = [
  // India (PIN codes)
  ['IN', '560001', 'Bengaluru GPO', 'Karnataka', 12.9767, 77.5993],
  ['IN', '560011', 'Jayanagar', 'Karnataka', 12.9299, 77.5826],
  ['IN', '560034', 'Koramangala', 'Karnataka', 12.9352, 77.6245],
  ['IN', '560066', 'Whitefield', 'Karnataka', 12.9698, 77.75],
  ['IN', '110001', 'Connaught Place', 'Delhi', 28.6315, 77.2167],
  ['IN', '110029', 'Safdarjung Enclave', 'Delhi', 28.5672, 77.21],
  ['IN', '122001', 'Gurugram', 'Haryana', 28.4595, 77.0266],
  ['IN', '400001', 'Fort, Mumbai', 'Maharashtra', 18.9388, 72.8354],
  ['IN', '400050', 'Bandra West', 'Maharashtra', 19.0596, 72.8295],
  ['IN', '600001', 'Chennai GPO', 'Tamil Nadu', 13.0878, 80.2785],
  ['IN', '600040', 'Anna Nagar', 'Tamil Nadu', 13.085, 80.2101],
  ['IN', '500001', 'Hyderabad GPO', 'Telangana', 17.385, 78.4867],
  ['IN', '411001', 'Pune', 'Maharashtra', 18.5204, 73.8567],
  ['IN', '700001', 'Kolkata GPO', 'West Bengal', 22.5726, 88.3639],
  ['IN', '682011', 'Ernakulam', 'Kerala', 9.9816, 76.2999],
  // United States (ZIP codes)
  ['US', '10001', 'New York', 'NY', 40.7506, -73.9972],
  ['US', '10016', 'New York', 'NY', 40.7459, -73.9781],
  ['US', '11201', 'Brooklyn', 'NY', 40.6937, -73.9897],
  ['US', '07030', 'Hoboken', 'NJ', 40.744, -74.0324],
  ['US', '94103', 'San Francisco', 'CA', 37.7725, -122.4147],
  ['US', '94110', 'San Francisco', 'CA', 37.7486, -122.4156],
  ['US', '94607', 'Oakland', 'CA', 37.8065, -122.2956],
  ['US', '94301', 'Palo Alto', 'CA', 37.4443, -122.1598],
  ['US', '60601', 'Chicago', 'IL', 41.8858, -87.6181],
  ['US', '60614', 'Chicago', 'IL', 41.9227, -87.6533],
  ['US', '77002', 'Houston', 'TX', 29.7564, -95.3657],
  ['US', '98101', 'Seattle', 'WA', 47.6114, -122.3305],
  ['US', '90012', 'Los Angeles', 'CA', 34.0614, -118.2386],
  ['US', '02115', 'Boston', 'MA', 42.3427, -71.0922],
  ['US', '30303', 'Atlanta', 'GA', 33.7525, -84.3915],
];

const FIRST_NAMES = {
  IN: ['Aarav', 'Priya', 'Rahul', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Rohan', 'Divya', 'Suresh', 'Lakshmi'],
  US: ['James', 'Maria', 'David', 'Emily', 'Michael', 'Sofia', 'Daniel', 'Olivia', 'Chris', 'Grace', 'Kevin', 'Aisha'],
};
const LAST_INITIALS = 'ABCDEFGHJKLMNPRSTVW';

// Deterministic pseudo-random numbers so every fresh demo database looks the same.
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

export function seedPostalCodes(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO postal_codes (country, postal_code, place, state, lat, lng) VALUES (?, ?, ?, ?, ?, ?)',
  );
  transaction(db, () => SAMPLE_POSTAL_CODES.forEach((row) => insert.run(...row)));
}

/** Adds clearly-labelled demo blood banks and donors around each sample postal code. */
export function seedDemoData(db) {
  const rand = rng(42);
  const jitter = () => (rand() - 0.5) * 0.02; // roughly ±1 km
  const now = nowIso();
  const insertBank = db.prepare(
    `INSERT INTO blood_banks (name, country, postal_code, address, city, state, phone, lat, lng, stock_json,
       stock_updated_at, source, is_sample)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo', 1)`,
  );
  const insertDonor = db.prepare(
    `INSERT INTO donors (public_id, name, email, phone, blood_group, country, postal_code, place, lat, lng,
       last_donation_date, available, verified, is_sample, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, ?, ?)`,
  );
  // Weighted roughly by how common each group is.
  const groupPool = ['O+', 'O+', 'O+', 'B+', 'B+', 'A+', 'A+', 'AB+', 'O-', 'A-', 'B-', 'AB-'];

  transaction(db, () => {
    let n = 0;
    for (const [country, code, place, state, lat, lng] of SAMPLE_POSTAL_CODES) {
      const stock = Object.fromEntries(BLOOD_GROUPS.map((g) => [g, Math.floor(rand() * (g.endsWith('-') ? 6 : 25))]));
      insertBank.run(
        `Demo Blood Bank — ${place} (${code})`, country, code, 'Demo address (sample data)', place, state,
        country === 'IN' ? '+91 00000 00000' : '+1 000-000-0000',
        lat + jitter(), lng + jitter(), JSON.stringify(stock), now,
      );
      for (let i = 0; i < 4; i++) {
        n++;
        const names = FIRST_NAMES[country];
        const name = `${names[Math.floor(rand() * names.length)]} ${LAST_INITIALS[Math.floor(rand() * LAST_INITIALS.length)]}`;
        const daysAgo = Math.floor(rand() * 200);
        const last = rand() < 0.3 ? null : new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
        insertDonor.run(
          newPublicId(), name, `demo.donor${n}@example.com`, null,
          groupPool[Math.floor(rand() * groupPool.length)], country, code, place,
          lat, lng, last, now, now,
        );
      }
    }
  });
}

export function seedIfEmpty(db, { demo }) {
  seedPostalCodes(db);
  const empty = db.prepare('SELECT (SELECT COUNT(*) FROM blood_banks) + (SELECT COUNT(*) FROM donors) AS n').get().n === 0;
  if (demo && empty) {
    seedDemoData(db);
    return true;
  }
  return false;
}
