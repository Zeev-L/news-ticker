// Slack lane provider — reads the signed-in user's unread DMs (and optionally
// channels) via the Slack Web API with a user token (xoxp).
//
// Slack has no bulk "unread" endpoint for standard tokens, so we list the user's
// conversations and check each with conversations.info (which carries
// unread_count_display + last_read). That's ~1 call per conversation, so we cap
// how many we check per poll and back off on rate limits.

const MAX_CHECK = 60;          // conversations inspected per refresh (rate-limit guard)
const teamCache = {};          // token -> team_id
const userCache = {};          // "token:userId" -> display name

async function api(method, token, params) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch('https://slack.com/api/' + method + qs, {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('retry-after') || '5', 10);
    const e = new Error('rate_limited'); e.retryAfter = retry; e.rateLimited = true; throw e;
  }
  return res.json();
}

async function teamId(token) {
  if (teamCache[token]) return teamCache[token];
  const r = await api('auth.test', token);
  teamCache[token] = (r && r.team_id) || '';
  return teamCache[token];
}

async function userName(token, userId) {
  if (!userId) return '';
  const key = token + ':' + userId;
  if (userCache[key]) return userCache[key];
  try {
    const r = await api('users.info', token, { user: userId });
    const p = r.ok ? r.user : null;
    const name = p ? (p.profile.display_name || p.real_name || p.name) : userId;
    userCache[key] = name;
    return name;
  } catch (e) { return userId; }
}

async function listConversations(token, types) {
  let out = [], cursor;
  do {
    const r = await api('users.conversations', token,
      Object.assign({ types, limit: 200, exclude_archived: true }, cursor ? { cursor } : {}));
    if (!r.ok) throw new Error(r.error || 'users.conversations failed');
    out = out.concat(r.channels || []);
    cursor = r.response_metadata && r.response_metadata.next_cursor;
  } while (cursor && out.length < 400);
  return out;
}

// Strip Slack mrkdwn niceties for a compact ticker snippet.
function clean(text) {
  return String(text || '')
    .replace(/<@[^>]+>/g, '@מישהו')
    .replace(/<#[^|>]+\|([^>]+)>/g, '#$1')
    .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

// Returns normalized ticker items: { title, meta, badge, ts, action, color }
async function fetch(lane, settings) {
  const token = settings.slack && settings.slack.token;
  if (!token) return [];

  const team = await teamId(token);
  const types = lane.includeChannels ? 'im,mpim,public_channel,private_channel' : 'im,mpim';
  const convs = await listConversations(token, types);

  const items = [];
  let checked = 0;
  for (const c of convs) {
    if (checked >= MAX_CHECK) break;
    checked++;
    let info;
    try {
      info = await api('conversations.info', token, { channel: c.id });
    } catch (e) {
      if (e.rateLimited) break;   // stop this cycle; try again next poll
      continue;
    }
    if (!info.ok) continue;
    const ch = info.channel;
    const unread = ch.unread_count_display || 0;
    if (!unread) continue;

    let last = null;
    try {
      const h = await api('conversations.history', token, { channel: c.id, limit: 1 });
      last = h.ok && h.messages && h.messages[0];
    } catch (e) { if (e.rateLimited) break; }

    let label;
    if (c.is_im) label = await userName(token, ch.user || c.user);
    else if (c.is_mpim) label = 'קבוצה';
    else label = '#' + (ch.name || '');

    const snippet = last ? clean(last.text) : '';
    items.push({
      title: label + (snippet ? ' — ' + snippet : ''),
      meta: [],
      badge: String(unread),
      ts: last ? Math.floor(parseFloat(last.ts) * 1000) : Date.now(),
      action: team ? ('slack://channel?team=' + team + '&id=' + c.id) : 'https://app.slack.com/client',
      color: lane.badgeBg || '#611f69'
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, lane.maxItems || 30);
}

// Quick connection check for the settings UI.
async function test(settings) {
  const token = settings.slack && settings.slack.token;
  if (!token) return { ok: false, error: 'אין token' };
  try {
    const r = await api('auth.test', token);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, team: r.team, user: r.user };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { fetch, test };
