# News Ticker — פס מבזקים למק

A lightweight macOS **breaking-news ticker** that lives as a thin, translucent bar at the
top of the screen and streams live headlines from Israeli news sites, merged
chronologically. Built with Electron.

> פס דק ושקוף שיושב בקצה המסך ומריץ מבזקים בזמן אמת מ-ynet ומקורות נוספים, ממוזגים לפי זמן.

---

## Features

- **Live RSS** from multiple Israeli sources, merged into one stream and sorted newest-first.
- **Two styles** — a continuous running ticker (`scroll`) or one headline at a time (`fade`).
- **Click-through** — the bar ignores the mouse over empty areas, so clicks pass to whatever
  is behind it (e.g. Chrome tabs). Only a headline itself is clickable → opens the article.
- **Draggable** — grab the red "מבזקים" handle to move the bar; the position is remembered.
- **Always on top**, spans the full screen width, semi-transparent (adjustable).
- **Hide / show instantly** — global hotkey `⌘⌥N`, the 📰 menu-bar icon, or the ✕ button.
- **Menu-bar app** — no Dock icon; controlled entirely from the 📰 tray icon.
- **Launch at login** (optional toggle).
- **Settings panel** — sources, position (top/bottom), style, speed, height, font size,
  opacity, refresh interval, hotkey.

## Sources (default)

Each source is any valid RSS feed. Enabled out of the box:

| Source | Feed |
|--------|------|
| ynet מבזקים | `https://www.ynet.co.il/Integration/StoryRss1854.xml` |
| וואלה | `https://rss.walla.co.il/feed/1` |
| ישראל היום | `https://www.israelhayom.co.il/rss.xml` |
| הארץ | `https://www.haaretz.co.il/srv/htz---all-articles` |
| גלובס | `https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2` |
| N12 | `https://rcs.mako.co.il/rss/news-israel.xml` |

Add or remove any feed from the ⚙ Settings panel. Toggle a source off without deleting it.

**Notes:** N12's feed updates slowly and its items link to the mako homepage rather than the
article. Some Haaretz articles are behind a paywall.

## Run (development)

```bash
npm install
npm start
```

## Build a standalone `.app`

```bash
npm install --save-dev @electron/packager   # once
npm run build          # see package.json; or run electron-packager directly
```

The build lands in `build/News Ticker-darwin-x64/News Ticker.app`. Copy it to
`/Applications`, then set `LSUIElement=true` in its `Info.plist` to run it as a background
(menu-bar-only) app.

## Project structure

| File | Role |
|------|------|
| `main.js` | Electron main process — window, tray, hotkey, drag, IPC, login item |
| `feeds.js` | Fetches + parses RSS feeds (in the main process, so no CORS) |
| `settings.js` | Defaults + JSON store (persisted in the app's userData folder) |
| `renderer/ticker.html` | The bar UI (scroll + fade, click-through, drag handle) |
| `renderer/settings.html` | The ⚙ settings panel |
| `preload.js` | Safe IPC bridge between renderer and main |

Settings are stored at
`~/Library/Application Support/news-ticker/settings.json` — not in the repo.

## License

MIT
