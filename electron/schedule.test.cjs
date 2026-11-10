const { test } = require('node:test');
const assert = require('node:assert/strict');
const { latestBoundary, nextBoundary } = require('./schedule.cjs');

const iso = (ms) => new Date(ms).toISOString();
const at = (s) => Date.parse(s);

test('daily reset in UTC', () => {
  const cfg = { timezone: 'UTC', dailyTime: '10:00' };
  assert.equal(iso(latestBoundary(at('2026-11-11T09:00Z'), 'daily', cfg)), '2026-11-10T10:00:00.000Z');
  assert.equal(iso(latestBoundary(at('2026-11-11T10:00Z'), 'daily', cfg)), '2026-11-11T10:00:00.000Z', 'boundary is inclusive');
  assert.equal(iso(nextBoundary(at('2026-11-11T10:00Z'), 'daily', cfg)), '2026-11-12T10:00:00.000Z');
});

test('weekly reset on Wednesday', () => {
  const cfg = { timezone: 'UTC', weeklyDay: 3, weeklyTime: '10:00' };
  // 2026-11-11 is a Wednesday
  assert.equal(iso(latestBoundary(at('2026-11-11T09:59Z'), 'weekly', cfg)), '2026-11-04T10:00:00.000Z');
  assert.equal(iso(latestBoundary(at('2026-11-11T10:00Z'), 'weekly', cfg)), '2026-11-11T10:00:00.000Z');
  assert.equal(iso(latestBoundary(at('2026-11-14T00:00Z'), 'weekly', cfg)), '2026-11-11T10:00:00.000Z');
  assert.equal(iso(nextBoundary(at('2026-11-14T00:00Z'), 'weekly', cfg)), '2026-11-18T10:00:00.000Z');
});

test('local time zone with offset', () => {
  // Midnight in Tokyo (UTC+9, no DST) is 15:00 UTC the day before.
  const cfg = { timezone: 'Asia/Tokyo', dailyTime: '00:00' };
  assert.equal(iso(latestBoundary(at('2026-11-11T16:00Z'), 'daily', cfg)), '2026-11-11T15:00:00.000Z');
});

test('daylight saving: the reset stays at the same wall-clock time', () => {
  const cfg = { timezone: 'America/New_York', dailyTime: '00:00' };
  // US clocks spring forward on 2026-03-08. Midnight before = EST (UTC-5), after = EDT (UTC-4).
  assert.equal(iso(latestBoundary(at('2026-03-08T12:00Z'), 'daily', cfg)), '2026-03-08T05:00:00.000Z');
  assert.equal(iso(nextBoundary(at('2026-03-08T12:00Z'), 'daily', cfg)), '2026-03-09T04:00:00.000Z');
  // ...and fall back on 2026-11-01.
  assert.equal(iso(nextBoundary(at('2026-10-31T12:00Z'), 'daily', cfg)), '2026-11-01T04:00:00.000Z');
  assert.equal(iso(nextBoundary(at('2026-11-01T12:00Z'), 'daily', cfg)), '2026-11-02T05:00:00.000Z');
});

test('month and year rollover', () => {
  const cfg = { timezone: 'UTC', dailyTime: '00:00', weeklyDay: 4, weeklyTime: '00:00' };
  assert.equal(iso(latestBoundary(at('2027-01-01T03:00Z'), 'daily', cfg)), '2027-01-01T00:00:00.000Z');
  assert.equal(iso(latestBoundary(at('2026-12-31T23:00Z'), 'daily', cfg)), '2026-12-31T00:00:00.000Z');
  // 2027-01-01 is a Friday → previous Thursday is 2026-12-31
  assert.equal(iso(latestBoundary(at('2027-01-02T00:00Z'), 'weekly', cfg)), '2026-12-31T00:00:00.000Z');
});

test('manual groups never reset', () => {
  assert.equal(latestBoundary(Date.now(), 'none', { timezone: 'UTC' }), null);
});
