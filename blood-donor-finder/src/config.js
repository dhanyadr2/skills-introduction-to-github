import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;
const bool = (value, fallback) => (value === undefined || value === '' ? fallback : /^(1|true|yes)$/i.test(value));

export function loadConfig(overrides = {}) {
  const port = Number(env.PORT || 3000);
  return {
    port,
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    dbPath: env.DB_PATH || './data/app.db',
    production: env.NODE_ENV === 'production',
    seedDemo: bool(env.SEED_DEMO, true),
    geocoderRemote: bool(env.GEOCODER_REMOTE, true),
    smtp: env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: Number(env.SMTP_PORT) === 465,
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        }
      : null,
    mailFrom: env.MAIL_FROM || 'Blood Donor Finder <no-reply@example.com>',
    ...overrides,
  };
}
