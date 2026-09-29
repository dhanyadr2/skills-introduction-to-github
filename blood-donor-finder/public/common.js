// Shared helpers for every page.

const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" style="color:var(--accent)" d="M32 4C32 4 12 28 12 41a20 20 0 0 0 40 0C52 28 32 4 32 4Z"/><path fill="#fff" d="M29 30h6v8h8v6h-8v8h-6v-8h-8v-6h8z"/></svg>';

export function renderChrome() {
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<header class="site"><div class="container">
      <a class="brand" href="/">${LOGO}Blood Donor Finder</a>
      <nav><a href="/">Find donors</a><a href="/register.html">Become a donor</a></nav>
    </div></header>`,
  );
  document.querySelector('main').insertAdjacentHTML(
    'beforeend',
    `<footer class="site">In a medical emergency, contact your hospital or local emergency number first.
      Donor availability is self-reported; blood banks confirm stock by phone.
      Donors are shown by first name and approximate area only — contact details are shared only when a donor accepts a request.</footer>`,
  );
}

/** Tiny element builder: h('p', { class: 'muted' }, 'text', childNode). Strings are inserted as text. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

let metaPromise;
export const loadMeta = () => (metaPromise ??= api('/api/meta'));

/** Email links carry their secret in the URL fragment (#token=...) so it never reaches server logs. */
export function tokenFromHash() {
  return new URLSearchParams(location.hash.slice(1)).get('token');
}

export function notice(target, kind, message) {
  target.replaceChildren(message ? h('div', { class: `notice ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message) : '');
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');
export const formatDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

export const STATUS_LABEL = {
  pending: 'Waiting for donor',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired (no response)',
};

export const storage = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
  },
};

renderChrome();
