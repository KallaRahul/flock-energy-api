# Protocol Discovery — Urja Meter Ops Portal

> How the legacy portal actually works under the hood, as discovered through systematic investigation.

## Portal Overview

The Urja Meter Ops portal at `https://urja-ops.flockenergy.tech` is a **SvelteKit** server-rendered application used by utility field staff to look up smart-meter information. It presents meter listings, individual meter details (nameplate, hierarchy, location, consumption), and a distribution transformer registry.

---

## Authentication

### Mechanism: `better-auth` Session Cookie

The portal uses the [`better-auth`](https://www.better-auth.com/) library for authentication.

**Login Flow:**

1. `GET /login` — Returns the SvelteKit login page. May set an initial cookie.
2. `POST /login` — Form-urlencoded body with two fields:
   - `email` — The user's email address (not "username")
   - `password` — The password
   - **Headers required**: `Content-Type: application/x-www-form-urlencoded`, `Referer`, `Origin` (the portal enforces same-origin checks and rejects cross-site POSTs without these)
3. On success (HTTP 200): a `Set-Cookie` header returns the session token:
   ```
   __Secure-better-auth.session_token=<token>.<signature>; Path=/; HttpOnly; Secure; SameSite=Lax
   ```
4. JSON-based login (`Content-Type: application/json`) returns `415 Unsupported Media Type` — only form-urlencoded is accepted.

**Session Expiry:**
- When the session expires, SvelteKit `__data.json` endpoints return: `{ "type": "redirect", "location": "/login" }` instead of data.
- HTML page requests redirect (302) to `/login`.
- The session token is an opaque string with a dot-separated signature.

**Sign Out:**
- `POST /api/auth/sign-out` — Invalidates the session.

### Gotchas
- The login form uses `email` as the field name, not `username` — this was a key discovery.
- Cross-site POST protection: the portal checks `Origin`/`Referer` headers and returns `403 Cross-site POST form submissions are forbidden` if they're missing or don't match.
- There is no CSRF token in the form.

---

## Discovered Endpoints

### 1. Client-Side JSON APIs (`/portal/*`)

The SvelteKit client JS (specifically `nodes/5.C4dYcCRt.js` for meters listing and `nodes/6.l777LXKL.js` for meter detail) uses `fetch()` to call internal JSON endpoints:

| Endpoint | Method | Description | Response Format |
|---|---|---|---|
| `/portal/meters/search?q={query}&page={page}` | GET | Search/list meters | `{ data: [...] }` |
| `/portal/meters/{id}/geo` | GET | Meter geo-coordinates | `{ data: { latitude, longitude } }` |
| `/portal/meters/{id}/energy` | GET | Consumption readings | `{ data: [...] }` |

#### Search Response
```json
{
  "data": [
    {
      "meterId": "J100001",
      "serialNo": "GE84132",
      "make": "L&T",
      "phaseType": "single",
      "installStatus": "Installed",
      "dtCode": "DT-002"
    }
  ]
}
```
- Pagination: 20 items per page. The `page` query parameter is 1-indexed.
- Empty `q` returns all meters. Partial matches on meter ID are supported.
- No explicit total count or page count is returned — you must fetch until a page returns fewer than 20 items.

#### Geo Response
```json
{
  "data": {
    "latitude": "26.85013563328432",
    "longitude": "75.77765593203735"
  }
}
```
- Coordinates are returned as strings (not numbers).
- All meters appear to be in the Jaipur, Rajasthan area.

#### Energy Response
```json
{
  "data": [
    {
      "timestamp": "23/06/2026 23:30",
      "kwh": "17717.54",
      "kvah": "19134.95",
      "voltR": "220"
    }
  ]
}
```
- ~337 readings per meter, at 30-minute intervals.
- All values are strings (not numbers).
- Timestamp format: `DD/MM/YYYY HH:mm`.
- `kwh` and `kvah` appear to be cumulative (not interval) readings.
- `voltR` is the R-phase voltage.

### 2. SvelteKit Data Endpoints (`/__data.json`)

SvelteKit exposes dehydrated page data at `/{route}/__data.json`:

| Endpoint | Description |
|---|---|
| `/meters/__data.json` | Meters page layout data (user info only) |
| `/meters/{id}/__data.json` | Full meter detail including nameplate + hierarchy |
| `/transformers/__data.json` | Transformers page layout data |

#### Meter Detail Data Structure

The `__data.json` response uses SvelteKit's dehydration format — a positional array where objects reference indices:

```json
{
  "type": "data",
  "nodes": [
    null,
    { "type": "data", "data": [/* user data */] },
    { "type": "data", "data": [/* meter data */] }
  ]
}
```

**Two data variants observed:**

**Format A** (e.g., J100020) — `classData` JSON string:
```json
{
  "detail": { "classData": "{\"installed_meter\":{\"MeterId\":\"J100020\",\"SerialNo\":\"AL20290\",...}}" },
  "hierarchy": { "Zone": "Jaipur Zone 3 (Z-03)", ... }
}
```

**Format B** (e.g., J100001) — Indexed `data` array:
```json
{
  "detail": { "data": [4, 6, 9, 12, 15, 18] },
  // indices point to: { "parameterName": "Meter ID", "parameterValue": "J100001" }
}
```

This inconsistency suggests the underlying database has meters from different systems or migration batches.

---

## Portal Navigation & UI Structure

### Pages
- `/login` — Login form
- `/meters` — Meter listing with search bar (client-rendered)
- `/meters/{id}` — Meter detail page with:
  - Nameplate section (static, server-rendered)
  - Location section ("Loading location…" → fetched from `/portal/meters/{id}/geo`)
  - Consumption section ("Loading consumption…" → fetched from `/portal/meters/{id}/energy`)
- `/transformers` — Distribution transformer listing with pagination ("Page 1 of 1", "Export all meters" button)

### Navigation
- Header: "Urja Meter Ops" → links to `/meters`
- Nav tabs: "Meters" (`/meters`), "Transformers" (`/transformers`)
- User: "Ops Desk" + "Sign out" button

---

## Hierarchy Structure

Meters are organised in a 7-level hierarchy:
1. **Zone** — e.g., "Jaipur Zone 2 (Z-02)"
2. **Circle** — e.g., "Circle 2 (C-02)"
3. **Division** — e.g., "Division 2 (D-02)"
4. **Subdivision** — e.g., "Subdivision 2 (SD-02)"
5. **Sub Station** — e.g., "Substation 2 (SS-02)"
6. **Feeder** — e.g., "Feeder 2 (F-002)"
7. **DT** (Distribution Transformer) — e.g., "Mansarovar DT 2 (DT-002)"

Each meter maps to exactly one DT, which is a leaf in the hierarchy.

---

## Data Anomalies & Quirks

1. **Inconsistent detail format**: Some meters have `classData` (JSON string), others have indexed `data` arrays. The adapter must handle both.
2. **Strings instead of numbers**: Geo coordinates, energy readings, and voltages are all returned as strings.
3. **No pagination metadata**: The search endpoint returns no `total`, `totalPages`, or `hasMore` field — you must infer the last page by checking if fewer than 20 results were returned.
4. **Cumulative readings**: `kwh` and `kvah` values are cumulative, not per-interval. To calculate interval consumption, you'd need to subtract consecutive readings.
5. **Single timestamp format**: `DD/MM/YYYY HH:mm` — non-ISO, requires parsing for downstream use.
6. **Cross-site restrictions**: POST requests require matching `Origin` and `Referer` headers.
7. **Transformers data is client-rendered**: The `__data.json` for transformers returns `null` for the page data node — the actual table data appears to be loaded client-side, likely from a `/portal/` endpoint that we haven't fully mapped.

---

## Technology Stack (Portal)

- **Framework**: SvelteKit (evidence: `x-sveltekit-page` header, `__data.json` endpoints, SvelteKit inline bootstrap scripts)
- **Auth**: better-auth (`__Secure-better-auth.session_token` cookie, `/api/auth/sign-out` endpoint)
- **Hosting**: Custom domain with `alt-svc: h3=":443"` (HTTP/3 support)
- **CSS**: Tailwind CSS (class names like `bg-slate-100`, `text-slate-800`, `rounded-xl`)
