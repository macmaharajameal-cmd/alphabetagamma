"""Regression checks for misleading industry/geography matches and catalog semantics."""
import json
import unittest
from classify_intel import classify
from refresh_news import context_text, kev_items


def tags(item, dimension):
    return {tag['id'] for tag in item[dimension]}


class ClassificationChecks(unittest.TestCase):
    def test_india_and_industry_remain_separate_dimensions(self):
        result = classify('Indian hotels report phishing targeting Microsoft 365')
        self.assertEqual(tags(result, 'sectors'), {'hospitality'})
        self.assertEqual(tags(result, 'regions'), {'india'})
        self.assertTrue(result['startupRelevant'])
        self.assertTrue(any(hunt['id'] == 'identity' for hunt in result['hunts']))

    def test_hospital_and_indianapolis_are_not_hospitality_or_india(self):
        result = classify('Hospital systems in Indianapolis report ransomware')
        self.assertEqual(result['sectors'], [])
        self.assertEqual(result['regions'], [])

    def test_indian_researcher_does_not_imply_an_industry(self):
        result = classify('Indian researcher discovers a Windows vulnerability')
        self.assertEqual(tags(result, 'regions'), {'india'})
        self.assertEqual(result['sectors'], [])
        self.assertIn('victim', result['scope'])

    def test_multi_industry_evidence_is_retained(self):
        result = classify('Retail payment and factory SCADA systems')
        self.assertEqual(tags(result, 'sectors'), {'retail', 'manufacturing'})
        self.assertTrue({'payments', 'ot'} <= tags(result, 'environments'))
        self.assertTrue(all(tag['evidence'] for tag in result['sectors']))

    def test_missing_context_is_not_filled_with_guesses(self):
        result = classify('Unclear security report')
        self.assertEqual(result['sectors'], [])
        self.assertEqual(result['environments'], [])
        self.assertEqual(result['regions'], [])
        self.assertFalse(result['startupRelevant'])
        self.assertEqual(result['hunts'], [])

    def test_feed_scripts_are_not_classification_evidence(self):
        self.assertEqual(context_text('<p>Useful context</p><script>Indian hotels</script>'), 'Useful context')

    def test_kev_is_not_a_breach_or_india_report(self):
        body = json.dumps({'vulnerabilities': [{'cveID': 'CVE-2025-1234', 'vulnerabilityName': 'Windows flaw', 'dateAdded': '2025-06-01', 'dueDate': '2025-06-21'}]}).encode()
        item = kev_items(body)[0]
        self.assertFalse(item['incident'])
        self.assertEqual(item['dateKind'], 'Added to CISA KEV')
        self.assertEqual(item['intel']['regions'], [])
        self.assertEqual(item['catalogDueDate'], '2025-06-21')


if __name__ == '__main__':
    unittest.main()
