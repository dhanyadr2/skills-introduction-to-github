import { api, h, loadMeta, notice, storage } from './common.js';

const form = document.getElementById('search');
const message = document.getElementById('message');
const results = document.getElementById('results');
const donorsEl = document.getElementById('donors');
const banksEl = document.getElementById('banks');
const dialog = document.getElementById('request-dialog');
const requestForm = document.getElementById('request-form');
const requestMessage = document.getElementById('request-message');

const meta = await loadMeta();
const countries = Object.fromEntries(meta.countries.map((c) => [c.code, c]));

form.country.append(...meta.countries.map((c) => h('option', { value: c.code }, c.name)));
form.bloodGroup.append(...meta.bloodGroups.map((g) => h('option', { value: g }, g)));
requestForm.bloodGroup.append(...meta.bloodGroups.map((g) => h('option', { value: g }, g)));
requestForm.urgency.append(...Object.entries(meta.urgency).map(([value, label]) => h('option', { value }, label)));

function applyCountry() {
  const c = countries[form.country.value];
  document.getElementById('postal-label').textContent = c.postalLabel;
  form.postalCode.placeholder = `e.g. ${c.postalExample}`;
  const current = Number(form.radius.value) || c.defaultRadius;
  form.radius.replaceChildren(
    ...c.radiusOptions.map((r) => h('option', { value: r, selected: r === current }, `${r} ${c.unit}`)),
  );
}

// Restore the last search (per browser) so repeat visits are one tap.
const saved = storage.get('lastSearch');
const params = new URLSearchParams(location.search);
form.country.value = params.get('country') || saved?.country || 'IN';
applyCountry();
form.postalCode.value = params.get('postalCode') || saved?.postalCode || '';
form.bloodGroup.value = params.get('bloodGroup') || saved?.bloodGroup || '';
if (saved?.radius) form.radius.value = saved.radius;
form.country.addEventListener('change', applyCountry);

// ----- tabs -----
const tabs = { donors: document.getElementById('tab-donors'), banks: document.getElementById('tab-banks') };
function selectTab(name) {
  for (const [key, tab] of Object.entries(tabs)) {
    tab.setAttribute('aria-selected', String(key === name));
    document.getElementById(key).hidden = key !== name;
  }
}
tabs.donors.addEventListener('click', () => selectTab('donors'));
tabs.banks.addEventListener('click', () => selectTab('banks'));

// ----- search -----
let lastResult = null;

async function search() {
  const query = {
    country: form.country.value,
    postalCode: form.postalCode.value.trim(),
    bloodGroup: form.bloodGroup.value,
    radius: form.radius.value,
    compatible: form.compatible.checked ? '1' : '0',
  };
  if (!query.postalCode) {
    notice(message, 'error', `Enter a ${countries[query.country].postalLabel}.`);
    return;
  }
  storage.set('lastSearch', query);
  history.replaceState(null, '', `?${new URLSearchParams({ country: query.country, postalCode: query.postalCode, bloodGroup: query.bloodGroup })}`);
  notice(message, 'ok', 'Searching…');
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    lastResult = await api(`/api/search?${new URLSearchParams(query)}`);
    notice(message, null, '');
    render(lastResult);
  } catch (err) {
    results.hidden = true;
    notice(message, 'error', err.message);
  } finally {
    button.disabled = false;
  }
}

function render(r) {
  const where = [r.origin.place, r.origin.state].filter(Boolean).join(', ');
  document.getElementById('summary').textContent =
    `Within ${r.radius} ${r.unit} of ${r.origin.postalCode} (${where})` +
    (r.bloodGroup ? ` · ${r.bloodGroup}${r.includeCompatible ? ' and compatible groups' : ' only'}` : '');
  tabs.donors.textContent = `Donors (${r.donors.length})`;
  tabs.banks.textContent = `Blood banks (${r.banks.length})`;

  donorsEl.replaceChildren(
    ...(r.donors.length
      ? r.donors.map((d) =>
          h('article', { class: 'card row between' },
            h('div', { class: 'row' },
              h('span', { class: 'badge' }, d.bloodGroup),
              h('div', {},
                h('h3', {}, d.name),
                h('div', { class: 'muted small' }, `${d.place ?? ''} · about ${d.distance} ${r.unit} away`),
                h('div', { class: 'row small', style: 'margin-top:4px;gap:6px' },
                  r.bloodGroup && !d.exactMatch ? h('span', { class: 'pill' }, `Compatible with ${r.bloodGroup}`) : null,
                  d.isSample ? h('span', { class: 'pill' }, 'Demo data') : null,
                ),
              ),
            ),
            h('button', { type: 'button', onclick: () => openRequest(d) }, 'Request contact'),
          ),
        )
      : [emptyState('No available donors found.', 'Try a larger distance, include compatible groups, or check the blood banks tab.')]),
  );

  banksEl.replaceChildren(
    ...(r.banks.length
      ? r.banks.map((b) =>
          h('article', { class: 'card' },
            h('div', { class: 'row between' },
              h('h3', {}, b.name),
              h('span', { class: 'muted small' }, `${b.distance} ${r.unit}`),
            ),
            h('div', { class: 'muted small' }, [b.address, b.city, b.state, b.postalCode].filter(Boolean).join(', ')),
            h('div', { class: 'row small', style: 'margin-top:6px' },
              b.phone ? h('a', { href: `tel:${b.phone.replace(/[^\d+]/g, '')}` }, `Call ${b.phone}`) : null,
              b.website ? h('a', { href: b.website, target: '_blank', rel: 'noopener' }, 'Website') : null,
              b.isSample ? h('span', { class: 'pill' }, 'Demo data') : null,
            ),
            b.stock
              ? h('div', {},
                  h('div', { class: 'stock' },
                    ...Object.entries(b.stock).map(([g, units]) =>
                      h('span', { class: [g === r.bloodGroup ? 'hl' : '', units ? '' : 'zero'].join(' ').trim() }, `${g}: ${units}`),
                    ),
                  ),
                  h('div', { class: 'muted small', style: 'margin-top:4px' }, `Stock (units) reported ${new Date(b.stockUpdatedAt).toLocaleString()} — call to confirm.`),
                )
              : h('div', { class: 'muted small', style: 'margin-top:6px' }, 'Stock not published — call to check availability.'),
          ),
        )
      : [emptyState('No blood banks found in this area.', 'Try a larger distance.')]),
  );

  results.hidden = false;
  selectTab(r.donors.length || !r.banks.length ? 'donors' : 'banks');
}

const emptyState = (title, hint) => h('div', { class: 'card' }, h('h3', {}, title), h('p', { class: 'muted small' }, hint));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  search();
});
if (form.postalCode.value && params.has('postalCode')) search();

// ----- request dialog -----
let activeDonor = null;
const savedSeeker = storage.get('seeker') ?? {};

function openRequest(donor) {
  activeDonor = donor;
  document.getElementById('request-title').textContent = `Request contact from ${donor.name}`;
  document.getElementById('request-sub').textContent = `${donor.bloodGroup} donor · ${donor.place ?? ''}`;
  for (const key of ['seekerName', 'seekerEmail', 'seekerPhone', 'hospital']) {
    if (savedSeeker[key] && !requestForm[key].value) requestForm[key].value = savedSeeker[key];
  }
  requestForm.bloodGroup.value = lastResult?.bloodGroup || donor.bloodGroup;
  notice(requestMessage, null, '');
  document.getElementById('request-submit').disabled = false;
  dialog.showModal();
}

document.getElementById('request-cancel').addEventListener('click', () => dialog.close());

requestForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = requestForm;
  const body = {
    donorId: activeDonor.id,
    seekerName: f.seekerName.value,
    seekerEmail: f.seekerEmail.value,
    seekerPhone: f.seekerPhone.value,
    bloodGroup: f.bloodGroup.value,
    units: Number(f.units.value),
    urgency: f.urgency.value,
    hospital: f.hospital.value,
    message: f.message.value,
  };
  const submit = document.getElementById('request-submit');
  submit.disabled = true;
  try {
    const res = await api('/api/requests', { method: 'POST', body });
    storage.set('seeker', { seekerName: body.seekerName, seekerEmail: body.seekerEmail, seekerPhone: body.seekerPhone, hospital: body.hospital });
    notice(requestMessage, 'ok', res.message);
    f.message.value = '';
    setTimeout(() => dialog.close(), 2500);
  } catch (err) {
    notice(requestMessage, 'error', err.message);
    submit.disabled = false;
  }
});
