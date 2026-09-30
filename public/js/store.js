// Shared app state: who is signed in, what they may do, and shop settings.

import { api, setToken, getToken } from './api.js';
import { setCurrency } from './ui.js';

export const state = {
  user: null,
  permissions: {},
  settings: {},
  cart: { lines: [], discount: 0, discountType: 'amount', paymentMethod: 'cash', customerId: null, customerName: '', note: '' },
};

export function can(permission) {
  return !!state.permissions[permission];
}

export function isManager() {
  return state.user?.role === 'admin' || state.user?.role === 'manager';
}

export async function loadSettings() {
  const { settings } = await api.get('/api/settings');
  state.settings = settings;
  setCurrency(settings.currency_symbol);
  return settings;
}

export async function signIn(username, password) {
  const result = await api.post('/api/auth/login', { username, password });
  setToken(result.token);
  state.user = result.user;
  await loadSettings();
  await refreshPermissions();
  return result;
}

export async function refreshPermissions() {
  const me = await api.get('/api/auth/me');
  state.user = me.user;
  state.permissions = me.permissions;
  return me;
}

export async function restoreSession() {
  if (!getToken()) return false;
  try {
    await refreshPermissions();
    await loadSettings();
    return true;
  } catch {
    setToken(null);
    state.user = null;
    return false;
  }
}

export async function signOut() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    /* the token is being thrown away anyway */
  }
  setToken(null);
  state.user = null;
  state.permissions = {};
}

export function taxRate() {
  return Number(state.settings.tax_rate) || 0;
}

export function storeName() {
  return state.settings.store_name || 'Cyber POS';
}