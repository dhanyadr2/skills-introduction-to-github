import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMPATIBLE_DONORS, eligibilityCutoff, nextEligibleDate, normalizePostalCode } from '../src/blood.js';
import { parseCsv } from '../src/csv.js';
import { boundingBox, distanceKm, fromKm } from '../src/geo.js';

test('distance between Bengaluru GPO and Koramangala is about 6 km', () => {
  const km = distanceKm(12.9767, 77.5993, 12.9352, 77.6245);
  assert.ok(km > 5 && km < 6, `got ${km}`);
});

test('miles conversion', () => {
  assert.equal(Math.round(fromKm(16.09344, 'mi')), 10);
});

test('bounding box contains points on the radius', () => {
  const box = boundingBox(40.75, -73.99, 10);
  assert.ok(box.minLat < 40.67 && box.maxLat > 40.83);
  assert.ok(box.minLng < -74.1 && box.maxLng > -73.88);
});

test('postal code validation per country', () => {
  assert.equal(normalizePostalCode('IN', '560 001'), '560001');
  assert.equal(normalizePostalCode('IN', '060001'), null);
  assert.equal(normalizePostalCode('US', '10001-1234'), '10001');
  assert.equal(normalizePostalCode('US', '1000'), null);
  assert.equal(normalizePostalCode('XX', '10001'), null);
});

test('blood compatibility', () => {
  assert.deepEqual(COMPATIBLE_DONORS['O-'], ['O-']);
  assert.equal(COMPATIBLE_DONORS['AB+'].length, 8);
  assert.ok(COMPATIBLE_DONORS['A+'].includes('O-'));
  assert.ok(!COMPATIBLE_DONORS['A+'].includes('B+'));
});

test('eligibility uses the country deferral period', () => {
  const today = new Date('2026-09-29T12:00:00Z');
  assert.equal(nextEligibleDate('US', '2026-09-01', today), '2026-10-27');
  assert.equal(nextEligibleDate('US', '2026-08-01', today), null);
  assert.equal(nextEligibleDate('IN', '2026-08-01', today), '2026-10-30');
  assert.equal(nextEligibleDate('IN', null, today), null);
  assert.equal(eligibilityCutoff('US', today), '2026-08-04');
});

test('CSV parser handles quotes, commas and CRLF', () => {
  const rows = parseCsv('﻿Name,Address\r\n"Bank, One","12 ""Main"" St"\r\n\r\nBank Two,x\r\n');
  assert.deepEqual(rows, [
    { Name: 'Bank, One', Address: '12 "Main" St' },
    { Name: 'Bank Two', Address: 'x' },
  ]);
});
