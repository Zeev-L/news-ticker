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

// Returns normalized items for the ticker: { title, meta: [], badge, ts, action }
async function fetch(lane, settings) {
  if (!isConnected(settings)) return [];
  const auth = client(settings);
  auth.setCredentials({ refresh_token: settings.google.refreshToken });
  const cal = google.calendar({ version: 'v3', auth });

  const now = new Date();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // Gather across ALL the user's calendars (work, personal, family…), not just primary.
  let calendarIds = ['primary'];
  try {
    const list = await cal.calendarList.list({ minAccessRole: 'reader' });
    calendarIds = (list.data.items || [])
      .filter(c => c.selected !== false && !/#holiday@/.test(c.id)) // skip holiday calendars
      .map(c => c.id);
    if (!calendarIds.length) calendarIds = ['primary'];
  } catch (e) { /* fall back to primary */ }

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
    }).then(r => r.data.items || []).catch(() => [])
  ));

  const seen = new Set();
  const events = perCal.flat().filter(ev => {
    const key = ev.id || (ev.summary + (ev.start && ev.start.dateTime));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return events
    .filter(ev => ev.start && ev.start.dateTime && ev.status !== 'cancelled') // timed events only
    .filter(ev => !(ev.attendees || []).some(a => a.self && a.responseStatus === 'declined')) // hide events you declined
    .sort((a, b) => Date.parse(a.start.dateTime) - Date.parse(b.start.dateTime))
    .map(ev => {
      const startMs = Date.parse(ev.start.dateTime);
      const attendees = (ev.attendees || []).filter(a => !a.self && !a.resource);
      const names = attendees.slice(0, 2).map(a => a.displayName || a.email).filter(Boolean);
      const meta = [];
      if (names.length) meta.push(names.join(', '));
      if (ev.location) meta.push(ev.location);
      return {
        title: ev.summary || '(ללא כותרת)',
        meta,
        badge: fmtTime(startMs),
        ts: startMs,
        action: meetingLink(ev)
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

module.exports = { fetch, connect, isConnected };
