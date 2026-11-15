(() => {
  'use strict';
  const canvas = document.getElementById('arcade-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ui = Object.fromEntries(['score','streak','health','clock','clock-label','wave','best','feedback','overlay','overlay-eyebrow','overlay-title','overlay-copy','setup','start','resume','pause','sound','finish','mode','result','lesson','targets'].map(id => [id,document.getElementById(`arcade-${id}`)]));
  if (!ctx) { ui['overlay-copy'].textContent = 'Canvas is unavailable in this browser. Try another browser, or explore the threat hunts below.'; ui.start.disabled = true; return; }
  const W = 480, H = 300, DURATION = 60;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const types = {
    bot: {label:'ROGUE BOT', color:'#ff7596', dark:'#a63858', points:100, sprite:[
      '....11....11....','.....111111.....','...1111111111...','..111111111111..','..112211112211..','..112211112211..','..111111111111..','....11333311....','...1111111111...','..11..1111..11..','..11..1..1..11..','.....11..11.....']},
    phish: {label:'PHISH DRONE', color:'#c4a0ff', dark:'#7651ba', points:150, sprite:[
      '.......11.......','......1111......','....11111111....','..111111111111..','1111331111331111','1111221111221111','..111111111111..','....11133111....','..11..1111..11..','.11....11....11.','11............11','................']},
    friendly: {label:'FRIENDLY', color:'#67e1d0', dark:'#287b77', points:0, sprite:[
      '..111111111111..','..111111111111..','..111111111111..','..111111112211..','..111111122111..','...1121122111...','...1112221111...','....11121111....','....11111111....','.....111111.....','......1111......','.......11.......']}
  };
  const stars = Array.from({length:42},(_,i)=>({x:(i*73+17)%W,y:(i*37+11)%224,size:i%4===0?2:1}));
  let state = 'idle', mode = 'arcade', score = 0, streak = 0, health = 5, elapsed = 0, wave = 1, best = 0;
  let shots = 0, hits = 0, friendlyHits = 0, escaped = 0, protectedCount = 0;
  let entities = [], effects = [], nextId = 1, spawnClock = 0, last = null, soundEnabled = false, audio = null;
  const aim = {x:W/2,y:H/2}; const keys = new Set(); const targetButtons = new Map();
  let lastHud = '';
  const pad = value => String(value).padStart(5,'0');
  const say = text => { ui.feedback.textContent = text; };
  function tone(freq, duration = .07, kind = 'square') {
    if (!soundEnabled) return;
    try {
      if (!audio) { const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return; audio = new Audio(); }
      if (audio.state === 'suspended') audio.resume().catch(()=>{});
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = kind; osc.frequency.setValueAtTime(freq,audio.currentTime);
      gain.gain.setValueAtTime(.025,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
      osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration);
      osc.onended = () => { osc.disconnect();gain.disconnect(); };
    } catch { /* Sound is optional; a blocked audio context must not stop play. */ }
  }
  function updateHud() {
    const stamp=[score,streak,health,Math.ceil(elapsed),wave,mode,best,state].join(':');
    if(stamp===lastHud)return;lastHud=stamp;
    ui.score.textContent=pad(score);ui.streak.textContent=streak ? `${streak} · ×${Math.min(3,1+Math.floor(streak/5))}` : '0';
    ui.health.textContent=mode==='practice'?'SAFE':`${health} / 5`;
    ui['clock-label'].textContent=mode==='practice'?'PRACTICE':'TIME LEFT';
    ui.clock.textContent=mode==='practice'?'∞':`${Math.max(0,Math.ceil(DURATION-elapsed))}s`;
    ui.wave.textContent=state==='idle'?'STANDBY':mode==='practice'?'TRAINING':`WAVE ${wave} / 3`;
    ui.best.textContent=pad(best);
  }
  function updateTargets() {
    const activeId=document.activeElement?.dataset?.target;
    for(const [id,button] of targetButtons){if(!entities.some(e=>e.id===id)){button.remove();targetButtons.delete(id);}}
    if(!entities.length && !targetButtons.size){ui.targets.replaceChildren();const note=document.createElement('p');note.textContent=state==='running'?'Watching for targets…':'Targets appear when your patrol starts.';ui.targets.append(note);return;}
    if(ui.targets.querySelector('p'))ui.targets.replaceChildren();
    for(const e of entities){if(targetButtons.has(e.id))continue;const button=document.createElement('button');button.type='button';button.dataset.target=String(e.id);button.dataset.friendly=String(e.kind==='friendly');button.textContent=e.kind==='friendly'?'FRIENDLY · protect':types[e.kind].label+' · quarantine';button.setAttribute('aria-label',e.kind==='friendly'?'Friendly shield. Do not fire; it costs integrity.':`Quarantine ${types[e.kind].label.toLowerCase()}`);button.addEventListener('click',()=>{if(state==='running')shoot(e.x,e.y);});ui.targets.append(button);targetButtons.set(e.id,button);}
    if(activeId && !entities.some(e=>String(e.id)===activeId)){const next=ui.targets.querySelector('button:not([data-friendly=true])') || ui.targets.querySelector('button');next?.focus({preventScroll:true});}
    for(const button of targetButtons.values())button.disabled=state!=='running';
  }
  function spawn(kind, x, y) {
    if(entities.length>=6)return;
    const left=Math.random()<.5;
    const e={id:nextId++,kind:kind || (Math.random()<.29?'friendly':Math.random()<.35?'phish':'bot'),x:x ?? (reduced.matches?40+Math.random()*(W-80):(left?-28:W+28)),y:y ?? 72+Math.random()*150,baseY:y ?? 72+Math.random()*150,age:0,vx:(left?1:-1)*(mode==='practice'?19:26+wave*8),phase:Math.random()*6};
    e.baseY=e.y;entities.push(e);updateTargets();
  }
  function start() {
    mode=ui.mode.value==='practice'?'practice':'arcade';state='running';score=0;streak=0;health=5;elapsed=0;wave=1;shots=0;hits=0;friendlyHits=0;escaped=0;protectedCount=0;entities=[];effects=[];spawnClock=0;last=null;keys.clear();aim.x=W/2;aim.y=H/2;
    ui.overlay.hidden=true;ui.pause.disabled=false;ui.pause.textContent='Pause';ui.finish.hidden=mode!=='practice';ui.result.hidden=true;ui.lesson.hidden=true;
    for(const button of targetButtons.values())button.remove();targetButtons.clear();
    spawn('bot',96,112);spawn('friendly',240,184);spawn('phish',384,112);
    say(mode==='practice'?'Practice patrol: no timer or damage. Try a rogue bot first.':'Patrol online. Quarantine rogue bots and phish drones. Protect friendly shields.');
    tone(420,.1,'triangle');updateHud();draw();document.querySelector('.arcade-cabinet').scrollIntoView({block:'start',behavior:'instant'});canvas.focus({preventScroll:true});
  }
  function pause(reason='Patrol paused. Your network can wait.') {
    if(state!=='running')return;
    state='paused';keys.clear();ui.overlay.hidden=false;ui.setup.hidden=true;ui.start.hidden=true;ui.resume.hidden=false;ui.result.hidden=true;ui.lesson.hidden=true;
    ui['overlay-eyebrow'].textContent='SIGNAL ON HOLD';ui['overlay-title'].textContent='Take a breather.';ui['overlay-copy'].textContent=reason;
    ui.pause.textContent='Resume';say(reason);updateTargets();updateHud();ui.resume.focus({preventScroll:true});
  }
  function resume() {
    if(state!=='paused')return;
    state='running';last=null;ui.overlay.hidden=true;ui.pause.textContent='Pause';say('Back online. Check your targets.');updateTargets();canvas.focus({preventScroll:true});
  }
  function finish(reason) {
    if(state!=='running' && state!=='paused')return;
    state='ended';keys.clear();
    if(mode==='arcade')best=Math.max(best,score);
    const accuracy=shots?Math.round(hits/shots*100):0;
    ui.overlay.hidden=false;ui.setup.hidden=false;ui.start.hidden=false;ui.resume.hidden=true;ui.pause.disabled=true;ui.pause.textContent='Pause';ui.finish.hidden=true;
    ui['overlay-eyebrow'].textContent=mode==='practice'?'TRAINING COMPLETE':health>0?'NETWORK SECURED':'NETWORK NEEDS A REBOOT';
    ui['overlay-title'].textContent=mode==='practice'?'Good practice, defender.':score>=2200 && health>0?'Signal sentinel.':score>=1000?'Packet protector.':'Keep your shield up.';
    ui['overlay-copy'].textContent=reason;
    ui.result.hidden=false;ui.result.textContent=`${pad(score)} points · ${hits} threats blocked · ${accuracy}% accuracy · ${protectedCount} friendlies protected`;
    ui.lesson.hidden=false;ui.lesson.textContent=friendlyHits?'Real-world tip: confirm the evidence before blocking a system. False positives can disrupt the good stuff.':escaped?'Real-world tip: layered defenses help when one threat slips through. Keep systems patched and recovery plans ready.':'Real-world tip: slow down for suspicious messages. Check the sender and destination before you click.';
    ui.start.textContent='PLAY AGAIN ↗';say(mode==='practice'?'Practice complete. Try arcade mode when you are ready.':`Patrol complete: ${score} points. ${accuracy}% accuracy.`);
    entities=[];effects=[];updateTargets();updateHud();draw();ui.start.focus({preventScroll:true});
  }
  function burst(x,y,color,label) {
    effects.push({x,y,color,label,age:0});if(effects.length>15)effects.shift();
  }
  function shoot(x,y) {
    if(state!=='running')return;shots++;aim.x=x;aim.y=y;
    const target=[...entities].reverse().find(e=>Math.hypot(e.x-x,e.y-y)<=30);
    if(!target){streak=0;burst(x,y,'#97aabd','MISS');tone(95,.04,'triangle');say('No target hit. Look for rogue bots and phish drones.');updateHud();return;}
    entities=entities.filter(e=>e.id!==target.id);
    if(target.kind==='friendly'){
      friendlyHits++;streak=0;if(mode==='arcade')health=Math.max(0,health-1);
      burst(target.x,target.y,'#67e1d0','FRIENDLY');tone(110,.14,'triangle');say(mode==='practice'?'That was a friendly shield. In arcade mode, blocking it costs integrity.':'Friendly system blocked. Integrity −1. Leave shields alone.');
    }else{
      hits++;streak++;const multiplier=Math.min(3,1+Math.floor(streak/5));const points=types[target.kind].points*multiplier;score+=points;
      burst(target.x,target.y,types[target.kind].color,`+${points}`);tone(target.kind==='phish'?640:440,.06);say(`${types[target.kind].label.toLowerCase()} quarantined. +${points}${multiplier>1?' · ×'+multiplier+' streak':''}`);
    }
    updateTargets();updateHud();if(health<=0 && mode==='arcade')finish('Five integrity points lost. Take another shot at keeping the network online.');
  }
  function background() {
    ctx.fillStyle='#080e1b';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#253849';for(const star of stars)ctx.fillRect(star.x,star.y,star.size,star.size);
    ctx.fillStyle='#0b1a2c';ctx.fillRect(0,188,W,82);
    for(let i=0;i<15;i++){const h=12+(i*17)%46;ctx.fillStyle=i%2?'#13253a':'#102035';ctx.fillRect(i*34,264-h,26,h);ctx.fillStyle='#386074';for(let row=0;row<3;row++)for(let col=0;col<3;col++)if((i+row+col)%3!==0)ctx.fillRect(i*34+5+col*6,264-h+5+row*8,2,3);}
    ctx.strokeStyle='#163243';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,268.5);ctx.lineTo(W,268.5);for(let i=0;i<9;i++){ctx.moveTo(240+(i-4)*20,269);ctx.lineTo(240+(i-4)*110,300);}for(const y of [274.5,283.5,296.5]){ctx.moveTo(0,y);ctx.lineTo(W,y);}ctx.stroke();
    ctx.font='7px monospace';ctx.textAlign='left';ctx.fillStyle='#53778b';ctx.fillText('SAFE / SCALE',12,289);ctx.textAlign='right';ctx.fillText('DEFEND THE GOOD STUFF',W-12,289);
    ctx.fillStyle='#0e1824';ctx.fillRect(12,12,112,15);ctx.fillStyle='#a1f56a';ctx.textAlign='left';ctx.font='7px monospace';ctx.fillText(state==='running'?'● PATROL ONLINE':'● SECURE SECTOR 01',18,22);
  }
  function drawSprite(e) {
    const type=types[e.kind],scale=3,x=Math.round(e.x-24),y=Math.round(e.y-18);
    ctx.fillStyle='#030813';ctx.fillRect(x+3,y+37,42,3);
    type.sprite.forEach((row,j)=>{for(let i=0;i<row.length;i++){const c=row[i];if(c==='.')continue;ctx.fillStyle=c==='1'?type.color:c==='2'?'#091320':type.dark;ctx.fillRect(x+i*scale,y+j*scale,scale,scale);}});
    ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillStyle=type.color;ctx.fillText(type.label,Math.round(e.x),y+48);
  }
  function draw() {
    ctx.imageSmoothingEnabled=false;background();
    if(state==='idle'){drawSprite({x:115,y:145,kind:'bot'});drawSprite({x:240,y:145,kind:'friendly'});drawSprite({x:365,y:145,kind:'phish'});}
    for(const e of entities)drawSprite(e);
    for(const fx of effects){ctx.fillStyle=fx.color;ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillText(fx.label,Math.round(fx.x),Math.round(fx.y-20-fx.age*22));if(!reduced.matches){for(let i=0;i<6;i++){const angle=i*Math.PI/3;const d=6+fx.age*35;ctx.fillRect(Math.round(fx.x+Math.cos(angle)*d),Math.round(fx.y+Math.sin(angle)*d),2,2);}}}
    if(state==='running'){
      const x=Math.round(aim.x),y=Math.round(aim.y);ctx.strokeStyle='#e4f6fd';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x-10,y+.5);ctx.lineTo(x-4,y+.5);ctx.moveTo(x+4,y+.5);ctx.lineTo(x+10,y+.5);ctx.moveTo(x+.5,y-10);ctx.lineTo(x+.5,y-4);ctx.moveTo(x+.5,y+4);ctx.lineTo(x+.5,y+10);ctx.stroke();ctx.fillStyle='#a1f56a';ctx.fillRect(x,y,1,1);
    }
  }
  function frame(timestamp) {
    if(state==='running'){
      const delta=last===null?0:Math.max(0,(timestamp-last)/1000);last=timestamp;const dt=Math.min(delta,.05);elapsed+=delta;
      if(mode==='arcade' && elapsed>=DURATION){elapsed=DURATION;finish('One minute on watch. Your patrol is complete.');}
      else {
        const nextWave=mode==='practice'?1:Math.min(3,1+Math.floor(elapsed/20));if(nextWave!==wave){wave=nextWave;say(`Wave ${wave}: things are speeding up. Keep checking your targets.`);}
        const speed=180;let dx=0,dy=0;if(keys.has('arrowleft')||keys.has('a'))dx--;if(keys.has('arrowright')||keys.has('d'))dx++;if(keys.has('arrowup')||keys.has('w'))dy--;if(keys.has('arrowdown')||keys.has('s'))dy++;
        const length=Math.hypot(dx,dy)||1;aim.x=Math.max(8,Math.min(W-8,aim.x+dx/length*speed*dt));aim.y=Math.max(35,Math.min(255,aim.y+dy/length*speed*dt));
        const survivors=[];let changed=false, threatEscaped=false;
        for(const e of entities){e.age+=delta;if(!reduced.matches){e.x+=e.vx*dt;e.y=e.baseY+Math.sin(e.age*1.6+e.phase)*9;}
          if(e.x < -55 || e.x>W+55 || e.age>13){changed=true;if(e.kind==='friendly')protectedCount++;else{threatEscaped=true;escaped++;streak=0;if(mode==='arcade')health=Math.max(0,health-1);}}else survivors.push(e);
        }
        entities=survivors;
        if(changed){updateTargets();if(mode==='arcade' && threatEscaped)say('A threat may have slipped through. Watch the edges and protect friendly shields.');}
        if(health<=0 && mode==='arcade')finish('The network took too many hits. Regroup, check your targets, and try again.');
        else{
          spawnClock+=delta;const interval=mode==='practice'?2.5:Math.max(.7,1.8-wave*.25);if(spawnClock>=interval){spawnClock=0;spawn();}
          for(const fx of effects)fx.age+=dt;effects=effects.filter(fx=>fx.age<.65);updateHud();draw();
        }
      }
    }else last=null;
    requestAnimationFrame(frame);
  }
  function position(event){const rect=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(W,(event.clientX-rect.left)/rect.width*W)),y:Math.max(0,Math.min(H,(event.clientY-rect.top)/rect.height*H))};}
  canvas.addEventListener('pointerdown',event=>{if(state!=='running'||(event.pointerType==='mouse' && event.button!==0))return;event.preventDefault();canvas.focus({preventScroll:true});const p=position(event);shoot(p.x,p.y);});
  canvas.addEventListener('pointermove',event=>{if(state==='running' && event.pointerType==='mouse'){const p=position(event);aim.x=p.x;aim.y=p.y;}});
  canvas.addEventListener('keydown',event=>{if(event.ctrlKey||event.metaKey||event.altKey)return;const key=event.key.toLowerCase();if(['arrowleft','arrowright','arrowup','arrowdown','w','a','s','d'].includes(key)){event.preventDefault();keys.add(key);}else if(key===' '){event.preventDefault();if(!event.repeat)shoot(aim.x,aim.y);}else if((key==='p'||key==='escape')&&!event.repeat){event.preventDefault();if(state==='running')pause();else if(state==='paused')resume();}});
  canvas.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));canvas.addEventListener('blur',()=>keys.clear());
  ui.overlay.addEventListener('keydown',event=>{if(state==='paused' && ['p','escape'].includes(event.key.toLowerCase()) && !event.repeat){event.preventDefault();resume();}});
  ui.start.addEventListener('click',start);ui.resume.addEventListener('click',resume);ui.pause.addEventListener('click',()=>state==='running'?pause():resume());ui.finish.addEventListener('click',()=>finish('Practice builds good instincts. Ready for a timed patrol?'));
  ui.sound.addEventListener('click',()=>{soundEnabled=!soundEnabled;ui.sound.textContent=soundEnabled?'Sound on':'Sound off';ui.sound.setAttribute('aria-pressed',String(soundEnabled));if(soundEnabled)tone(380,.08,'triangle');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause('You left the tab. Your patrol is safely paused.');});
  reduced.addEventListener('change',()=>{if(reduced.matches){for(const e of entities)e.x=Math.max(36,Math.min(W-36,e.x));}draw();});
  updateHud();draw();requestAnimationFrame(frame);
})();
