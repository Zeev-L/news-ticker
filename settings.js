const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = {
  sources: [
    { name: 'ynet מבזקים', url: 'https://www.ynet.co.il/Integration/StoryRss1854.xml', enabled: true },
    { name: 'וואלה', url: 'https://rss.walla.co.il/feed/1', enabled: true },
    { name: 'ישראל היום', url: 'https://www.israelhayom.co.il/rss.xml', enabled: true },
    { name: 'הארץ', url: 'https://www.haaretz.co.il/srv/htz---all-articles', enabled: true },
    { name: 'גלובס', url: 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2', enabled: true },
    { name: 'N12', url: 'https://rcs.mako.co.il/rss/news-israel.xml', enabled: true }
  ],
  position: 'top',        // 'top' | 'bottom'
  mode: 'scroll',         // 'scroll' | 'fade'
  speed: 60,              // scroll speed, px per second
  fadeSeconds: 6,         // seconds per headline in fade mode
  refreshSeconds: 90,     // how often to re-fetch feeds
  hotkey: 'Command+Alt+N',
  height: 20,
  fontSize: 11,
  opacity: 0.55,
  maxItems: 50,
  showSource: true,
  visible: true,
  openAtLogin: false,
  customPos: null   // {x, y} once the user drags the bar; null = follow position (top/bottom)
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

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return deepMerge(DEFAULTS, parsed);
  } catch (e) {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  const merged = deepMerge(DEFAULTS, settings);
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
  return merged;
}

module.exports = { load, save, DEFAULTS, SETTINGS_PATH };
