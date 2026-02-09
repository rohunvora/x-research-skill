# x-research

X/Twitter research agent for [Claude Code](https://code.claude.com) and [OpenClaw](https://openclaw.ai). Search, filter, monitor — all from the terminal.

## What it does

Wraps the X API into a fast CLI so your AI agent (or you) can search tweets, pull threads, monitor accounts, and get sourced research without writing curl commands.

- **Search** with engagement sorting, time filtering, noise removal
- **Quick mode** for cheap, targeted lookups
- **Watchlists** for monitoring accounts
- **Cache** to avoid repeat API charges
- **Cost transparency** — every search shows what it cost

## Install

### Claude Code
```bash
# From your project
mkdir -p .claude/skills
cd .claude/skills
git clone https://github.com/rohunvora/x-research-skill.git x-research
```

### OpenClaw
```bash
# From your workspace
mkdir -p skills
cd skills
git clone https://github.com/rohunvora/x-research-skill.git x-research
```

## Setup

1. **X API Bearer Token** — Get one from the [X Developer Portal](https://developer.x.com)
2. **Set the env var:**
   ```bash
   export X_BEARER_TOKEN="your-token-here"
   ```
   Or save it to `~/.config/env/global.env`:
   ```
   X_BEARER_TOKEN=your-token-here
   ```
3. **Install Bun** (for CLI tooling): https://bun.sh

## Usage

### Natural language (just talk to Claude)
- "What are people saying about Opus 4.6?"
- "Search X for OpenClaw skills"
- "What's CT saying about BNKR today?"
- "Check what @frankdegods posted recently"

### CLI commands
```bash
cd skills/x-research

# Search (sorted by likes, auto-filters retweets)
bun run x-search.ts search "your query" --sort likes --limit 10

# Profile — recent tweets from a user
bun run x-search.ts profile username

# Thread — full conversation
bun run x-search.ts thread TWEET_ID

# Single tweet
bun run x-search.ts tweet TWEET_ID

# Watchlist
bun run x-search.ts watchlist add username "optional note"
bun run x-search.ts watchlist check

# Save research to file
bun run x-search.ts search "query" --save --markdown

# Usage & budget
bun run x-search.ts usage                         # API usage report
bun run x-search.ts usage --days 30               # Last 30 days
bun run x-search.ts usage budget                  # Budget status
bun run x-search.ts usage budget set-daily 5      # $5/day limit
bun run x-search.ts usage budget set-monthly 50   # $50/month limit
bun run x-search.ts usage budget reset            # Reset counters
```

### Search options
```
--sort likes|impressions|retweets|recent   (default: likes)
--since 1h|3h|12h|1d|7d     Time filter (default: last 7 days)
--min-likes N              Filter minimum likes
--min-impressions N        Filter minimum impressions
--pages N                  Pages to fetch, 1-5 (default: 1, 100 tweets/page)
--limit N                  Results to display (default: 15)
--quick                    Quick mode (see below)
--from <username>          Shorthand for from:username in query
--quality                  Pre-filter low-engagement tweets (min_faves:10)
--no-replies               Exclude replies
--save                     Save to ~/clawd/drafts/
--json                     Raw JSON output
--markdown                 Markdown research doc
```

## Quick Mode

`--quick` is designed for fast, cheap lookups when you just need a pulse check on a topic.

**What it does:**
- Forces single page (max 10 results) — reduces API reads
- Auto-appends `-is:retweet -is:reply` noise filters (unless you explicitly used those operators)
- Uses 1-hour cache TTL instead of the default 15 minutes
- Shows cost summary after results

**Examples:**
```bash
# Quick pulse check on a topic
bun run x-search.ts search "BNKR" --quick

# Quick check what someone is saying
bun run x-search.ts search "BNKR" --from voidcider --quick

# Quick quality-only results
bun run x-search.ts search "AI agents" --quality --quick
```

**Why it's cheaper:**
- Prevents multi-page fetches (biggest cost saver)
- 1hr cache means repeat searches are free
- Noise filters mean fewer junk results in your 100-tweet page
- You see cost after every search — no surprises

## `--from` Shorthand

Adds `from:username` to your query without having to type the full operator syntax.

```bash
# These are equivalent:
bun run x-search.ts search "BNKR from:voidcider"
bun run x-search.ts search "BNKR" --from voidcider

# Works with --quick and other flags
bun run x-search.ts search "AI" --from frankdegods --quick --quality
```

If your query already contains `from:`, the flag won't double-add it.

## `--quality` Flag

Filters out low-engagement tweets (≥10 likes required). Applied post-fetch since `min_faves` isn't available on X API Basic tier.

```bash
bun run x-search.ts search "crypto AI" --quality
```

## Usage Tracking & Budget Controls

With pay-per-use pricing, cost visibility is critical. x-research tracks every API call locally and can fetch real usage data from the X API.

### Check usage
```bash
bun run x-search.ts usage                # Fetch from X API (or local fallback)
bun run x-search.ts usage --days 30      # Last 30 days
bun run x-search.ts usage --json         # Raw JSON for programmatic use
bun run x-search.ts usage --markdown     # Markdown report
```

### Set budget limits
```bash
bun run x-search.ts usage budget set-daily 5     # Block requests after $5/day
bun run x-search.ts usage budget set-monthly 50  # Block requests after $50/month
bun run x-search.ts usage budget set-daily 0     # Remove daily limit
bun run x-search.ts usage budget reset           # Reset all counters
```

**How it works:**
- Every search, profile, and thread call records post reads locally in `data/budget.json`
- Before each API call, x-research checks if the request would exceed your budget
- If it would, the request is **blocked** with a clear message
- Warnings appear when you hit 80% of your limit (configurable)
- `usage` command fetches real data from `GET /2/usage/tweets` when available, falls back to local tracking
- Daily counters auto-reset at midnight; rolling counters track 30-day spend
- Cached results don't count toward budget (they're free)

**Why this matters:** AI agents can burn through credits fast with multi-page searches. Budget controls prevent runaway costs, especially in agentic loops where the LLM decides how many searches to run.

## Cost

As of February 2026, the X API uses **pay-per-use pricing** with prepaid credits. No subscriptions, no monthly caps. You buy credits in the [Developer Console](https://console.x.com) and they're deducted per request.

**Per-resource costs:**
| Resource | Cost |
|----------|------|
| Post read | $0.005 |
| User lookup | $0.010 |
| Post create | $0.010 |

**Search cost:** Each search page returns up to 100 posts = ~$0.50/page.

| Operation | Est. cost |
|-----------|-----------|
| Quick search (1 page, ≤100 posts) | ~$0.50 |
| Standard search (1 page) | ~$0.50 |
| Deep research (3 pages) | ~$1.50 |
| Profile check (user + posts) | ~$0.51 |
| Watchlist check (5 accounts) | ~$2.55 |
| Cached repeat (any) | free |

**24-hour deduplication:** If you request the same post twice in a UTC day, you're only charged once. This means repeat searches on the same topic within a day cost less than the estimate above.

**Spending controls:** Set auto-recharge thresholds and spending limits per billing cycle in the Developer Console. Failed requests are never billed.

**xAI credit bonus:** Spend $200+/cycle on X API → earn 10-20% back as xAI/Grok API credits. See [pricing docs](https://docs.x.com/x-api/getting-started/pricing).

**How x-search saves money:**
- Cache (15min default, 1hr in quick mode) — repeat queries are free
- 24-hour dedup means re-running the same search costs $0 at API level too
- Quick mode prevents accidental multi-page fetches
- Cost displayed after every search so you know what you're spending
- `--from` targets specific users instead of broad searches
- Monitor your usage programmatically: `GET /2/usage/tweets`

## File structure

```
x-research/
├── SKILL.md              # Agent instructions (Claude reads this)
├── x-search.ts           # CLI entry point
├── lib/
│   ├── api.ts            # X API wrapper
│   ├── cache.ts          # File-based cache
│   ├── format.ts         # Telegram + markdown formatters
│   └── usage.ts          # Usage tracking & budget controls
└── data/
    ├── watchlist.json    # Accounts to monitor
    ├── budget.json       # Budget config & local tracking (auto-managed)
    └── cache/            # Auto-managed
```

## Limitations

- Search covers last 7 days only (recent search endpoint restriction)
- Read-only — never posts or interacts
- Requires X API access with prepaid credits ([sign up](https://console.x.com))
- `min_likes` / `min_retweets` search operators unavailable (filtered post-hoc instead)
- Full-archive search (beyond 7 days) requires enterprise access

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=rohunvora/x-research-skill&type=Date)](https://star-history.com/#rohunvora/x-research-skill&Date)

## License

MIT
