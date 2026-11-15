"""Explainable classification of publisher headlines and RSS context, without an AI API."""
import re

VERSION = 'rules-1'
SECTORS = {
 'retail': ('Retail', r'\b(retail(?:er|ers)?|e-commerce|ecommerce|point.of.sale|online stores?|shopping carts?)\b'),
 'hospitality': ('Hospitality', r'\b(hospitality|hotels?|resorts?|hospitality booking|hotel booking|guest reservation)\b'),
 'manufacturing': ('Manufacturing', r'\b(manufactur(?:ing|er|ers)|industrial|factories|factory|semiconductors?|SCADA|programmable logic controller)\b'),
 'saas': ('SaaS / technology', r'\b(SaaS|software.as.a.service|software compan(?:y|ies)|cloud providers?|software supply.chain|developer tools?)\b'),
}
ENVIRONMENTS = {
 'm365': ('Microsoft 365 / identity', r'\b(Microsoft 365|Office 365|M365|Entra|Azure AD|Exchange Online|SharePoint|Outlook|OneDrive)\b'),
 'aws': ('AWS', r'\b(AWS|Amazon Web Services|Amazon S3|Amazon EC2)\b'),
 'azure': ('Azure', r'\b(Azure|Entra|Azure AD)\b'),
 'windows': ('Windows', r'\b(Windows|PowerShell|Active Directory|scheduled tasks?|schtasks)\b'),
 'payments': ('Payments / e-commerce', r'\b(point.of.sale|payment(?:s)?|e-commerce|ecommerce|shopping carts?|card skimm(?:ing|er)|Magecart)\b'),
 'web': ('Web / SaaS applications', r'\b(SaaS|web applications?|web apps?|WordPress|JavaScript|SQL injection|API keys?|OAuth|GitHub|GitLab|developer|software supply.chain|Chrome|Chromium)\b'),
 'ot': ('Industrial / OT', r'\b(SCADA|industrial control|operational technology|PLCs?|programmable logic controller|Siemens|Rockwell)\b'),
}
TOPICS = {
 'identity': ('Identity / account access', r'\b(phishing|credentials?|passwords?|sign.ins?|login|MFA|OAuth|tokens?|identity|account takeover)\b'),
 'ransomware': ('Ransomware / extortion', r'\b(ransomware|extortion|ransom)\b'),
 'vulnerability': ('Vulnerability / exploitation', r'\b(CVE-\d{4}-\d+|vulnerabilit(?:y|ies)|zero.day|exploit(?:ed|ation|s)?)\b'),
 'data': ('Data exposure / theft', r'\b(breach|data leak|stolen|data theft|data exposure|exfiltrat(?:ion|e|ed))\b'),
 'supply-chain': ('Software supply chain', r'\b(supply.chain|malicious packages?|npm|PyPI|trojanized|compromised (?:extension|package|update))\b'),
}
REGIONS = {
 'india': ('India mentioned', r'\b(India|Indian|CERT-In|Bengaluru|Bangalore|Mumbai|New Delhi|Hyderabad)\b'),
 'global': ('Global scope explicitly mentioned', r'\b(worldwide|globally|global campaign|across the world|multiple countries)\b'),
}
# Suggested starting points, not claims about the attack described in the source.
HUNTS = {
 'identity': ('identity', 'Unusual successful sign-ins', 'Identity-provider sign-in, MFA, and audit logs'),
 'windows': ('powershell', 'Suspicious PowerShell', 'Windows process events / Defender XDR; PowerShell logging'),
 'oauth': ('oauth', 'Unexpected OAuth application consent', 'Entra application audit logs in Microsoft Sentinel'),
 'persistence': ('persistence', 'Unexpected scheduled tasks', 'Windows task creation and process logs'),
}

def matching(text, definitions):
 result=[]
 for key,(label,pattern) in definitions.items():
  matches=list(re.finditer(pattern,text,re.I))
  if matches:
   terms=list(dict.fromkeys(m.group(0) for m in matches))[:3]
   result.append({'id':key,'label':label,'evidence':terms,'confidence':'Explicit term match'})
 return result

def classify(title, context='', source=''):
 text=title+' '+context
 sectors=matching(text,SECTORS);env=matching(text,ENVIRONMENTS);topics=matching(text,TOPICS);regions=matching(text,REGIONS)
 env_ids={e['id'] for e in env};topic_ids={t['id'] for t in topics}
 startup=bool(env_ids & {'m365','aws','azure','web','payments'} or topic_ids & {'identity','supply-chain'})
 hunts=[]
 if 'identity' in topic_ids and env_ids & {'m365','azure'}:hunts.append(HUNTS['identity'])
 if re.search(r'\bOAuth|application consent\b',text,re.I):hunts.append(HUNTS['oauth'])
 if re.search(r'\bPowerShell\b',text,re.I):hunts.append(HUNTS['windows'])
 if re.search(r'\bscheduled tasks?|schtasks\b',text,re.I):hunts.append(HUNTS['persistence'])
 return {'version':VERSION,'basis':'Headline and publisher RSS context' if context else 'Headline only',
         'sectors':sectors,'environments':env,'topics':topics,'regions':regions,
         'startupRelevant':startup,'startupReason':'Potential relevance to small teams using the mentioned cloud, application, payment, or identity systems. Company size is not established by the source.' if startup else '',
         'hunts':[{'id':i,'title':t,'requires':r} for i,t,r in hunts],
         'scope':'Catalog entry: exploitation confirmed by CISA, geography and industry unspecified' if source=='CISA KEV' else 'Tags identify source wording; they do not establish victim industry, location, attribution, or impact.'}
