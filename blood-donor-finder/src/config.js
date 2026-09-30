import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;
const bool = (value, fallback) => (value === undefined || value === '' ? fallback : /^(1|true|yes)$/i.test(value));

function parseTrustProxy(value) {
  if (!value) return 'loopback';
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function loadConfig(overrides = {}) {
  const port = Number(env.PORT || 3000);
  return {
    port,
    // RENDER_EXTERNAL_URL is set automatically on Render.
    baseUrl: (env.BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    // Set when running behind a reverse proxy/load balancer so rate limits see the real client IP:
    // "true" (trust X-Forwarded-For), a hop count like "1", or Express's named values.
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    // When set, /dev/outbox asks for this password (any username).
    outboxPassword: env.OUTBOX_PASSWORD || null,
    dbPath: env.DB_PATH || './data/app.db',
    production: env.NODE_ENV === 'production',
    seedDemo: bool(env.SEED_DEMO, true),
    geocoderRemote: bool(env.GEOCODER_REMOTE, true),
    // Look up blood banks live from OpenStreetMap on each search (cached for 24h).
    osmLive: bool(env.OSM_LIVE, true),
    // India blood bank directory from the data.gov.in API, refreshed daily when both are set.
    dataGovIn:
      env.DATA_GOV_IN_API_KEY && env.DATA_GOV_IN_RESOURCE_ID
        ? { apiKey: env.DATA_GOV_IN_API_KEY, resourceId: env.DATA_GOV_IN_RESOURCE_ID }
        : null,
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
