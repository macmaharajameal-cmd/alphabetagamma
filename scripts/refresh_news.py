"""Fetch publisher RSS headlines; retain prior records when a source is unavailable."""
from pathlib import Path
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse, urlencode
from html.parser import HTMLParser
from classify_intel import classify
import concurrent.futures
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'docs/data/news.json'
SOURCES = [
    ('BleepingComputer', 'https://www.bleepingcomputer.com/feed/', {'www.bleepingcomputer.com', 'bleepingcomputer.com'}),
    ('The Hacker News', 'https://feeds.feedburner.com/TheHackersNews', {'thehackernews.com', 'www.thehackernews.com'}),
    ('CISA KEV', 'https://raw.githubusercontent.com/cisagov/kev-data/develop/known_exploited_vulnerabilities.json', {'www.cisa.gov'}),
]
INCIDENT = re.compile(r'breach|ransomware|data (?:leak|theft|expos)|stolen|compromis|cyberattack|cyber.attack|extortion|hackers (?:steal|leak)|security incident', re.I)

def now():
    return datetime.now(timezone.utc).isoformat()

class FeedText(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts = []; self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style'): self.skip = max(0, self.skip - 1)
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def context_text(raw):
    parser = FeedText(); parser.feed(raw[:30000])
    return ' '.join(' '.join(parser.parts).split())[:8000]

def kev_items(body):
    catalog = json.loads(body)
    entries = sorted(catalog['vulnerabilities'], key=lambda row: row['dateAdded'], reverse=True)[:50]
    items = []
    for row in entries:
        title = row['cveID'] + ' · ' + row['vulnerabilityName']
        link = 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog?' + urlencode({'search_api_fulltext':row['cveID']})
        date = datetime.strptime(row['dateAdded'], '%Y-%m-%d').replace(tzinfo=timezone.utc).isoformat()
        context = row.get('shortDescription', '')
        items.append({'title':title, 'url':link, 'publishedAt':date, 'dateKind':'Added to CISA KEV', 'source':'CISA KEV', 'incident':False,
                      'intel':classify(title, context, 'CISA KEV'), 'cve':row['cveID'], 'requiredAction':row.get('requiredAction',''),
                      'catalogDueDate':row.get('dueDate'), 'ransomwareUse':row.get('knownRansomwareCampaignUse','Unknown')})
    return items

def fetch_once(source):
    name, url, hosts = source
    request = urllib.request.Request(url, headers={'User-Agent': 'SafeScale-RSS/1.0 (+https://safescale.in)'})
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(3_000_001)
    if len(body) > 3_000_000:
        raise ValueError('Feed exceeds size limit')
    if name == 'CISA KEV':
        return kev_items(body)
    if b'<!ENTITY' in body.upper() or b'<!DOCTYPE' in body.upper():
        raise ValueError('Unsupported XML declarations')
    root = ET.fromstring(body)
    items = []
    for node in root.findall('.//item'):
        title = ' '.join((node.findtext('title') or '').split())[:500]
        link = (node.findtext('link') or '').strip()
        parsed = urlparse(link)
        if not title or parsed.scheme != 'https' or parsed.hostname not in hosts:
            continue
        try:
            published = parsedate_to_datetime(node.findtext('pubDate') or '')
            if published.tzinfo is None:
                published = published.replace(tzinfo=timezone.utc)
            published = published.astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError, OverflowError):
            continue
        context = context_text(node.findtext('description') or '')
        items.append({'title': title, 'url': link, 'publishedAt': published, 'source': name, 'incident': bool(INCIDENT.search(title)), 'intel':classify(title, context, name)})
    if not items:
        raise ValueError('No valid headlines')
    return items

def fetch(source):
    for attempt in range(3):
        try:
            return fetch_once(source)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def main():
    previous = json.loads(DEST.read_text()) if DEST.exists() else {'items': [], 'sources': []}
    combined = {item['url']: item for item in previous.get('items', [])}
    statuses = []
    success_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = [(source, pool.submit(fetch, source)) for source in SOURCES]
        for source, future in futures:
            name, url, _ = source
            old = next((s for s in previous.get('sources', []) if s['name'] == name), {})
            try:
                items = future.result()
                combined.update({item['url']: item for item in items})
                statuses.append({'name': name, 'feedUrl': url, 'status': 'ok', 'lastSuccessAt': now()})
                success_count += 1
                print(f'{name}: {len(items)} fetched')
            except Exception as error:
                statuses.append({'name': name, 'feedUrl': url, 'status': 'unavailable', 'lastSuccessAt': old.get('lastSuccessAt')})
                print(f'{name}: unavailable ({type(error).__name__}); retained previous headlines')
    items = sorted(combined.values(), key=lambda item: item['publishedAt'], reverse=True)[:240]
    for item in items:
        if 'intel' not in item:
            item['intel'] = classify(item['title'], source=item['source'])
    if not items:
        raise SystemExit('No current or cached headlines; leaving the site unchanged')
    result = {'checkedAt': now(), 'sources': statuses, 'items': items}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(f'Saved {len(items)} headlines ({sum(i["incident"] for i in items)} incident-related); {success_count} sources refreshed')

if __name__ == '__main__':
    main()
