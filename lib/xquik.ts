/**
 * Xquik API backend — drop-in alternative to the X API v2.
 * Uses API key from env: XQUIK_API_KEY
 *
 * 33x cheaper than X API v2: $0.00015/tweet vs $0.005/tweet.
 * A 100-tweet search costs ~$0.015 instead of ~$0.50.
 *
 * SDK: https://www.npmjs.com/package/@xquik/tweetclaw
 */

import type { Tweet } from "./api";

const BASE = "https://xquik.com/api/v1";

export function getXquikKey(): string {
  if (process.env.XQUIK_API_KEY) return process.env.XQUIK_API_KEY;
  throw new Error(
    "XQUIK_API_KEY not found. Get one at https://xquik.com/dashboard/api-keys"
  );
}

export function hasXquikKey(): boolean {
  return !!process.env.XQUIK_API_KEY;
}

/** Cost per tweet read via Xquik (1 credit = $0.00015). */
export const COST_PER_TWEET = 0.00015;

/** Cost per user lookup via Xquik. */
export const COST_PER_USER = 0.00015;

async function xquikGet(
  path: string,
  params: Record<string, string | number | undefined> = {}
): Promise<any> {
  const key = getXquikKey();
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`;

  const res = await fetch(url, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Xquik API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Map a Xquik tweet object to the shared Tweet interface.
 */
function mapTweet(t: any): Tweet {
  const author = t.author || {};
  return {
    id: t.id,
    text: t.text || "",
    author_id: author.id || "",
    username: author.username || "?",
    name: author.name || "?",
    created_at: t.createdAt || "",
    conversation_id: t.conversationId || t.id,
    metrics: {
      likes: t.likeCount || 0,
      retweets: t.retweetCount || 0,
      replies: t.replyCount || 0,
      quotes: t.quoteCount || 0,
      impressions: t.viewCount || 0,
      bookmarks: t.bookmarkCount || 0,
    },
    urls: (t.entities?.urls || [])
      .map((u: any) => u.expanded_url || u.url)
      .filter(Boolean),
    mentions: (t.entities?.mentions || [])
      .map((m: any) => m.username)
      .filter(Boolean),
    hashtags: (t.entities?.hashtags || [])
      .map((h: any) => h.tag)
      .filter(Boolean),
    tweet_url: `https://x.com/${author.username || "?"}/status/${t.id}`,
  };
}

/**
 * Search tweets via Xquik API.
 * Supports the same X search operators (from:, #hashtag, OR, -is:retweet, etc.)
 */
export async function xquikSearch(
  query: string,
  opts: {
    maxResults?: number;
    pages?: number;
    sortOrder?: "relevancy" | "recency";
    since?: string;
  } = {}
): Promise<Tweet[]> {
  const limit = Math.max(Math.min(opts.maxResults || 100, 200), 10);
  const pages = opts.pages || 1;
  const queryType = opts.sortOrder === "recency" ? "Latest" : "Top";

  let allTweets: Tweet[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < pages; page++) {
    const params: Record<string, string | number | undefined> = {
      q: query,
      limit,
      queryType,
      cursor,
      sinceTime: opts.since,
    };

    const raw = await xquikGet("/x/tweets/search", params);
    const tweets = (raw.tweets || []).map(mapTweet);
    allTweets.push(...tweets);

    cursor = raw.next_cursor;
    if (!raw.has_next_page || !cursor) break;
  }

  return allTweets;
}

/**
 * Fetch a single tweet by ID via Xquik.
 */
export async function xquikGetTweet(tweetId: string): Promise<Tweet | null> {
  try {
    const raw = await xquikGet(`/x/tweets/${tweetId}`);
    return mapTweet(raw);
  } catch {
    return null;
  }
}

/**
 * Get user profile via Xquik.
 */
export async function xquikGetUser(username: string): Promise<any> {
  const raw = await xquikGet(`/x/users/${username}`);
  // Map to the same shape as X API v2 user object
  return {
    id: raw.id,
    username: raw.username,
    name: raw.name,
    description: raw.description || "",
    created_at: raw.createdAt || "",
    public_metrics: {
      followers_count: raw.followers || 0,
      following_count: raw.following || 0,
      tweet_count: raw.statusesCount || 0,
    },
  };
}

/**
 * Get recent tweets from a specific user via Xquik search.
 */
export async function xquikProfile(
  username: string,
  opts: { count?: number; includeReplies?: boolean } = {}
): Promise<{ user: any; tweets: Tweet[] }> {
  const user = await xquikGetUser(username);

  const replyFilter = opts.includeReplies ? "" : " -is:reply";
  const query = `from:${username} -is:retweet${replyFilter}`;
  const tweets = await xquikSearch(query, {
    maxResults: Math.min(opts.count || 20, 100),
    sortOrder: "recency",
  });

  return { user, tweets };
}

/**
 * Fetch a conversation thread via Xquik.
 */
export async function xquikThread(
  conversationId: string,
  opts: { pages?: number } = {}
): Promise<Tweet[]> {
  const query = `conversation_id:${conversationId}`;
  const tweets = await xquikSearch(query, {
    pages: opts.pages || 2,
    sortOrder: "recency",
  });

  // Also fetch the root tweet
  try {
    const root = await xquikGetTweet(conversationId);
    if (root) {
      tweets.unshift(root);
    }
  } catch {
    // Root tweet might be deleted
  }

  return tweets;
}
