# Boekjesmaker in Seinhuis

Independent Python service, private Railway networking only. Public entry point:
`https://treinbord.up.railway.app/seinhuis/boekjesmaker/`.
The Node gateway checks the existing **owner** session on every request. KM-only
members do not gain access. All mutations require the exact public Origin and
X-Booklets header. Cookies, client authorization and arbitrary proxy headers are
never forwarded. Shared gateway secret authenticates the private service too.

## Railway setup

Use the existing repository/main, root directory `/booklets`, detected Dockerfile.
Set healthcheck `/health`, port 8080, restart on failure (5 retries) in Railway.
Do not use the root railway.json (that starts Node). New services can no longer
opt into legacy Config as Code after 2026-08-28; configure this service in the UI.
Use one replica in the same region as live-board, a dedicated volume at `/data`,
and no public domain/TCP proxy. Limits: 2 GB RAM, 1 CPU, 5 GB application storage
quota. Railway provisioned a 50 GB volume and does not offer shrinking in this UI;
it bills used space. The app enforces the agreed 5 GB usage in upload/render/import
paths with metadata headroom. Obtain cost agreement before raising limits. Enable daily
volume backups. No PostgreSQL schema or KM-media bucket changes are required.

Python variables:

- BOOKLETS_GATEWAY_SECRET: cryptographically random, >=32 characters.
- BOOKLETS_ENCRYPTION_KEY: Fernet key (32 random bytes, URL-safe base64).
- BOOKLETS_PUBLIC_ORIGIN: https://treinbord.up.railway.app
- BOOKLETS_DATA: /data
- PORT: 8080
- BOOKLETS_IMPORT_ENABLED: 1 during the initial import; remove afterwards.
- Optional GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: Google **web** OAuth client,
  Docs API enabled, documents.readonly. Exact authorized redirect:
  https://treinbord.up.railway.app/seinhuis/boekjesmaker/google/callback

live-board variables:

- BOOKLETS_INTERNAL_URL: http://<actual-private-service-name>.railway.internal:8080
- BOOKLETS_GATEWAY_SECRET: identical private gateway secret.
- BOOKLETS_PUBLIC_ORIGIN: https://treinbord.up.railway.app

Keep these in Railway variables/secrets; never commit values. Google credentials
are encrypted at rest. The old Windows-bound OAuth file cannot be migrated.
Google callback uses an explicit same-site continuation to restore the existing
Strict login cookie before processing the one-time state and PKCE code.

## Initial migration

Stop editing the local library during the final snapshot and transfer. Run:
`python prepare_import.py SOURCE_DATA OUTPUT_DIRECTORY` in a private local work
directory outside Git. It uses SQLite's backup API. Users/passwords/Google tokens
and preview caches are excluded. At the protected `/seinhuis/boekjesmaker/import`
select import.json and every .part file, then import. Checksums, file whitelist,
asset/export completeness and database transaction protect the import. Existing
nonempty libraries cannot be overwritten. Verify counts and several PDFs, remove
BOOKLETS_IMPORT_ENABLED, then create an initial volume backup. Local originals
remain untouched. Each local snapshot needs a new empty output directory.

## Resource and recovery limits

PDF downloads stream in chunks. Upload limit is 50 MB. One mutation or preview
render runs at a time; further requests get 429 and a retry message. One Gunicorn
worker is required because the semaphore/OAuth preparation cache is process-local.
Generation timeout is 180 seconds; oversized work may need further optimisation.
The service should fail independently from the train board. Never increase limits
silently. Disable access by clearing BOOKLETS_INTERNAL_URL without deleting data.
Restore the dedicated volume backup for recovery; never restore Postgres for a
booklet issue. Published PDFs are immutable and stored alongside their snapshots.

## Tests

From repository root: npm run check:syntax, npm test, npm run test:browser.
From booklets: python test_cloud.py and python test_migration.py.
Validate private access, owner vs KM member, cross-origin rejection, upload,
generation, previews and PDF downloads online after deployment. Do not claim live
verification based only on local tests.
