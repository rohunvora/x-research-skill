/**
 * Format tweets for Telegram or markdown output.
 */

import type { Tweet } from "./api";

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Format a single tweet for Telegram (monospace-friendly).
 */
export function formatTweetTelegram(t: Tweet, index?: number, opts?: { full?: boolean }): string {
  const prefix = index !== undefined ? `${index + 1}. ` : "";
  const engagement = `${compactNumber(t.metrics.likes)}❤️ ${compactNumber(t.metrics.impressions)}👁`;
  const time = timeAgo(t.created_at);

  // Truncate text to 200 chars for summary view, full text for single tweet/thread
  const text = opts?.full || t.text.length <= 200 ? t.text : t.text.slice(0, 197) + "...";
  // Clean up t.co links from text
  const cleanText = text.replace(/https:\/\/t\.co\/\S+/g, "").trim();

  let out = `${prefix}@${t.username} (${engagement} · ${time})\n${cleanText}`;

  if (t.urls.length > 0) {
    out += `\n🔗 ${t.urls[0]}`;
  }
  out += `\n${t.tweet_url}`;

  return out;
}

/**
 * Format a list of tweets for Telegram.
 */
export function formatResultsTelegram(
  tweets: Tweet[],
  opts: { query?: string; limit?: number } = {}
): string {
  const limit = opts.limit || 15;
  const shown = tweets.slice(0, limit);

  let out = "";
  if (opts.query) {
    out += `🔍 "${opts.query}" — ${tweets.length} results\n\n`;
  }

  out += shown.map((t, i) => formatTweetTelegram(t, i)).join("\n\n");

  if (tweets.length > limit) {
    out += `\n\n... +${tweets.length - limit} more`;
  }

  return out;
}

/**
 * Format a single tweet for markdown (research docs).
 */
export function formatTweetMarkdown(t: Tweet): string {
  const engagement = `${t.metrics.likes}L ${t.metrics.impressions}I`;
  const cleanText = t.text.replace(/https:\/\/t\.co\/\S+/g, "").trim();
  const quoted = cleanText.replace(/\n/g, "\n  > ");

  let out = `- **@${t.username}** (${engagement}) [Tweet](${t.tweet_url})\n  > ${quoted}`;

  if (t.urls.length > 0) {
    out += `\n  Links: ${t.urls.map((u) => `[${new URL(u).hostname}](${u})`).join(", ")}`;
  }

  return out;
}

/**
 * Format results as a full markdown research document.
 */
export function formatResearchMarkdown(
  query: string,
  tweets: Tweet[],
  opts: {
    themes?: { title: string; tweetIds: string[] }[];
    apiCalls?: number;
    queries?: string[];
  } = {}
): string {
  const date = new Date().toISOString().split("T")[0];

  let out = `# X Research: ${query}\n\n`;
  out += `**Date:** ${date}\n`;
  out += `**Tweets found:** ${tweets.length}\n\n`;

  if (opts.themes && opts.themes.length > 0) {
    for (const theme of opts.themes) {
      out += `## ${theme.title}\n\n`;
      const themeTweets = theme.tweetIds
        .map((id) => tweets.find((t) => t.id === id))
        .filter(Boolean) as Tweet[];
      out += themeTweets.map(formatTweetMarkdown).join("\n\n");
      out += "\n\n";
    }
  } else {
    // No themes — just list by engagement
    out += `## Top Results (by engagement)\n\n`;
    out += tweets
      .slice(0, 30)
      .map(formatTweetMarkdown)
      .join("\n\n");
    out += "\n\n";
  }

  out += `---\n\n## Research Metadata\n`;
  out += `- **Query:** ${query}\n`;
  out += `- **Date:** ${date}\n`;
  if (opts.apiCalls) out += `- **API calls:** ${opts.apiCalls}\n`;
  out += `- **Tweets scanned:** ${tweets.length}\n`;
  out += `- **Est. cost:** ~$${((tweets.length * 0.005)).toFixed(2)}\n`;
  if (opts.queries) {
    out += `- **Search queries:**\n`;
    for (const q of opts.queries) {
      out += `  - \`${q}\`\n`;
    }
  }

  return out;
}

/**
 * Format a user profile for Telegram.
 */
export function formatProfileTelegram(user: any, tweets: Tweet[]): string {
  const m = user.public_metrics || {};
  let out = `👤 @${user.username} — ${user.name}\n`;
  out += `${compactNumber(m.followers_count || 0)} followers · ${compactNumber(m.tweet_count || 0)} tweets\n`;
  if (user.description) {
    out += `${user.description.slice(0, 150)}\n`;
  }
  out += `\nRecent:\n\n`;
  out += tweets
    .slice(0, 10)
    .map((t, i) => formatTweetTelegram(t, i))
    .join("\n\n");

  return out;
}
