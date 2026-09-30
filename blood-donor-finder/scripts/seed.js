// Usage: npm run seed                  -> add sample postal codes (+ demo data if the database is empty)
//        npm run seed -- --reset       -> delete ALL banks, donors and requests, then load demo data
//        npm run seed -- --remove-demo -> delete only the demo banks and donors, keep real data
// Set SEED_DEMO=false (e.g. in .env) so the server doesn't reload demo data into an empty database.
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { seedDemoData, seedPostalCodes } from '../src/seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);

if (process.argv.includes('--remove-demo')) {
  const banks = db.prepare('DELETE FROM blood_banks WHERE is_sample = 1').run().changes;
  const donors = db.prepare('DELETE FROM donors WHERE is_sample = 1').run().changes;
  console.log(`Removed ${banks} demo blood banks and ${donors} demo donors.`);
  if (config.seedDemo) console.log('Tip: set SEED_DEMO=false in .env so demo data is not reloaded into an empty database.');
  process.exit(0);
}

if (process.argv.includes('--reset')) {
  db.exec('DELETE FROM requests; DELETE FROM donors; DELETE FROM blood_banks; DELETE FROM outbox;');
}
seedPostalCodes(db);
const { n } = db.prepare('SELECT (SELECT COUNT(*) FROM blood_banks) + (SELECT COUNT(*) FROM donors) AS n').get();
if (n === 0) {
  seedDemoData(db);
  console.log('Demo data loaded.');
} else {
  console.log('Database already has data; only sample postal codes were added. Use --reset to start over.');
}
