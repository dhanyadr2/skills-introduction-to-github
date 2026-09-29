// Usage: npm run seed            -> add sample postal codes (+ demo data if the database is empty)
//        npm run seed -- --reset -> delete ALL banks, donors and requests, then load demo data
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { seedDemoData, seedPostalCodes } from '../src/seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);
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
