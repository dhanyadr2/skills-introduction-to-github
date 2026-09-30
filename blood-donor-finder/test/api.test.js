import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { nowIso, openDb } from '../src/db.js';
import { seedPostalCodes } from '../src/seed.js';

let server;
let base;
let db;
const mails = [];

before(async () => {
  db = openDb(':memory:');
  seedPostalCodes(db);
  const config = loadConfig({ baseUrl: 'http://app.test', geocoderRemote: false, osmLive: false, rateLimit: false, production: false });
  const mailer = { send: async (m) => void mails.push(m) };
  server = createApp({ db, mailer, config }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => {
  mails.length = 0;
  db.exec('DELETE FROM requests; DELETE FROM donors; DELETE FROM blood_banks;');
});

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

const tokenIn = (mail, page) => mail.text.match(new RegExp(`${page}#token=([\\w-]+)`))[1];

async function registerDonor(overrides = {}) {
  const body = {
    name: 'Priya Sharma', email: 'priya@example.com', phone: '+91 98450 00000', bloodGroup: 'O-',
    country: 'IN', postalCode: '560034', consent: true, ...overrides,
  };
  const res = await call('/api/donors', { method: 'POST', body });
  assert.equal(res.status, 202, JSON.stringify(res.body));
  const mail = mails.at(-1);
  return { verify: tokenIn(mail, 'verify.html'), manage: tokenIn(mail, 'manage.html') };
}

const search = (q) => call(`/api/search?${new URLSearchParams({ country: 'IN', postalCode: '560001', radius: '10', ...q })}`);

describe('search', () => {
  test('rejects invalid postal codes and unknown ones', async () => {
    assert.equal((await search({ postalCode: '12' })).status, 400);
    const unknown = await search({ postalCode: '999999' });
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /PIN code 999999/);
  });

  test('finds blood banks within radius, sorted by distance, using the country unit', async () => {
    const insert = db.prepare('INSERT INTO blood_banks (name, country, lat, lng) VALUES (?, ?, ?, ?)');
    insert.run('Near', 'IN', 12.935, 77.624); // Koramangala, ~5.3 km
    insert.run('Nearest', 'IN', 12.977, 77.6); // GPO
    insert.run('Far', 'IN', 13.2, 77.7); // ~27 km
    insert.run('US bank', 'US', 12.977, 77.6);
    const res = await search({});
    assert.equal(res.status, 200);
    assert.equal(res.body.unit, 'km');
    assert.deepEqual(res.body.banks.map((b) => b.name), ['Nearest', 'Near']);
    const wide = await search({ radius: '50' });
    assert.equal(wide.body.banks.length, 3);
  });

  test('only verified, available, eligible, compatible donors appear, without contact details', async () => {
    const { verify } = await registerDonor();
    assert.equal((await search({ bloodGroup: 'A+' })).body.donors.length, 0, 'unverified donor hidden');

    await call('/api/donors/verify', { method: 'POST', body: { token: verify } });
    const res = await search({ bloodGroup: 'A+' });
    assert.equal(res.body.donors.length, 1);
    const donor = res.body.donors[0];
    assert.equal(donor.name, 'Priya S.');
    assert.equal(donor.exactMatch, false);
    assert.equal(donor.email, undefined);
    assert.equal(donor.phone, undefined);

    assert.equal((await search({ bloodGroup: 'A+', compatible: '0' })).body.donors.length, 0);

    const recent = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
    db.prepare('UPDATE donors SET last_donation_date = ?').run(recent);
    assert.equal((await search({ bloodGroup: 'O-' })).body.donors.length, 0, 'recent donor hidden');
  });
});

describe('donor registration and profile', () => {
  test('duplicate registration does not reveal the account and sends a new manage link', async () => {
    const first = await registerDonor();
    const again = await call('/api/donors', {
      method: 'POST',
      body: { name: 'X', email: 'PRIYA@example.com', bloodGroup: 'A+', country: 'IN', postalCode: '560001', consent: true },
    });
    assert.equal(again.status, 202);
    assert.match(mails.at(-1).subject, /already registered/);
    const oldLink = await call('/api/donors/me', { headers: { 'x-manage-token': first.manage } });
    assert.equal(oldLink.status, 401, 'old manage link is replaced');
  });

  test('requires consent and validates fields', async () => {
    const base = { name: 'A', email: 'a@example.com', bloodGroup: 'A+', country: 'US', postalCode: '10001' };
    assert.equal((await call('/api/donors', { method: 'POST', body: base })).status, 400);
    assert.equal((await call('/api/donors', { method: 'POST', body: { ...base, consent: true, bloodGroup: 'C+' } })).status, 400);
    assert.equal((await call('/api/donors', { method: 'POST', body: { ...base, consent: true, lastDonationDate: '2999-01-01' } })).status, 400);
  });

  test('manage link can view, pause, move and delete', async () => {
    const { verify, manage } = await registerDonor();
    await call('/api/donors/verify', { method: 'POST', body: { token: verify } });
    const headers = { 'x-manage-token': manage };

    const me = await call('/api/donors/me', { headers });
    assert.equal(me.body.verified, true);
    assert.equal(me.body.place, 'Koramangala');

    const paused = await call('/api/donors/me', { method: 'PATCH', headers, body: { available: false, postalCode: '110001' } });
    assert.equal(paused.body.available, false);
    assert.equal(paused.body.place, 'Connaught Place');
    assert.equal((await search({ postalCode: '110001' })).body.donors.length, 0);

    assert.equal((await call('/api/donors/me', { method: 'DELETE', headers })).status, 200);
    assert.equal((await call('/api/donors/me', { headers })).status, 401);
  });
});

describe('masked contact requests', () => {
  async function verifiedDonorId() {
    const { verify } = await registerDonor();
    await call('/api/donors/verify', { method: 'POST', body: { token: verify } });
    return (await search({})).body.donors[0].id;
  }
  const requestBody = (donorId, extra = {}) => ({
    donorId, seekerName: 'Ravi Kumar', seekerEmail: 'ravi@example.com', seekerPhone: '+91 90000 11111',
    bloodGroup: 'B+', hospital: 'City Hospital, Koramangala', units: 2, urgency: 'today', ...extra,
  });

  test('accept flow shares contacts only after acceptance', async () => {
    const donorId = await verifiedDonorId();
    mails.length = 0;
    const created = await call('/api/requests', { method: 'POST', body: requestBody(donorId) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const [toDonor, toSeeker] = mails;
    assert.equal(toDonor.to, 'priya@example.com');
    assert.doesNotMatch(toDonor.text, /ravi@example\.com|90000/);
    assert.equal(toSeeker.to, 'ravi@example.com');
    assert.doesNotMatch(toSeeker.text, /priya@example\.com|98450/);

    const donorHeaders = { 'x-request-token': tokenIn(toDonor, 'respond.html') };
    const seekerHeaders = { 'x-request-token': tokenIn(toSeeker, 'status.html') };

    const before = await call('/api/requests/status', { headers: seekerHeaders });
    assert.equal(before.body.status, 'pending');
    assert.equal(before.body.donor.email, undefined);
    assert.equal((await call('/api/requests/respond', { headers: donorHeaders })).body.seekerContact, null);

    const accepted = await call('/api/requests/respond', { method: 'POST', headers: donorHeaders, body: { action: 'accept' } });
    assert.equal(accepted.body.status, 'accepted');
    assert.equal((await call('/api/requests/respond', { method: 'POST', headers: donorHeaders, body: { action: 'decline' } })).status, 409);

    const afterAccept = await call('/api/requests/status', { headers: seekerHeaders });
    assert.equal(afterAccept.body.donor.email, 'priya@example.com');
    assert.equal(afterAccept.body.donor.phone, '+91 98450 00000');
    assert.ok(mails.some((m) => m.to === 'ravi@example.com' && m.text.includes('priya@example.com')));
    assert.ok(mails.some((m) => m.to === 'priya@example.com' && m.text.includes('ravi@example.com')));
  });

  test('rejects incompatible groups, duplicates, and too many requests per seeker', async () => {
    const donorId = await verifiedDonorId();
    db.prepare("UPDATE donors SET blood_group = 'AB+'").run();
    const bad = await call('/api/requests', { method: 'POST', body: requestBody(donorId, { bloodGroup: 'O+' }) });
    assert.equal(bad.status, 400);
    db.prepare("UPDATE donors SET blood_group = 'O-'").run();

    assert.equal((await call('/api/requests', { method: 'POST', body: requestBody(donorId) })).status, 201);
    assert.equal((await call('/api/requests', { method: 'POST', body: requestBody(donorId) })).status, 409);

    const donor = db.prepare('SELECT id FROM donors').get();
    const insert = db.prepare(
      `INSERT INTO requests (donor_id, seeker_name, seeker_email, blood_group, hospital, urgency, status, donor_token_hash, seeker_token_hash, created_at)
       VALUES (?, 'x', 'ravi@example.com', 'O-', 'h', 'today', 'declined', ?, ?, ?)`,
    );
    for (let i = 0; i < 4; i++) insert.run(donor.id, `d${i}`, `s${i}`, nowIso());
    const limited = await call('/api/requests', { method: 'POST', body: requestBody(donorId, { seekerEmail: 'ravi@example.com' }) });
    assert.equal(limited.status, 429);
  });

  test('old pending requests expire', async () => {
    const donorId = await verifiedDonorId();
    mails.length = 0;
    await call('/api/requests', { method: 'POST', body: requestBody(donorId) });
    db.prepare('UPDATE requests SET created_at = ?').run(new Date(Date.now() - 73 * 3_600_000).toISOString());
    const headers = { 'x-request-token': tokenIn(mails[0], 'respond.html') };
    assert.equal((await call('/api/requests/respond', { headers })).body.status, 'expired');
    assert.equal((await call('/api/requests/respond', { method: 'POST', headers, body: { action: 'accept' } })).status, 409);
  });
});

describe('dev outbox password and proxy IPs', () => {
  test('outbox requires the password when one is set, and trust proxy is configurable', async () => {
    const outDb = openDb(':memory:');
    const config = loadConfig({ outboxPassword: 's3cret', trustProxy: true, rateLimit: false, production: false });
    const app = createApp({ db: outDb, mailer: { send: async () => {} }, config });
    assert.equal(app.get('trust proxy'), true);
    const srv = app.listen(0);
    await new Promise((resolve) => srv.once('listening', resolve));
    const url = `http://127.0.0.1:${srv.address().port}/dev/outbox`;
    const auth = (pw) => ({ authorization: `Basic ${Buffer.from(`admin:${pw}`).toString('base64')}` });
    try {
      assert.equal((await fetch(url)).status, 401);
      assert.equal((await fetch(url, { headers: auth('wrong') })).status, 401);
      assert.equal((await fetch(url, { headers: auth('s3cret') })).status, 200);
    } finally {
      srv.close();
    }
  });
});
