import { api, h, notice, tokenFromHash } from './common.js';

const message = document.getElementById('message');
try {
  await api('/api/donors/verify', { method: 'POST', body: { token: tokenFromHash() } });
  message.replaceChildren(
    h('div', { class: 'notice ok', role: 'status' }, 'Thank you! Your email is confirmed and you now appear in donor search.'),
    h('p', { class: 'small muted' }, 'Use the manage link from the same email to pause your profile or update your last donation date.'),
  );
} catch (err) {
  notice(message, 'error', err.message);
}
