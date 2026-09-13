# Kilometer Kampioen — implementation status

Branch starts from production main 3f9b660204b6679d6cb8be516d81f305113616ed.

Implemented first phase: `/kilometerkampioen/` email-code authentication, editable participation profile, `/treinhuis` owner-authenticated participant list and readiness display. Uses shared PostgreSQL/SQLite connection and separate `kk_records` table, outside train retention. No participant data returned by anonymous session requests. OTPs expire in 10 minutes and are consumed atomically on first verification attempt; a wrong attempt requires a new code. Per-address and HMAC-IP request limits. Seven-day server sessions with Secure/HttpOnly cookies. No localStorage of participant data. Database migration only creates tables/indexes.

Required before production login: `KK_AUTH_SECRET` (stable random secret; owner encryption/password secret used as fallback), `RESEND_API_KEY`, `KK_EMAIL_FROM` (verified sender). Never put these in Git. Resend requests use the official HTTPS email endpoint and a timeout. No real mail sent during unit tests.

Memory: DB hour cache capped at 4000 entries/36h; station resolution at 500/7d; Italian journey lookup at 500/24h. Periodic cleanup runs independently of traffic. Archived observations are unaffected. RAM reduction must still be measured in production; other memory improvements need profiling.

NOT YET IMPLEMENTED: upload storage, proof/update forms in production, public liveblog and rich editor, citations, team management, map/planning integration, station integration, multiple admin roles. Existing prototype is design reference, not implementation. Do not announce competition readiness or publish a finished app based on this phase.

Next: resolve mail and object-storage provisioning with user, then implement private uploads with server validation and ownership checks (4 images <=15MB each + 1 video <=100MB/60s). Keep proof originals; separate public editorial media and private evidence. All eight participation fields remain: email/full name/display name/edition/start time required; companion conditional; station/distance optional pending user's field-number clarification. No score calculations in v1.

Tests: `node test-kk.mjs`, existing admin/CMS regressions, syntax check. Production deployment and real email verification still required. PostgreSQL integration tests and real-browser checks still required.
