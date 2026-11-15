# Security review

This review covered the current static pages, browser scripts, feed ingestion/classification, and GitHub Actions publishing workflow. It was a code review plus local adversarial-input/browser checks and live deployment checks, not a guarantee that every vulnerability has been found.

## Fixed in this update

- **XML declaration filtering bypass:** a UTF-16-encoded feed bypassed the original raw-byte `DOCTYPE`/`ENTITY` check and ElementTree expanded an internal entity. DTDs are now rejected by the XML parser itself, independent of that byte encoding. Response size limits remain in place. No external-file disclosure was demonstrated.
- **Third-party script privilege:** the optional X widget previously executed JavaScript in the main page's origin. X content now loads into opt-in, cross-origin, sandboxed frames. Parent pages permit only local scripts/styles and no longer permit inline styles or remote X JavaScript. Frames cannot access the parent DOM or navigate the top-level page; normal account links remain available.
- **Feed-origin and malformed-data defenses:** HTTPS publisher URLs are checked against the declared source on both producer and consumer. Credentials, unexpected ports, source mismatches, and foreign origins are rejected. Browser reads are bounded and timed out, nested feed data is normalized, and hunt identifiers are allowlisted. Existing text-node rendering is retained; no feed HTML is executed.
- **Unexpected redirects:** feed requests cannot redirect to HTTP, another provider, or a private-address hostname. Requests originate only from configured source URLs. This is a redirect-host control, not a general-purpose DNS-rebinding defense.
- **Publishing permissions:** external feeds are processed in a read-only job without persisted Git credentials. A separate publishing job revalidates a single JSON artifact before committing only `docs/data/news.json`. All official Actions dependencies are pinned to full commit SHAs. No pull-request-target workflow or external API secrets are used.
- **HTTPS enforcement:** the publishing job requests HTTPS enforcement through GitHub's Pages API. The resulting Pages setting and HTTP redirect must be checked after deployment; failure of that configuration step does not prevent deployment of the independent code fixes.

## Verification

Python regressions cover encoded XML declarations, redirect restrictions, source URL spoofing, nested data validation, classification distinctions, and catalog semantics. Browser checks cover hostile headline text, rejected phishing/JavaScript URLs, malformed classification data, oversized responses, opt-in X frames, blocked parent DOM access/top navigation, and normal page rendering.

No credentials matched the high-confidence private-key/token patterns checked in the currently tracked files. The site has no login, user database, or server-side form handlers. This does not constitute a full Git-history secret scan or an assessment of the owner's GitHub/GoDaddy accounts.

## Hosting limits

GitHub Pages controls HTTP response headers. This site cannot set its own `frame-ancestors`, HSTS, Permissions-Policy, or `X-Content-Type-Options` response headers with HTML meta tags or a `_headers` file. The per-page meta CSP constrains scripts and resources, but cannot enforce `frame-ancestors`. Header-level controls require a hosting provider or edge proxy that supports them. Do not add sensitive authenticated actions without revisiting that boundary.

X controls embedded content and availability inside its isolated frames. Publisher content can still be wrong or misleading; source matching and classification tags are not independent verification of reports.
