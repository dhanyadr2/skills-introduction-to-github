import { api, h, loadMeta, notice } from './common.js';

const form = document.getElementById('register');
const message = document.getElementById('message');
const meta = await loadMeta();
const countries = Object.fromEntries(meta.countries.map((c) => [c.code, c]));

form.bloodGroup.append(...meta.bloodGroups.map((g) => h('option', { value: g }, g)));
form.country.append(...meta.countries.map((c) => h('option', { value: c.code }, c.name)));
form.lastDonationDate.max = new Date().toISOString().slice(0, 10);

function applyCountry() {
  const c = countries[form.country.value];
  document.getElementById('postal-label').textContent = c.postalLabel;
  form.postalCode.placeholder = `e.g. ${c.postalExample}`;
  document.getElementById('eligibility-hint').textContent =
    `You'll be hidden from search for ${c.minDaysBetweenDonations} days after a donation.`;
}
form.country.addEventListener('change', applyCountry);
applyCountry();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const res = await api('/api/donors', {
      method: 'POST',
      body: {
        name: form.name.value,
        email: form.email.value,
        phone: form.phone.value,
        bloodGroup: form.bloodGroup.value,
        country: form.country.value,
        postalCode: form.postalCode.value,
        lastDonationDate: form.lastDonationDate.value || null,
        consent: form.consent.checked,
      },
    });
    form.reset();
    applyCountry();
    notice(message, 'ok', `${res.message} You'll appear in search after confirming.`);
  } catch (err) {
    notice(message, 'error', err.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('resend').addEventListener('click', async (e) => {
  e.preventDefault();
  const email = form.email.value || prompt('Your registered email:');
  if (!email) return;
  try {
    const res = await api('/api/donors/manage-link', { method: 'POST', body: { email } });
    notice(message, 'ok', res.message);
  } catch (err) {
    notice(message, 'error', err.message);
  }
});
