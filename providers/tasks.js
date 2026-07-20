// Tasks lane provider — pulls today's tasks from "מיק" (the-mic) via its
// Apps Script agenda endpoint (…/exec?json=agenda). Returns open tasks whose due
// date is today or overdue, as "category - task", with an overdue marker.

async function fetch(lane) {
  if (!lane.url) return [];
  const sep = lane.url.includes('?') ? '&' : '?';
  let url = lane.url + sep + 'json=agenda';
  if (lane.token) url += '&token=' + encodeURIComponent(lane.token);

  const res = await globalThis.fetch(url, { redirect: 'follow' });
  const data = await res.json();
  if (!data || !data.ok || !Array.isArray(data.tasks)) return [];

  const action = lane.boardUrl || lane.url;
  return data.tasks.map(t => {
    const cat = (t.category || '').trim();
    const title = (cat ? cat + ' - ' : '') + (t.task || '').trim();
    return {
      title,
      meta: [],
      badge: t.overdue ? 'באיחור' : '',
      ts: 0,
      action,
      color: t.overdue ? '#d64545' : (lane.badgeBg || '#1f9d55')
    };
  });
}

// Connection check for the settings UI.
async function test(lane) {
  if (!lane.url) return { ok: false, error: 'אין כתובת' };
  try {
    const sep = lane.url.includes('?') ? '&' : '?';
    let url = lane.url + sep + 'json=agenda';
    if (lane.token) url += '&token=' + encodeURIComponent(lane.token);
    const res = await globalThis.fetch(url, { redirect: 'follow' });
    const data = await res.json();
    if (!data || !data.ok) return { ok: false, error: (data && data.error) || 'תשובה לא תקינה' };
    return { ok: true, count: (data.tasks || []).length, date: data.date };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { fetch, test };
