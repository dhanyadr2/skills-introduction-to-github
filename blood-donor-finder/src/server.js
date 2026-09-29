import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { seedIfEmpty } from './seed.js';

const config = loadConfig();
const db = openDb(config.dbPath);
if (seedIfEmpty(db, { demo: config.seedDemo })) console.log('Loaded demo blood banks and donors.');

const app = createApp({ db, mailer: createMailer(db, config), config });
app.listen(config.port, () => {
  console.log(`Blood Donor Finder running at ${config.baseUrl}`);
  if (!config.smtp && !config.production) console.log(`Emails are not sent; read them at ${config.baseUrl}/dev/outbox`);
});
