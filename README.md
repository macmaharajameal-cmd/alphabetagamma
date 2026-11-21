# SafeScale

Public static site hosted by GitHub Pages from `main:/docs`, using the custom domain in `docs/CNAME`.

## Pages

- Home and anonymous About page: no personal name, email, location, or biography claims.
- Cyber news and recent breaches: source-linked RSS headlines, search, publisher and time filters. Incident labels are headline keyword matches, not independently verified incident assessments.
- Threat hunts: defensive hypotheses, in-tab checklist progress, MITRE references, and starter KQL queries. No telemetry is collected. Queries require the named Microsoft data tables.
- On X: selected security profiles and user-initiated official timeline widgets. No X API credentials are used. These are not trending or verified-only rankings. X can restrict or require sign-in for embeds.

## News updates

`python scripts/refresh_news.py` fetches headlines from BleepingComputer and The Hacker News. Only titles, timestamps, attribution, and original links are published. Up to 400 records are kept; previously fetched records survive temporary feed failures. Browser rendering uses text nodes, not feed HTML.

The **Refresh cyber headlines** Actions workflow runs every six hours (GitHub may delay scheduled jobs), on updater changes, and manually through Actions. It commits the generated `docs/data/news.json` and explicitly requests a Pages rebuild because `GITHUB_TOKEN` commits do not trigger one automatically. It needs only the repository-provided token with contents/pages write permission, no external secrets. Public repositories may have schedules disabled by GitHub after 60 days without repository activity; check Actions if updates become stale.

The public feed shows the last refresh attempt, source failures, and a warning after 12 hours without a refresh. Headlines are not live streaming. Each headline retains its publication date.

## Privacy

No first-party analytics, forms, cookies, or persistent browser storage. Checklists reset on reload. Publisher links open the original publisher. Sandboxed X timelines load only after the visitor clicks “Load X timelines”; X may then process data under its own policies. Content security policies are set per page. Do not insert personal details into the About page without approval.

Keep `docs/CNAME` as `safescale.in`. Keep only the four GitHub Pages apex A records in the DNS zone; do not reconnect GoDaddy WebsiteBuilder DNS.

## Continuous briefing tape

The Home and On X pages show a seamless left-to-right headline tape at 32 CSS pixels per second. Hover, keyboard focus, or a hidden tab pauses it. The tape resumes when the pointer and keyboard focus leave it. Reduced-motion preferences keep it stationary. Read all headlines provides a stationary accessible alternative. Publisher refreshes run every six hours, every day, with three fetch attempts per source. Open pages check for new published data every 15 minutes and when returning to an older tab. Last successful source-refresh time is displayed below the tape; stale briefings are labeled.

## Business intelligence

`docs/intel.html` filters the same shared `news.json` collection by industry, geography, business profile, environment, source, and evidence/relevance mode. No database or AI service is required. `scripts/classify_intel.py` classifies feed titles and RSS context using documented terms; it stores only matched evidence, not full article/description text. Multiple tags are supported and unmatched dimensions remain unclassified. No customer inventories or account data are collected. Shared view URLs contain only the selected filters.

Industry mentions are separate from potential business relevance based on a technology-to-sector map. India-relevant includes transferable technology/identity risks; India-mentioned requires a source term. Neither establishes victim location or sector. Startup is an applicability profile, not victim size. The UI shows method, matched terms, confidence meaning, timestamps, and source links. It does not claim AI analysis or independent verification. The method is intentionally conservative, but term matching can still produce false positives/negatives. Use the original advisory for affected versions and context.

Sources: BleepingComputer RSS, The Hacker News RSS, and the official CISA KEV JSON mirror at `cisagov/kev-data` (newest 50 catalog entries). KEV dates are catalog additions, not publication or incident dates. U.S. federal catalog deadlines do not apply automatically to Indian businesses. CERT-In is a direct official guidance link; its feeds are not ingested because tested endpoints did not return usable feed data. Canonical publisher URLs are deduplicated within the combined collection; cross-publisher reports of one incident remain distinct and are not counted as unique incidents.

Industry coverage cards explain systems, telemetry, and operational priorities. Hunt links require the named logs and do not assert a technique was used in a source story. Cloud OAuth, identity sign-in, Windows PowerShell, and scheduled-task guides are available; dedicated POS script and industrial protocol queries are not included. Classification is regenerated on each scheduled fetch, with cached classifications retained during source failures. Headlines and classifications refresh together every six hours. Add a rule in `classify_intel.py` to extend taxonomy, and run `python scripts/refresh_news.py` to regenerate data.

## Security maintenance

See [SECURITY.md](SECURITY.md) for the reviewed boundaries, fixed issues, tests, and GitHub Pages header limitations. Feed parsing runs separately from publishing; run `python -m unittest discover -s scripts -p "test_*.py"` before changing the ingestion or classification code. Actions are SHA-pinned and should be reviewed when updating those pins.

## Packet Patrol arcade

`docs/arcade.html` is a first-party pixel-art game implemented in `assets/arcade.js` and `assets/arcade.css`. Arcade mode lasts 60 active seconds across three waves with five integrity points. Escaped threats and friendly hits cost integrity; misses break the streak. Practice is untimed, slower, and does not lose integrity. Scores and best-this-visit stay in memory and reset on reload; there is no leaderboard service, persistent storage, telemetry, or external asset dependency. Sound uses Web Audio only after a visitor opts in.

Mouse/touch aiming, keyboard reticle controls, and a regular-button target panel are available. Hiding the tab pauses the round. Reduced-motion settings stop target motion and particle effects; newly spawned targets remain visible. Start/restart scrolls the cabinet into view. The existing strict CSP remains unchanged. The game simulates defensive decisions and does not scan or connect to any systems.

## Industry categories

Cyber News and Recent Breaches now have a category/industry selector, counts, shortcut chips, and per-story badges. Business Intel defaults to **Assigned industry category**; the optional broader relevance mode also matches technologies commonly used by a sector. Explicit source-sector matches remain available separately.

The shared taxonomy covers retail, hospitality, manufacturing, SaaS/technology, banking/financial services, healthcare, education, government/public sector, telecommunications, transport/logistics, energy/utilities, and General/cross-industry. Rules examine headlines and current RSS context. Explicit keyword matches and curated company mappings are labeled separately; company lookup is a suggestion, not proof of victim industry. Unclear/general product advisories retain a General/cross-industry category. Counts are multi-label story counts, not unique incidents.

The scheduled workflow currently uses **keyword/company tagging only**. No AI request, model permission, API key, or API billing is enabled in that workflow. `scripts/classify_ai.py` is an optional, unscheduled adapter with quoted-evidence validation and bounded calls; it is not the active classifier. The published `classification.aiStatus` records `disabled`. Any future AI integration must keep model suggestions distinguishable from source evidence and credentials out of the website.

The backend category taxonomy, browser allowlist and static selector options must be updated together when adding a sector. `scripts/test_categories.py` covers industry distinctions, company mapping, rejected model suggestions, and graceful service unavailability; AI tests use mocks only.

## Source collection

Ten scheduled sources: BleepingComputer, The Hacker News, CISA KEV (official GitHub mirror), Krebs on Security, SecurityWeek, SANS Internet Storm Center, Unit 42, Microsoft Security, CERT-EU, and The Record. The collection combines research, reporting, catalog entries and advisories; not every entry is an incident report. Seven new feed endpoints were checked before enabling them. CERT-In remains a manual official-guidance link; its feed is not ingested.

All feeds use the existing bounded XML parser, HTTPS redirect checks, per-source headline URL allowlists, retry/cached-data fallback, and read-only ingestion job. Up to 100 RSS records per source response and 400 combined records are retained, with a four-megabyte publication/browser limit. Source status and last successful fetch are tracked individually. The browser source allowlist and publisher validator must be updated together. Publisher text is treated as untrusted, and only matched category evidence—not article HTML—is rendered. CERT-EU's CET/CEST RSS timestamps are normalized to explicit UTC offsets.
