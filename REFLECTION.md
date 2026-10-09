# Reflection

## What assumptions did you make?

**About the portal:**
- I assumed the portal is read-only and won't change its endpoint structure during evaluation. The SvelteKit `__data.json` contract and `/portal/*` endpoints are the stable integration surface.
- I assumed `DD/MM/YYYY HH:mm` timestamps are in IST (Indian Standard Time), consistent with Jaipur being the region for all meters.
- I assumed energy readings (`kwh`, `kvah`) are cumulative meter registers rather than interval values, based on the monotonically increasing numbers observed.
- I assumed the 20-items-per-page search pagination is fixed and not configurable.

**About the API design:**
- I assumed downstream consumers want clean JSON with proper types (numbers as numbers, not strings) — so I normalise string-encoded numbers from the portal and provide ISO 8601 timestamps (`isoTimestamp`).
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

3. **Rate limiting and connection pooling** — Add request throttling and a connection pool/queue to prevent overwhelming the upstream portal during spike traffic.

4. **Full dataset extraction & local sync** — Implement a background worker to sync all meters, locations, and consumption data into SQLite/Postgres for cross-attribute filtering.

## What mistake did you make while solving this (there's always one)?

My first mistake was trying to authenticate with `username` as the form field name instead of `email`. The portal returned `401` but the error message wasn't clear about which field was wrong — it just re-rendered the login page. I wasted time trying different authentication strategies (JSON body, SvelteKit form actions at `/login?/login`, better-auth API endpoints at `/api/auth/sign-in/email`) before going back to basics and reading the actual HTML form.

My second mistake was overcomplicating the data extraction. I initially tried to parse the SvelteKit `__data.json` dehydrated format for everything — but then I discovered the much simpler `/portal/*` JSON endpoints that the client JS uses internally. I should have inspected the JavaScript bundle files earlier — that's where the real API surface was documented (in code, not in any spec).

## If you were reviewing your own submission, what would you criticise?

1. **No caching** — Every API call hits the upstream portal. For a production service, this is unacceptable. At minimum, meter details (which rarely change) should be cached.

2. **Session mutex added, but single account connection** — An in-flight promise lock (`_loginPromise`) was implemented to eliminate concurrent re-auth race conditions, but the service relies on a single shared operator account.

3. **Hierarchy endpoint scalability** — The hierarchy endpoint fetches every meter sequentially, then fetches each meter's detail. With 300+ meters, this takes 30-60 seconds. A production version would need background indexing and a cached tree.

4. **Transformers data incomplete** — I identified the transformers page but didn't fully reverse-engineer its client-side data loading, so I haven't exposed a `/api/v1/transformers` endpoint. The data is visible in the browser but the programmatic path remains partially unmapped.

