"""Validate generated data before a privileged publishing job commits it."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from datetime import datetime
from classify_intel import SECTORS, ENVIRONMENTS, TOPICS, REGIONS, CATEGORY_LABELS

MAX_BYTES = 4_000_000
SOURCE_HOSTS = {
    'BleepingComputer': {'www.bleepingcomputer.com', 'bleepingcomputer.com'},
    'The Hacker News': {'thehackernews.com', 'www.thehackernews.com'},
    'CISA KEV': {'www.cisa.gov'},
}
HUNT_IDS = {'identity', 'powershell', 'persistence', 'oauth'}


def valid_source_url(value, source):
    if not isinstance(value, str) or len(value) > 2048:
        return False
    try:
        url = urlsplit(value)
        return (url.scheme == 'https' and url.hostname in SOURCE_HOSTS.get(source, set())
                and not url.username and not url.password and url.port in (None, 443))
    except (ValueError, TypeError):
        return False


def text(value, maximum):
    return isinstance(value, str) and 0 < len(value) <= maximum


def validate_news(data):
    if not isinstance(data, dict) or not isinstance(data.get('items'), list) or not 1 <= len(data['items']) <= 240:
        raise ValueError('Invalid feed collection')
    if not text(data.get('checkedAt'), 80):
        raise ValueError('Invalid refresh timestamp')
    datetime.fromisoformat(data['checkedAt'])
    for item in data['items']:
        if not isinstance(item, dict) or not text(item.get('title'), 500) or not valid_source_url(item.get('url'), item.get('source')):
            raise ValueError('Untrusted source URL or invalid headline')
        if not text(item.get('publishedAt'), 80) or not isinstance(item.get('incident'), bool):
            raise ValueError('Invalid record metadata')
        datetime.fromisoformat(item['publishedAt'])
        for key in ('requiredAction', 'ransomwareUse', 'cve', 'catalogDueDate', 'dateKind'):
            if item.get(key) is not None and not isinstance(item[key], str):
                raise ValueError('Invalid catalog metadata')
            if isinstance(item.get(key), str) and len(item[key]) > 2000:
                raise ValueError('Oversized catalog metadata')
        intel = item.get('intel')
        if not isinstance(intel, dict):
            raise ValueError('Missing classification')
        for field, allowed in [('sectors', SECTORS), ('environments', ENVIRONMENTS), ('topics', TOPICS), ('regions', REGIONS)]:
            tags = intel.get(field)
            if not isinstance(tags, list) or len(tags) > len(allowed):
                raise ValueError('Invalid classification tags')
            for tag in tags:
                if not isinstance(tag, dict) or tag.get('id') not in allowed or not text(tag.get('label'), 100):
                    raise ValueError('Invalid classification tag')
                if not isinstance(tag.get('evidence'), list) or not 1 <= len(tag['evidence']) <= 3 or not all(text(t, 100) for t in tag['evidence']):
                    raise ValueError('Invalid classification evidence')
        categories = intel.get('categories', [])
        if not isinstance(categories, list) or len(categories) > len(CATEGORY_LABELS):
            raise ValueError('Invalid categories')
        for tag in categories:
            if not isinstance(tag, dict) or not isinstance(tag.get('id'), str) or tag['id'] not in CATEGORY_LABELS or tag.get('label') != CATEGORY_LABELS[tag['id']]:
                raise ValueError('Invalid category')
            if tag.get('method') not in ('keyword', 'company', 'general', 'ai') or not text(tag.get('reason'), 500) or not text(tag.get('confidence'), 100):
                raise ValueError('Invalid category provenance')
            if not isinstance(tag.get('evidence'), list) or len(tag['evidence']) > 3 or not all(text(e, 100) for e in tag['evidence']):
                raise ValueError('Invalid category evidence')
            if tag['method'] != 'general' and not tag['evidence']:
                raise ValueError('Missing category evidence')
        ai = intel.get('ai')
        if ai is not None:
            if not isinstance(ai, dict) or not isinstance(ai.get('fingerprint'), str) or not re.fullmatch(r'[a-f0-9]{64}', ai['fingerprint']) or not isinstance(ai.get('suggestions'), list) or len(ai['suggestions']) > 2:
                raise ValueError('Invalid cached model metadata')
            for tag in ai['suggestions']:
                if not isinstance(tag, dict) or not isinstance(tag.get('id'), str) or tag['id'] not in CATEGORY_LABELS or tag.get('method') != 'ai' or not text(tag.get('confidence'),100) or not text(tag.get('reason'),300) or not isinstance(tag.get('evidence'),list) or len(tag['evidence'])!=1 or not text(tag['evidence'][0],100):
                    raise ValueError('Invalid cached model suggestion')
        hunts = intel.get('hunts')
        if not isinstance(hunts, list) or len(hunts) > 4 or any(not isinstance(h, dict) or h.get('id') not in HUNT_IDS or not text(h.get('title'), 150) or not text(h.get('requires'), 500) for h in hunts):
            raise ValueError('Invalid hunt mapping')
    return len(data['items'])


def validate_file(path):
    raw = Path(path).read_bytes()
    if len(raw) > MAX_BYTES:
        raise ValueError('Feed exceeds size limit')
    return validate_news(json.loads(raw))


if __name__ == '__main__':
    print(f'Validated {validate_file(sys.argv[1])} records')
