'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { open, DB_PATH } = require('./src/db');
const auth = require('./src/auth');

const PORT = Number(process.env.PORT) || 13000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.locals.db = open(DB_PATH);

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Every route handler reads the live connection from here, so the backup restore
// can swap it out without restarting.
app.use((req, _res, next) => {
  req.db = app.locals.db;
  next();
});

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

app.use(auth.attachUser);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'Cyber POS',
    version: require('./package.json').version,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/categories', require('./src/routes/categories'));
app.use('/api/customers', require('./src/routes/customers'));
app.use('/api/suppliers', require('./src/routes/suppliers'));
app.use('/api/sales', require('./src/routes/sales'));
app.use('/api/orders', require('./src/routes/orders'));
app.use('/api/purchases', require('./src/routes/purchases'));
app.use('/api/expenses', require('./src/routes/expenses'));
app.use('/api/stock', require('./src/routes/stock'));
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/dashboard', require('./src/routes/dashboard'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/activity', require('./src/routes/activity'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/backup', require('./src/routes/backup'));

app.use(
  express.static(path.join(__dirname, 'public'), {
    index: 'index.html',
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

// Unknown /api paths must not fall through to the SPA and return HTML.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API endpoint' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[cyber-pos]', err);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({
    error: isProd && status >= 500 ? 'Something went wrong on the server' : err.message,
    code: err.code || null,
  });
});

const server = app.listen(PORT, HOST, () => {
  const banner = [
    '',
    '  Cyber POS is running',
    `  Till screen:  http://localhost:${PORT}`,
    `  Other devices: http://<this-pc-ip>:${PORT}`,
    `  Database:    ${DB_PATH}`,
    '',
    '  Sign in with  admin / admin123  and change it straight away.',
    '',
  ].join('\n');
  console.log(banner);

  if (!fs.existsSync(DB_PATH)) {
    console.warn('  Database file was not found on disk.');
  }
});

function shutdown(signal) {
  console.log(`\n${signal} received - closing Cyber POS.`);
  server.close(() => {
    try {
      app.locals.db.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 4000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;