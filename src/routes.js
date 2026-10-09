/**
 * API Routes — Clean REST endpoints exposed to downstream consumers.
 *
 * All routes are prefixed with /api/v1 and return JSON.
 * Error responses follow a consistent { error: string } shape.
 */
const { Router } = require('express');

/**
 * Create the router bound to a shared UrjaPortalClient instance.
 * @param {import('./client')} portalClient
 * @returns {Router}
 */
function createRouter(portalClient) {
  const router = Router();

  // ───────── Auth / Session ─────────

  /**
   * POST /api/v1/auth/login
   * Explicitly trigger portal authentication.
   * The service authenticates automatically, but this lets callers
   * verify connectivity on demand.
   */
  router.post('/auth/login', async (req, res, next) => {
    try {
      const email = req.body?.email || req.body?.username || portalClient.email;
      const password = req.body?.password || portalClient.password;
      const ok = await portalClient.login(email, password);
      if (!ok) {
        return res.status(401).json({ error: 'Portal authentication failed' });
      }
      res.json({ message: 'Authenticated successfully', authenticated: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/auth/status
   * Check current session status.
   */
  router.get('/auth/status', async (_req, res, next) => {
    try {
      const status = await portalClient.getSessionStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  // ───────── Meters ─────────

  /**
   * GET /api/v1/meters
   * List / search meters.
   * Query params:
   *   q     - search term (meter ID or serial number)
   *   page  - page number (default 1, 20 items per page)
   */
  router.get('/meters', async (req, res, next) => {
    try {
      const { q = '', page = '1' } = req.query;
      const pageNum = parseInt(page, 10);
      if (isNaN(pageNum) || pageNum < 1) {
        return res.status(400).json({ error: 'Invalid page parameter' });
      }
      const result = await portalClient.searchMeters(q, pageNum);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * GET /api/v1/meters/:id
   * Get detailed information for a specific meter, including nameplate
   * data and network hierarchy placement.
   */
  router.get('/meters/:id', async (req, res, next) => {
    try {
      const detail = await portalClient.getMeterDetail(req.params.id);
      res.json(detail);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  });

  /**
   * GET /api/v1/meters/:id/location
   * Get geo-coordinates for a specific meter.
   */
  router.get('/meters/:id/location', async (req, res, next) => {
    try {
      const location = await portalClient.getMeterLocation(req.params.id);
      res.json({ meterId: req.params.id, location });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  });

  /**
   * GET /api/v1/meters/:id/consumption
   * Get energy consumption readings for a specific meter.
   * Returns timestamped kWh, kVAh, and voltage readings.
   */
  router.get('/meters/:id/consumption', async (req, res, next) => {
    try {
      const readings = await portalClient.getMeterConsumption(req.params.id);
      res.json({
        meterId: req.params.id,
        count: readings.length,
        readings,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message });
      }
      next(err);
    }
  });

  // ───────── Hierarchy (Optional Extension) ─────────

  /**
   * GET /api/v1/hierarchy
   * Reconstruct the network hierarchy tree:
   * Zone > Circle > Division > Subdivision > Sub Station > Feeder > DT > Meters
   *
   * ⚠ This endpoint is expensive — it fetches all meters and their details.
   * Consider caching in production.
   */
  router.get('/hierarchy', async (_req, res, next) => {
    try {
      const hierarchy = await portalClient.getHierarchy();
      res.json(hierarchy);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createRouter;
