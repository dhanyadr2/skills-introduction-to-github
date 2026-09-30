import { importBankRows } from '../bank-import.js';

// Pulls India's blood bank directory from the Open Government Data platform (data.gov.in) API.
// Needs a free API key (sign in at data.gov.in -> My Account) and the dataset's resource ID
// (open the dataset on data.gov.in; its API link looks like api.data.gov.in/resource/<resource-id>).
const PAGE_SIZE = 500;
const MAX_ROWS = 50_000;
export const SOURCE = 'data.gov.in';

export async function fetchDataGovInRecords({ apiKey, resourceId, fetchImpl = fetch }) {
  const records = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const url = new URL(`https://api.data.gov.in/resource/${encodeURIComponent(resourceId)}`);
    url.search = new URLSearchParams({ 'api-key': apiKey, format: 'json', limit: PAGE_SIZE, offset }).toString();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`data.gov.in responded ${res.status}${res.status === 403 ? ' (check the API key)' : ''}`);
    const body = await res.json();
    const page = body.records ?? [];
    records.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return records;
}

/** Replaces all data.gov.in blood banks with a fresh copy. Keeps the old copy if the API returns nothing. */
export async function syncDataGovIn(db, options) {
  const records = await fetchDataGovInRecords(options);
  if (!records.length) throw new Error('data.gov.in returned no records (check the resource ID)');
  const { imported, skipped } = importBankRows(db, records, { country: 'IN', source: SOURCE, replace: true });
  return { fetched: records.length, imported, skipped: skipped.length, sampleFields: Object.keys(records[0]) };
}
