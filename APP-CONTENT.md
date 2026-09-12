# Seinhuis content management

Open `/seinhuis`, sign in with the existing protected owner account, then choose **Pagina’s en inhoud beheren**.

The existing app content is prefilled as a draft. Saving does not change the public app. **Voorbeeld bekijken** saves the current draft and opens an authenticated preview. **Publiceren** atomically replaces the public configuration. The previous publication can be restored into a draft and reviewed before publishing again. Concurrent saves fail with a conflict instead of overwriting another session.

Pages support overview (one or multiple feeds), article reader and embedded website types. Each page has a title/visibility setting and default/no/custom logo. Menu links can reference an app page or external HTTPS URL. Ordered sections support feeds and original text/image/link content. Feeds support count, starting item, layout, normalized-field equality filter, country selector, complete photo/price requirement, optional reader and section heading/more link. The built-in personal station page and locally saved stations are preserved.

Supported feed origins are Treinreiziger.nl and Treinrondreis.nl. RSS and the Treinrondreis product feed are supported. Filters use normalized fields such as `categories`, `country` (e.g. CH), `title`, `duration` and `price`. RSS article text is displayed safely as plain text with paragraphs. No third-party scripts or raw HTML from feeds execute. Embedded websites must allow framing; a normal external link is always available. Adding a new feed provider requires reviewing and extending the server allowlist.

Draft/public/previous configuration lives in the separate `app_content` database table, outside train-history retention. API edits require the normal admin session and exact same-origin POST requests. Recovery-only sessions cannot edit content. Preview/feed routes authorize access to draft feeds separately; public requests can fetch only published feed URLs. Requests reject redirects, non-HTTPS feeds, unexpected origins, credentials and oversized XML. The app does not cache draft API responses in the service worker.

Checks: `node test-app-cms.mjs`, `node test-tr-app.mjs`, `node test-tr-app-content.mjs`, `node test-admin-security.mjs`.
