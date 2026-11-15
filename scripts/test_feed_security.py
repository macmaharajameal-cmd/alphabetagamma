"""Regression tests for encoded XML payloads, redirects, and feed-origin spoofing."""
import copy
import json
from pathlib import Path
import unittest
import urllib.request
import xml.etree.ElementTree as ET
from refresh_news import parse_feed_xml, SourceRedirects
from validate_news import valid_source_url, validate_news


class FeedSecurityChecks(unittest.TestCase):
    def test_encoded_entity_declarations_are_rejected(self):
        payload = '<!DOCTYPE rss [<!ENTITY x "injected">]><rss><title>&x;</title></rss>'
        for encoding in ('utf-8', 'utf-16', 'utf-16-le', 'utf-16-be'):
            with self.subTest(encoding=encoding), self.assertRaises((ValueError, ET.ParseError)):
                parse_feed_xml(payload.encode(encoding))

    def test_ordinary_feed_still_parses(self):
        self.assertEqual(parse_feed_xml(b'<rss><title>Safe &amp; normal</title></rss>').findtext('title'), 'Safe & normal')

    def test_no_redirect_to_private_or_unapproved_origin(self):
        handler = SourceRedirects({'feeds.feedburner.com'})
        request = urllib.request.Request('https://feeds.feedburner.com/TheHackersNews')
        for destination in ('http://feeds.feedburner.com/feed', 'https://127.0.0.1/data', 'https://169.254.169.254/latest/meta-data/', 'https://attacker.example/feed', 'https://x@feeds.feedburner.com/feed', 'https://feeds.feedburner.com:8443/feed'):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                handler.redirect_request(request, None, 302, 'Found', {}, destination)

    def test_publisher_links_cannot_spoof_origin(self):
        for link in ('javascript:alert(1)', 'http://www.bleepingcomputer.com/news/', 'https://www.bleepingcomputer.com.attacker.example/news/', 'https://www.bleepingcomputer.com@attacker.example/', 'https://user@www.bleepingcomputer.com/', 'https://www.bleepingcomputer.com:8443/'):
            self.assertFalse(valid_source_url(link, 'BleepingComputer'))
        self.assertTrue(valid_source_url('https://www.bleepingcomputer.com/news/security/test/', 'BleepingComputer'))
        self.assertFalse(valid_source_url('https://www.bleepingcomputer.com/', 'The Hacker News'))

    def test_publish_validation_rejects_bad_links_and_nested_data(self):
        data = json.loads((Path(__file__).resolve().parents[1] / 'docs/data/news.json').read_text())
        self.assertGreater(validate_news(data), 0)
        poisoned = copy.deepcopy(data)
        poisoned['items'][0]['url'] = 'https://attacker.example/login'
        with self.assertRaises(ValueError): validate_news(poisoned)
        poisoned = copy.deepcopy(data)
        poisoned['items'][0]['intel']['sectors'] = 'not-an-array'
        with self.assertRaises(ValueError): validate_news(poisoned)


if __name__ == '__main__':
    unittest.main()
