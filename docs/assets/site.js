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
let tickerCleanup = () => {};
function renderTicker(data) {
  const viewport = document.getElementById('ticker-viewport');
  if (!viewport || !data.items.length) return;
  tickerCleanup();
  const abort = new AbortController();
  const options = {signal: abort.signal};
  const items = data.items.slice(0, 15);
  const track = element('div', 'ticker-track');
  // The moving tape has a stationary, keyboard-accessible alternative: Read all headlines.
  track.setAttribute('aria-hidden', 'true');
  const group = element('div', 'ticker-group');
  items.forEach(item => {
    const link = element('a', 'ticker-item');
    link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.tabIndex = -1;
    link.title = `${item.source} · ${fmt(item.publishedAt)} · ${item.title}`;
    link.append(element('span', 'ticker-source', item.source), element('span', 'ticker-headline', item.title), element('span', 'ticker-separator', '◆'));
    group.append(link);
  });
  track.append(group, group.cloneNode(true));
  viewport.replaceChildren(track);
  const wrap = viewport.closest('.ticker-wrap');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animation, width = 0, duration = 0, index = 0;
  function sync() {
    const temporarilyPaused = document.hidden || wrap.matches(':hover') || wrap.contains(document.activeElement);
    if (animation) {
      if (reduced.matches || temporarilyPaused) animation.pause(); else animation.play();
    }
  }
  function measure() {
    const newWidth = group.getBoundingClientRect().width;
    if (!newWidth || Math.abs(newWidth - width) < 1) return;
    const progress = animation && duration ? (Number(animation.currentTime) % duration) / duration : 0;
    if (animation) animation.cancel();
    width = newWidth;
    duration = width / 32 * 1000; // Constant readable speed: 32 CSS pixels per second.
    // Two identical groups make the left-to-right wrap seamless at every viewport width.
    animation = track.animate([{transform: `translateX(${-width}px)`}, {transform: 'translateX(0px)'}], {duration, iterations: Infinity, easing: 'linear'});
    animation.currentTime = progress * duration;
    sync();
  }
  function seek(delta) {
    index = (index + delta + items.length) % items.length;
    const offset = group.children[index].offsetLeft - group.offsetLeft;
    if (animation) animation.currentTime = ((width - offset) % width) / width * duration;
  }
  document.getElementById('ticker-next').addEventListener('click', () => seek(1), options);
  document.getElementById('ticker-prev').addEventListener('click', () => seek(-1), options);
  reduced.addEventListener('change', sync, options);
  wrap.addEventListener('mouseenter', sync, options); wrap.addEventListener('mouseleave', sync, options);
  wrap.addEventListener('focusin', sync, options);
  wrap.addEventListener('focusout', () => requestAnimationFrame(sync), options);
  document.addEventListener('visibilitychange', sync, options);
  const observer = new ResizeObserver(measure); observer.observe(group);
  measure();
  const updated = document.getElementById('ticker-updated');
  const latestSuccess = Math.max(...(data.sources || []).map(source => Date.parse(source.lastSuccessAt) || 0));
  const stale = !latestSuccess || Date.now() - latestSuccess > 12 * 3600000;
  updated.textContent = `Updated ${fmt(latestSuccess || data.checkedAt)} · Automatic refresh every 6 hours${stale ? ' · Updates delayed; check the original publishers' : ''}`;
  tickerCleanup = () => { abort.abort(); observer.disconnect(); if (animation) animation.cancel(); };
}
function renderNews(data) {
  const list = document.getElementById('stories');
  const source = document.getElementById('source');
  const search = document.getElementById('search');
  const windowSelect = document.getElementById('window');
  const feedStatus = document.getElementById('feed-status');
  let items = page === 'breaches' ? data.items.filter(i => i.incident) : data.items;
  [...new Set(items.map(i => i.source))].sort().forEach(name => {
    const option = element('option', '', name); option.value = name; source.append(option);
  });
  function updateStatus(data) {
  const lastCheck = Date.parse(data.checkedAt);
  const old = !Number.isFinite(lastCheck) || Date.now() - lastCheck > 12 * 3600000;
  feedStatus.textContent = `Last refresh attempt: ${fmt(data.checkedAt)}.${old ? ' Updates are delayed; check publisher sites for newer reporting.' : ''}`;
  const failures = (data.sources || []).filter(s => s.status !== 'ok');
  if (failures.length) feedStatus.textContent += ` Unavailable on last attempt: ${failures.map(s => s.name).join(', ')}. Previously fetched headlines are retained.`;
  }
  updateStatus(data);
  document.addEventListener('briefing-update', event => {
    const fresh = event.detail;
    items = page === 'breaches' ? fresh.items.filter(i => i.incident) : fresh.items;
    updateStatus(fresh);
    render();
  });
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
  let refreshing = false;
  let lastAttempt = 0;
  let renderedVersion;
  async function refreshBriefing() {
    if (refreshing) return;
    refreshing = true; lastAttempt = Date.now();
    try {
      const data = await loadFeed();
      // Preserve a visitor's search and tape position when the briefing has not changed.
      if (data.checkedAt !== renderedVersion) {
        if (['news', 'breaches'].includes(page)) {
          if (renderedVersion === undefined) renderNews(data);
          else {
            // Keep filters and their listeners intact; replace the list's data on refresh.
            document.dispatchEvent(new CustomEvent('briefing-update', {detail: data}));
          }
        }
        renderTicker(data); renderedVersion = data.checkedAt;
      }
    } catch {
      if (renderedVersion === undefined) {
        const status = document.getElementById('feed-status');
        if (status) status.textContent = 'Headlines are temporarily unavailable. Please use the publisher links below.';
        const tickerStatus = document.getElementById('ticker-updated');
        if (tickerStatus) tickerStatus.textContent = 'Briefing temporarily unavailable. Open Cyber news for publisher links.';
      }
    } finally { refreshing = false; }
  }
  refreshBriefing();
  window.setInterval(() => { if (!document.hidden) refreshBriefing(); }, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastAttempt > 15 * 60 * 1000) refreshBriefing();
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
