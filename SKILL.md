---
name: x-research
description: >
  General-purpose X/Twitter research agent. Searches X for real-time perspectives,
  dev discussions, product feedback, cultural takes, breaking news, and expert opinions.
  Works like a web research agent but uses X as the source.
  Use when: (1) user says "x research", "search x for", "search twitter for",
  "what are people saying about", "what's twitter saying", "check x for", "x search",
  "/x-research", (2) user is working on something where recent X discourse would provide
  useful context (new library releases, API changes, product launches, cultural events,
  industry drama), (3) user wants to find what devs/experts/community thinks about a topic.
  NOT for: posting tweets or account management. Note: currently uses recent search (last 7 days). Full-archive search is available on the same pay-per-use X API plan but not yet implemented in this skill.
---

# X Research

General-purpose agentic research over X/Twitter. Decompose any research question into targeted searches, iteratively refine, follow threads, deep-dive linked content, and synthesize into a sourced briefing.

For X API details (endpoints, operators, response format): read `references/x-api.md`.

## CLI Tool

All commands run from this skill directory:

```bash
cd ~/clawd/skills/x-research
source ~/.config/env/global.env
```

### Search

```bash
bun run x-search.ts search "<query>" [options]
```

**Options:**
- `--sort likes|impressions|retweets|recent` — sort order (default: likes)
- `--since 1h|3h|12h|1d|7d` — time filter (default: last 7 days). Also accepts minutes (`30m`) or ISO timestamps.
- `--min-likes N` — filter by minimum likes
- `--min-impressions N` — filter by minimum impressions
- `--pages N` — pages to fetch, 1-5 (default: 1, 100 tweets/page)
- `--limit N` — max results to display (default: 15)
- `--quick` — quick mode: 1 page, max 10 results, auto noise filter (`-is:retweet -is:reply`), 1hr cache, cost summary
- `--from <username>` — shorthand for `from:username` in query
- `--quality` — filter low-engagement tweets (≥10 likes, post-hoc)
- `--no-replies` — exclude replies
- `--save` — save results to `~/clawd/drafts/x-research-{slug}-{date}.md`
- `--json` — raw JSON output
- `--markdown` — markdown output for research docs

Auto-adds `-is:retweet` unless query already includes it. All searches display estimated API cost.

**Examples:**
```bash
bun run x-search.ts search "BNKR" --sort likes --limit 10
bun run x-search.ts search "from:frankdegods" --sort recent
bun run x-search.ts search "(opus 4.6 OR claude) trading" --pages 2 --save
bun run x-search.ts search "$BNKR (revenue OR fees)" --min-likes 5
bun run x-search.ts search "BNKR" --quick
bun run x-search.ts search "BNKR" --from voidcider --quick
bun run x-search.ts search "AI agents" --quality --quick
```

### Profile

```bash
bun run x-search.ts profile <username> [--count N] [--replies] [--json]
```

Fetches recent tweets from a specific user (excludes replies by default).

### Thread

```bash
bun run x-search.ts thread <tweet_id> [--pages N]
```

Fetches full conversation thread by root tweet ID.

### Single Tweet

```bash
bun run x-search.ts tweet <tweet_id> [--json]
```

### Watchlist

```bash
bun run x-search.ts watchlist                       # Show all
bun run x-search.ts watchlist add <user> [note]     # Add account
bun run x-search.ts watchlist remove <user>          # Remove account
bun run x-search.ts watchlist check                  # Check recent from all
```

Watchlist stored in `data/watchlist.json`. Use for heartbeat integration — check if key accounts posted anything important.

### Cache

```bash
bun run x-search.ts cache clear    # Clear all cached results
```

15-minute TTL. Avoids re-fetching identical queries.

## Research Loop (Agentic)

When doing deep research (not just a quick search), follow this loop:

### 1. Decompose the Question into Queries

Turn the research question into 3-5 keyword queries using X search operators:

- **Core query**: Direct keywords for the topic
- **Expert voices**: `from:` specific known experts
- **Pain points**: Keywords like `(broken OR bug OR issue OR migration)`
- **Positive signal**: Keywords like `(shipped OR love OR fast OR benchmark)`
- **Links**: `url:github.com` or `url:` specific domains
- **Noise reduction**: `-is:retweet` (auto-added), add `-is:reply` if needed
- **Crypto spam**: Add `-airdrop -giveaway -whitelist` if crypto topics flooding

### 2. Search and Extract

Run each query via CLI. After each, assess:
- Signal or noise? Adjust operators.
- Key voices worth searching `from:` specifically?
- Threads worth following via `thread` command?
- Linked resources worth deep-diving with `web_fetch`?

### 3. Follow Threads

When a tweet has high engagement or is a thread starter:
```bash
bun run x-search.ts thread <tweet_id>
```

### 4. Deep-Dive Linked Content

When tweets link to GitHub repos, blog posts, or docs, fetch with `web_fetch`. Prioritize links that:
- Multiple tweets reference
- Come from high-engagement tweets
- Point to technical resources directly relevant to the question

### 5. Synthesize

Group findings by theme, not by query:

```
### [Theme/Finding Title]

[1-2 sentence summary]

- @username: "[key quote]" (NL, NI) [Tweet](url)
- @username2: "[another perspective]" (NL, NI) [Tweet](url)

Resources shared:
- [Resource title](url) — [what it is]
```

### 6. Save

Use `--save` flag or save manually to `~/clawd/drafts/x-research-{topic-slug}-{YYYY-MM-DD}.md`.

## Refinement Heuristics

- **Too much noise?** Add `-is:reply`, use `--sort likes`, narrow keywords
- **Too few results?** Broaden with `OR`, remove restrictive operators
- **Crypto spam?** Add `-$ -airdrop -giveaway -whitelist`
- **Expert takes only?** Use `from:` or `--min-likes 50`
- **Substance over hot takes?** Search with `has:links`

## Heartbeat Integration

On heartbeat, can run `watchlist check` to see if key accounts posted anything notable. Flag to Frank only if genuinely interesting/actionable — don't report routine tweets.

## File Structure

```
skills/x-research/
├── SKILL.md           (this file)
├── x-search.ts        (CLI entry point)
├── lib/
│   ├── api.ts         (X API wrapper: search, thread, profile, tweet)
│   ├── cache.ts       (file-based cache, 15min TTL)
│   └── format.ts      (Telegram + markdown formatters)
├── data/
│   ├── watchlist.json  (accounts to monitor)
│   └── cache/          (auto-managed)
└── references/
    └── x-api.md        (X API endpoint reference)
```
