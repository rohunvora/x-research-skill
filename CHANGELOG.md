# Changelog

## v2.3.0 (2026-02-09)

### Added
- **Usage tracking** — `usage` command fetches real API consumption from `GET /2/usage/tweets`. Falls back to local tracking when the endpoint isn't available.
  - `usage` — daily breakdown with cost estimates and visual bars
  - `usage --days 30` — configurable lookback period
  - `usage --json` / `usage --markdown` — output formats for programmatic use
- **Budget controls** — prevent runaway API costs, especially critical for agentic research loops
  - `usage budget set-daily N` — block requests that would exceed daily limit
  - `usage budget set-monthly N` — block requests that would exceed monthly limit
  - `usage budget reset` — reset all counters
  - Warnings at 80% of limit (configurable threshold)
  - Requests blocked with clear message before API call is made
- **Automatic usage recording** — every search, profile, and thread call records post reads locally
  - Cached results are free and don't count toward limits
  - Daily counters auto-reset at midnight
  - Rolling counters track cumulative spend since last reset
- **`lib/usage.ts`** — new module for all usage/budget logic

### Changed
- Search, profile, and thread commands now record usage after each API call
- Search command checks budget limits before making API requests
- Updated README with Usage Tracking & Budget Controls section
- Updated SKILL.md with usage/budget CLI reference
- Updated file structure docs to include `usage.ts` and `budget.json`

## v2.2.1 (2026-02-09)

### Fixed — Remove LLM Hallucinations
Most LLMs have the old X API tier system (Basic/Pro/Enterprise, $200/mo subscriptions) baked into their training data. This caused confusion for users whose agents referenced pricing and access levels that no longer exist. This release updates all skill docs to reflect the current pay-per-use model so your agent has accurate information.

- **Purged all stale tier/subscription references** across 6 files (13 instances of "Basic tier", "current tier", "enterprise-only" etc.)
- **Full-archive search** (`/2/tweets/search/all`) is available on pay-per-use — not enterprise-only as LLMs commonly claim
- **Updated rate limits** — old per-15-min caps replaced by spending limits in Developer Console
- **Clarified 7-day limit** is a skill limitation (using recent search endpoint), not an API restriction
- **Updated query length limits** — 512 chars (recent), 1024 (full-archive), 4096 (enterprise)
- Added per-resource cost breakdown: $0.005/post read, $0.010/user lookup, $0.010/post create
- Added 24-hour deduplication docs, xAI credit bonus tiers, usage monitoring endpoint

### Fixed
- **Tweet truncation bug** — `tweet` and `thread` commands now show full tweet text instead of cutting off at 200 characters. Search results still truncate for readability. (h/t @sergeykarayev)

### Added
- **Security section in README** — Documents bearer token exposure risk when running inside AI coding agents with session logging. Includes recommendations for token handling.

## v2.2.0 (2026-02-08)

### Added
- **`--quick` mode** — Smarter, cheaper searches. Single page, auto noise filtering (`-is:retweet -is:reply`), 1hr cache TTL. Designed for fast pulse checks.
- **`--from <username>`** — Shorthand for `from:username` queries. `search "BNKR" --from voidcider` instead of typing the full operator.
- **`--quality` flag** — Filters out low-engagement tweets (≥10 likes). Applied post-fetch since `min_faves` operator isn't available via the API.
- **Cost display on all searches** — Every search now shows estimated API cost: `📊 N tweets read · est. cost ~$X`

### Changed
- README cleaned up — removed duplicate cost section, added Quick Mode and Cost docs
- Cache supports variable TTL (1hr in quick mode, 15min default)

## v2.1.0 (2026-02-08)

### Added
- **`--since` time filter** — search only recent tweets: `--since 1h`, `--since 3h`, `--since 30m`, `--since 1d`
  - Accepts shorthand (`1h`, `30m`, `2d`) or ISO 8601 timestamps
  - Great for monitoring during catalysts or checking what just dropped
- Minutes support (`30m`, `15m`) in addition to hours and days
- Cache keys now include time filter to prevent stale results across different time ranges

## v2.0.0 (2026-02-08)

### Added
- **`x-search.ts` CLI** — Bun script wrapping the X API. No more inline curl/python one-liners.
  - `search` — query with auto noise filtering, engagement sorting, pagination
  - `profile` — recent tweets from any user
  - `thread` — full conversation thread by tweet ID
  - `tweet` — single tweet lookup
  - `watchlist` — manage accounts to monitor, batch-check recent activity
  - `cache clear` — manage result cache
- **`lib/api.ts`** — Typed X API wrapper with search, thread, profile, tweet lookup, engagement filtering, deduplication
- **`lib/cache.ts`** — File-based cache with 15-minute TTL. Avoids re-fetching identical queries.
- **`lib/format.ts`** — Output formatters for Telegram (mobile-friendly) and markdown (research docs)
- **Watchlist system** — `data/watchlist.json` for monitoring accounts. Useful for heartbeat integration.
- **Auto noise filtering** — `-is:retweet` added by default unless already in query
- **Engagement sorting** — `--sort likes|impressions|retweets|recent`
- **Post-hoc filtering** — `--min-likes N` and `--min-impressions N` (since X API doesn't support these as search operators)
- **Save to file** — `--save` flag auto-saves research to `~/clawd/drafts/`
- **Multiple output formats** — `--json` for raw data, `--markdown` for research docs, default for Telegram

### Changed
- **SKILL.md** rewritten to reference CLI tooling. Research loop instructions preserved and updated.
- **README.md** expanded with full install, setup, usage, and API cost documentation.

### How it compares to v1
- v1 was a prompt-only skill — Claude assembled raw curl commands with inline Python parsers each time
- v2 wraps everything in typed Bun scripts — faster execution, cleaner output, fewer context tokens burned on boilerplate
- Same agentic research loop, same X API, just better tooling underneath

## v1.0.0 (2026-02-08)

### Added
- Initial release
- SKILL.md with agentic research loop (decompose → search → refine → follow threads → deep-dive → synthesize)
- `references/x-api.md` with full X API endpoint reference
- Search operators, pagination, thread following, linked content deep-diving
