const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/server');

describe('Express API Server Endpoints', () => {
  let server;
  let baseUrl;

  test('starts server on random port', async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve();
      });
    });
    assert.ok(baseUrl);
  });

  test('GET /health returns 200 ok status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ok');
    assert.ok(data.timestamp);
  });

  test('GET /openapi.json returns valid OpenAPI spec', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    assert.equal(res.status, 200);
    const spec = await res.json();
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'Flock Energy — Urja Meter Ops API');
    assert.ok(spec.paths['/api/v1/meters']);
  });

  test('GET /api/v1/meters with invalid page parameter returns 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/meters?page=abc`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'Invalid page parameter');
  });

  test('teardown server', async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
