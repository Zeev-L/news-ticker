// Google Calendar lane provider + one-time OAuth (loopback desktop flow).
const { google } = require('googleapis');
const http = require('http');
const { shell } = require('electron');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function fmtRange(startMs, endMs) {
  if (!endMs || endMs <= startMs) return fmtTime(startMs);
  return fmtTime(startMs) + '–' + fmtTime(endMs);
}

// List the user's calendars (for the settings picker): id, name, default colour.
async function listCalendars(settings) {
  if (!isConnected(settings)) return [];
  const auth = client(settings);
  auth.setCredentials({ refresh_token: settings.google.refreshToken });
  const cal = google.calendar({ version: 'v3', auth });
  const list = await cal.calendarList.list({ minAccessRole: 'reader' });
  return (list.data.items || []).map(c => ({
    id: c.id,
    name: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || '#1f7ae0',
    primary: !!c.primary
  }));
}

function isConnected(settings) {
  const g = settings.google || {};
  return !!(g.clientId && g.clientSecret && g.refreshToken);
}

function client(settings, redirectUri) {
  const g = settings.google || {};
  return new google.auth.OAuth2(g.clientId, g.clientSecret, redirectUri);
}

// Pull the best video-call link out of an event.
function meetingLink(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  const cd = ev.conferenceData;
  if (cd && Array.isArray(cd.entryPoints)) {
    const video = cd.entryPoints.find(e => e.entryPointType === 'video' && e.uri);
    if (video) return video.uri;
    const any = cd.entryPoints.find(e => e.uri);
    if (any) return any.uri;
  }
  return ev.htmlLink || '';
}

// Returns normalized items for the ticker: { title, meta: [], badge, ts, action, color }
async function fetch(lane, settings) {
  if (!isConnected(settings)) return [];
  const auth = client(settings);
  auth.setCredentials({ refresh_token: settings.google.refreshToken });
  const cal = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Calendar metadata (names + default colours) for anything not yet configured.
  const meta = {};
  try {
    const list = await cal.calendarList.list({ minAccessRole: 'reader' });
    (list.data.items || []).forEach(c => { meta[c.id] = { name: c.summary, color: c.backgroundColor }; });
  } catch (e) { /* fall back below */ }

  // Which calendars to include + their colours. If the user has configured calendars
  // in settings, honour their enabled/colour choices; otherwise include all (minus holidays).
  const configured = Array.isArray(lane.calendars) ? lane.calendars : [];
  let calendarIds;
  if (configured.length) {
    calendarIds = configured.filter(c => c.enabled !== false).map(c => c.id);
  } else {
    calendarIds = Object.keys(meta).filter(id => !/#holiday@/.test(id));
  }
  if (!calendarIds.length && !configured.length) calendarIds = ['primary'];

  const colorFor = (id) => {
    const c = configured.find(x => x.id === id);
    if (c && c.color) return c.color;
    return (meta[id] && meta[id].color) || lane.badgeBg || '#1f7ae0';
  };

  // timeMin filters by an event's END time, so this yields events that are
  // in-progress or upcoming today (past ones drop off automatically).
  const perCal = await Promise.all(calendarIds.map(id =>
    cal.events.list({
      calendarId: id,
      timeMin: now.toISOString(),
      timeMax: endOfDay.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    }).then(r => (r.data.items || []).map(ev => ({ ev, color: colorFor(id) }))).catch(() => [])
  ));

  const seen = new Set();
  const rows = perCal.flat().filter(({ ev }) => {
    const key = ev.id || (ev.summary + (ev.start && ev.start.dateTime));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return rows
    .filter(({ ev }) => ev.start && ev.start.dateTime && ev.status !== 'cancelled') // timed events only
    .filter(({ ev }) => !(ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) // hide declined
    .sort((a, b) => Date.parse(a.ev.start.dateTime) - Date.parse(b.ev.start.dateTime))
    .map(({ ev, color }) => {
      const startMs = Date.parse(ev.start.dateTime);
      const endMs = ev.end && ev.end.dateTime ? Date.parse(ev.end.dateTime) : 0;
      const attendees = (ev.attendees || []).filter(a => !a.self && !a.resource);
      const names = attendees.slice(0, 2).map(a => a.displayName || a.email).filter(Boolean);
      const meta2 = [];
      if (names.length) meta2.push(names.join(', '));
      if (ev.location) meta2.push(ev.location);
      return {
        title: ev.summary || '(ללא כותרת)',
        meta: meta2,
        badge: fmtRange(startMs, endMs),
        ts: startMs,
        action: meetingLink(ev),
        color
      };
    });
}

// One-time OAuth: opens the browser, catches the redirect on a loopback port,
// exchanges the code, and returns { refreshToken, email }. Throws on failure.
function connect(settings) {
  return new Promise((resolve, reject) => {
    const g = settings.google || {};
    if (!g.clientId || !g.clientSecret) {
      reject(new Error('חסרים Client ID / Client Secret'));
      return;
    }

    const server = http.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const redirectUri = 'http://127.0.0.1:' + port;
      const auth = client(settings, redirectUri);
      const authUrl = auth.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES
      });

      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('פג הזמן להתחברות (5 דקות)'));
      }, 5 * 60 * 1000);

      server.on('request', async (req, res) => {
        try {
          const u = new URL(req.url, redirectUri);
          const code = u.searchParams.get('code');
          const err = u.searchParams.get('error');
          if (err) {
            res.end('ההתחברות בוטלה. אפשר לסגור את החלון.');
            clearTimeout(timeout); server.close(); reject(new Error(err));
            return;
          }
          if (!code) { res.end('...'); return; }
          const { tokens } = await auth.getToken(code);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html dir="rtl"><body style="font-family:-apple-system;text-align:center;padding:40px"><h2>✅ היומן חובר בהצלחה</h2><p>אפשר לסגור את החלון ולחזור לאפליקציה.</p></body></html>');
          clearTimeout(timeout); server.close();

          let email = '';
          try {
            auth.setCredentials(tokens);
            const info = await google.oauth2({ version: 'v2', auth }).userinfo.get();
            email = info.data.email || '';
          } catch (_) { /* email is best-effort */ }

          resolve({ refreshToken: tokens.refresh_token, email });
        } catch (e) {
          clearTimeout(timeout); server.close(); reject(e);
        }
      });

      shell.openExternal(authUrl);
    });
  });
}

module.exports = { fetch, connect, isConnected, listCalendars };
