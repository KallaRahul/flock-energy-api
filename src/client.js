/**
 * Urja Portal Client — Adapter layer for the legacy portal.
 *
 * Handles:
 *   - Session persistence via __Secure-better-auth.session_token cookie
 *   - Auto-reauthentication on session expiry (302 redirect to /login)
 *   - Data normalisation from SvelteKit dehydrated format to clean JSON
 *
 * Discovery: The portal is a SvelteKit app. Server-rendered HTML pages embed
 * dehydrated data in inline <script> blocks; the client JS then fetches
 * additional data from internal `/portal/` JSON endpoints for geo, energy,
 * and search. We use these `/portal/` endpoints directly.
 */
const axios = require('axios');
const cheerio = require('cheerio');

class UrjaPortalClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl - Portal base URL
   * @param {string} opts.email   - Login email
   * @param {string} opts.password - Login password
   */
  constructor({ baseUrl, email, password }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.email = email;
    this.password = password;
    this.cookies = '';
    this.cookieStore = {};
    this.authenticated = false;

    this.http = axios.create({
      baseURL: this.baseUrl,
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 15000,
      headers: {
        'User-Agent':
          'UrjaApiWrapper/1.0 (Node.js; Flock Energy Take-Home)',
      },
    });
  }

  // ───────────── cookie helpers ─────────────

  /** Extract Set-Cookie headers and merge into our cookie store. */
  _captureCookies(response) {
    const sc = response.headers['set-cookie'];
    if (!sc) return;
    for (const c of sc) {
      const [nameVal] = c.split(';');
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx === -1) continue;
      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1);
      this.cookieStore[name] = value;
    }
    this.cookies = Object.entries(this.cookieStore)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** Make a request with current cookies, capturing any Set-Cookie. */
  async _request(method, path, opts = {}) {
    const headers = { ...opts.headers, Cookie: this.cookies };
    const response = await this.http.request({
      method,
      url: path,
      headers,
      ...opts,
    });
    this._captureCookies(response);
    return response;
  }

  // ───────────── authentication ─────────────

  /**
   * Log in to the portal.
   * The portal uses better-auth: POST /login with form-urlencoded
   * email + password. On success a __Secure-better-auth.session_token
   * cookie is set and the response is 200.
   *
   * @param {string} [email=this.email]
   * @param {string} [password=this.password]
   * @returns {Promise<boolean>} true if login succeeded
   */
  async login(email = this.email, password = this.password) {
    // GET login page first to pick up any initial cookies
    await this._request('GET', '/login');

    const body = new URLSearchParams();
    body.append('email', email);
    body.append('password', password);

    const resp = await this._request('POST', '/login', {
      data: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${this.baseUrl}/login`,
        Origin: this.baseUrl,
      },
    });

    const hasToken = !!this.cookieStore['__Secure-better-auth.session_token'];
    this.authenticated = hasToken;
    return hasToken;
  }

  /**
   * Ensure we have a valid session. If the session has expired or we
   * haven't authenticated yet, re-login using a shared promise lock
   * to avoid race conditions during concurrent requests.
   */
  async ensureAuth() {
    if (this.authenticated) return;

    if (this._loginPromise) {
      await this._loginPromise;
      return;
    }

    this._loginPromise = this.login().finally(() => {
      this._loginPromise = null;
    });

    const ok = await this._loginPromise;
    if (!ok) {
      const err = new Error('Portal authentication failed');
      err.statusCode = 401;
      throw err;
    }
  }

  /**
   * Make an authenticated GET request. If the portal responds with a
   * redirect to /login (session expired), re-authenticate and retry once.
   */
  async _authedGet(path) {
    await this.ensureAuth();

    let resp = await this._request('GET', path, { maxRedirects: 5 });

    // Detect session expiry: SvelteKit __data.json returns
    // { type: "redirect", location: "/login" } or the HTML response
    // redirects to /login.
    const isExpired =
      (resp.status === 302 &&
        (resp.headers.location || '').includes('/login')) ||
      (resp.status === 200 &&
        resp.data?.type === 'redirect' &&
        resp.data?.location === '/login');

    if (isExpired) {
      this.authenticated = false;
      await this.ensureAuth();
      resp = await this._request('GET', path, { maxRedirects: 5 });
    }

    return resp;
  }

  // ───────────── public data methods ─────────────

  /**
   * Search meters.
   * Portal endpoint: GET /portal/meters/search?q={query}&page={page}
   * Returns: { data: [{ meterId, serialNo, make, phaseType, installStatus, dtCode }] }
   *
   * @param {string} [query=''] - Search term (meter ID or serial)
   * @param {number} [page=1]   - Page number (20 items per page)
   * @returns {Promise<object>} { meters: [...], page, pageSize }
   */
  async searchMeters(query = '', page = 1) {
    const q = encodeURIComponent(query);
    const resp = await this._authedGet(
      `/portal/meters/search?q=${q}&page=${page}`
    );

    if (resp.status !== 200) {
      const err = new Error(`Search failed with status ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }

    const raw = resp.data;
    const meters = (raw.data || []).map((m) => ({
      meterId: m.meterId,
      meter_id: m.meterId,
      serialNo: m.serialNo,
      serial_number: m.serialNo,
      make: m.make,
      phaseType: m.phaseType,
      phase_type: m.phaseType,
      installStatus: m.installStatus,
      install_status: m.installStatus,
      status: m.installStatus,
      dtCode: m.dtCode,
      dt_code: m.dtCode,
    }));

    return {
      meters,
      page: parseInt(page, 10),
      pageSize: 20,
      count: meters.length,
    };
  }

  /**
   * Get detailed meter info including nameplate, network hierarchy, and location.
   * Portal endpoint: GET /meters/{id}/__data.json (SvelteKit data)
   *
   * The SvelteKit dehydration format encodes data as a positional array
   * where objects reference array indices. We parse both the "classData"
   * JSON variant and the "data" array variant.
   *
   * @param {string} meterId
   * @returns {Promise<object>} Normalised meter detail
   */
  async getMeterDetail(meterId) {
    const [detailResp, locationResult] = await Promise.allSettled([
      this._authedGet(`/meters/${meterId}/__data.json`),
      this.getMeterLocation(meterId),
    ]);

    if (detailResp.status !== 'fulfilled' || detailResp.value.status !== 200) {
      const status = detailResp.value?.status || 500;
      const err = new Error(`Meter detail request failed: ${status}`);
      err.statusCode = status;
      throw err;
    }

    const body = detailResp.value.data;

    // Find the meter data node (index 2 in nodes array)
    const meterNode = body?.nodes?.[2];
    if (!meterNode || meterNode.type === 'error') {
      const errMsg = meterNode?.error?.message || 'Meter not found';
      const err = new Error(errMsg);
      err.statusCode = meterNode?.status || 404;
      throw err;
    }

    const parsed = this._parseMeterNode(meterId, meterNode);
    const location =
      locationResult.status === 'fulfilled'
        ? locationResult.value.location
        : { latitude: null, longitude: null };

    const np = parsed.nameplate || {};
    const serialNumber =
      np['Serial No'] ||
      np['SerialNo'] ||
      np['serial_number'] ||
      np['serialNo'] ||
      'N/A';
    const status =
      np['Installation Status'] ||
      np['InstallationStatus'] ||
      np['status'] ||
      np['installStatus'] ||
      'UNKNOWN';
    const make = np['Make'] || np['make'] || 'N/A';
    const phaseType =
      np['Phase Type'] || np['PhaseType'] || np['phaseType'] || 'N/A';

    const hierarchy = parsed.hierarchy || {};
    const dtCode =
      hierarchy['DT'] ||
      hierarchy['dtCode'] ||
      hierarchy['dt_code'] ||
      'N/A';

    return {
      meterId,
      meter_id: meterId,
      serialNo: serialNumber,
      serial_number: serialNumber,
      make,
      phaseType,
      phase_type: phaseType,
      installStatus: status,
      install_status: status,
      status,
      dtCode,
      dt_code: dtCode,
      location,
      nameplate: np,
      hierarchy,
    };
  }

  /**
   * Parse SvelteKit dehydrated meter node into clean object.
   */
  _parseMeterNode(meterId, node) {
    const rawData = node.data;
    if (!rawData || !Array.isArray(rawData)) {
      return { meterId, nameplate: {}, hierarchy: {} };
    }

    // The first element is a shape descriptor: { meterId: idx, detail: idx, hierarchy: idx }
    const shape = rawData[0];

    // --- Nameplate ---
    let nameplate = {};
    const detailIdx = shape.detail;
    const detailObj = rawData[detailIdx];

    if (detailObj?.classData !== undefined) {
      let jsonStr = detailObj.classData;
      if (typeof jsonStr === 'number' && typeof rawData[jsonStr] === 'string') {
        jsonStr = rawData[jsonStr];
      }
      if (typeof jsonStr === 'string') {
        try {
          const parsed = JSON.parse(jsonStr);
          const rawNp = parsed.installed_meter || parsed;
          // Normalise keys
          for (const [k, v] of Object.entries(rawNp)) {
            nameplate[k] = v;
          }
        } catch {
          nameplate = { raw: jsonStr };
        }
      }
    } else if (detailObj?.data !== undefined) {
      // Format B: data is an array of indices or an index pointing to an array in rawData
      let indices = detailObj.data;
      if (typeof indices === 'number' && Array.isArray(rawData[indices])) {
        indices = rawData[indices];
      }
      if (Array.isArray(indices)) {
        for (const idx of indices) {
          const item = rawData[idx];
          if (item && typeof item === 'object') {
            let key = item.parameterName;
            if (typeof key === 'number' && typeof rawData[key] === 'string') {
              key = rawData[key];
            }
            let value = item.parameterValue;
            if (typeof value === 'number' && rawData[value] !== undefined) {
              value = rawData[value];
            }
            if (key) {
              nameplate[key] = value;
            }
          }
        }
      }
    }

    // --- Hierarchy ---
    const hierarchyIdx = shape.hierarchy;
    let hierarchy = {};
    const hierarchyObj = rawData[hierarchyIdx];

    if (hierarchyObj && typeof hierarchyObj === 'object') {
      for (const [key, valOrIdx] of Object.entries(hierarchyObj)) {
        if (typeof valOrIdx === 'number' && rawData[valOrIdx] !== undefined) {
          hierarchy[key] = rawData[valOrIdx];
        } else {
          hierarchy[key] = valOrIdx;
        }
      }
    }

    return {
      meterId: rawData[shape.meterId] || meterId,
      nameplate,
      hierarchy,
    };
  }

  /**
   * Get meter geo-location.
   * Portal endpoint: GET /portal/meters/{id}/geo
   * Returns: { data: { latitude, longitude } }
   *
   * @param {string} meterId
   * @returns {Promise<object>} { latitude: number, longitude: number }
   */
  async getMeterLocation(meterId) {
    const resp = await this._authedGet(`/portal/meters/${meterId}/geo`);
    if (resp.status !== 200) {
      const err = new Error(`Geo request failed: ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }
    const raw = resp.data?.data || {};
    const lat = parseFloat(raw.latitude) || null;
    const lng = parseFloat(raw.longitude) || null;
    return {
      meterId,
      meter_id: meterId,
      location: {
        latitude: lat,
        longitude: lng,
      },
      latitude: lat,
      longitude: lng,
    };
  }

  /**
   * Convert DD/MM/YYYY HH:mm IST timestamp to ISO 8601 string.
   */
  _toIsoTimestamp(tsStr) {
    if (!tsStr) return null;
    const match = tsStr.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!match) return null;
    const [, day, month, year, hours, minutes] = match;
    return `${year}-${month}-${day}T${hours}:${minutes}:00+05:30`;
  }

  /**
   * Get meter consumption / energy readings.
   * Portal endpoint: GET /portal/meters/{id}/energy
   * Returns: { data: [{ timestamp, kwh, kvah, voltR }] }
   *
   * @param {string} meterId
   * @returns {Promise<object[]>} Array of readings with numeric types and ISO timestamps
   */
  async getMeterConsumption(meterId) {
    const resp = await this._authedGet(`/portal/meters/${meterId}/energy`);
    if (resp.status !== 200) {
      const err = new Error(`Energy request failed: ${resp.status}`);
      err.statusCode = resp.status;
      throw err;
    }
    const raw = resp.data?.data || [];
    return raw.map((r) => {
      const iso = this._toIsoTimestamp(r.timestamp);
      return {
        timestamp: r.timestamp || null,
        isoTimestamp: iso,
        iso_timestamp: iso,
        kwh: r.kwh ? parseFloat(r.kwh) : null,
        kvah: r.kvah ? parseFloat(r.kvah) : null,
        voltR: r.voltR ? parseFloat(r.voltR) : null,
        volt_r: r.voltR ? parseFloat(r.voltR) : null,
      };
    });
  }

  /**
   * Get the session status.
   * @returns {Promise<object>} { authenticated, user }
   */
  async getSessionStatus() {
    try {
      await this.ensureAuth();
      // Fetch the layout data to confirm session is valid
      const resp = await this._authedGet('/meters/__data.json');
      if (resp.status === 200 && resp.data?.nodes?.[1]?.data) {
        const userData = resp.data.nodes[1].data;
        // Parse SvelteKit dehydrated user data
        const shape = userData[0]; // { user: idx }
        const userObj = userData[shape.user]; // { name: idx, email: idx }
        return {
          authenticated: true,
          user: {
            name: userData[userObj.name],
            email: userData[userObj.email],
          },
        };
      }
      return { authenticated: true, user: null };
    } catch {
      return { authenticated: false, user: null };
    }
  }

  /**
   * Build a hierarchical tree structure from meter data.
   * Fetches all meters and groups them by Zone > Circle > Division >
   * Subdivision > Sub Station > Feeder > DT.
   *
   * @param {number} [maxPages=20] - Maximum pages to fetch
   * @returns {Promise<object>} Nested hierarchy tree
   */
  async getHierarchy(maxPages = 20) {
    const allMeters = [];
    for (let page = 1; page <= maxPages; page++) {
      const result = await this.searchMeters('', page);
      allMeters.push(...result.meters);
      if (result.count < result.pageSize) break; // last page
    }

    // Fetch detail + hierarchy for each meter (batched, max 5 concurrent)
    const details = [];
    const batchSize = 5;
    for (let i = 0; i < allMeters.length; i += batchSize) {
      const batch = allMeters.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((m) => this.getMeterDetail(m.meterId))
      );
      for (const r of results) {
        if (r.status === 'fulfilled') details.push(r.value);
      }
    }

    // Build tree
    const tree = {};
    for (const d of details) {
      const h = d.hierarchy || {};
      const path = [
        h['Zone'],
        h['Circle'],
        h['Division'],
        h['Subdivision'],
        h['Sub Station'],
        h['Feeder'],
        h['DT'],
      ].filter(Boolean);

      let node = tree;
      for (const segment of path) {
        if (!node[segment]) node[segment] = {};
        node = node[segment];
      }
      if (!node._meters) node._meters = [];
      node._meters.push(d.meterId);
    }

    return {
      totalMeters: allMeters.length,
      detailsFetched: details.length,
      tree,
    };
  }
}

module.exports = UrjaPortalClient;
