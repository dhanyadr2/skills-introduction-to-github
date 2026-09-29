import { api, formatDateTime, h, notice, STATUS_LABEL, tokenFromHash } from './common.js';

const message = document.getElementById('message');
const fact = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : []);

try {
  const r = await api('/api/requests/status', { headers: { 'x-request-token': tokenFromHash() ?? '' } });
  document.getElementById('headline').textContent = `${STATUS_LABEL[r.status]} — ${r.donor.name} (${r.donor.bloodGroup})`;
  document.getElementById('facts').replaceChildren(
    ...fact("Patient's blood group", r.bloodGroup),
    ...fact('Units', String(r.units)),
    ...fact('Needed', r.urgency),
    ...fact('Hospital / location', r.hospital),
    ...fact('Sent', formatDateTime(r.createdAt)),
    ...fact('Answered', formatDateTime(r.respondedAt)),
  );
  const next = document.getElementById('next');
  if (r.status === 'accepted') {
    next.replaceChildren(
      h('div', { class: 'notice ok' },
        h('strong', {}, `Contact ${r.donor.name} now: `),
        r.donor.phone ? h('a', { href: `tel:${r.donor.phone.replace(/[^\d+]/g, '')}` }, r.donor.phone) : 'no phone given',
        ' · ',
        h('a', { href: `mailto:${r.donor.email}` }, r.donor.email),
      ),
    );
  } else if (r.status === 'pending') {
    notice(next, 'warn', "The donor hasn't responded yet. For urgent needs, also contact other donors and nearby blood banks.");
  } else {
    next.replaceChildren(
      h('div', { class: 'notice warn' }, 'This donor is not able to help. ', h('a', { href: '/' }, 'Search for other donors'), '.'),
    );
  }
  document.getElementById('request').hidden = false;
} catch (err) {
  notice(message, 'error', err.message);
}
