'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, str, bad } = require('../util');

const router = express.Router();

router.post(
  '/login',
  wrap((req, res) => {
    const db = req.db;
    const username = str(req.body?.username).toLowerCase();
    const password = str(req.body?.password);
    if (!username || !password) throw bad('Enter your username and password');

    const result = auth.login(db, username, password);
    if (!result) throw bad('Wrong username or password', 'BAD_CREDENTIALS');

    const { c: userCount } = db.prepare('SELECT COUNT(*) AS c FROM users WHERE active = 1').get();
    auth.log(db, { userId: result.user.id, username: result.user.username }, 'login', `signed in as ${username}`);
    res.json({ token: result.token, user: result.user, userCount });
  })
);

router.post(
  '/logout',
  auth.requireAuth,
  wrap((req, res) => {
    auth.log(req.db, req, 'logout', 'signed out');
    auth.logout(req.token);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  auth.requireAuth,
  wrap((req, res) => {
    const row = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!row) return res.status(401).json({ error: 'Session no longer valid' });
    res.json({ user: auth.publicUser(row), permissions: permissionsFor(row.role) });
  })
);

router.post(
  '/change-password',
  auth.requireAuth,
  wrap((req, res) => {
    const current = str(req.body?.current_password);
    const next = str(req.body?.new_password);
    if (next.length < 6) throw bad('New password must be at least 6 characters');

    const row = req.db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
    if (!auth.verifyPassword(current, row.password_hash)) throw bad('Your current password is wrong');
    if (current === next) throw bad('New password must be different');

    auth.setPassword(req.db, row.id, next);
    auth.log(req.db, req, 'password_change', 'changed own password');
    res.json({ ok: true });
  })
);

function permissionsFor(role) {
  return {
    canSell: true,
    canManageProducts: role === 'admin' || role === 'manager',
    canPurchase: role === 'admin' || role === 'manager',
    canManageExpenses: role === 'admin' || role === 'manager',
    canViewReports: role === 'admin' || role === 'manager',
    canVoidSales: role === 'admin' || role === 'manager',
    canManageUsers: role === 'admin',
    canBackup: role === 'admin',
    canChangeSettings: role === 'admin',
  };
}

module.exports = router;