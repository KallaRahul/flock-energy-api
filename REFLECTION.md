# Reflection

## What assumptions did you make?

**About the portal:**
- I assumed the portal is read-only and won't change its endpoint structure during evaluation. The SvelteKit `__data.json` contract and `/portal/*` endpoints are the stable integration surface.
- I assumed `DD/MM/YYYY HH:mm` timestamps are in IST (Indian Standard Time), consistent with Jaipur being the region for all meters.
- I assumed energy readings (`kwh`, `kvah`) are cumulative meter registers rather than interval values, based on the monotonically increasing numbers observed.
- I assumed the 20-items-per-page search pagination is fixed and not configurable.

**About the API design:**
- I assumed downstream consumers want clean JSON with proper types (numbers as numbers, not strings) — so I normalise string-encoded numbers from the portal.
- I assumed session management should be transparent to API consumers — they shouldn't need to know about portal cookies or re-authentication flows.
- I assumed the hierarchy endpoint can afford to be slow (~30-60s) since it fetches all meters. In production this would need caching.

## Which part was the most difficult, and how did you get unstuck?

The **authentication flow** was the most challenging part. Three things tripped me up:

1. **The form field is `email`, not `username`** — This wasn't documented anywhere. I only discovered it by parsing the login page HTML and finding `<input name="email" type="email">`. My first login attempts used `username` and silently failed.

2. **Cross-site POST protection** — The portal rejects POST requests that don't include matching `Origin` and `Referer` headers, returning `403 Cross-site POST form submissions are forbidden`. This isn't a CSRF token mechanism — it's a simple header check.

3. **SvelteKit's dehydrated data format** — The `__data.json` endpoints return data in a compact positional-array format where values are referenced by index. Understanding this format required inspecting the client-side JS files (specifically `nodes/6.l777LXKL.js`) to see how the framework deserialises it.

I got unstuck by systematically inspecting the SvelteKit client JavaScript bundles, which revealed the internal `/portal/*` fetch endpoints (search, geo, energy). These were much cleaner to consume than the dehydrated `__data.json` format, so I used them as the primary data source for search, location, and consumption.

## If you had another day, what would you improve?

1. **Response caching layer** — Add an in-memory cache (or Redis) with TTL-based invalidation for meter details and consumption data. The portal data is likely updated every 30 minutes (matching the reading interval), so a 5-minute cache would dramatically improve performance.

2. **Transformers endpoint** — I observed the transformers page exists with columns (Code, Name, Feeder, Capacity kVA) and an "Export all meters" button. Discovering the client-side data source for this would unlock a bulk-fetch path.

3. **ISO 8601 timestamps** — Convert the portal's `DD/MM/YYYY HH:mm` timestamps to ISO 8601 format (`2026-06-24T06:00:00+05:30`) for better downstream interoperability.

4. **Unit tests** — Add tests with mocked portal responses to verify the SvelteKit data parser handles both Format A (`classData`) and Format B (indexed `data` arrays) correctly.

5. **Rate limiting and connection pooling** — The current implementation creates a fresh HTTP request for each API call. A connection pool and request queue would prevent overwhelming the upstream portal.

6. **Full dataset extraction** — Implement a background job that crawls all meters, their details, locations, and consumption data into a local SQLite database, enabling cross-attribute queries the portal can't do.

## What mistake did you make while solving this (there's always one)?

My first mistake was trying to authenticate with `username` as the form field name instead of `email`. The portal returned `401` but the error message wasn't clear about which field was wrong — it just re-rendered the login page. I wasted time trying different authentication strategies (JSON body, SvelteKit form actions at `/login?/login`, better-auth API endpoints at `/api/auth/sign-in/email`) before going back to basics and reading the actual HTML form.

My second mistake was overcomplicating the data extraction. I initially tried to parse the SvelteKit `__data.json` dehydrated format for everything — but then I discovered the much simpler `/portal/*` JSON endpoints that the client JS uses internally. I should have inspected the JavaScript bundle files earlier — that's where the real API surface was documented (in code, not in any spec).

## If you were reviewing your own submission, what would you criticise?

1. **No caching** — Every API call hits the upstream portal. For a production service, this is unacceptable. At minimum, meter details (which rarely change) should be cached.

2. **No tests** — The submission lacks automated tests. The SvelteKit data parser, especially the two-format normalisation logic, deserves unit tests with fixtures from actual portal responses.

3. **Session is a singleton** — The portal client uses a single shared session. If two API requests arrive simultaneously and both trigger re-authentication, there's a race condition. A proper implementation would use a mutex/semaphore around the login flow.

4. **No rate limiting on our API** — The service doesn't throttle incoming requests, which could cause it to flood the upstream portal.

5. **Hierarchy endpoint scalability** — The hierarchy endpoint fetches every meter sequentially, then fetches each meter's detail. With 300+ meters, this takes 30-60 seconds. A production version would need background indexing and a cached tree.

6. **Transformers data incomplete** — I identified the transformers page but didn't fully reverse-engineer its client-side data loading, so I haven't exposed a `/api/v1/transformers` endpoint. The data is visible in the browser but the programmatic path remains partially unmapped.
