/**
 * Configuration module
 * Loads environment variables and provides defaults.
 */
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  portal: {
    url: process.env.PORTAL_URL || 'https://urja-ops.flockenergy.tech',
    email: process.env.PORTAL_EMAIL || 'operator@urja.local',
    password: process.env.PORTAL_PASSWORD || 'urja-ops-2026',
  },
};

module.exports = config;
