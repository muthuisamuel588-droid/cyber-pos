'use strict';

const express = require('express');
const auth = require('../auth');
const { wrap, int } = require('../util');

const router = express.Router();
router.use(auth.requireAuth, auth.requireRole('admin'));

router.get(
  '/',
  wrap((req, res) => {
    const limit = Math.min(int(req.query.limit, 300), 1000);
    const activity = req.db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(limit);
    res.json({ activity });
  })
);

module.exports = router;