'use strict';

const express = require('express');
const auth = require('../auth');
const { hashPassword } = require('../db');
const { wrap, str, bad, notFound } = require('../util');
const { publicUser } = require('../auth');

const router = express.Router();
router.use(auth.requireAuth);

const ROLES = ['admin', 'manager', 'cashier'];

router.get(
  '/',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const users = req.db.prepare('SELECT * FROM users ORDER BY username').all();
    res.json({ users: users.map(publicUser), roles: ROLES });
  })
);

router.post(
  '/',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const username = str(req.body?.username).toLowerCase();
    const password = str(req.body?.password);
    const role = str(req.body?.role) || 'cashier';

    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      throw bad('Username must be 3-32 characters: letters, numbers, dot, dash or underscore');
    }
    if (password.length < 6) throw bad('Password must be at least 6 characters');
    if (!ROLES.includes(role)) throw bad('Unknown role');
    if (req.db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      throw bad('That username is taken');
    }

    const info = req.db
      .prepare('INSERT INTO users (username, password_hash, full_name, role) VALUES (?, ?, ?, ?)')
      .run(username, hashPassword(password), str(req.body?.full_name), role);

    auth.log(req.db, req, 'user_create', `${username} (${role})`);
    const row = req.db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ user: publicUser(row) });
  })
);

router.put(
  '/:id',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw notFound('User not found');

    const role = str(req.body?.role) || existing.role;
    if (!ROLES.includes(role)) throw bad('Unknown role');
    const active = req.body?.active === undefined ? existing.active : req.body.active ? 1 : 0;

    // Never let the last usable admin lock everyone out of the Users page.
    if (existing.role === 'admin' && (role !== 'admin' || !active)) {
      const { c } = req.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id);
      if (c === 0) throw bad('This is the only active admin - promote someone else first');
    }

    req.db
      .prepare('UPDATE users SET full_name = ?, role = ?, active = ? WHERE id = ?')
      .run(str(req.body?.full_name), role, active, id);

    auth.log(req.db, req, 'user_update', `${existing.username} -> ${role}${active ? '' : ' (disabled)'}`);
    res.json({ user: publicUser(req.db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  })
);

router.post(
  '/:id/reset-password',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw notFound('User not found');

    const password = str(req.body?.password);
    if (password.length < 6) throw bad('Password must be at least 6 characters');

    auth.setPassword(req.db, id, password);
    auth.log(req.db, req, 'user_reset_password', existing.username);
    res.json({ ok: true });
  })
);

router.delete(
  '/:id',
  auth.requireRole('admin'),
  wrap((req, res) => {
    const id = Number(req.params.id);
    const existing = req.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw notFound('User not found');
    if (id === req.userId) throw bad('You cannot remove the account you are signed in with');

    if (existing.role === 'admin') {
      const { c } = req.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(id);
      if (c === 0) throw bad('This is the only active admin - promote someone else first');
    }

    // Sales and purchases reference users; disabling keeps the history intact.
    req.db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    auth.log(req.db, req, 'user_disable', existing.username);
    res.json({ ok: true });
  })
);

module.exports = router;