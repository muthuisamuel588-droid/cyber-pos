'use strict';

const crypto = require('crypto');
const { hashPassword } = require('./db');
const { forbidden, str } = require('./util');

// Sessions live in memory only: closing the POS logs everyone out and nothing
// about a session is ever written to disk.
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(digest, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

function login(db, username, password) {
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .get(str(username).toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, username: user.username, role: user.role, seen: Date.now() });
  return { token, user: publicUser(user) };
}

function logout(token) {
  sessions.delete(token);
}

function userForToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.seen > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  session.seen = Date.now();
  return session;
}

function publicUser(row) {
  return { id: row.id, username: row.username, fullName: row.full_name, role: row.role, active: !!row.active };
}

function readToken(req) {
  const header = req.get('authorization') || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return str(req.query.token) || null;
}

/** Populates req.user / req.session when a valid token is present. Never rejects. */
function attachUser(req, _res, next) {
  const token = readToken(req);
  req.token = token;
  const session = userForToken(token);
  if (session) {
    req.user = session;
    req.userId = session.userId;
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(forbidden('Please sign in'));
  return next();
}

/** Gate a route by role. `requireRole('admin')` or requireRole('admin', 'manager'). */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(forbidden('Please sign in'));
    if (!roles.includes(req.user.role)) return next(forbidden('Your role cannot do that'));
    return next();
  };
}

function setPassword(db, userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

/** Records an audit row. `actor` is anything carrying { userId, username } - usually req. */
function log(db, actor, action, detail) {
  db.prepare(
    'INSERT INTO activity_log (user_id, user_name, action, detail) VALUES (?, ?, ?, ?)'
  ).run(actor?.userId ?? null, actor?.username ?? null, str(action), detail ? str(detail).slice(0, 500) : null);
}

module.exports = {
  login,
  logout,
  attachUser,
  requireAuth,
  requireRole,
  verifyPassword,
  setPassword,
  publicUser,
  log,
};