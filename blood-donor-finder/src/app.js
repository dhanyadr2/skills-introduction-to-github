import express from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BLOOD_GROUPS,
  COMPATIBLE_DONORS,
  COUNTRIES,
  URGENCY,
  donorGroupsFor,
  eligibilityCutoff,
  isBloodGroup,
  nextEligibleDate,
  normalizePostalCode,
} from './blood.js';
import { nowIso, transaction } from './db.js';
import { boundingBox, distanceKm, fromKm, geocodePostal, toKm } from './geo.js';
import { openStreetMapBanks } from './sources/openstreetmap.js';
import { hashToken, newPublicId, newToken } from './tokens.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const REQUEST_TTL_HOURS = 72;
const MAX_RESULTS = 50;
const SEEKER_REQUESTS_PER_HOUR = 5;
const DONOR_OPEN_REQUESTS_PER_DAY = 3;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- input helpers ----------

function text(value, field, { max = 200, required = true } = {}) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) {
    if (required) throw new HttpError(400, `${field} is required.`);
    return null;
  }
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters.`);
  return v;
}

function email(value) {
  const v = text(value, 'Email', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new HttpError(400, 'Enter a valid email address.');
  return v;
}

function phone(value, { required = false } = {}) {
  const v = text(value, 'Phone', { max: 25, required });
  if (v && !/^\+?[\d\s()-]{7,20}$/.test(v)) throw new HttpError(400, 'Enter a valid phone number.');
  return v;
}

function country(value) {
  if (!COUNTRIES[value]) throw new HttpError(400, 'Choose India or United States.');
  return value;
}

function bloodGroup(value, field = 'Blood group') {
  if (!isBloodGroup(value)) throw new HttpError(400, `${field} must be one of ${BLOOD_GROUPS.join(', ')}.`);
  return value;
}

function postal(countryCode, value) {
  const code = normalizePostalCode(countryCode, value);
  if (!code) {
    const cfg = COUNTRIES[countryCode];
    throw new HttpError(400, `Enter a valid ${cfg.postalLabel} (e.g. ${cfg.postalExample}).`);
  }
  return code;
}

function pastDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, 'Last donation date must be a date (YYYY-MM-DD).');
  }
  if (value > new Date().toISOString().slice(0, 10)) {
    throw new HttpError(400, 'Last donation date cannot be in the future.');
  }
  return value;
}

/** "Priya Sharma" -> "Priya S." — donors are never shown by full name in search. */
function displayName(name) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
}

// Simple fixed-window limiter for write endpoints (per client IP).
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
    } else if (++entry.count > max) {
      return next(new HttpError(429, 'Too many requests. Please wait a few minutes and try again.'));
    }
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

const digest = (value) => createHash('sha256').update(value).digest();
const safeEqual = (a, b) => timingSafeEqual(digest(a), digest(b));

// ---------- app ----------

export function createApp({ db, mailer, config }) {
  const app = express();
  app.set('trust proxy', config.trustProxy ?? 'loopback');
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(PUBLIC_DIR));

  const writeLimit = config.rateLimit === false ? (_q, _s, n) => n() : rateLimiter({ windowMs: 10 * 60_000, max: 30 });
  const link = (page, token) => `${config.baseUrl}/${page}#token=${token}`;
  const geocode = (c, p) => geocodePostal(db, c, p, { remote: config.geocoderRemote, fetchImpl: config.fetchImpl });

  async function locate(countryCode, postalCode) {
    const origin = await geocode(countryCode, postalCode);
    if (!origin) {
      throw new HttpError(404, `We couldn't find ${COUNTRIES[countryCode].postalLabel} ${postalCode}. Check it and try again.`);
    }
    return origin;
  }

  function expireOldRequests() {
    const cutoff = new Date(Date.now() - REQUEST_TTL_HOURS * 3_600_000).toISOString();
    db.prepare("UPDATE requests SET status = 'expired' WHERE status = 'pending' AND created_at < ?").run(cutoff);
  }

  function donorByManageToken(req) {
    const token = req.get('x-manage-token');
    const donor = token && db.prepare('SELECT * FROM donors WHERE manage_token_hash = ?').get(hashToken(token));
    if (!donor) throw new HttpError(401, 'This manage link is invalid or has been replaced by a newer one.');
    return donor;
  }

  // ----- metadata for the UI -----

  app.get('/api/meta', (_req, res) => {
    res.json({
      bloodGroups: BLOOD_GROUPS,
      compatibleDonors: COMPATIBLE_DONORS,
      urgency: URGENCY,
      countries: Object.values(COUNTRIES).map(({ postalPattern, ...c }) => c),
    });
  });

  // ----- search -----

  app.get('/api/search', async (req, res) => {
    const c = country(req.query.country);
    const cfg = COUNTRIES[c];
    const code = postal(c, req.query.postalCode);
    const group = req.query.bloodGroup ? bloodGroup(req.query.bloodGroup) : null;
    const includeCompatible = req.query.compatible !== '0';
    const radius = Number(req.query.radius || cfg.defaultRadius);
    if (!cfg.radiusOptions.includes(radius)) {
      throw new HttpError(400, `Radius must be one of ${cfg.radiusOptions.join(', ')} ${cfg.unit}.`);
    }

    const origin = await locate(c, code);
    const radiusKm = toKm(radius, cfg.unit);
    const box = boundingBox(origin.lat, origin.lng, radiusKm);
    const boxParams = [c, box.minLat, box.maxLat, box.minLng, box.maxLng];
    const within = (rows) =>
      rows
        .map((r) => ({ ...r, km: distanceKm(origin.lat, origin.lng, r.lat, r.lng) }))
        .filter((r) => r.km <= radiusKm);
    const round1 = (km) => Math.round(fromKm(km, cfg.unit) * 10) / 10;

    const bankRows = db
      .prepare(
        `SELECT * FROM blood_banks
         WHERE country = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?`,
      )
      .all(...boxParams)
      .map((b) => ({ ...b, source: b.is_sample ? 'demo' : b.source }));
    let liveSourceFailed = false;
    if (config.osmLive) {
      const osm = await openStreetMapBanks(db, {
        cacheKey: `${c}:${code}:${radius}`,
        lat: origin.lat,
        lng: origin.lng,
        radiusKm,
        fetchImpl: config.fetchImpl,
      });
      liveSourceFailed = !osm.ok;
      // Skip OpenStreetMap entries that duplicate a bank we already have (within ~200 m).
      const fresh = osm.banks.filter(
        (o) => !bankRows.some((b) => distanceKm(o.lat, o.lng, b.lat, b.lng) < 0.2),
      );
      bankRows.push(...fresh.map((o) => ({ ...o, source: 'openstreetmap' })));
    }
    const banks = within(bankRows)
      .sort((a, b) => a.km - b.km)
      .slice(0, MAX_RESULTS)
      .map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        city: b.city,
        state: b.state,
        postalCode: b.postal_code,
        phone: b.phone,
        website: b.website,
        openingHours: b.opening_hours ?? null,
        distance: round1(b.km),
        stock: b.stock_json ? JSON.parse(b.stock_json) : null,
        stockUpdatedAt: b.stock_updated_at ?? null,
        source: b.source,
        isSample: b.source === 'demo',
      }));

    const groups = group ? donorGroupsFor(group, includeCompatible) : BLOOD_GROUPS;
    const donorRows = db
      .prepare(
        `SELECT public_id, name, blood_group, place, lat, lng, is_sample FROM donors
         WHERE country = ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
           AND verified = 1 AND available = 1
           AND (last_donation_date IS NULL OR last_donation_date <= ?)
           AND blood_group IN (${groups.map(() => '?').join(',')})`,
      )
      .all(...boxParams, eligibilityCutoff(c), ...groups);
    const donors = within(donorRows)
      .map((d) => ({ ...d, exact: !group || d.blood_group === group }))
      .sort((a, b) => b.exact - a.exact || a.km - b.km)
      .slice(0, MAX_RESULTS)
      .map((d) => ({
        id: d.public_id,
        name: displayName(d.name),
        bloodGroup: d.blood_group,
        place: d.place,
        // Donor locations are postal-code centres, so only show a coarse distance.
        distance: Math.max(1, Math.round(fromKm(d.km, cfg.unit))),
        exactMatch: d.exact,
        isSample: Boolean(d.is_sample),
      }));

    res.json({
      origin: { country: c, postalCode: code, place: origin.place, state: origin.state },
      unit: cfg.unit,
      radius,
      bloodGroup: group,
      includeCompatible,
      banks,
      donors,
      liveSourceFailed,
    });
  });

  // ----- donors -----

  app.post('/api/donors', writeLimit, async (req, res) => {
    const b = req.body ?? {};
    if (b.consent !== true) {
      throw new HttpError(400, 'Please agree to be contacted about blood requests to register.');
    }
    const c = country(b.country);
    const input = {
      name: text(b.name, 'Name', { max: 100 }),
      email: email(b.email),
      phone: phone(b.phone),
      bloodGroup: bloodGroup(b.bloodGroup),
      postalCode: postal(c, b.postalCode),
      lastDonationDate: pastDate(b.lastDonationDate),
    };
    const genericReply = { ok: true, message: `Check ${input.email} for a link to confirm your registration.` };

    const existing = db.prepare('SELECT id, name FROM donors WHERE email = ?').get(input.email);
    if (existing) {
      // Don't reveal whether an email is registered; send a fresh manage link instead.
      const manage = newToken();
      db.prepare('UPDATE donors SET manage_token_hash = ?, updated_at = ? WHERE id = ?').run(manage.hash, nowIso(), existing.id);
      await mailer.send({
        to: input.email,
        subject: 'You are already registered as a blood donor',
        text: `Hi ${existing.name},\n\nSomeone (hopefully you) tried to register this email again. You are already registered.\n\nUpdate or pause your donor profile here:\n${link('manage.html', manage.token)}\n\nThis link replaces any earlier manage link.`,
      });
      return res.status(202).json(genericReply);
    }

    const origin = await locate(c, input.postalCode);
    const verify = newToken();
    const manage = newToken();
    const now = nowIso();
    db.prepare(
      `INSERT INTO donors (public_id, name, email, phone, blood_group, country, postal_code, place, lat, lng,
         last_donation_date, verify_token_hash, manage_token_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newPublicId(), input.name, input.email, input.phone, input.bloodGroup, c, input.postalCode, origin.place,
      origin.lat, origin.lng, input.lastDonationDate, verify.hash, manage.hash, now, now,
    );
    await mailer.send({
      to: input.email,
      subject: 'Confirm your blood donor registration',
      text: `Hi ${input.name},\n\nThank you for registering as a ${input.bloodGroup} blood donor.\n\n1. Confirm your email to appear in search results:\n${link('verify.html', verify.token)}\n\n2. Keep this link to update, pause, or delete your profile later:\n${link('manage.html', manage.token)}\n\nPeople who find you will only see your first name, blood group, and approximate area. Your phone and email are shared only with requesters you accept.`,
    });
    res.status(202).json(genericReply);
  });

  app.post('/api/donors/verify', writeLimit, (req, res) => {
    const token = text(req.body?.token, 'Token');
    const donor = db.prepare('SELECT id FROM donors WHERE verify_token_hash = ?').get(hashToken(token));
    if (!donor) throw new HttpError(400, 'This confirmation link is invalid or was already used.');
    db.prepare('UPDATE donors SET verified = 1, verify_token_hash = NULL, updated_at = ? WHERE id = ?').run(nowIso(), donor.id);
    res.json({ ok: true });
  });

  app.post('/api/donors/manage-link', writeLimit, async (req, res) => {
    const addr = email(req.body?.email);
    const donor = db.prepare('SELECT id, name FROM donors WHERE email = ?').get(addr);
    if (donor) {
      const manage = newToken();
      db.prepare('UPDATE donors SET manage_token_hash = ?, updated_at = ? WHERE id = ?').run(manage.hash, nowIso(), donor.id);
      await mailer.send({
        to: addr,
        subject: 'Your donor profile link',
        text: `Hi ${donor.name},\n\nUse this link to update, pause, or delete your donor profile:\n${link('manage.html', manage.token)}\n\nThis link replaces any earlier manage link.`,
      });
    }
    res.status(202).json({ ok: true, message: `If ${addr} is registered, a new link is on its way.` });
  });

  function donorProfile(donor) {
    expireOldRequests();
    const requests = db
      .prepare(
        `SELECT seeker_name, blood_group, hospital, units, urgency, status, created_at FROM requests
         WHERE donor_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(donor.id)
      .map((r) => ({
        seekerName: r.seeker_name,
        bloodGroup: r.blood_group,
        hospital: r.hospital,
        units: r.units,
        urgency: URGENCY[r.urgency],
        status: r.status,
        createdAt: r.created_at,
      }));
    return {
      name: donor.name,
      email: donor.email,
      phone: donor.phone,
      bloodGroup: donor.blood_group,
      country: donor.country,
      postalCode: donor.postal_code,
      place: donor.place,
      lastDonationDate: donor.last_donation_date,
      nextEligibleDate: nextEligibleDate(donor.country, donor.last_donation_date),
      available: Boolean(donor.available),
      verified: Boolean(donor.verified),
      requests,
    };
  }

  app.get('/api/donors/me', (req, res) => {
    res.json(donorProfile(donorByManageToken(req)));
  });

  app.patch('/api/donors/me', writeLimit, async (req, res) => {
    const donor = donorByManageToken(req);
    const b = req.body ?? {};
    const next = {
      name: 'name' in b ? text(b.name, 'Name', { max: 100 }) : donor.name,
      phone: 'phone' in b ? phone(b.phone) : donor.phone,
      blood_group: 'bloodGroup' in b ? bloodGroup(b.bloodGroup) : donor.blood_group,
      last_donation_date: 'lastDonationDate' in b ? pastDate(b.lastDonationDate) : donor.last_donation_date,
      available: 'available' in b ? (b.available ? 1 : 0) : donor.available,
      postal_code: donor.postal_code,
      place: donor.place,
      lat: donor.lat,
      lng: donor.lng,
    };
    if ('postalCode' in b) {
      const code = postal(donor.country, b.postalCode);
      if (code !== donor.postal_code) {
        const origin = await locate(donor.country, code);
        Object.assign(next, { postal_code: code, place: origin.place, lat: origin.lat, lng: origin.lng });
      }
    }
    db.prepare(
      `UPDATE donors SET name = ?, phone = ?, blood_group = ?, last_donation_date = ?, available = ?,
         postal_code = ?, place = ?, lat = ?, lng = ?, updated_at = ? WHERE id = ?`,
    ).run(
      next.name, next.phone, next.blood_group, next.last_donation_date, next.available,
      next.postal_code, next.place, next.lat, next.lng, nowIso(), donor.id,
    );
    res.json(donorProfile(db.prepare('SELECT * FROM donors WHERE id = ?').get(donor.id)));
  });

  app.delete('/api/donors/me', writeLimit, (req, res) => {
    const donor = donorByManageToken(req);
    db.prepare('DELETE FROM donors WHERE id = ?').run(donor.id);
    res.json({ ok: true });
  });

  // ----- contact requests (masked) -----

  app.post('/api/requests', writeLimit, async (req, res) => {
    const b = req.body ?? {};
    const input = {
      donorId: text(b.donorId, 'Donor', { max: 32 }),
      seekerName: text(b.seekerName, 'Your name', { max: 100 }),
      seekerEmail: email(b.seekerEmail),
      seekerPhone: phone(b.seekerPhone, { required: true }),
      bloodGroup: bloodGroup(b.bloodGroup, "Patient's blood group"),
      hospital: text(b.hospital, 'Hospital / location', { max: 200 }),
      units: Number.isInteger(b.units) && b.units >= 1 && b.units <= 10 ? b.units : null,
      urgency: URGENCY[b.urgency] ? b.urgency : null,
      message: text(b.message, 'Message', { max: 1000, required: false }),
    };
    if (!input.units) throw new HttpError(400, 'Units needed must be a whole number from 1 to 10.');
    if (!input.urgency) throw new HttpError(400, 'Choose how urgently blood is needed.');

    expireOldRequests();
    const donor = db
      .prepare('SELECT * FROM donors WHERE public_id = ? AND verified = 1 AND available = 1')
      .get(input.donorId);
    if (!donor || nextEligibleDate(donor.country, donor.last_donation_date)) {
      throw new HttpError(404, 'This donor is no longer available. Please choose another donor.');
    }
    if (!COMPATIBLE_DONORS[input.bloodGroup].includes(donor.blood_group)) {
      throw new HttpError(400, `A ${donor.blood_group} donor cannot give red cells to a ${input.bloodGroup} patient.`);
    }

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const count = (sql, ...params) => db.prepare(sql).get(...params).n;
    if (count('SELECT COUNT(*) n FROM requests WHERE seeker_email = ? AND created_at > ?', input.seekerEmail, hourAgo) >= SEEKER_REQUESTS_PER_HOUR) {
      throw new HttpError(429, `You can send up to ${SEEKER_REQUESTS_PER_HOUR} requests per hour. For emergencies, also call the blood banks listed.`);
    }
    if (count("SELECT COUNT(*) n FROM requests WHERE donor_id = ? AND seeker_email = ? AND status = 'pending'", donor.id, input.seekerEmail)) {
      throw new HttpError(409, 'You already have a pending request with this donor.');
    }
    if (count("SELECT COUNT(*) n FROM requests WHERE donor_id = ? AND status = 'pending' AND created_at > ?", donor.id, dayAgo) >= DONOR_OPEN_REQUESTS_PER_DAY) {
      throw new HttpError(429, 'This donor already has several open requests. Please contact another donor.');
    }

    const donorToken = newToken();
    const seekerToken = newToken();
    db.prepare(
      `INSERT INTO requests (donor_id, seeker_name, seeker_email, seeker_phone, blood_group, hospital, units,
         urgency, message, donor_token_hash, seeker_token_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      donor.id, input.seekerName, input.seekerEmail, input.seekerPhone, input.bloodGroup, input.hospital,
      input.units, input.urgency, input.message, donorToken.hash, seekerToken.hash, nowIso(),
    );

    await mailer.send({
      to: donor.email,
      subject: `Blood request: ${input.bloodGroup} needed — ${URGENCY[input.urgency]}`,
      text: `Hi ${donor.name},\n\n${input.seekerName} is looking for a ${input.bloodGroup} donor.\n\nHospital / location: ${input.hospital}\nUnits needed: ${input.units}\nNeeded: ${URGENCY[input.urgency]}\n${input.message ? `Message: ${input.message}\n` : ''}\nYour contact details have NOT been shared. Open this link to accept or decline:\n${link('respond.html', donorToken.token)}\n\nIf you accept, you and ${input.seekerName} will receive each other's contact details. The request expires in ${REQUEST_TTL_HOURS} hours.`,
    });
    await mailer.send({
      to: input.seekerEmail,
      subject: `Your request was sent to ${displayName(donor.name)}`,
      text: `Hi ${input.seekerName},\n\nWe've asked ${displayName(donor.name)} (${donor.blood_group}) to help. You'll get an email when they respond.\n\nTrack the request here:\n${link('status.html', seekerToken.token)}\n\nFor urgent needs, please also contact the nearby blood banks listed in your search results.`,
    });
    res.status(201).json({ ok: true, message: `Request sent. Check ${input.seekerEmail} for a link to track it.` });
  });

  function requestByToken(column, token) {
    expireOldRequests();
    const row =
      token &&
      db
        .prepare(
          `SELECT r.*, d.name AS donor_name, d.email AS donor_email, d.phone AS donor_phone, d.blood_group AS donor_group
           FROM requests r JOIN donors d ON d.id = r.donor_id WHERE r.${column} = ?`,
        )
        .get(hashToken(token));
    if (!row) throw new HttpError(404, 'This link is invalid, or the request was removed.');
    return row;
  }

  const requestSummary = (r) => ({
    status: r.status,
    bloodGroup: r.blood_group,
    hospital: r.hospital,
    units: r.units,
    urgency: URGENCY[r.urgency],
    message: r.message,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  });

  app.get('/api/requests/respond', (req, res) => {
    const r = requestByToken('donor_token_hash', req.get('x-request-token'));
    res.json({
      ...requestSummary(r),
      seekerName: r.seeker_name,
      donorName: r.donor_name,
      seekerContact: r.status === 'accepted' ? { email: r.seeker_email, phone: r.seeker_phone } : null,
    });
  });

  app.post('/api/requests/respond', writeLimit, async (req, res) => {
    const action = req.body?.action;
    if (action !== 'accept' && action !== 'decline') throw new HttpError(400, 'Choose accept or decline.');
    const r = requestByToken('donor_token_hash', req.get('x-request-token'));
    const status = action === 'accept' ? 'accepted' : 'declined';
    const updated = transaction(db, () =>
      db
        .prepare("UPDATE requests SET status = ?, responded_at = ? WHERE id = ? AND status = 'pending'")
        .run(status, nowIso(), r.id).changes,
    );
    if (!updated) throw new HttpError(409, `This request is already ${r.status}.`);

    if (status === 'accepted') {
      await mailer.send({
        to: r.seeker_email,
        subject: `${r.donor_name} accepted your blood request`,
        text: `Hi ${r.seeker_name},\n\nGood news — ${r.donor_name} (${r.donor_group}) has agreed to help.\n\nContact them now:\nPhone: ${r.donor_phone || 'not provided'}\nEmail: ${r.donor_email}\n\nPlease be respectful of the donor's time and privacy.`,
      });
      await mailer.send({
        to: r.donor_email,
        subject: `Thank you — here is ${r.seeker_name}'s contact`,
        text: `Hi ${r.donor_name},\n\nThank you for accepting. ${r.seeker_name} has your contact details and may reach out.\n\nTheir contact:\nPhone: ${r.seeker_phone}\nEmail: ${r.seeker_email}\nHospital / location: ${r.hospital}\n\nIf anyone pressures you or asks for money, do not proceed.`,
      });
    } else {
      await mailer.send({
        to: r.seeker_email,
        subject: 'A donor was unable to help',
        text: `Hi ${r.seeker_name},\n\nThe donor you contacted can't help this time. Please search again and reach out to other donors or the nearby blood banks.`,
      });
    }
    res.json({ ok: true, status });
  });

  app.get('/api/requests/status', (req, res) => {
    const r = requestByToken('seeker_token_hash', req.get('x-request-token'));
    res.json({
      ...requestSummary(r),
      seekerName: r.seeker_name,
      donor:
        r.status === 'accepted'
          ? { name: r.donor_name, bloodGroup: r.donor_group, email: r.donor_email, phone: r.donor_phone }
          : { name: displayName(r.donor_name), bloodGroup: r.donor_group },
    });
  });

  // ----- development outbox -----

  if (!config.production) {
    app.get('/dev/outbox', (req, res) => {
      if (config.outboxPassword) {
        const [scheme, encoded] = (req.get('authorization') ?? '').split(' ');
        const password = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : '';
        if (!safeEqual(password, config.outboxPassword)) {
          return res.set('WWW-Authenticate', 'Basic realm="Dev outbox"').status(401).send('Password required.');
        }
      }
      const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
      const linkify = (s) => esc(s).replace(/https?:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`);
      const mails = db.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT 50').all();
      res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev outbox</title><link rel="stylesheet" href="/style.css">
<main class="container"><h1>Dev outbox</h1><p class="muted">Emails the app would have sent (newest first). Shown only when NODE_ENV is not production.</p>
${mails.map((m) => `<article class="card"><p class="muted">${esc(m.created_at)} · to <b>${esc(m.to_addr)}</b></p><h3>${esc(m.subject)}</h3><pre class="mail">${linkify(m.body)}</pre></article>`).join('') || '<p>No emails yet.</p>'}
</main>`);
    });
  }

  // ----- errors -----

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body.');
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
  });

  return app;
}
