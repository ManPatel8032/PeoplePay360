/**
 * One API client for the whole app. Every request carries the demo user id so
 * the server can enforce the role matrix.
 */
const USER_KEY = 'pp360.userId';

export const getUserId = () => Number(localStorage.getItem(USER_KEY)) || 1;
export const setUserId = (id) => localStorage.setItem(USER_KEY, String(id));

async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': String(getUserId()) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = json.fields;
    err.blockers = json.blockers;
    throw err;
  }
  return json.data !== undefined ? json.data : json;
}

export const api = {
  get:   (p) => request('GET', p),
  post:  (p, b) => request('POST', p, b ?? {}),
  patch: (p, b) => request('PATCH', p, b),
  del:   (p) => request('DELETE', p),
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const money = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

export const moneyExact = (n) =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
