const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const UrjaPortalClient = require('../src/client');

describe('UrjaPortalClient Unit Tests', () => {
  const client = new UrjaPortalClient({
    baseUrl: 'https://urja-ops.flockenergy.tech',
    email: 'test@example.com',
    password: 'password',
  });

  describe('Cookie Parsing & Store', () => {
    test('captures and formats Set-Cookie headers correctly', () => {
      const mockResponse = {
        headers: {
          'set-cookie': [
            '__Secure-better-auth.session_token=token123; Path=/; Secure; HttpOnly',
            'another_cookie=value456; Path=/',
          ],
        },
      };
      client._captureCookies(mockResponse);
      assert.equal(client.cookieStore['__Secure-better-auth.session_token'], 'token123');
      assert.equal(client.cookieStore['another_cookie'], 'value456');
      assert.ok(client.cookies.includes('__Secure-better-auth.session_token=token123'));
      assert.ok(client.cookies.includes('another_cookie=value456'));
    });
  });

  describe('Timestamp Conversion', () => {
    test('converts IST DD/MM/YYYY HH:mm to ISO 8601 offset format', () => {
      const result = client._toIsoTimestamp('23/06/2026 23:30');
      assert.equal(result, '2026-06-23T23:30:00+05:30');
    });

    test('returns null for invalid or empty timestamps', () => {
      assert.equal(client._toIsoTimestamp(''), null);
      assert.equal(client._toIsoTimestamp(null), null);
      assert.equal(client._toIsoTimestamp('invalid-date'), null);
    });
  });

  describe('SvelteKit Positional Dehydrated Data Parsing', () => {
    test('parses Format A (classData JSON string)', () => {
      const mockNode = {
        data: [
          { meterId: 1, detail: 2, hierarchy: 3 }, // shape descriptor index 0
          'J100020', // index 1: meterId
          {
            classData: JSON.stringify({
              installed_meter: {
                'Meter ID': 'J100020',
                'Serial No': 'AL20290',
                'Make': 'Genus',
                'Phase Type': 'three',
                'Installation Status': 'Installed',
              },
            }),
          }, // index 2: detailObj
          {
            'Zone': 4,
            'Circle': 5,
          }, // index 3: hierarchyObj
          'Jaipur Zone 3 (Z-03)', // index 4
          'Circle 3 (C-03)', // index 5
        ],
      };

      const result = client._parseMeterNode('J100020', mockNode);
      assert.equal(result.meterId, 'J100020');
      assert.equal(result.nameplate['Meter ID'], 'J100020');
      assert.equal(result.nameplate['Make'], 'Genus');
      assert.equal(result.nameplate['Phase Type'], 'three');
      assert.equal(result.hierarchy['Zone'], 'Jaipur Zone 3 (Z-03)');
      assert.equal(result.hierarchy['Circle'], 'Circle 3 (C-03)');
    });

    test('parses Format B (indexed data array)', () => {
      const mockNode = {
        data: [
          { meterId: 1, detail: 2, hierarchy: 3 }, // index 0 shape
          'J100001', // index 1
          { data: [4, 5] }, // index 2 detailObj with indices 4 and 5
          { 'Zone': 6 }, // index 3 hierarchy
          { parameterName: 7, parameterValue: 1 }, // index 4 item 1
          { parameterName: 8, parameterValue: 9 }, // index 5 item 2
          'Jaipur Zone 2 (Z-02)', // index 6
          'Meter ID', // index 7
          'Make', // index 8
          'L&T', // index 9
        ],
      };

      const result = client._parseMeterNode('J100001', mockNode);
      assert.equal(result.meterId, 'J100001');
      assert.equal(result.nameplate['Meter ID'], 'J100001');
      assert.equal(result.nameplate['Make'], 'L&T');
      assert.equal(result.hierarchy['Zone'], 'Jaipur Zone 2 (Z-02)');
    });

    test('returns empty objects gracefully when rawData is invalid', () => {
      const result = client._parseMeterNode('INVALID', { data: null });
      assert.equal(result.meterId, 'INVALID');
      assert.deepEqual(result.nameplate, {});
      assert.deepEqual(result.hierarchy, {});
    });
  });
});
