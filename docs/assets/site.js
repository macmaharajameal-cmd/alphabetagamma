'use strict';
const page = document.body.dataset.page;
const fmt = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
};
function safeLink(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function loadFeed() {
  const response = await fetch('data/news.json', {cache: 'no-cache'});
  if (!response.ok) throw new Error('Could not fetch headlines');
  const data = await response.json();
  if (!Array.isArray(data.items)) throw new Error('Invalid feed');
  data.items = data.items.filter(item => item && typeof item.title === 'string' && safeLink(item.url));
  return data;
}
function renderTicker(data) {
  const link = document.getElementById('ticker-link');
  if (!link || !data.items.length) return;
  const items = data.items.slice(0, 15);
  let index = 0;
  const pause = document.getElementById('ticker-pause');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let paused = reduced.matches;
  const show = () => {
    const item = items[index];
    link.textContent = `${item.source} · ${fmt(item.publishedAt)} · ${item.title}`;
    link.href = item.url;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
  };
  const setPaused = () => { pause.textContent = paused ? 'Play' : 'Pause'; pause.setAttribute('aria-pressed', String(paused)); };
  document.getElementById('ticker-next').addEventListener('click', () => { index = (index + 1) % items.length; show(); });
  document.getElementById('ticker-prev').addEventListener('click', () => { index = (index + items.length - 1) % items.length; show(); });
  pause.addEventListener('click', () => { paused = !paused; setPaused(); });
  reduced.addEventListener('change', () => { if (reduced.matches) { paused = true; setPaused(); } });
  setPaused(); show();
  const wrap = link.closest('.ticker-wrap');
  window.setInterval(() => {
    if (!paused && !document.hidden && !wrap.matches(':hover') && !wrap.contains(document.activeElement)) {
      index = (index + 1) % items.length; show();
    }
  }, 9000);
}
function renderNews(data) {
  const list = document.getElementById('stories');
  const source = document.getElementById('source');
  const search = document.getElementById('search');
  const windowSelect = document.getElementById('window');
  const feedStatus = document.getElementById('feed-status');
  const items = page === 'breaches' ? data.items.filter(i => i.incident) : data.items;
  [...new Set(items.map(i => i.source))].sort().forEach(name => {
    const option = element('option', '', name); option.value = name; source.append(option);
  });
  const lastCheck = Date.parse(data.checkedAt);
  const old = !Number.isFinite(lastCheck) || Date.now() - lastCheck > 12 * 3600000;
  feedStatus.textContent = `Last refresh attempt: ${fmt(data.checkedAt)}.${old ? ' Updates are delayed; check publisher sites for newer reporting.' : ''}`;
  const failures = (data.sources || []).filter(s => s.status !== 'ok');
  if (failures.length) feedStatus.textContent += ` Unavailable on last attempt: ${failures.map(s => s.name).join(', ')}. Previously fetched headlines are retained.`;
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const days = windowSelect.value === 'all' ? null : Number(windowSelect.value);
    const shown = items.filter(i => (source.value === 'all' || i.source === source.value) &&
      `${i.title} ${i.source}`.toLocaleLowerCase().includes(query) &&
      (days === null || (Date.parse(i.publishedAt) >= Date.now() - days * 86400000)));
    list.replaceChildren();
    document.getElementById('results-count').textContent = `${shown.length} ${shown.length === 1 ? 'headline' : 'headlines'}`;
    if (!shown.length) list.append(element('p', 'empty', 'No headlines match. Try a broader search or another time range.'));
    shown.forEach(item => {
      const article = element('article', 'story');
      const meta = element('div', 'story-meta');
      meta.append(element('span', 'pill', item.source));
      const time = element('time', '', fmt(item.publishedAt)); time.dateTime = item.publishedAt; meta.append(time);
      const heading = element('h2');
      const link = element('a', '', item.title); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
      const read = element('a', 'read', 'Read original reporting ↗'); read.href = item.url; read.target = '_blank'; read.rel = 'noopener noreferrer';
      article.append(meta, heading, read); list.append(article);
    });
  }
  document.getElementById('filters').addEventListener('submit', e => e.preventDefault());
  search.addEventListener('input', render); source.addEventListener('change', render); windowSelect.addEventListener('change', render);
  document.getElementById('filters').addEventListener('reset', () => window.setTimeout(render, 0)); render();
}
if (['news', 'breaches', 'home', 'social'].includes(page)) {
  loadFeed().then(data => { if (['news', 'breaches'].includes(page)) renderNews(data); renderTicker(data); }).catch(() => {
    const status = document.getElementById('feed-status');
    if (status) status.textContent = 'Headlines are temporarily unavailable. Please use the publisher links below.';
  });
}
if (page === 'hunts') {
  document.querySelectorAll('.hunt').forEach(hunt => {
    const boxes = [...hunt.querySelectorAll('input[type=checkbox]')];
    const status = hunt.querySelector('.hunt-status');
    const update = () => {
      const count = boxes.filter(b => b.checked).length;
      hunt.querySelector('progress').value = count;
      status.textContent = `${count} of ${boxes.length} steps complete`;
    };
    boxes.forEach(box => box.addEventListener('change', update));
    hunt.querySelector('[data-reset]').addEventListener('click', () => { boxes.forEach(b => { b.checked = false; }); update(); });
    hunt.querySelector('[data-copy]').addEventListener('click', async e => {
      const button = e.currentTarget;
      try { await navigator.clipboard.writeText(hunt.querySelector('code').textContent); button.textContent = 'Copied'; }
      catch { button.textContent = 'Select the query to copy manually'; }
      window.setTimeout(() => { button.textContent = 'Copy query'; }, 3500);
    });
  });
}
if (page === 'social') {
  document.getElementById('load-x').addEventListener('click', e => {
    e.currentTarget.disabled = true; e.currentTarget.textContent = 'Timelines requested';
    const status = document.getElementById('x-status');
    status.textContent = 'Loading from X… If no posts appear, open the account links below.';
    document.querySelectorAll('.x-slot').forEach(slot => {
      const link = element('a', 'twitter-timeline', `Posts from ${slot.dataset.name}`);
      link.href = `https://twitter.com/${slot.dataset.handle}`;
      link.dataset.theme = 'dark'; link.dataset.height = '540'; link.dataset.dnt = 'true';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; slot.append(link);
    });
    const script = document.createElement('script'); script.src = 'https://platform.twitter.com/widgets.js'; script.async = true;
    script.onload = () => { status.textContent = 'X widget loaded. If posts are unavailable or sign-in is required, use the account links below.'; };
    script.onerror = () => { status.textContent = 'X could not load here. Please use the account links below.'; };
    document.head.append(script);
  });
}
