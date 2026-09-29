import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS postal_codes (
  country     TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  place       TEXT NOT NULL,
  state       TEXT,
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  PRIMARY KEY (country, postal_code)
);

CREATE TABLE IF NOT EXISTS blood_banks (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  country          TEXT NOT NULL,
  postal_code      TEXT,
  address          TEXT,
  city             TEXT,
  state            TEXT,
  phone            TEXT,
  website          TEXT,
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
  stock_json       TEXT,
  stock_updated_at TEXT,
  source           TEXT NOT NULL DEFAULT 'manual',
  is_sample        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS blood_banks_geo ON blood_banks (country, lat, lng);

CREATE TABLE IF NOT EXISTS donors (
  id                 INTEGER PRIMARY KEY,
  public_id          TEXT NOT NULL UNIQUE,
  name               TEXT NOT NULL,
  email              TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone              TEXT,
  blood_group        TEXT NOT NULL,
  country            TEXT NOT NULL,
  postal_code        TEXT NOT NULL,
  place              TEXT,
  lat                REAL NOT NULL,
  lng                REAL NOT NULL,
  last_donation_date TEXT,
  available          INTEGER NOT NULL DEFAULT 1,
  verified           INTEGER NOT NULL DEFAULT 0,
  verify_token_hash  TEXT,
  manage_token_hash  TEXT,
  is_sample          INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS donors_geo ON donors (country, lat, lng);

CREATE TABLE IF NOT EXISTS requests (
  id                INTEGER PRIMARY KEY,
  donor_id          INTEGER NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
  seeker_name       TEXT NOT NULL,
  seeker_email      TEXT NOT NULL COLLATE NOCASE,
  seeker_phone      TEXT,
  blood_group       TEXT NOT NULL,
  hospital          TEXT NOT NULL,
  units             INTEGER NOT NULL DEFAULT 1,
  urgency           TEXT NOT NULL,
  message           TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  donor_token_hash  TEXT NOT NULL UNIQUE,
  seeker_token_hash TEXT NOT NULL UNIQUE,
  created_at        TEXT NOT NULL,
  responded_at      TEXT
);
CREATE INDEX IF NOT EXISTS requests_donor ON requests (donor_id, created_at);
CREATE INDEX IF NOT EXISTS requests_seeker ON requests (seeker_email, created_at);

CREATE TABLE IF NOT EXISTS outbox (
  id         INTEGER PRIMARY KEY,
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const nowIso = () => new Date().toISOString();
