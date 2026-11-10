// Time-zone-aware reset boundaries with no dependencies.
//
// Everything is computed from the actual clock ("what was the most recent
// reset before now?"), never from a running countdown, so sleep, shutdown,
// clock changes and DST all come out right on the next check.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map();

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of instant `ms` in time zone `tz`. */
function parts(ms, tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: +o.year,
    m: +o.month,
    d: +o.day,
    h: +o.hour % 24,
    mi: +o.minute,
    s: +o.second,
    wd: WEEKDAYS.indexOf(o.weekday),
  };
}

/** How far `tz` is ahead of UTC at instant `ms`, in ms. */
function offset(ms, tz) {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instant when the wall clock in `tz` reads y-m-d h:mi. Day overflow is
 * fine (d = 0 means the last day of the previous month). Times skipped by a
 * DST jump land an hour later, like most games do.
 */
function zoned(y, m, d, h, mi, tz) {
  const asUtc = Date.UTC(y, m - 1, d, h, mi);
  const first = asUtc - offset(asUtc, tz);
  return asUtc - offset(first, tz);
}

function hm(time) {
  const [h, mi] = String(time).split(':').map(Number);
  return [h || 0, mi || 0];
}

function rule(cadence, cfg) {
  if (cadence === 'daily') return { time: hm(cfg.dailyTime), step: 1 };
  if (cadence === 'weekly') return { time: hm(cfg.weeklyTime), step: 7, weekday: cfg.weeklyDay };
  return null;
}

/** Most recent reset boundary at or before `now`, or null for manual groups. */
function latestBoundary(now, cadence, cfg) {
  const r = rule(cadence, cfg);
  if (!r) return null;
  const tz = cfg.timezone;
  const [h, mi] = r.time;
  const p = parts(now, tz);
  const back = r.step === 7 ? (p.wd - r.weekday + 7) % 7 : 0;
  let t = zoned(p.y, p.m, p.d - back, h, mi, tz);
  if (t > now) t = zoned(p.y, p.m, p.d - back - r.step, h, mi, tz);
  return t;
}

/** The next reset strictly after `now`. */
function nextBoundary(now, cadence, cfg) {
  const last = latestBoundary(now, cadence, cfg);
  if (last === null) return null;
  const r = rule(cadence, cfg);
  const p = parts(last, cfg.timezone);
  return zoned(p.y, p.m, p.d + r.step, r.time[0], r.time[1], cfg.timezone);
}

function defaultResetConfig() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    dailyTime: '00:00',
    weeklyDay: 1, // Monday
    weeklyTime: '00:00',
  };
}

module.exports = { latestBoundary, nextBoundary, isValidTimeZone, defaultResetConfig };
