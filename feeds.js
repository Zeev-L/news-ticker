// Fetches and parses RSS feeds in the main process (no CORS limits here).

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '') // strip any stray tags in titles
    .trim();
}

function pick(block, tag) {
  const re = new RegExp('<' + tag + '[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/' + tag + '>', 'i');
  const m = re.exec(block);
  return m ? decodeEntities(m[1]) : '';
}

function parseRss(xml, sourceName) {
  const items = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = pick(block, 'title');
    const link = pick(block, 'link');
    const pub = pick(block, 'pubDate');
    if (!title) continue;
    const ts = pub ? Date.parse(pub) : NaN;
    items.push({
      title,
      link,
      source: sourceName,
      pubDate: pub,
      ts: Number.isNaN(ts) ? 0 : ts
    });
  }
  return items;
}

async function fetchOne(source) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 NewsTicker/1.0' }
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    return parseRss(xml, source.name);
  } catch (e) {
    console.error('Feed error [' + source.name + ']:', e.message);
    return [];
  }
}

// Fetch all enabled sources, merge, dedupe by link, sort newest-first.
async function fetchAll(sources, maxItems) {
  const enabled = (sources || []).filter(s => s && s.enabled && s.url);
  const results = await Promise.all(enabled.map(fetchOne));
  const flat = results.flat();

  const seen = new Set();
  const deduped = [];
  for (const it of flat) {
    const key = it.link || it.title;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(it);
  }

  deduped.sort((a, b) => b.ts - a.ts);
  return deduped.slice(0, maxItems || 50);
}

module.exports = { fetchAll, parseRss };
