// Notes/mantras lane provider — items come straight from the user's own texts
// in settings (lane.notes). No network, no auth.

async function fetch(lane) {
  const texts = Array.isArray(lane.notes) ? lane.notes : [];
  return texts
    .map(t => (t == null ? '' : String(t).trim()))
    .filter(Boolean)
    .map(t => ({
      title: t,
      meta: [],
      badge: lane.badgeWord || '',
      ts: 0,
      action: ''
    }));
}

module.exports = { fetch };
