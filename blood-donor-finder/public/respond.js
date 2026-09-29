import { api, formatDateTime, h, notice, STATUS_LABEL, tokenFromHash } from './common.js';

const headers = { 'x-request-token': tokenFromHash() ?? '' };
const message = document.getElementById('message');
const actions = document.getElementById('actions');
const outcome = document.getElementById('outcome');

const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : []);

function render(r) {
  document.getElementById('intro').textContent = `Hi ${r.donorName}, ${r.seekerName} is looking for blood and asked if you can help.`;
  document.getElementById('facts').replaceChildren(
    ...fact("Patient's blood group", r.bloodGroup),
    ...fact('Units needed', String(r.units)),
    ...fact('Needed', r.urgency),
    ...fact('Hospital / location', r.hospital),
    ...fact('Message', r.message),
    ...fact('Requested', formatDateTime(r.createdAt)),
    ...fact('Status', STATUS_LABEL[r.status]),
  );
  actions.hidden = r.status !== 'pending';
  if (r.status === 'accepted' && r.seekerContact) {
    outcome.replaceChildren(
      h('div', { class: 'notice ok' },
        h('strong', {}, `Thank you! Contact ${r.seekerName}: `),
        h('a', { href: `tel:${r.seekerContact.phone.replace(/[^\d+]/g, '')}` }, r.seekerContact.phone),
        ' · ',
        h('a', { href: `mailto:${r.seekerContact.email}` }, r.seekerContact.email),
      ),
    );
  } else if (r.status !== 'pending') {
    notice(outcome, 'warn', `This request is ${STATUS_LABEL[r.status].toLowerCase()}.`);
  }
  document.getElementById('request').hidden = false;
}

async function load() {
  render(await api('/api/requests/respond', { headers }));
}

async function respond(action) {
  for (const b of actions.querySelectorAll('button')) b.disabled = true;
  try {
    await api('/api/requests/respond', { method: 'POST', headers, body: { action } });
    await load();
  } catch (err) {
    notice(message, 'error', err.message);
    for (const b of actions.querySelectorAll('button')) b.disabled = false;
  }
}

document.getElementById('accept').addEventListener('click', () => respond('accept'));
document.getElementById('decline').addEventListener('click', () => respond('decline'));

try {
  await load();
} catch (err) {
  notice(message, 'error', err.message);
}
