// Thin fetch wrapper: attaches the token, unwraps JSON, and turns API errors
// into thrown Errors carrying the server's message so views can show it as-is.

let token = localStorage.getItem('cyberpos_token') || null;

export function getToken() {
  return token;
}

export function setToken(value) {
  token = value;
  if (value) localStorage.setItem('cyberpos_token', value);
  else localStorage.removeItem('cyberpos_token');
}

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the POS server - is it still running?', 0, 'NETWORK');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    if (res.status === 403 && data?.error === 'Please sign in') onUnauthorized();
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.code);
  }
  return data;
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body ?? {}),
  put: (path, body) => request('PUT', path, body ?? {}),
  del: (path) => request('DELETE', path),
};

/** Builds a query string, dropping empty values. */
export function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}