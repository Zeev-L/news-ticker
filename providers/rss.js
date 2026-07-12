// RSS lane provider — wraps feeds.js and normalizes items for the ticker engine.
const { fetchAll } = require('../feeds');

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// Returns normalized items: { title, meta: [], badge, ts, action }
async function fetch(lane) {
  const items = await fetchAll(lane.sources, lane.maxItems || 50);
  return items.map(n => {
    const meta = [];
    if (n.ts) meta.push(fmtTime(n.ts));
    if (lane.showMeta && n.source) meta.push(n.source);
    return {
      title: n.title,
      meta,
      badge: lane.badgeWord || 'מבזק',
      ts: n.ts,
      action: n.link
    };
  });
}

module.exports = { fetch };
