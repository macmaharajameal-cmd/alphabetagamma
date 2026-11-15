'use strict';
const industryPacks = {
  retail: {name:'Retail', environments:['payments','web','windows','m365','aws','azure'], covers:'Checkout and e-commerce integrity, payment access, staff identities, and Windows endpoints.', logs:'Payment-provider audit trails, checkout change records, web access logs, identity sign-ins, EDR process events.', priorities:['Confirm checkout scripts and payment integrations against approved changes.','Review privileged accounts, MFA coverage, and internet-facing applications.'], guides:['identity','powershell']},
  hospitality: {name:'Hospitality', environments:['payments','web','windows','m365','aws','azure'], covers:'Reservation and guest-service applications, staff access, payment systems, and endpoint persistence.', logs:'Reservation/PMS access logs where available, identity/MFA logs, payment-vendor audit records, Windows task events.', priorities:['Inventory reservation and payment integrations and their service accounts.','Review remote support access and separate guest Wi-Fi from business systems.'], guides:['identity','persistence']},
  manufacturing: {name:'Manufacturing', environments:['ot','windows','m365','azure'], covers:'Engineering and Windows endpoints, industrial-system exposure, remote access, and IT/OT identity boundaries.', logs:'EDR process trees, Windows event logs, remote-access records, firewall logs, and passive OT telemetry where available.', priorities:['Review engineering-workstation and remote-access account activity.','Coordinate vendor remediation and evidence collection with OT owners; do not run unplanned active scans.'], guides:['powershell','persistence']},
  saas: {name:'SaaS / technology', environments:['web','aws','azure','m365'], covers:'Cloud and application identities, OAuth grants, developer integrations, software supply chains, and exposed applications.', logs:'Cloud control-plane audit logs, Entra application audits, IdP sign-ins, repository and CI/CD audit logs.', priorities:['Review privileged identities, application permissions, and integration secrets.','Check recent dependency, build pipeline, and deployment changes.'], guides:['oauth','identity']}
};
const intelGuides = {
  identity:{name:'Unusual successful sign-ins',requires:'Identity-provider sign-in and MFA logs; starter query uses Sentinel SigninLogs.'},
  powershell:{name:'Suspicious PowerShell',requires:'Windows process telemetry; starter query uses Defender XDR DeviceProcessEvents.'},
  persistence:{name:'Unexpected scheduled tasks',requires:'Windows task and process telemetry; starter query uses Defender XDR.'},
  oauth:{name:'Unexpected OAuth consent',requires:'Entra application audit logs in Sentinel AuditLogs.'}
};
const intelIds = ['industry','region','profile','environment','mode','source','search'];
const intelControls = Object.fromEntries(intelIds.map(id=>[id,document.getElementById(`intel-${id}`)]));
let intelItems = [], intelLimit = 30;
const getIntelFilters = () => Object.fromEntries(intelIds.map(id=>[id,intelControls[id].value]));
function intelTags(item, dimension) {return (item.intel?.[dimension] || []);}
function hasIntelTag(item, dimension, id) {return intelTags(item,dimension).some(tag=>tag.id===id);}
function sharedTechnology(item) {return intelTags(item,'environments').length>0 || intelTags(item,'topics').some(t=>['identity','supply-chain'].includes(t.id));}
function matchingIndustry(item, id) {
  return hasIntelTag(item,'sectors',id) || intelTags(item,'environments').some(tag=>industryPacks[id]?.environments.includes(tag.id));
}
function matchedIntel(item, f) {
  if (f.industry!=='all') {
    if(f.mode==='mentioned' && !hasIntelTag(item,'sectors',f.industry))return false;
    if(f.mode!=='mentioned' && !matchingIndustry(item,f.industry))return false;
  } else if (f.mode==='mentioned' && !intelTags(item,'sectors').length)return false;
  if(f.mode==='unclassified' && intelTags(item,'sectors').length)return false;
  if(f.region==='india' && !hasIntelTag(item,'regions','india'))return false;
  if(f.region==='india-relevant' && !(hasIntelTag(item,'regions','india') || sharedTechnology(item)))return false;
  if(f.region==='global' && !hasIntelTag(item,'regions','global'))return false;
  if(f.region==='unclassified' && intelTags(item,'regions').length)return false;
  if(f.profile==='startup' && !item.intel?.startupRelevant)return false;
  if(f.environment!=='all' && !hasIntelTag(item,'environments',f.environment))return false;
  if(f.source!=='all' && item.source!==f.source)return false;
  const terms=f.search.trim().toLocaleLowerCase();
  if(terms) {
    const haystack=[item.title,item.source,...['sectors','environments','topics','regions'].flatMap(d=>intelTags(item,d).flatMap(t=>[t.label,...t.evidence]))].join(' ').toLocaleLowerCase();
    if(!haystack.includes(terms))return false;
  }
  return true;
}
function intelScore(item,f) {return (f.industry!=='all' && hasIntelTag(item,'sectors',f.industry)?30:0)+(f.region.startsWith('india') && hasIntelTag(item,'regions','india')?15:0)+(f.environment!=='all' && hasIntelTag(item,'environments',f.environment)?10:0);}
function intelLink(text,href) {
  const a=element('a','',text);a.href=href;
  if(href.startsWith('https://')){a.target='_blank';a.rel='noopener noreferrer';}
  return a;
}
function intelReason(item,f) {
  const reasons=[];
  if(f.industry!=='all') {
    if(hasIntelTag(item,'sectors',f.industry))reasons.push(`${industryPacks[f.industry].name} wording appears in the source context. This is not confirmation of victim industry.`);
    else if(f.mode!=='mentioned') reasons.push(`Potential fit for ${industryPacks[f.industry].name.toLowerCase()} teams using the mentioned technology. Confirm it is in your environment.`);
  }
  if(f.region==='india-relevant' && !hasIntelTag(item,'regions','india'))reasons.push('India relevance is an assessment of shared technology or identity risk; the source does not establish Indian victims.');
  if(hasIntelTag(item,'regions','india'))reasons.push('India-related wording appears in the source context; check the original report for what that location refers to.');
  if(f.profile==='startup')reasons.push(item.intel.startupReason);
  if(!reasons.length)reasons.push(intelTags(item,'sectors').length?'The source contains industry context. Tags reflect terms, not independently verified attribution.':'Industry is not established by the available source context. Review affected technologies before assigning relevance.');
  return reasons;
}
function intelChecks(item) {
  const tasks=[];
  const topics=intelTags(item,'topics').map(t=>t.id);const env=intelTags(item,'environments').map(t=>t.id);
  if(item.source==='CISA KEV')tasks.push(item.requiredAction || 'Compare your product inventory and versions with the vendor advisory, then follow vendor remediation guidance.');
  else if(topics.includes('vulnerability'))tasks.push('Check vendor advisories against your inventory, exposed versions, and mitigation status.');
  if(topics.includes('identity'))tasks.push('Review related sign-ins, MFA events, session activity, and privileged account changes.');
  if(topics.includes('ransomware'))tasks.push('Review suspicious access and endpoint activity, backup integrity, and your incident escalation path.');
  if(topics.includes('supply-chain'))tasks.push('Review dependency, integration, and build-pipeline changes against approved releases.');
  if(env.includes('payments'))tasks.push('Validate checkout changes, payment integrations, and administrator access with their owners.');
  if(env.includes('ot'))tasks.push('Validate applicability with OT owners using passive telemetry and vendor guidance; avoid unplanned active testing.');
  if(!tasks.length)tasks.push('Read the source, identify the affected assets, and compare its evidence with your inventory and available logs.');
  return tasks.slice(0,3);
}
function renderIntelCoverage(f) {
  const grid=document.getElementById('industry-coverage');grid.replaceChildren();
  const panel=document.getElementById('intel-coverage-panel');
  if(panel.dataset.industry!==f.industry){panel.open=f.industry!=='all';panel.dataset.industry=f.industry;}
  const entries=f.industry==='all'?Object.entries(industryPacks):[[f.industry,industryPacks[f.industry]]];
  document.getElementById('coverage-heading').textContent=f.industry==='all'?'Industry coverage & required logs':`${industryPacks[f.industry].name}: scope and starting points`;
  entries.forEach(([id,pack])=>{
    const card=element('article','industry-card');card.append(element('h3','',pack.name),element('p','',pack.covers));
    const logs=element('p');logs.append(element('strong','','Useful logs: '),document.createTextNode(pack.logs));card.append(logs);
    const ul=element('ul');pack.priorities.forEach(text=>ul.append(element('li','',text)));card.append(ul);
    const links=element('div','source-links');pack.guides.forEach(key=>{
      const a=intelLink(intelGuides[key].name+' →',`hunts.html#hunt-${key}`);a.title=intelGuides[key].requires;links.append(a);
    });card.append(links);
    const note=element('p','subtle','Guides cover the named logs and techniques; no dedicated payment-script or industrial-protocol query is included.');card.append(note);
    if(f.industry==='all') {const params=new URLSearchParams({industry:id});card.append(intelLink('View this industry →','intel.html?'+params));}
    grid.append(card);
  });
}
function intelCard(item,f) {
  const article=element('article','story intel-story');
  const meta=element('div','story-meta');meta.append(element('span','pill',item.source));
  const time=element('time','',`${item.dateKind || 'Published'} · ${fmt(item.publishedAt)}`);time.dateTime=item.publishedAt;meta.append(time);article.append(meta);
  const heading=element('h2');heading.append(intelLink(item.title,item.url));article.append(heading);
  const tags=element('div','intel-tags');
  const sectors=intelTags(item,'sectors');
  if(sectors.length)sectors.forEach(tag=>tags.append(element('span','intel-badge',`${tag.label} mentioned`)));
  else tags.append(element('span','intel-badge unknown','Industry unclassified'));
  if(f.industry!=='all' && !hasIntelTag(item,'sectors',f.industry) && f.mode!=='mentioned')tags.append(element('span','intel-badge assessment',`Potential ${industryPacks[f.industry].name.toLowerCase()} fit`));
  if(hasIntelTag(item,'regions','india'))tags.append(element('span','intel-badge','India mentioned'));
  else if(f.region==='india-relevant')tags.append(element('span','intel-badge assessment','India relevance · assessment'));
  else tags.append(element('span','intel-badge unknown',intelTags(item,'regions').length?'Global wording present':'Geography not established'));
  intelTags(item,'environments').slice(0,3).forEach(tag=>tags.append(element('span','pill',tag.label)));article.append(tags);
  article.append(element('h3','','Why this appears'));
  intelReason(item,f).forEach(text=>article.append(element('p','',text)));
  article.append(element('h3','','What to check'));const list=element('ul');intelChecks(item).forEach(text=>list.append(element('li','',text)));article.append(list);
  if(item.source==='CISA KEV') {
    const facts=element('p','subtle',`CISA ransomware-campaign use: ${item.ransomwareUse || 'Unknown'}.`);
    if(item.catalogDueDate)facts.append(document.createTextNode(` U.S. federal catalog remediation date: ${item.catalogDueDate}; not an Indian compliance deadline.`));
    article.append(facts);
  }
  const actions=element('div','intel-actions');actions.append(intelLink('Read original source ↗',item.url));
  const hunts=item.intel?.hunts || [];
  hunts.forEach(h=>{if(!intelGuides[h.id])return;const a=intelLink(h.title+' →',`hunts.html#hunt-${h.id}`);a.title=h.requires;actions.append(a)});
  article.append(actions);
  if(!hunts.length)article.append(element('p','subtle','No specific hunt mapping is established from this context. Use the industry starting points above after confirming telemetry.'));
  else hunts.forEach(h=>article.append(element('p','subtle',`Hunt prerequisite: ${h.requires}. A suggested guide is not evidence this technique occurred.`)));
  const details=element('details');details.append(element('summary','','Classification evidence & confidence'));
  const evidence=element('div','intel-evidence');evidence.append(element('p','',`Method: ${item.intel?.version || 'unclassified'} · ${item.intel?.basis || 'No context available'}.`));
  [['sectors','Industry'],['environments','Environment'],['regions','Geography'],['topics','Topic']].forEach(([dimension,label])=>{
    const values=intelTags(item,dimension);
    evidence.append(element('p','',`${label}: ${values.length?values.map(tag=>`${tag.label} — “${tag.evidence.join('”, “')}” (${tag.confidence})`).join('; '):'Unclassified: no explicit term matched.'}`));
  });
  evidence.append(element('p','subtle',item.intel?.scope || 'Source context does not establish applicability.'));
  details.append(evidence);article.append(details);return article;
}
function updateIntelURL(f) {
  const params=new URLSearchParams();
  Object.entries(f).forEach(([key,value])=>{if(value && value!=='all' && !(key==='mode' && value==='relevant'))params.set(key==='search'?'q':key,value)});
  const query=params.toString();history.replaceState(null,'',location.pathname+(query?'?'+query:''));
}
function renderBusinessIntel() {
  const f=getIntelFilters();renderIntelCoverage(f);updateIntelURL(f);
  const shown=intelItems.filter(item=>matchedIntel(item,f)).sort((a,b)=>intelScore(b,f)-intelScore(a,f) || Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  const results=document.getElementById('intel-results');results.replaceChildren();
  document.getElementById('intel-count').textContent=`${shown.length} matching items · showing ${Math.min(shown.length,intelLimit)}`;
  document.getElementById('intel-scope-note').textContent=f.region==='india-relevant'?'India-relevant includes shared technology risks as well as India mentions. Ordered by filter fit, then date—not severity.':f.region==='india'?'Only items with India-related wording. A mention is not proof of Indian victims. Ordered by filter fit, then date—not severity.':'Ordered by filter fit, then date—not severity. Unknown sectors and geography remain explicitly labeled.';
  if(!shown.length){
    const empty=element('div','empty');empty.append(element('p','','No items meet all these filters. That does not mean there are no threats to this sector or region.'));
    const broader=element('button','button secondary intel-empty-action','Broaden to all available intelligence');broader.type='button';broader.addEventListener('click',()=>{document.getElementById('intel-filters').reset()});empty.append(broader);results.append(empty);
  } else shown.slice(0,intelLimit).forEach(item=>results.append(intelCard(item,f)));
  document.getElementById('intel-more').hidden=shown.length<=intelLimit;
}
function updateIntelFeed(data) {
  intelItems=data.items;
  document.getElementById('intel-total').textContent=intelItems.length;
  document.getElementById('intel-sector-count').textContent=intelItems.filter(i=>intelTags(i,'sectors').length).length;
  document.getElementById('intel-india-count').textContent=intelItems.filter(i=>hasIntelTag(i,'regions','india')).length;
  document.getElementById('intel-kev-count').textContent=intelItems.filter(i=>i.source==='CISA KEV').length;
  const missing=(data.sources || []).filter(s=>s.status!=='ok').map(s=>s.name);
  const stale=Date.now()-Date.parse(data.checkedAt)>12*3600000;
  document.getElementById('intel-status').textContent=`Last refresh attempt: ${fmt(data.checkedAt)}.${stale?' Updates are delayed.':''}${missing.length?' Some sources are unavailable: '+missing.join(', ')+'. Cached items are retained.':''}`;
  const selected=intelControls.source.value;
  intelControls.source.replaceChildren(new Option('All sources','all'));
  [...new Set(intelItems.map(i=>i.source))].sort().forEach(name=>intelControls.source.append(new Option(name,name)));
  if([...intelControls.source.options].some(o=>o.value===selected))intelControls.source.value=selected;
}
async function startIntel() {
  try {
    const data=await loadFeed();updateIntelFeed(data);
    const params=new URLSearchParams(location.search);
    intelIds.forEach(key=>{const value=params.get(key==='search'?'q':key);if(value!==null && (key==='search' || [...intelControls[key].options].some(o=>o.value===value)))intelControls[key].value=value});
    renderBusinessIntel();
  }catch{document.getElementById('intel-status').textContent='Intelligence is temporarily unavailable. Use the original-source links below; please try again later.';renderIntelCoverage(getIntelFilters());}
}
document.getElementById('intel-filters').addEventListener('submit',e=>e.preventDefault());
intelIds.forEach(key=>intelControls[key].addEventListener(key==='search'?'input':'change',()=>{intelLimit=30;renderBusinessIntel()}));
document.getElementById('intel-filters').addEventListener('reset',()=>setTimeout(()=>{intelLimit=30;renderBusinessIntel()},0));
document.getElementById('intel-more').addEventListener('click',()=>{intelLimit+=30;renderBusinessIntel()});
document.getElementById('intel-share').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(location.href);document.getElementById('intel-share-status').textContent='View link copied. It contains your filters, not an account or customer profile.';}
  catch{document.getElementById('intel-share-status').textContent='Copy the address from your browser to share these filters.';}
});
startIntel();
setInterval(async()=>{if(document.hidden)return;try{updateIntelFeed(await loadFeed());renderBusinessIntel()}catch{/* Keep the current view on network failure. */}},15*60*1000);
