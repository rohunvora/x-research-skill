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

You need **one** of these backends (or both — Xquik is preferred when both are set):

### Option A: Xquik API key (recommended — 33x cheaper)

1. **Get an API key** at [xquik.com](https://xquik.com) (Dashboard → API Keys)
2. **Set the env var:**
   ```bash
   export XQUIK_API_KEY="xk_your_key_here"
   ```
3. **Install Bun** (for CLI tooling): https://bun.sh

That's it — no Bearer token, no developer portal application, no OAuth setup.

### Option B: X API Bearer Token

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

### Switching backends

```bash
# Auto-detect (prefers Xquik when both keys are set)
bun run x-search.ts search "AI agents"

# Force a specific backend
bun run x-search.ts search "AI agents" --backend xquik
bun run x-search.ts search "AI agents" --backend x-api

# Or set via env
export X_RESEARCH_BACKEND=xquik
```

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

Filters out low-engagement tweets (≥10 likes required). Applied post-fetch since `min_faves` isn't available as an X API search operator.

```bash
bun run x-search.ts search "crypto AI" --quality
```

## Cost

x-search supports two backends with very different pricing:

### Backend comparison

| | Xquik | X API v2 |
|---|---|---|
| **Cost per tweet read** | **$0.00015** | $0.005 |
| **Cost per user lookup** | **$0.00015** | $0.010 |
| **100-tweet search** | **~$0.015** | ~$0.50 |
| **Deep research (3 pages)** | **~$0.045** | ~$1.50 |
| **Profile check** | **~$0.004** | ~$0.51 |
| **Watchlist check (5 accounts)** | **~$0.02** | ~$2.55 |
| **Cached repeat** | free | free |
| **Auth** | API key | Bearer token |
| **Rate limits** | None | 450 req/15min |

That's **33x cheaper** per tweet read with Xquik. A heavy research session that costs $5 on X API v2 costs ~$0.15 on Xquik.

### X API v2 pricing details

The X API uses **pay-per-use pricing** with prepaid credits. No subscriptions, no monthly caps. You buy credits in the [Developer Console](https://console.x.com) and they're deducted per request.

**24-hour deduplication:** If you request the same post twice in a UTC day, you're only charged once.

**Spending controls:** Set auto-recharge thresholds and spending limits per billing cycle in the Developer Console. Failed requests are never billed.

**xAI credit bonus:** Spend $200+/cycle on X API → earn 10-20% back as xAI/Grok API credits. See [pricing docs](https://docs.x.com/x-api/getting-started/pricing).

### How x-search saves money (both backends)

- Cache (15min default, 1hr in quick mode) — repeat queries are free
- Quick mode prevents accidental multi-page fetches
- Cost displayed after every search so you know what you're spending
- `--from` targets specific users instead of broad searches
- Using Xquik backend reduces costs by 33x out of the box

## File structure

```
x-research/
├── SKILL.md              # Agent instructions (Claude reads this)
├── x-search.ts           # CLI entry point
├── lib/
│   ├── api.ts            # API router (auto-detects backend)
│   ├── xquik.ts          # Xquik backend ($0.00015/tweet)
│   ├── cache.ts          # File-based cache
│   └── format.ts         # Telegram + markdown formatters
└── data/
    ├── watchlist.json    # Accounts to monitor
    └── cache/            # Auto-managed
```

## Security

**Xquik API key:** Sent as an `X-API-Key` header. Scoped to read-only operations by default. Lower risk than Bearer tokens since it doesn't grant write access to your X account.

**X API Bearer token:** x-search reads your token from the `X_BEARER_TOKEN` env var or `~/.config/env/global.env`. The token is never printed to stdout, but be aware:

- **AI coding agents** (Claude Code, Codex, etc.) may log tool calls — including HTTP headers — in session transcripts. If you're running x-search inside an agent session, your bearer token could appear in those logs.
- **Recommendations:**
  - Set tokens as system env vars (not inline in commands)
  - Review your agent's session log settings
  - Use a token with minimal permissions (read-only)
  - Rotate your token if you suspect exposure
  - Consider using the Xquik backend to avoid exposing your X Bearer token entirely

## Limitations

- **X API v2 backend:** Search covers last 7 days only (uses `/2/tweets/search/recent`). Full-archive search is available on the same pay-per-use plan but not yet implemented.
- **Xquik backend:** No 7-day limit on search.
- Read-only — never posts or interacts
- Requires either a Xquik API key ([xquik.com](https://xquik.com)) or X API access with prepaid credits ([console.x.com](https://console.x.com))
- `min_likes` / `min_retweets` search operators unavailable (filtered post-hoc instead)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=rohunvora/x-research-skill&type=Date)](https://star-history.com/#rohunvora/x-research-skill&Date)

## License

MIT
