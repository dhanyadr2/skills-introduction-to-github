import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { importBankRows } from '../src/bank-import.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { seedPostalCodes } from '../src/seed.js';
import { syncDataGovIn } from '../src/sources/datagovin.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('OpenStreetMap live lookup in search', () => {
  let server;
  let base;
  let db;
  let overpassCalls = 0;
  let overpassUp = true;

  before(async () => {
    db = openDb(':memory:');
    seedPostalCodes(db);
    db.prepare("INSERT INTO blood_banks (name, country, lat, lng, source) VALUES ('Local Bank', 'IN', 12.9767, 77.5993, 'csv')").run();
    const fetchImpl = async (url, init) => {
      assert.match(String(url), /overpass-api\.de/);
      assert.match(decodeURIComponent(init.body), /healthcare/);
      overpassCalls++;
      if (!overpassUp) return json({}, 504);
      return json({
        elements: [
          // duplicate of Local Bank (~50 m away) -> dropped
          { type: 'node', id: 1, lat: 12.9771, lon: 77.5995, tags: { healthcare: 'blood_donation', name: 'Dup' } },
          { type: 'way', id: 2, center: { lat: 12.935, lon: 77.624 }, tags: { healthcare: 'blood_bank', name: 'OSM Bank', phone: '+91 80 1234 5678', opening_hours: '24/7' } },
          { type: 'node', id: 3, lat: 13.5, lon: 78.5, tags: { name: 'Too far' } },
        ],
      });
    };
    const config = loadConfig({ geocoderRemote: false, osmLive: true, fetchImpl, rateLimit: false });
    server = createApp({ db, mailer: { send: async () => {} }, config }).listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  const search = async (postalCode = '560001') =>
    (await fetch(`${base}/api/search?country=IN&postalCode=${postalCode}&radius=10`)).json();

  test('merges live results, drops duplicates and far entries, and caches', async () => {
    const r = await search();
    assert.deepEqual(r.banks.map((b) => [b.name, b.source]), [['Local Bank', 'csv'], ['OSM Bank', 'openstreetmap']]);
    assert.equal(r.banks[1].openingHours, '24/7');
    assert.equal(r.banks[1].id, 'osm:way/2');
    assert.equal(r.liveSourceFailed, false);
    await search();
    assert.equal(overpassCalls, 1, 'second search served from cache');
  });

  test('still answers when OpenStreetMap is down, and flags it', async () => {
    overpassUp = false;
    const r = await search('560034');
    assert.equal(r.liveSourceFailed, true);
    assert.deepEqual(r.banks.map((b) => b.name), ['Local Bank']);
  });
});

describe('data.gov.in sync', () => {
  const record = (i, extra = {}) => ({
    _blood_bank_name: `Bank ${i}`, state: 'Karnataka', district: 'Bengaluru', pincode: '560001',
    contact_no: '080-000', latitude: '12.97', longitude: '77.59', ...extra,
  });

  test('pages through the API and maps its field names', async () => {
    const db = openDb(':memory:');
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(new URL(url));
      const offset = Number(new URL(url).searchParams.get('offset'));
      const count = offset === 0 ? 500 : 3;
      return json({ records: Array.from({ length: count }, (_, i) => record(offset + i)) });
    };
    const r = await syncDataGovIn(db, { apiKey: 'k', resourceId: 'res-1', fetchImpl });
    assert.equal(r.fetched, 503);
    assert.equal(r.imported, 503);
    assert.equal(urls.length, 2);
    assert.equal(urls[0].pathname, '/resource/res-1');
    assert.equal(urls[0].searchParams.get('api-key'), 'k');
    const bank = db.prepare("SELECT * FROM blood_banks WHERE name = 'Bank 0'").get();
    assert.equal(bank.phone, '080-000');
    assert.equal(bank.city, 'Bengaluru');
    assert.equal(bank.source, 'data.gov.in');

    // A second sync replaces rather than duplicates.
    await syncDataGovIn(db, { apiKey: 'k', resourceId: 'res-1', fetchImpl });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM blood_banks').get().n, 503);
  });

  test('keeps existing banks when the API fails or returns unusable rows', async () => {
    const db = openDb(':memory:');
    importBankRows(db, [record(1)], { country: 'IN', source: 'data.gov.in' });
    await assert.rejects(syncDataGovIn(db, { apiKey: 'bad', resourceId: 'r', fetchImpl: async () => json({}, 403) }), /API key/);
    await assert.rejects(
      syncDataGovIn(db, { apiKey: 'k', resourceId: 'r', fetchImpl: async () => json({ records: [{ foo: 'bar' }] }) }),
      /existing data kept/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM blood_banks').get().n, 1);
  });
});
