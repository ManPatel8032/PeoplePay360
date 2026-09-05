/**
 * One API client for the whole app.
 *
 * Auth model:
 *  - the access token lives in memory only (never localStorage — an XSS payload
 *    cannot read it back out after a reload)
 *  - the refresh token is an httpOnly cookie the browser sends on its own
 *  - a 401 triggers exactly one transparent refresh + retry; if that fails the
 *    app is told to log out. Pages never handle 401 themselves.
 */

let accessToken = null;
let onUnauthorized = null;

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;

/** AuthProvider registers a callback so a dead session can bounce to /login. */
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

/** Endpoints that must never trigger the refresh-and-retry loop. */
const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

let refreshInFlight = null;

/** Refresh once even if several requests 401 at the same moment. */
function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('refresh failed');
        const json = await res.json();
        accessToken = json.accessToken;
        return accessToken;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function send(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function request(method, path, body) {
  let res = await send(method, path, body);

  if (res.status === 401 && !NO_RETRY.includes(path)) {
    try {
      await refreshAccessToken();
      res = await send(method, path, body);
    } catch {
      accessToken = null;
      onUnauthorized?.();
      const err = new Error('Your session has expired. Please log in again.');
      err.status = 401;
      throw err;
    }
  }

  if (res.status === 204) return null;

  const json = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.fields = json.fields;
    err.blockers = json.blockers;
    if (res.status === 401 && !NO_RETRY.includes(path)) {
      accessToken = null;
      onUnauthorized?.();
    }
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

/**
 * Authenticated file download. The PDF route is opened as a blob rather than a
 * plain link because a browser navigation would not carry the Bearer header.
 */
export async function downloadFile(path) {
  let res = await fetch(`/api${path}`, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    await refreshAccessToken();
    res = await fetch(`/api${path}`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      credentials: 'same-origin',
    });
  }
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

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
