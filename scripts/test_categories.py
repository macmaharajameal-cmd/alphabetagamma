import json
import unittest
from unittest.mock import patch
import urllib.error
from classify_intel import classify
from classify_ai import apply_ai, validated_suggestions, fingerprint, MODEL, VERSION


def item(title):
    return {'title':title,'source':'The Hacker News','url':'https://thehackernews.com/test','publishedAt':'2026-11-21T00:00:00+00:00','incident':False,'intel':classify(title)}


class CategoryChecks(unittest.TestCase):
    def test_expanded_industries_and_unknown_fallback(self):
        self.assertEqual({c['id'] for c in classify('Hospitals and banks report breaches')['categories']},{'healthcare','finance'})
        self.assertEqual(classify('Chrome CVE flaw')['categories'][0]['id'],'cross-industry')
        self.assertEqual(classify('Indian researcher discovers a flaw')['regions'][0]['id'],'india')
        self.assertEqual(classify('Indian researcher discovers a flaw')['categories'][0]['id'],'cross-industry')

    def test_company_mapping_is_not_a_source_industry_mention(self):
        value=classify('Marriott investigates a security incident')
        self.assertEqual(value['sectors'],[])
        self.assertEqual(value['categories'][0]['id'],'hospitality')
        self.assertEqual(value['categories'][0]['method'],'company')
        self.assertEqual(classify('AWS target updated')['categories'][0]['id'],'cross-industry')

    def test_model_must_quote_supplied_evidence(self):
        valid={'id':'transport','confidence':'medium','evidence':'Qantas','reason':'Airline company context.'}
        self.assertEqual(validated_suggestions([valid],'Qantas reports an incident')[0]['method'],'ai')
        self.assertEqual(validated_suggestions([valid],'Windows flaw'),[])
        self.assertEqual(validated_suggestions([valid|{'id':'javascript:alert(1)'}],'Qantas'),[])
        self.assertEqual(validated_suggestions([valid|{'confidence':'low'}],'Qantas'),[])

    def test_denied_model_access_keeps_keyword_categories(self):
        data={'items':[item('Hotels report phishing'),item('Delta investigates an incident')]}
        with patch('classify_ai.request_batch',side_effect=urllib.error.HTTPError('https://models.github.ai',403,'Denied',{},None)):
            result=apply_ai(data,token='test-only')
        self.assertEqual(result['classification']['aiStatus'],'access-unavailable')
        self.assertEqual(result['items'][0]['intel']['categories'][0]['id'],'hospitality')

    def test_cached_model_result_is_reused_without_a_call(self):
        record=item('Delta investigates an incident')
        tags=validated_suggestions([{'id':'transport','confidence':'medium','evidence':'Delta','reason':'Airline company context.'}],record['title'])
        record['intel']['ai']={'fingerprint':fingerprint(record),'model':MODEL,'version':VERSION,'suggestions':tags}
        with patch('classify_ai.request_batch') as request:
            result=apply_ai({'items':[record]},token='test-only')
        request.assert_not_called()
        self.assertEqual(result['classification']['aiCategorized'],1)
        self.assertEqual(result['items'][0]['intel']['categories'][0]['method'],'ai')

    def test_catalog_is_never_sent_to_industry_model(self):
        record=item('Windows vulnerability');record['source']='CISA KEV'
        with patch('classify_ai.request_batch') as request:apply_ai({'items':[record]},token='test-only')
        request.assert_not_called()

if __name__=='__main__':unittest.main()
