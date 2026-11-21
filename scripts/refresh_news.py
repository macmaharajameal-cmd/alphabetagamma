"""Fetch publisher RSS headlines; retain prior records when a source is unavailable."""
from pathlib import Path
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse, urlencode
from html.parser import HTMLParser
from classify_intel import classify, category_tags, VERSION
from validate_news import validate_news, valid_source_url
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
    ('Krebs on Security', 'https://krebsonsecurity.com/feed/', {'www.krebsonsecurity.com', 'krebsonsecurity.com'}),
    ('SecurityWeek', 'https://www.securityweek.com/feed/', {'securityweek.com', 'www.securityweek.com'}),
    ('SANS Internet Storm Center', 'https://isc.sans.edu/rssfeed_full.xml', {'isc.sans.edu'}),
    ('Unit 42', 'https://unit42.paloaltonetworks.com/feed/', {'unit42.paloaltonetworks.com'}),
    ('Microsoft Security', 'https://www.microsoft.com/en-us/security/blog/feed/', {'www.microsoft.com'}),
    ('CERT-EU', 'https://cert.europa.eu/publications/security-advisories-rss', {'cert.europa.eu'}),
    ('The Record', 'https://therecord.media/feed', {'therecord.media'}),
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

class NoDTDTreeBuilder(ET.TreeBuilder):
    def doctype(self, *args):
        raise ValueError('DTD declarations are forbidden')


def parse_feed_xml(body):
    # A parser-level rule also rejects UTF-16/UTF-32 declaration bypasses.
    return ET.fromstring(body, parser=ET.XMLParser(target=NoDTDTreeBuilder()))


class SourceRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, hosts):
        super().__init__()
        self.hosts = hosts

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlparse(newurl)
        if parsed.scheme != 'https' or parsed.hostname not in self.hosts or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError('Redirect outside the approved HTTPS source')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_once(source):
    name, url, hosts = source
    request = urllib.request.Request(url, headers={'User-Agent': 'SafeScale-RSS/1.0 (+https://safescale.in)'})
    network_hosts = {urlparse(url).hostname}
    if name == 'BleepingComputer':
        network_hosts.update({'www.bleepingcomputer.com', 'bleepingcomputer.com'})
    opener = urllib.request.build_opener(SourceRedirects(network_hosts))
    with opener.open(request, timeout=25) as response:
        body = response.read(3_000_001)
    if len(body) > 3_000_000:
        raise ValueError('Feed exceeds size limit')
    if name == 'CISA KEV':
        return kev_items(body)
    root = parse_feed_xml(body)
    items = []
    for node in root.findall('.//item')[:100]:
        title = ' '.join((node.findtext('title') or '').split())[:500]
        link = (node.findtext('link') or '').strip()
        parsed = urlparse(link)
        if not title or not valid_source_url(link, name):
            continue
        try:
            date_text = (node.findtext('pubDate') or '').strip()
            # CERT-EU uses named Central European offsets in its RSS dates.
            date_text = re.sub(r'\bCEST$', '+0200', re.sub(r'\bCET$', '+0100', date_text))
            published = parsedate_to_datetime(date_text)
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
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        futures = [(source, pool.submit(fetch, source)) for source in SOURCES]
        for source, future in futures:
            name, url, _ = source
            old = next((s for s in previous.get('sources', []) if s['name'] == name), {})
            try:
                items = future.result()
                for item in items:
                    cached_ai = combined.get(item['url'], {}).get('intel', {}).get('ai')
                    if isinstance(cached_ai, dict): item['intel']['ai'] = cached_ai
                    combined[item['url']] = item
                statuses.append({'name': name, 'feedUrl': url, 'status': 'ok', 'lastSuccessAt': now()})
                success_count += 1
                print(f'{name}: {len(items)} fetched')
            except Exception as error:
                statuses.append({'name': name, 'feedUrl': url, 'status': 'unavailable', 'lastSuccessAt': old.get('lastSuccessAt')})
                print(f'{name}: unavailable ({type(error).__name__}); retained previous headlines')
    items = sorted(combined.values(), key=lambda item: item['publishedAt'], reverse=True)[:400]
    for item in items:
        old = item.get('intel', {})
        if old.get('version') != VERSION:
            fresh = classify(item['title'], source=item['source'])
            for dimension in ('sectors', 'environments', 'topics', 'regions'):
                for tag in old.get(dimension, []):
                    if not any(t['id'] == tag['id'] for t in fresh[dimension]): fresh[dimension].append(tag)
            fresh['categories'] = category_tags(item['title'], '', fresh['sectors'])
            if isinstance(old.get('ai'), dict): fresh['ai'] = old['ai']
            item['intel'] = fresh
    if not items:
        raise SystemExit('No current or cached headlines; leaving the site unchanged')
    for item in items:
        item['intel'].pop('ai', None)
        item['intel']['categories'] = [tag for tag in item['intel']['categories'] if tag['method'] != 'ai']
        if not item['intel']['categories']:
            item['intel']['categories'] = category_tags(item['title'], '', item['intel']['sectors'])
    result = {'checkedAt': now(), 'sources': statuses, 'items': items, 'classification': {'rulesVersion': VERSION, 'aiStatus': 'disabled', 'model': '', 'processedThisRun': 0, 'cachedRecords': 0, 'aiCategorized': 0, 'pending': 0}}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    validate_news(result)
    temporary = DEST.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(DEST)
    print(f'Saved {len(items)} headlines ({sum(i["incident"] for i in items)} incident-related); {success_count} sources refreshed')

if __name__ == '__main__':
    main()
