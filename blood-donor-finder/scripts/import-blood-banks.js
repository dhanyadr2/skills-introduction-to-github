// Import blood banks from a CSV file.
//   npm run import:banks -- --country IN path/to/blood-banks.csv [--source data.gov.in] [--replace]
//
// Column names are matched loosely (case, spaces and underscores ignored). Recognised columns:
//   name:        name | blood bank name
//   address:     address
//   city:        city | district
//   state:       state
//   postal code: postal code | pincode | pin code | zip | zip code
//   phone:       phone | contact no | contact | mobile | helpline
//   website:     website | web site | url
//   latitude:    latitude | lat
//   longitude:   longitude | lng | lon | long
//   stock:       one column per blood group, e.g. "A+", "O-" (units in stock; optional)
// Rows without coordinates are placed at their postal code's centre, if it is known
// (run import:postal first for full coverage). Rows that can't be located are skipped.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { importBankRows } from '../src/bank-import.js';
import { COUNTRIES } from '../src/blood.js';
import { loadConfig } from '../src/config.js';
import { parseCsv } from '../src/csv.js';
import { openDb } from '../src/db.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { country: { type: 'string' }, source: { type: 'string', default: 'csv' }, replace: { type: 'boolean' } },
});
const country = values.country?.toUpperCase();
if (!COUNTRIES[country] || positionals.length !== 1) {
  console.error('Usage: npm run import:banks -- --country IN|US file.csv [--source name] [--replace]');
  process.exit(1);
}

const db = openDb(loadConfig().dbPath);
const rows = parseCsv(readFileSync(positionals[0], 'utf8'));
const { imported, skipped } = importBankRows(db, rows, { country, source: values.source, replace: values.replace });
console.log(`Imported ${imported} blood banks.`);
if (skipped.length) {
  const lines = skipped.map((i) => i + 2); // +2: header row and 1-based line numbers
  console.log(`Skipped ${skipped.length} rows without a name or location (lines ${lines.slice(0, 20).join(', ')}${lines.length > 20 ? ', …' : ''}).`);
}
