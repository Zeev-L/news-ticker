const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// Default RSS sources for the news lane.
const DEFAULT_SOURCES = [
  { name: 'ynet מבזקים', url: 'https://www.ynet.co.il/Integration/StoryRss1854.xml', enabled: true },
  { name: 'וואלה', url: 'https://rss.walla.co.il/feed/1', enabled: true },
  { name: 'ישראל היום', url: 'https://www.israelhayom.co.il/rss.xml', enabled: true },
  { name: 'הארץ', url: 'https://www.haaretz.co.il/srv/htz---all-articles', enabled: true },
  { name: 'גלובס', url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2', enabled: true },
  { name: 'N12', url: 'https://rcs.mako.co.il/rss/news-israel.xml', enabled: true }
];

// A lane = one bar. Common display fields + kind-specific fields.
const NEWS_LANE = {
  id: 'news', kind: 'rss', title: 'מבזקים', enabled: true,
  position: 'top', mode: 'scroll', speed: 60, fadeSeconds: 6,
  height: 20, fontSize: 11, opacity: 0.55, refreshSeconds: 90,
  hotkey: 'Command+Alt+N', customPos: null,
  barRgb: '17,19,24', badgeBg: '#d81f2a',
  badgeMode: 'word', badgeWord: 'מבזק', showMeta: true,
  emptyText: 'טוען מבזקים…',
  sources: DEFAULT_SOURCES, maxItems: 50
};

const CALENDAR_LANE = {
  id: 'calendar', kind: 'calendar', title: 'יומן', enabled: true,
  position: 'top', mode: 'scroll', speed: 45, fadeSeconds: 8,
  height: 20, fontSize: 11, opacity: 0.6, refreshSeconds: 60,
  hotkey: 'Command+Alt+C', customPos: null,
  barRgb: '10,42,58', badgeBg: '#1f7ae0',
  badgeMode: 'time', showMeta: true,
  emptyText: 'אין פגישות נוספות היום',
  calendars: []   // [{ id, name, enabled, color }] — filled from Google, editable in settings
};

const SLACK_LANE = {
  id: 'slack', kind: 'slack', title: 'Slack', enabled: false,
  position: 'top', mode: 'scroll', speed: 45, fadeSeconds: 8,
  height: 20, fontSize: 11, opacity: 0.6, refreshSeconds: 120,
  hotkey: 'Command+Alt+S', customPos: null,
  barRgb: '26,15,38', badgeBg: '#611f69',
  badgeMode: 'count', showMeta: true,
  emptyText: 'אין הודעות שלא נקראו',
  includeChannels: false   // DMs only by default; toggle on to include channels
};

const DEFAULTS = {
  lanes: [NEWS_LANE, CALENDAR_LANE, SLACK_LANE],
  google: { clientId: '', clientSecret: '', refreshToken: '', email: '' },
  slack: { token: '' },
  openAtLogin: false
};

function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (typeof override !== 'object' || override === null) return out;
  for (const key of Object.keys(override)) {
    if (
      typeof out[key] === 'object' && out[key] !== null && !Array.isArray(out[key]) &&
      typeof override[key] === 'object' && override[key] !== null && !Array.isArray(override[key])
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

// Merge lanes by id: default lanes fill missing fields; user lanes win; keep order
// (defaults first, then any user-only lanes).
function mergeLanes(defaultLanes, userLanes) {
  const byId = {};
  defaultLanes.forEach(l => { byId[l.id] = { ...l }; });
  (userLanes || []).forEach(u => {
    if (u && u.id) byId[u.id] = byId[u.id] ? deepMerge(byId[u.id], u) : u;
  });
  const order = defaultLanes.map(l => l.id);
  (userLanes || []).forEach(u => { if (u && u.id && !order.includes(u.id)) order.push(u.id); });
  return order.map(id => byId[id]);
}

// Convert the old flat (single-bar) schema into the new lanes schema.
function migrate(parsed) {
  if (!parsed || parsed.lanes) return parsed || {};
  if (parsed.sources) {
    const news = {
      id: 'news', kind: 'rss', title: 'מבזקים', enabled: true,
      position: parsed.position || 'top', mode: parsed.mode || 'scroll',
      speed: parsed.speed, fadeSeconds: parsed.fadeSeconds,
      height: parsed.height, fontSize: parsed.fontSize, opacity: parsed.opacity,
      refreshSeconds: parsed.refreshSeconds, hotkey: parsed.hotkey || 'Command+Alt+N',
      customPos: parsed.customPos || null,
      barRgb: '17,19,24', badgeBg: '#d81f2a',
      badgeMode: 'word', badgeWord: 'מבזק',
      showMeta: parsed.showSource !== false,
      sources: parsed.sources, maxItems: parsed.maxItems || 50
    };
    return { lanes: [news], google: { clientId: '', clientSecret: '', refreshToken: '', email: '' }, openAtLogin: !!parsed.openAtLogin };
  }
  return parsed;
}

function normalize(parsed) {
  const migrated = migrate(parsed);
  const merged = deepMerge(DEFAULTS, migrated);
  merged.lanes = mergeLanes(DEFAULTS.lanes, migrated.lanes);
  return merged;
}

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return normalize(JSON.parse(raw));
  } catch (e) {
    return normalize({});
  }
}

function save(settings) {
  const merged = normalize(settings);
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
  return merged;
}

module.exports = { load, save, DEFAULTS, SETTINGS_PATH };
