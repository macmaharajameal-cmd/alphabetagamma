'use strict';
const page = document.body.dataset.page;
const fmt = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
};
const FEED_SOURCE_HOSTS = Object.freeze({
  'BleepingComputer': ['www.bleepingcomputer.com', 'bleepingcomputer.com'],
  'The Hacker News': ['thehackernews.com', 'www.thehackernews.com'],
  'CISA KEV': ['www.cisa.gov']
});
const INDUSTRY_CATEGORIES = Object.freeze({"retail": "Retail", "hospitality": "Hospitality", "manufacturing": "Manufacturing", "saas": "SaaS / technology", "finance": "Banking / financial services", "healthcare": "Healthcare", "education": "Education", "government": "Government / public sector", "telecom": "Telecommunications", "transport": "Transport / logistics", "energy": "Energy / utilities", "cross-industry": "General / cross-industry"});
function safeLink(value, source) {
  if (typeof value !== 'string' || typeof source !== 'string' || value.length > 2048 || !Object.hasOwn(FEED_SOURCE_HOSTS, source)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && FEED_SOURCE_HOSTS[source].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
function feedText(value, maximum = 500) { return typeof value === 'string' ? value.slice(0, maximum) : ''; }
function normalizeFeed(data) {
  if (!data || !Array.isArray(data.items) || typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid feed');
  const allowed = {
    sectors: Object.keys(INDUSTRY_CATEGORIES).filter(id => id !== 'cross-industry'),
    environments: ['m365', 'aws', 'azure', 'windows', 'payments', 'web', 'ot'],
    regions: ['india', 'global'], topics: ['identity', 'ransomware', 'vulnerability', 'data', 'supply-chain']
  };
  const items = data.items.slice(0, 240).flatMap(item => {
    if (!item || !safeLink(item.url, item.source) || typeof item.title !== 'string' || !item.title.trim() || typeof item.publishedAt !== 'string' || !Number.isFinite(Date.parse(item.publishedAt))) return [];
    const raw = item.intel && typeof item.intel === 'object' ? item.intel : {};
    const intel = {version: feedText(raw.version, 40), basis: feedText(raw.basis, 100), scope: feedText(raw.scope, 1000), startupRelevant: raw.startupRelevant === true, startupReason: feedText(raw.startupReason, 1000)};
    Object.entries(allowed).forEach(([key, ids]) => {
      intel[key] = (Array.isArray(raw[key]) ? raw[key] : []).slice(0, ids.length).filter(t => t && ids.includes(t.id) && typeof t.label === 'string').map(t => ({id: t.id, label: feedText(t.label, 100), confidence: feedText(t.confidence, 100), evidence: (Array.isArray(t.evidence) ? t.evidence : []).filter(v => typeof v === 'string').slice(0, 3).map(v => feedText(v, 100))}));
    });
    intel.categories = (Array.isArray(raw.categories) ? raw.categories : []).slice(0, 12).filter(tag => tag && typeof tag.id === 'string' && Object.hasOwn(INDUSTRY_CATEGORIES, tag.id) && ['keyword','company','general','ai'].includes(tag.method)).map(tag => ({id:tag.id,label:INDUSTRY_CATEGORIES[tag.id],method:tag.method,confidence:feedText(tag.confidence,100),reason:feedText(tag.reason,500),evidence:(Array.isArray(tag.evidence)?tag.evidence:[]).filter(e=>typeof e==='string').slice(0,3).map(e=>feedText(e,100))}));
    if (!intel.categories.length) intel.categories = intel.sectors.length ? intel.sectors.map(tag=>({...tag,label:INDUSTRY_CATEGORIES[tag.id],method:'keyword',reason:'Industry wording in the available context.'})) : [{id:'cross-industry',label:INDUSTRY_CATEGORIES['cross-industry'],method:'general',confidence:'Industry not established',reason:'Review the affected technology across sectors.',evidence:[]}];
    intel.hunts = (Array.isArray(raw.hunts) ? raw.hunts : []).slice(0, 4).filter(h => h && ['identity', 'powershell', 'persistence', 'oauth'].includes(h.id)).map(h => ({id: h.id, title: feedText(h.title, 150), requires: feedText(h.requires, 500)}));
    const clean = {title: feedText(item.title), source: item.source, url: safeLink(item.url, item.source), publishedAt: item.publishedAt, incident: item.incident === true, intel};
    ['dateKind', 'requiredAction', 'ransomwareUse', 'catalogDueDate', 'cve'].forEach(key => { clean[key] = feedText(item[key], 2000); });
    return [clean];
  });
  const sources = (Array.isArray(data.sources) ? data.sources : []).slice(0, 3).filter(s => s && Object.hasOwn(FEED_SOURCE_HOSTS, s.name)).map(s => ({name: s.name, status: s.status === 'ok' ? 'ok' : 'unavailable', lastSuccessAt: feedText(s.lastSuccessAt, 80)}));
  const rawClassification = data.classification && typeof data.classification === 'object' ? data.classification : {};
  const classification = {aiStatus: feedText(rawClassification.aiStatus, 50), aiCategorized: Number.isFinite(rawClassification.aiCategorized) ? Math.max(0, rawClassification.aiCategorized) : 0, cachedRecords: Number.isFinite(rawClassification.cachedRecords) ? Math.max(0, rawClassification.cachedRecords) : 0, pending: Number.isFinite(rawClassification.pending) ? Math.max(0, rawClassification.pending) : 0};
  return {checkedAt: data.checkedAt, sources, items, classification};
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
async function loadFeed() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('data/news.json', {cache: 'no-cache', signal: controller.signal});
    if (!response.ok) throw new Error('Could not fetch headlines');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', {fatal: true});
    let bytes = 0, text = '';
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 4000000) { await reader.cancel(); throw new Error('Feed exceeds size limit'); }
        text += decoder.decode(value, {stream: true});
      }
    } finally { reader.releaseLock(); }
    return normalizeFeed(JSON.parse(text + decoder.decode()));
  } finally { clearTimeout(timeout); }
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
function categoryStatus(data) {
  const c=data.classification || {};
  if(c.aiStatus==='active') return `Keywords and company matches active. AI checked ${c.cachedRecords || 0} records; ${c.aiCategorized || 0} have additional AI category suggestions.${c.pending?' Remaining headlines will be checked in later refreshes.':''}`;
  if(['access-unavailable','temporarily-unavailable','rate-limited'].includes(c.aiStatus)) return 'Keyword and company categories are active. The AI service is currently unavailable; existing AI suggestions are retained.';
  return 'Categories use source keywords and company context. General / cross-industry keeps broad technology news visible.';
}
function renderNews(data) {
  const list = document.getElementById('stories');
  const source = document.getElementById('source');
  const search = document.getElementById('search');
  const category = document.getElementById('category');
  const shortcuts = document.getElementById('category-shortcuts');
  const windowSelect = document.getElementById('window');
  const feedStatus = document.getElementById('feed-status');
  let items = page === 'breaches' ? data.items.filter(i => i.incident) : data.items;
  function updateChoices() {
    const currentSource=source.value, currentCategory=category.value;
    source.replaceChildren(new Option('All publishers','all'));
    [...new Set(items.map(i => i.source))].sort().forEach(name => source.append(new Option(name,name)));
    if([...source.options].some(o=>o.value===currentSource))source.value=currentSource;
    const counts=Object.fromEntries(Object.keys(INDUSTRY_CATEGORIES).map(id=>[id,items.filter(item=>item.intel.categories.some(c=>c.id===id)).length]));
    category.replaceChildren(new Option(`All categories (${items.length})`,'all'));
    Object.entries(INDUSTRY_CATEGORIES).forEach(([id,label])=>category.append(new Option(`${label} (${counts[id]})`,id)));
    if([...category.options].some(o=>o.value===currentCategory))category.value=currentCategory;
    shortcuts.replaceChildren();
    [['all','All',items.length],...Object.entries(INDUSTRY_CATEGORIES).map(([id,label])=>[id,label,counts[id]])].forEach(([id,label,count])=>{
      const button=element('button','category-chip',`${label} · ${count}`);button.type='button';button.dataset.category=id;
      button.addEventListener('click',()=>{category.value=id;render();});shortcuts.append(button);
    });
  }
  function updateStatus(data) {
    const lastCheck = Date.parse(data.checkedAt);
    const old = !Number.isFinite(lastCheck) || Date.now() - lastCheck > 12 * 3600000;
    feedStatus.textContent = `Last refresh attempt: ${fmt(data.checkedAt)}.${old ? ' Updates are delayed; check publisher sites for newer reporting.' : ''}`;
    const failures = (data.sources || []).filter(s => s.status !== 'ok');
    if (failures.length) feedStatus.textContent += ` Unavailable on last attempt: ${failures.map(s => s.name).join(', ')}. Previously fetched headlines are retained.`;
    document.getElementById('category-status').textContent=categoryStatus(data);
  }
  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const days = windowSelect.value === 'all' ? null : Number(windowSelect.value);
    const shown = items.filter(i => (source.value === 'all' || i.source === source.value) &&
      (category.value === 'all' || i.intel.categories.some(c=>c.id===category.value)) &&
      `${i.title} ${i.source} ${i.intel.categories.map(c=>c.label).join(' ')}`.toLocaleLowerCase().includes(query) &&
      (days === null || (Date.parse(i.publishedAt) >= Date.now() - days * 86400000)));
    list.replaceChildren();
    shortcuts.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.category===category.value)));
    document.getElementById('results-count').textContent = `${shown.length} ${shown.length === 1 ? 'headline' : 'headlines'}${category.value!=='all'?' · '+INDUSTRY_CATEGORIES[category.value]:''}`;
    if (!shown.length) list.append(element('p', 'empty', 'No headlines match these filters. Try All categories or a wider time range. A zero count does not mean the industry has no threats.'));
    shown.forEach(item => {
      const article = element('article', 'story');
      const meta = element('div', 'story-meta');meta.append(element('span', 'pill', item.source));
      const time = element('time', '', `${item.dateKind || 'Published'} · ${fmt(item.publishedAt)}`);time.dateTime = item.publishedAt;meta.append(time);
      const heading = element('h2');const link = element('a', '', item.title);link.href = item.url;link.target = '_blank';link.rel = 'noopener noreferrer';heading.append(link);
      const tags=element('div','intel-tags');item.intel.categories.forEach(tag=>{const badge=element('span','intel-badge'+(['ai','company'].includes(tag.method)?' assessment':tag.method==='general'?' unknown':''),tag.label+(tag.method==='ai'?' · AI':tag.method==='company'?' · company match':''));badge.title=tag.confidence+'. '+tag.reason;tags.append(badge);});
      const read = element('a', 'read', 'Read original reporting ↗');read.href = item.url;read.target = '_blank';read.rel = 'noopener noreferrer';
      article.append(meta, heading, tags, read);list.append(article);
    });
  }
  updateChoices();updateStatus(data);render();
  document.addEventListener('briefing-update',event=>{const fresh=event.detail;items=page==='breaches'?fresh.items.filter(i=>i.incident):fresh.items;updateChoices();updateStatus(fresh);render();});
  document.getElementById('filters').addEventListener('submit', e => e.preventDefault());
  search.addEventListener('input', render);source.addEventListener('change', render);category.addEventListener('change',render);windowSelect.addEventListener('change', render);
  document.getElementById('filters').addEventListener('reset', () => window.setTimeout(render, 0));
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
  function openLinkedHunt() {
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (target?.matches('details.hunt')) target.open = true;
  }
  openLinkedHunt();
  window.addEventListener('hashchange', openLinkedHunt);
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
    const accounts = new Set(['CISAgov', 'MsftSecIntel', 'Unit42_Intel']);
    document.querySelectorAll('.x-slot').forEach(slot => {
      if (!accounts.has(slot.dataset.handle)) return;
      const frame = document.createElement('iframe');
      frame.title = `X timeline: ${slot.dataset.name}`;
      frame.src = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${slot.dataset.handle}`;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      frame.referrerPolicy = 'no-referrer';
      frame.loading = 'lazy';
      slot.append(frame);
    });
    status.textContent = 'Timelines requested in isolated X frames. If posts are unavailable or sign-in is required, use the account links below.';
  });
}
