export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// Red-cell compatibility: recipient group -> donor groups it can receive from.
export const COMPATIBLE_DONORS = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

// Per-country settings. `minDaysBetweenDonations` is the whole-blood deferral
// period used to hide donors who donated too recently.
export const COUNTRIES = {
  IN: {
    code: 'IN',
    name: 'India',
    postalLabel: 'PIN code',
    postalPattern: /^[1-9]\d{5}$/,
    postalExample: '560001',
    unit: 'km',
    radiusOptions: [5, 10, 25, 50],
    defaultRadius: 10,
    minDaysBetweenDonations: 90,
  },
  US: {
    code: 'US',
    name: 'United States',
    postalLabel: 'ZIP code',
    postalPattern: /^\d{5}$/,
    postalExample: '10001',
    unit: 'mi',
    radiusOptions: [5, 10, 25, 50],
    defaultRadius: 10,
    minDaysBetweenDonations: 56,
  },
};

export const URGENCY = {
  now: 'Immediately (within 6 hours)',
  today: 'Within 24 hours',
  soon: 'Within 3 days',
  planned: 'Planned / scheduled',
};

export function isBloodGroup(value) {
  return BLOOD_GROUPS.includes(value);
}

export function donorGroupsFor(recipientGroup, includeCompatible) {
  return includeCompatible ? COMPATIBLE_DONORS[recipientGroup] : [recipientGroup];
}

/** Returns the normalized postal code, or null if it is not valid for the country. */
export function normalizePostalCode(country, raw) {
  const cfg = COUNTRIES[country];
  if (!cfg || typeof raw !== 'string') return null;
  let code = raw.replace(/\s+/g, '');
  if (country === 'US') code = code.replace(/-\d{4}$/, ''); // ZIP+4 -> ZIP
  return cfg.postalPattern.test(code) ? code : null;
}

/** Date (YYYY-MM-DD) from which the donor may donate again, or null if eligible now/unknown. */
export function nextEligibleDate(country, lastDonationDate, today = new Date()) {
  if (!lastDonationDate) return null;
  const next = new Date(`${lastDonationDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + COUNTRIES[country].minDaysBetweenDonations);
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return next > todayUtc ? next.toISOString().slice(0, 10) : null;
}

/** Latest last-donation date (YYYY-MM-DD) that still counts as eligible today. */
export function eligibilityCutoff(country, today = new Date()) {
  const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  cutoff.setUTCDate(cutoff.getUTCDate() - COUNTRIES[country].minDaysBetweenDonations);
  return cutoff.toISOString().slice(0, 10);
}
