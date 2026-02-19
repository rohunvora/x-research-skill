#!/usr/bin/env bun
/**
 * x-search — CLI for X/Twitter research.
 *
 * Commands:
 *   search <query> [options]    Search recent tweets
 *   thread <tweet_id>           Fetch full conversation thread
 *   profile <username>          Recent tweets from a user
 *   tweet <tweet_id>            Fetch a single tweet
 *   watchlist                   Show watchlist
 *   watchlist add <user>        Add user to watchlist
 *   watchlist remove <user>     Remove user from watchlist
 *   watchlist check             Check recent tweets from all watchlist accounts
 *   cache clear                 Clear search cache
 *
 * Search options:
 *   --sort likes|impressions|retweets|recent   Sort order (default: likes)
 *   --min-likes N              Filter by minimum likes
 *   --min-impressions N        Filter by minimum impressions
 *   --pages N                  Number of pages to fetch (default: 1, max 5)
 *   --no-replies               Exclude replies
 *   --no-retweets              Exclude retweets (added by default)
 *   --limit N                  Max results to display (default: 15)
 *   --quick                    Quick mode: 1 page, noise filter, 1hr cache
 *   --from <username>          Shorthand for from:username in query
 *   --quality                  Pre-filter low-engagement (min_faves:10)
 *   --save                     Save results to ~/clawd/drafts/
 *   --json                     Output raw JSON
 *   --markdown                 Output as markdown (for research docs)
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import * as api from "./lib/api";
import * as cache from "./lib/cache";
import * as fmt from "./lib/format";
import * as usage from "./lib/usage";

const SKILL_DIR = import.meta.dir;
const WATCHLIST_PATH = join(SKILL_DIR, "data", "watchlist.json");
const DRAFTS_DIR = join(process.env.HOME!, "clawd", "drafts");

// --- Arg parsing ---

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): boolean {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0) {
    args.splice(idx, 1);
    return true;
  }
  return false;
}

function getOpt(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return undefined;
}

// --- Watchlist ---

interface Watchlist {
  accounts: { username: string; note?: string; addedAt: string }[];
}

function loadWatchlist(): Watchlist {
  if (!existsSync(WATCHLIST_PATH))
    return { accounts: [] };
  return JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8"));
}

function saveWatchlist(wl: Watchlist) {
  writeFileSync(WATCHLIST_PATH, JSON.stringify(wl, null, 2));
}

// --- Commands ---

async function cmdSearch() {
  // Parse new flags first (before getOpt consumes positional args)
  const quick = getFlag("quick");
  const quality = getFlag("quality");
  const fromUser = getOpt("from");

  const sortOpt = getOpt("sort") || "likes";
  const minLikes = parseInt(getOpt("min-likes") || "0");
  const minImpressions = parseInt(getOpt("min-impressions") || "0");
  let pages = Math.min(parseInt(getOpt("pages") || "1"), 5);
  let limit = parseInt(getOpt("limit") || "15");
  const since = getOpt("since");
  const noReplies = getFlag("no-replies");
  const noRetweets = getFlag("no-retweets");
  const save = getFlag("save");
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");

  // Quick mode overrides
  if (quick) {
    pages = 1;
    limit = Math.min(limit, 10);
  }

  // Everything after "search" that isn't a flag is the query
  const queryParts = args.slice(1).filter((a) => !a.startsWith("--"));
  let query = queryParts.join(" ");

  if (!query) {
    console.error("Usage: x-search.ts search <query> [options]");
    process.exit(1);
  }

  // --from shorthand: add from:username if not already in query
  if (fromUser && !query.toLowerCase().includes("from:")) {
    query += ` from:${fromUser.replace(/^@/, "")}`;
  }

  // Auto-add noise filters unless already present
  if (!query.includes("is:retweet") && !noRetweets) {
    query += " -is:retweet";
  }
  if (quick && !query.includes("is:reply")) {
    query += " -is:reply";
  } else if (noReplies && !query.includes("is:reply")) {
    query += " -is:reply";
  }

  // Cache TTL: 1hr for quick mode, 15min default
  const cacheTtlMs = quick ? 3_600_000 : 900_000;

  // Budget check before making API calls
  const budgetBlock = usage.checkBudget(pages * 100);
  if (budgetBlock) {
    console.error(budgetBlock);
    process.exit(1);
  }

  // Check cache (cache key does NOT include quick flag — shared between modes)
  const cacheParams = `sort=${sortOpt}&pages=${pages}&since=${since || "7d"}`;
  const cached = cache.get(query, cacheParams, cacheTtlMs);
  let tweets: api.Tweet[];

  if (cached) {
    tweets = cached;
    console.error(`(cached — ${tweets.length} tweets)`);
  } else {
    tweets = await api.search(query, {
      pages,
      sortOrder: sortOpt === "recent" ? "recency" : "relevancy",
      since: since || undefined,
    });
    cache.set(query, cacheParams, tweets);
  }

  // Track raw count for cost (API charges per tweet read, regardless of post-hoc filters)
  const rawTweetCount = tweets.length;

  // Filter
  if (minLikes > 0 || minImpressions > 0) {
    tweets = api.filterEngagement(tweets, {
      minLikes: minLikes || undefined,
      minImpressions: minImpressions || undefined,
    });
  }

  // --quality: post-hoc filter for min 10 likes (min_faves not available as a search operator)
  if (quality) {
    tweets = api.filterEngagement(tweets, { minLikes: 10 });
  }

  // Sort
  if (sortOpt !== "recent") {
    const metric = sortOpt as "likes" | "impressions" | "retweets";
    tweets = api.sortBy(tweets, metric);
  }

  tweets = api.dedupe(tweets);

  // Output
  if (asJson) {
    console.log(JSON.stringify(tweets.slice(0, limit), null, 2));
  } else if (asMarkdown) {
    const md = fmt.formatResearchMarkdown(query, tweets, {
      queries: [query],
    });
    console.log(md);
  } else {
    console.log(fmt.formatResultsTelegram(tweets, { query, limit }));
  }

  // Save
  if (save) {
    const slug = query
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40)
      .toLowerCase();
    const date = new Date().toISOString().split("T")[0];
    const path = join(DRAFTS_DIR, `x-research-${slug}-${date}.md`);
    const md = fmt.formatResearchMarkdown(query, tweets, {
      queries: [query],
    });
    writeFileSync(path, md);
    console.error(`\nSaved to ${path}`);
  }

  // Record usage and check budget warnings
  if (!cached) {
    const warning = usage.recordUsage(rawTweetCount);
    if (warning) console.error(warning);
  }

  // Cost display (based on raw API reads, not post-filter count)
  const cost = (rawTweetCount * 0.005).toFixed(2);
  if (quick) {
    console.error(`\n⚡ quick mode · ${rawTweetCount} tweets read (~$${cost})`);
  } else {
    console.error(`\n📊 ${rawTweetCount} tweets read · est. cost ~$${cost}`);
  }

  // Stats to stderr
  const filtered = rawTweetCount !== tweets.length ? ` → ${tweets.length} after filters` : "";
  const sinceLabel = since ? ` | since ${since}` : "";
  console.error(
    `${rawTweetCount} tweets${filtered} | sorted by ${sortOpt} | ${pages} page(s)${sinceLabel}`
  );
}

async function cmdThread() {
  const tweetId = args[1];
  if (!tweetId) {
    console.error("Usage: x-search.ts thread <tweet_id>");
    process.exit(1);
  }

  const pages = Math.min(parseInt(getOpt("pages") || "2"), 5);
  const tweets = await api.thread(tweetId, { pages });

  // Record usage: thread fetches root tweet + conversation search
  usage.recordUsage(tweets.length + 1);

  if (tweets.length === 0) {
    console.log("No tweets found in thread.");
    return;
  }

  console.log(`🧵 Thread (${tweets.length} tweets)\n`);
  for (const t of tweets) {
    console.log(fmt.formatTweetTelegram(t, undefined, { full: true }));
    console.log();
  }
}

async function cmdProfile() {
  const username = args[1]?.replace(/^@/, "");
  if (!username) {
    console.error("Usage: x-search.ts profile <username>");
    process.exit(1);
  }

  const count = parseInt(getOpt("count") || "20");
  const includeReplies = getFlag("replies");
  const asJson = getFlag("json");

  const { user, tweets } = await api.profile(username, {
    count,
    includeReplies,
  });

  // Record usage: 1 user lookup + tweet reads
  usage.recordUsage(tweets.length);

  if (asJson) {
    console.log(JSON.stringify({ user, tweets }, null, 2));
  } else {
    console.log(fmt.formatProfileTelegram(user, tweets));
  }
}

async function cmdTweet() {
  const tweetId = args[1];
  if (!tweetId) {
    console.error("Usage: x-search.ts tweet <tweet_id>");
    process.exit(1);
  }

  const tweet = await api.getTweet(tweetId);
  if (!tweet) {
    console.log("Tweet not found.");
    return;
  }

  const asJson = getFlag("json");
  if (asJson) {
    console.log(JSON.stringify(tweet, null, 2));
  } else {
    console.log(fmt.formatTweetTelegram(tweet, undefined, { full: true }));
  }
}

async function cmdWatchlist() {
  const sub = args[1];
  const wl = loadWatchlist();

  if (sub === "add") {
    const username = args[2]?.replace(/^@/, "");
    const note = args.slice(3).join(" ") || undefined;
    if (!username) {
      console.error("Usage: x-search.ts watchlist add <username> [note]");
      process.exit(1);
    }
    if (wl.accounts.find((a) => a.username.toLowerCase() === username.toLowerCase())) {
      console.log(`@${username} already on watchlist.`);
      return;
    }
    wl.accounts.push({
      username,
      note,
      addedAt: new Date().toISOString(),
    });
    saveWatchlist(wl);
    console.log(`Added @${username} to watchlist.${note ? ` (${note})` : ""}`);
    return;
  }

  if (sub === "remove" || sub === "rm") {
    const username = args[2]?.replace(/^@/, "");
    if (!username) {
      console.error("Usage: x-search.ts watchlist remove <username>");
      process.exit(1);
    }
    const before = wl.accounts.length;
    wl.accounts = wl.accounts.filter(
      (a) => a.username.toLowerCase() !== username.toLowerCase()
    );
    saveWatchlist(wl);
    console.log(
      wl.accounts.length < before
        ? `Removed @${username} from watchlist.`
        : `@${username} not found on watchlist.`
    );
    return;
  }

  if (sub === "check") {
    if (wl.accounts.length === 0) {
      console.log("Watchlist is empty. Add accounts with: watchlist add <username>");
      return;
    }
    console.log(`Checking ${wl.accounts.length} watchlist accounts...\n`);
    for (const acct of wl.accounts) {
      try {
        const { user, tweets } = await api.profile(acct.username, { count: 5 });
        const label = acct.note ? ` (${acct.note})` : "";
        console.log(`\n--- @${acct.username}${label} ---`);
        if (tweets.length === 0) {
          console.log("  No recent tweets.");
        } else {
          for (const t of tweets.slice(0, 3)) {
            console.log(fmt.formatTweetTelegram(t));
            console.log();
          }
        }
      } catch (e: any) {
        console.error(`  Error checking @${acct.username}: ${e.message}`);
      }
    }
    return;
  }

  // Default: show watchlist
  if (wl.accounts.length === 0) {
    console.log("Watchlist is empty. Add accounts with: watchlist add <username>");
    return;
  }
  console.log(`📋 Watchlist (${wl.accounts.length} accounts)\n`);
  for (const acct of wl.accounts) {
    const note = acct.note ? ` — ${acct.note}` : "";
    console.log(`  @${acct.username}${note} (added ${acct.addedAt.split("T")[0]})`);
  }
}

async function cmdCache() {
  const sub = args[1];
  if (sub === "clear") {
    const removed = cache.clear();
    console.log(`Cleared ${removed} cached entries.`);
  } else {
    const removed = cache.prune();
    console.log(`Pruned ${removed} expired entries.`);
  }
}

async function cmdUsage() {
  const sub = args[1];

  if (sub === "budget") {
    const action = args[2];
    const budget = usage.loadBudget();

    if (action === "set-daily") {
      const limit = parseFloat(args[3]);
      if (isNaN(limit) || limit < 0) {
        console.error("Usage: x-search.ts usage budget set-daily <amount_usd>");
        console.error("  Set to 0 to remove daily limit.");
        process.exit(1);
      }
      budget.dailyLimitUsd = limit;
      usage.saveBudget(budget);
      console.log(
        limit === 0
          ? "Daily budget limit removed."
          : `Daily budget set to $${limit.toFixed(2)}`
      );
      return;
    }

    if (action === "set-monthly") {
      const limit = parseFloat(args[3]);
      if (isNaN(limit) || limit < 0) {
        console.error("Usage: x-search.ts usage budget set-monthly <amount_usd>");
        console.error("  Set to 0 to remove monthly limit.");
        process.exit(1);
      }
      budget.monthlyLimitUsd = limit;
      usage.saveBudget(budget);
      console.log(
        limit === 0
          ? "Monthly budget limit removed."
          : `Monthly budget set to $${limit.toFixed(2)}`
      );
      return;
    }

    if (action === "reset") {
      budget.localTracking = {
        today: new Date().toISOString().split("T")[0],
        todayPostReads: 0,
        todayCost: 0,
        rollingPostReads: 0,
        rollingCost: 0,
        lastReset: new Date().toISOString(),
      };
      usage.saveBudget(budget);
      console.log("Budget counters reset.");
      return;
    }

    // Default: show budget status
    console.log(`💰 Budget Configuration\n`);
    console.log(
      `  Daily limit:   ${budget.dailyLimitUsd > 0 ? `$${budget.dailyLimitUsd.toFixed(2)}` : "none"}`
    );
    console.log(
      `  Monthly limit: ${budget.monthlyLimitUsd > 0 ? `$${budget.monthlyLimitUsd.toFixed(2)}` : "none"}`
    );
    console.log(`  Warn at:       ${Math.round(budget.warnThreshold * 100)}% of limit`);
    console.log(`\n📊 Today's Usage\n`);
    console.log(
      `  Post reads: ${budget.localTracking.todayPostReads.toLocaleString()}`
    );
    console.log(
      `  Est. cost:  $${budget.localTracking.todayCost.toFixed(2)}`
    );
    console.log(`\n📊 Rolling (since ${budget.localTracking.lastReset.split("T")[0]})\n`);
    console.log(
      `  Post reads: ${budget.localTracking.rollingPostReads.toLocaleString()}`
    );
    console.log(
      `  Est. cost:  $${budget.localTracking.rollingCost.toFixed(2)}`
    );
    return;
  }

  // Default: fetch usage from API
  const days = parseInt(getOpt("days") || "7");
  const asJson = getFlag("json");
  const asMarkdown = getFlag("markdown");

  try {
    const data = await usage.fetchUsage({ days });
    if (asJson) {
      console.log(JSON.stringify(data, null, 2));
    } else if (asMarkdown) {
      console.log(usage.formatUsageMarkdown(data));
    } else {
      console.log(usage.formatUsageTelegram(data));
    }
  } catch (e: any) {
    console.error(`Error fetching usage: ${e.message}`);
    // Fall back to local tracking
    console.log(`\nLocal tracking (fallback):\n`);
    const budget = usage.loadBudget();
    console.log(
      `  Today: ${budget.localTracking.todayPostReads} reads (~$${budget.localTracking.todayCost.toFixed(2)})`
    );
    console.log(
      `  Rolling: ${budget.localTracking.rollingPostReads} reads (~$${budget.localTracking.rollingCost.toFixed(2)})`
    );
  }
}

function showUsage() {
  console.log(`x-search — X/Twitter research CLI

Commands:
  search <query> [options]    Search recent tweets (last 7 days)
  thread <tweet_id>           Fetch full conversation thread
  profile <username>          Recent tweets from a user
  tweet <tweet_id>            Fetch a single tweet
  watchlist                   Show watchlist
  watchlist add <user> [note] Add user to watchlist
  watchlist remove <user>     Remove user from watchlist
  watchlist check             Check recent from all watchlist accounts
  cache clear                 Clear search cache
  usage                       Show API usage (from X API or local tracking)
  usage budget                Show budget configuration and status
  usage budget set-daily N    Set daily spending limit (USD, 0 to remove)
  usage budget set-monthly N  Set monthly spending limit (USD, 0 to remove)
  usage budget reset          Reset usage counters

Search options:
  --sort likes|impressions|retweets|recent   (default: likes)
  --since 1h|3h|12h|1d|7d   Time filter (default: last 7 days)
  --min-likes N              Filter minimum likes
  --min-impressions N        Filter minimum impressions
  --pages N                  Pages to fetch, 1-5 (default: 1)
  --limit N                  Results to display (default: 15)
  --quick                    Quick mode: 1 page, max 10 results, auto noise
                             filter, 1hr cache TTL, cost summary
  --from <username>          Shorthand for from:username in query
  --quality                  Pre-filter low-engagement tweets (min_faves:10)
  --no-replies               Exclude replies
  --save                     Save to ~/clawd/drafts/
  --json                     Raw JSON output
  --markdown                 Markdown output`);
}

// --- Main ---

async function main() {
  switch (command) {
    case "search":
    case "s":
      await cmdSearch();
      break;
    case "thread":
    case "t":
      await cmdThread();
      break;
    case "profile":
    case "p":
      await cmdProfile();
      break;
    case "tweet":
      await cmdTweet();
      break;
    case "watchlist":
    case "wl":
      await cmdWatchlist();
      break;
    case "cache":
      await cmdCache();
      break;
    case "usage":
    case "u":
      await cmdUsage();
      break;
    default:
      showUsage();
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
