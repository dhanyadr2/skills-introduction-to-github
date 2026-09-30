// Download India's blood bank directory from the data.gov.in API right now.
// Needs DATA_GOV_IN_API_KEY and DATA_GOV_IN_RESOURCE_ID (in .env or the environment).
//   npm run sync:banks
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { syncDataGovIn } from '../src/sources/datagovin.js';

const config = loadConfig();
if (!config.dataGovIn) {
  console.error('Set DATA_GOV_IN_API_KEY and DATA_GOV_IN_RESOURCE_ID first (see .env.example).');
  process.exit(1);
}
try {
  const r = await syncDataGovIn(openDb(config.dbPath), config.dataGovIn);
  console.log(`Fetched ${r.fetched} records; loaded ${r.imported} blood banks, skipped ${r.skipped} without a name or location.`);
  if (r.skipped > r.imported) console.log(`Most rows were skipped. Fields in the data: ${r.sampleFields.join(', ')}`);
} catch (err) {
  console.error(`Sync failed: ${err.message}`);
  process.exit(1);
}
