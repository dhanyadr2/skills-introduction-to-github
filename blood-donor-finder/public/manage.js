import { api, formatDate, formatDateTime, h, loadMeta, notice, STATUS_LABEL, tokenFromHash } from './common.js';

const token = tokenFromHash();
const headers = { 'x-manage-token': token ?? '' };
const message = document.getElementById('message');
const form = document.getElementById('edit');
const editMessage = document.getElementById('edit-message');
const meta = await loadMeta();
const countries = Object.fromEntries(meta.countries.map((c) => [c.code, c]));
form.bloodGroup.append(...meta.bloodGroups.map((g) => h('option', { value: g }, g)));
form.lastDonationDate.max = new Date().toISOString().slice(0, 10);

let profile;

function render(p) {
  profile = p;
  const c = countries[p.country];
  const eligible = !p.nextEligibleDate;
  const visible = p.verified && p.available && eligible;
  document.getElementById('availability-title').textContent = visible ? 'You are visible in search' : 'You are hidden from search';
  document.getElementById('availability-text').textContent = !p.verified
    ? 'Confirm your email using the link we sent to appear in search.'
    : !p.available
      ? 'Your profile is paused.'
      : !eligible
        ? `You can donate again from ${formatDate(p.nextEligibleDate)} and will reappear automatically.`
        : `${p.bloodGroup} donor near ${p.place ?? p.postalCode}.`;
  document.getElementById('toggle-available').textContent = p.available ? 'Pause' : 'Resume';
  document.getElementById('toggle-available').className = p.available ? 'secondary' : '';

  document.getElementById('email-line').textContent = `Email: ${p.email} · ${c.name}`;
  document.getElementById('postal-label').textContent = c.postalLabel;
  form.name.value = p.name;
  form.phone.value = p.phone ?? '';
  form.bloodGroup.value = p.bloodGroup;
  form.postalCode.value = p.postalCode;
  form.lastDonationDate.value = p.lastDonationDate ?? '';

  document.getElementById('requests').replaceChildren(
    ...(p.requests.length
      ? p.requests.map((r) =>
          h('article', { class: 'card' },
            h('div', { class: 'row between' }, h('h3', {}, `${r.bloodGroup} · ${r.seekerName}`), h('span', { class: 'pill' }, STATUS_LABEL[r.status])),
            h('div', { class: 'muted small' }, `${r.hospital} · ${r.units} unit(s) · ${r.urgency} · ${formatDateTime(r.createdAt)}`),
          ),
        )
      : [h('p', { class: 'muted' }, 'No requests yet.')]),
  );
  document.getElementById('profile').hidden = false;
}

async function update(body) {
  render(await api('/api/donors/me', { method: 'PATCH', headers, body }));
}

try {
  render(await api('/api/donors/me', { headers }));
} catch (err) {
  message.replaceChildren(
    h('div', { class: 'notice error', role: 'alert' }, err.message),
    h('p', {}, h('a', { href: '/register.html' }, 'Request a new manage link')),
  );
}

document.getElementById('toggle-available').addEventListener('click', async () => {
  try {
    await update({ available: !profile.available });
    notice(message, 'ok', profile.available ? 'Welcome back — your profile is active.' : 'Your profile is paused.');
  } catch (err) {
    notice(message, 'error', err.message);
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await update({
      name: form.name.value,
      phone: form.phone.value,
      bloodGroup: form.bloodGroup.value,
      postalCode: form.postalCode.value,
      lastDonationDate: form.lastDonationDate.value || null,
    });
    notice(editMessage, 'ok', 'Saved.');
  } catch (err) {
    notice(editMessage, 'error', err.message);
  }
});

document.getElementById('delete').addEventListener('click', async () => {
  if (!confirm('Delete your donor profile permanently?')) return;
  try {
    await api('/api/donors/me', { method: 'DELETE', headers });
    document.getElementById('profile').hidden = true;
    notice(message, 'ok', 'Your profile has been deleted. Thank you for being a donor.');
  } catch (err) {
    notice(message, 'error', err.message);
  }
});
