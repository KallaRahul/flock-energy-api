/**
 * Application entry point.
 *
 * Wires together:
 *   - Express server with JSON body parsing and CORS
 *   - Swagger UI at /docs
 *   - REST API routes at /api/v1/*
 *   - Global error handler
 */
const express = require('express');
const cors = require('cors');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const UrjaPortalClient = require('./client');
const createRouter = require('./routes');

const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());

// ── Portal client (shared singleton) ──
const portalClient = new UrjaPortalClient({
  baseUrl: config.portal.url,
  email: config.portal.email,
  password: config.portal.password,
});

// ── Swagger / OpenAPI docs ──
const openapiSpec = require(path.join(__dirname, '..', 'openapi.json'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
  customSiteTitle: 'Flock Energy — Urja API Docs',
}));
app.get('/openapi.json', (_req, res) => res.json(openapiSpec));

// ── Health check ──
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
);

// ── API routes ──
app.use('/api/v1', createRouter(portalClient));

// ── Root redirect to docs ──
app.get('/', (_req, res) => res.redirect('/docs'));

// ── Global error handler ──
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  const status = err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

// ── Start server ──
app.listen(config.port, () => {
  console.log(`\n  🔌 Flock Energy — Urja Meter API`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  API:    http://localhost:${config.port}/api/v1`);
  console.log(`  Docs:   http://localhost:${config.port}/docs`);
  console.log(`  Spec:   http://localhost:${config.port}/openapi.json`);
  console.log(`  Health: http://localhost:${config.port}/health`);
  console.log(`  ─────────────────────────────────\n`);
});

module.exports = app;
