# Flock Energy — Urja Meter Ops API Service

A clean, modern, and documented **REST API wrapper** service written in Node.js / Express that sits in front of the legacy **Urja Meter Ops** web application (`https://urja-ops.flockenergy.tech`).

This service automates programmatic authentication, session management, and data retrieval against the legacy portal, transforming SvelteKit dehydrated responses and internal endpoints into clean, well-structured JSON. Downstream data platforms and product teams can consume smart meter data without ever touching the legacy web UI.

---

## Deliverables & Links

- 📜 **[PROTOCOL.md](PROTOCOL.md)** — Reverse-engineering write-up of the Urja portal's internal mechanics, authentication flows, SvelteKit data structures, and quirks.
- 📄 **[openapi.json](openapi.json)** — OpenAPI 3.0.3 specification for this REST API.
- 🪞 **[REFLECTION.md](REFLECTION.md)** — Engineering reflections, assumptions, trade-offs, mistakes made, and self-critique.
- 🌐 **Interactive Documentation**: Available at `http://localhost:3000/docs` (Swagger UI) when the service is running.

---

## Project Structure

```
flock-api-submission/
├── src/
│   ├── client.js          # UrjaPortalClient: Legacy portal HTTP adapter & SvelteKit parser
│   ├── routes.js          # Express REST API route definitions (/api/v1/*)
│   ├── config.js          # Environment variable configuration loader
│   └── server.js          # Express app entry point, Swagger UI middleware, & error handler
├── openapi.json           # OpenAPI 3.0.3 API specification
├── PROTOCOL.md            # Detailed technical discovery of the legacy portal
├── REFLECTION.md          # 5 Reflection questions & self-assessment
├── README.md              # Project documentation & setup guide (this file)
├── package.json           # Dependencies and scripts
├── .env.example           # Environment template
└── .gitignore             # Git ignore patterns
```

---

## Architecture & Design

```
+-------------------+       HTTP / REST       +-----------------------+       HTTP / Cookie Auth       +--------------------------+
| Downstream Client | ---------------------> |  Flock Urja API Proxy | -----------------------------> | Urja Meter Ops Portal    |
| (Curl / App / AI) | <--------------------- |  (Express / Node.js)  | <----------------------------- | (https://urja-ops.tech)  |
+-------------------+      Clean JSON        +-----------------------+      SvelteKit / JSON          +--------------------------+
```

### Key Components

1. **UrjaPortalClient Adapter (`src/client.js`)**:
   - Maintains persistent session cookies (`__Secure-better-auth.session_token`).
   - Automatically detects session expiration (SvelteKit redirects) and re-authenticates.
   - Normalises string-encoded numbers to floats/integers.
   - Deserialises SvelteKit dehydrated positional-array data structures (`/__data.json`) and unifies multiple legacy detail formats into clean JSON.

2. **Express REST Router (`src/routes.js`)**:
   - Exposes clean endpoints under `/api/v1/`.
   - Handles errors gracefully with consistent JSON error responses (`{ "error": "message" }`).

3. **Interactive Swagger UI (`src/server.js`)**:
   - Serves the OpenAPI 3.0.3 specification interactively at `/docs`.

---

## Quick Start & Setup Instructions

### Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/flock-api-submission.git
   cd flock-api-submission
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment**:
   Copy `.env.example` to `.env` (defaults are pre-configured for the Urja portal):
   ```bash
   cp .env.example .env
   ```
   *Contents of `.env`:*
   ```env
   PORT=3000
   PORTAL_URL=https://urja-ops.flockenergy.tech
   PORTAL_EMAIL=operator@urja.local
   PORTAL_PASSWORD=urja-ops-2026
   ```

### Running the API

- **Start production server**:
  ```bash
  npm start
  ```
- **Start development server**:
  ```bash
  npm run dev
  ```

Once started, the service will be available at:
- **API Base URL**: `http://localhost:3000/api/v1`
- **Swagger Documentation**: `http://localhost:3000/docs`
- **OpenAPI JSON Spec**: `http://localhost:3000/openapi.json`
- **Health Check**: `http://localhost:3000/health`

---

## API Reference & Sample Requests

### 1. Health Check
```bash
curl http://localhost:3000/health
```
**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-24T06:53:39.012Z"
}
```

### 2. Search / List Smart Meters
```bash
curl "http://localhost:3000/api/v1/meters?q=J100001&page=1"
```
**Response:**
```json
{
  "meters": [
    {
      "meterId": "J100001",
      "serialNo": "GE84132",
      "make": "L&T",
      "phaseType": "single",
      "installStatus": "Installed",
      "dtCode": "DT-002"
    }
  ],
  "page": 1,
  "pageSize": 20,
  "count": 1
}
```

### 3. Get Meter Details & Hierarchy Placement
```bash
curl http://localhost:3000/api/v1/meters/J100001
```
**Response:**
```json
{
  "meterId": "J100001",
  "nameplate": {
    "Meter ID": "J100001",
    "Serial No": "GE84132",
    "Make": "L&T",
    "Phase Type": "single",
    "Installation Status": "Installed",
    "Installation Type": "CT Operated"
  },
  "hierarchy": {
    "Meter ID": "J100001",
    "Installation Status": "Installed",
    "Installation Type": "CT Operated",
    "Zone": "Jaipur Zone 2 (Z-02)",
    "Circle": "Circle 2 (C-02)",
    "Division": "Division 2 (D-02)",
    "Subdivision": "Subdivision 2 (SD-02)",
    "Sub Station": "Substation 2 (SS-02)",
    "Feeder": "Feeder 2 (F-002)",
    "DT": "Mansarovar DT 2 (DT-002)"
  }
}
```

### 4. Get Meter Geo-Location
```bash
curl http://localhost:3000/api/v1/meters/J100001/location
```
**Response:**
```json
{
  "meterId": "J100001",
  "location": {
    "latitude": 26.822136543835608,
    "longitude": 75.90718190602279
  }
}
```

### 5. Get Meter Consumption History
```bash
curl http://localhost:3000/api/v1/meters/J100001/consumption
```
**Response:**
```json
{
  "meterId": "J100001",
  "count": 337,
  "readings": [
    {
      "timestamp": "23/06/2026 23:30",
      "kwh": 42594.05,
      "kvah": 46001.58,
      "voltR": 231
    }
  ]
}
```

### 6. Get Network Hierarchy Tree (Optional Extension)
```bash
curl http://localhost:3000/api/v1/hierarchy
```

### 7. Auth Status & Explicit Login
```bash
curl http://localhost:3000/api/v1/auth/status
curl -X POST http://localhost:3000/api/v1/auth/login
```

---

## Architectural Notes, Trade-offs & Decisions

### 1. Data Source Selection: SvelteKit Dehydrated JSON vs `/portal/` Internal APIs
During discovery, I identified two data extraction paths:
- **Path A**: Scraping HTML or parsing SvelteKit `/__data.json` dehydrated responses.
- **Path B**: Calling internal client fetch endpoints `/portal/meters/search`, `/portal/meters/{id}/geo`, and `/portal/meters/{id}/energy`.

*Decision:* Used **Path B** for search, location, and consumption readings because it returns native JSON arrays with structured fields. Used **Path A** (`/__data.json`) for meter nameplate and hierarchy placement, as that data is server-rendered into SvelteKit layouts.

### 2. Session Management & Auto-Reauthentication
*Decision:* Implemented automatic, transparent session handling inside `UrjaPortalClient`. If the portal returns a `302 Redirect` to `/login` or SvelteKit `{ type: "redirect", location: "/login" }`, the adapter automatically re-logs in using stored credentials and retries the request seamlessly.

### 3. Data Type Normalisation
*Trade-off:* The legacy portal returns geo-coordinates, consumption numbers (`kwh`, `kvah`), and voltages as strings (e.g. `"26.85"`, `"42594.05"`). The wrapper parses these into native JavaScript floats/integers to guarantee clean typing for downstream SDKs.

---

## Intentional Omissions & Future Improvements

1. **Response Caching**: The current service queries the upstream portal on every request. Adding an in-memory or Redis cache (with a 5–15 minute TTL) would significantly improve latency.
2. **Bulk Offline Sync / Local Database**: Storing meter data in SQLite or PostgreSQL would allow complex cross-attribute queries ("find all faulty meters in Zone 3 near coordinates X, Y") that the legacy portal cannot support natively.
3. **ISO 8601 Timestamps**: The portal returns timestamps in `DD/MM/YYYY HH:mm` format. Future versions will parse these into full ISO 8601 strings with timezone offset (`2026-06-23T23:30:00+05:30`).

---

## Summary Reflection

For detailed responses to all 5 required reflection questions (assumptions, hardest part, mistakes, what to improve, and self-critique), see **[REFLECTION.md](REFLECTION.md)**.
