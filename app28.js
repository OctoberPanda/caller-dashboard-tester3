// CALLER DASHBOARD TESTER v3
// Built from scratch — unified number modal, date-based persistence, bank-name keying

const SCRIPT_URL='https://script.google.com/macros/s/AKfycbwQi98Cg7DD8t8xegXhelPlcGvFUCEhzs3amya0zPA3EcNl4C1mdah-8FmqrNEx29JJ/exec';
const CFG_KEY='cdt3_config';
const LOGS_KEY='cdt3_logs';
const FLAGS_KEY='cdt3_flags';
const CALLS_KEY='cdt3_calls'; // per-number call counters
const CALLMETA_KEY='cdt3_callmeta'; // per-number no-answer/attempted counts for 2x/7x rule
const BLACKBOX_KEY='cdt3_blackbox'; // per-number: is it a black box (no identifier) number
const HQFLAG_KEY='cdt3_hqflags'; // HQ number flags (app only)
const HQMETA_KEY='cdt3_hqmeta'; // HQ number 2x/7x counters + blackbox toggle
const DNE_KEY='cdt3_dne'; // leads that do not exist in bank system (app only)
const AFU_KEY='cdt3_appfu'; // in-app follow-up scheduler (app only)
const PARKED_KEY='cdt3_parked'; // banks manually moved off the main list (app only)
const LEADFLAG_KEY='cdt3_leadflags'; // lead-level flags, manual text (app only)
const APPNUM_KEY='cdt3_appnums'; // app-only numbers added per lead
const STOPMARK_KEY='cdt3_stopmark'; // bank the user stopped at (resume next day)
const FUD_KEY='cdt3_fud'; // follow-up sheet banks: daily dial counters, done-today, next date (app only)

// COLUMN MAP (0-based)
const C={
  ROW:0,BANK:1,STATE:5,CITY:6,REG:7,AA:8,HQ:4,TEAMCALLED:3,
  CEO_NAME:9,CEO_PHONE:10,CEO_EA:11,CEO_EMAIL:12,CEO_INIT:13,
  CEO_RECENT:14,CEO_TIMES:15,CEO_WHO:16,CEO_NOTES:17,CEO_OUTCOME:18,
  CRA_NAME:19,CRA_PHONE:20,CRA_EMAIL_I:21,CRA_EMAIL_R:22,CRA_INIT:23,
  CRA_RECENT:24,CRA_TIMES:25,CRA_WHO:26,CRA_NOTES:27,CRA_OUTCOME:28,
  CFO_NAME:29,CFO_PHONE:30,CFO_EMAIL_I:31,CFO_EMAIL_R:32,CFO_INIT:33,
  CFO_RECENT:34,CFO_TIMES:35,CFO_WHO:36,CFO_NOTES:37,CFO_OUTCOME:38,
};

const RC={
  CEO:{recent:14,times:15,who:16,notes:17,outcome:18,phone:10,name:9,ea:11,email:12,init:12,initCall:13},
  CRA:{recent:24,times:25,who:26,notes:27,outcome:28,phone:20,name:19,ea:null,email:21,emailR:22,init:21,initCall:23},
  CFO:{recent:34,times:35,who:36,notes:37,outcome:38,phone:30,name:29,ea:null,email:31,emailR:32,init:31,initCall:33},
};

// Follow-Up Sheet columns
const FU={BANK:0,PERSON:1,CONTACT:2,HQ:3,INITCALL:4,FOLLOWUP:5,TIMES:6,REP:7,NOTES:8};
// Priority Banks tab columns (1 header row, data starts sheet row 2)
const PRI={NUM:0,BANK:1,ASSETS:2,CEO:{recent:3,notes:4},CRA:{recent:5,notes:6},CFO:{recent:7,notes:8}};
let priorities=[]; // {pri: sheetRow, d:[...]}
let priByBank={}; // bankId(mainRi) -> {pri, d}
let followups=[]; // {fri, d:[...]} rows where rep is Leon

const FLAG_OPTIONS=['Black box VM','Dead air','Unidentifiable VM','No answer, no VM or identifier','Wrong number','Wrong contact','Wrong bank','Not in service','Fax machine','Did not hear full name','Call screened by AI','Invalid number','Call rejected','No exec access'];

const OC={'Expressed Interest':'green','Follow-up':'blue','Email requested/ Follow-up':'blue','Left Message':'blue','Check Back Later':'amber','Open':'amber','Decline':'red','Request To Unsubscribe':'red','Wrong Number':'red','Wrong Contact':'red',"Not the bank's fund type":'red'};

let cfg={},banks=[],logs={},flags={},calls={},apptHeld={},emailLogs={},callMeta={},blackbox={},hqFlags={},hqMeta={},dne={},appFU={},parked={},fud={},fuByBank={},leadFlags={},appNums={},stopMark=null,openRI=null,numCtx=null,genCtx=null,undoCtx=null,workDate='';
let navList=[],navIdx=0,listDirty=false;
const APPT_KEY='cdt3_appt';
const EMAIL_KEY='cdt3_email';

// Keyboard navigation
document.addEventListener('keydown',(e)=>{
  const tag=document.activeElement?.tagName?.toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select')return;
  if(e.key==='ArrowRight'||e.key==='ArrowDown')nextBank();
  if(e.key==='ArrowLeft'||e.key==='ArrowUp')prevBank();
});

setInterval(()=>{listDirty=true;},15*60*1000); // mark stale; list only rebuilds on Next/Prev

window.onload=()=>{
  cfg=loadCfg();logs=loadLogs();flags=loadFlags();calls=loadCalls();apptHeld=loadAppt();emailLogs=loadEmailLogs();callMeta=loadCallMeta();blackbox=loadBlackbox();hqFlags=loadHQFlags();hqMeta=loadHQMeta();dne=loadDNE();appFU=loadAFU();parked=loadParked();fud=loadFUD();leadFlags=loadLeadFlags();appNums=loadAppNums();stopMark=loadStopMark();
  // Migrate old cdt2 logs if cdt3 is empty
  migrateLegacyLogs();
  workDate=cfg.lastWorkDate||initWorkDate();
  if(!cfg.sheetId||!cfg.tab||!cfg.apiKey||!cfg.name){show('setup-screen');prefillSetup();}
  else{show('main-app');boot();}
};

function prefillSetup(){sv('s-name',cfg.name||'');sv('s-sheet-id',cfg.sheetId||'');sv('s-tab',cfg.tab||'');sv('s-update-id',cfg.updateSheetId||'');sv('s-update-tab',cfg.updateTab||'');sv('s-api-key',cfg.apiKey||'');}
function saveSetup(){
  const name=gv('s-name').trim(),sheetId=gv('s-sheet-id').trim(),tab=gv('s-tab').trim(),updateSheetId=gv('s-update-id').trim(),updateTab=gv('s-update-tab').trim(),followupTab=gv('s-followup-tab').trim(),priorityTab=gv('s-priority-tab').trim(),apiKey=gv('s-api-key').trim();
  if(!name||!sheetId||!tab||!apiKey){toast('Please fill in all required fields','error');return;}
  cfg={name,sheetId,tab,updateSheetId,updateTab,followupTab,priorityTab,apiKey,lastWorkDate:workDate};saveCfg();show('main-app');boot();
}
function boot(){st('rep-badge',cfg.name);if(!workDate)workDate=initWorkDate();el('work-date').value=workDate;loadSheet();}
function onDateChange(){workDate=gv('work-date').trim();if(!workDate)return;cfg.lastWorkDate=workDate;saveCfg();renderStats();applyFilters(false);}
function initWorkDate(){const now=new Date();const et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));return(et.getMonth()+1)+'/'+et.getDate()+'/'+et.getFullYear();}
function workDateDisplay(){return workDate||'';}

async function loadFollowups(){
  const fuTab=cfg.followupTab||'Follow-Up Sheet';
  const repName=(cfg.name||'Leon').split(' ')[0]; // first name, e.g. "Leon"
  try{
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent("'"+fuTab+"'")}?key=${cfg.apiKey}`;
    const res=await fetch(url);const data=await res.json();
    if(data.error){console.error('Follow-up load error',data.error.message);followups=[];return;}
    followups=(data.values||[]).slice(2).map((row,i)=>({fri:i+3,d:row}))
      .filter(f=>f.d[FU.BANK]&&String(f.d[FU.BANK]).trim()
        &&String(f.d[FU.REP]||'').toLowerCase().includes(repName.toLowerCase()));
  }catch(e){console.error('Follow-up load failed',e);followups=[];}
}

// Match a follow-up bank to the main tracker (loose: trim + case-insensitive)
function findMainBank(bankName){
  const norm=s=>String(s||'').replace(/\u00a0/g,' ').trim().toLowerCase();
  const target=norm(bankName);
  return banks.find(b=>norm(b.d[C.BANK])===target)
    ||banks.find(b=>norm(b.d[C.BANK]).includes(target)||target.includes(norm(b.d[C.BANK])));
}

// ── FOLLOW-UP VIEW ──
let followupOpen=false;
function toggleFollowupView(){
  followupOpen=!followupOpen;
  el('followup-view').classList.toggle('hidden',!followupOpen);
  el('bank-view').classList.toggle('hidden',followupOpen);
  document.querySelector('.nav-bar')?.classList.toggle('hidden',followupOpen);
  if(el('btn-followup'))el('btn-followup').textContent=followupOpen?'← Back to banks':'📋 Follow-Ups';
  if(followupOpen)renderFollowups();
}

function renderFollowups(){
  const v=el('followup-view');
  if(!followups.length){v.innerHTML='<div class="loading">No follow-up banks assigned to you.</div>';return;}
  let h='<div style="max-width:900px;margin:0 auto">';
  h+='<h2 style="font-size:18px;font-weight:700;margin:8px 0 4px">Daily Follow-Ups</h2>';
  h+='<div style="font-size:12px;color:var(--text3);margin-bottom:16px">'+followups.length+' banks · one log per day, not per dial</div>';
  followups.forEach(f=>{
    const d=f.d;
    const bank=String(d[FU.BANK]||'').replace(/\u00a0/g,' ').trim();
    const person=d[FU.PERSON]||'';
    const contact=d[FU.CONTACT]||'';
    const hq=d[FU.HQ]||'';
    const followDate=d[FU.FOLLOWUP]?fmtSheetDate(d[FU.FOLLOWUP]):'never';
    const times=d[FU.TIMES]||'0';
    const notes=d[FU.NOTES]||'';
    // Pull AA + email date from main tracker
    const mb=findMainBank(bank);
    const role=fuRole(person);
    let aa='',emailDate='',reg='';
    if(mb){
      aa=String(mb.d[C.AA]||'').trim();
      reg=String(mb.d[C.REG]||'').trim();
      if(role&&RC[role])emailDate=effEmailDate(mb.d,role);
    }
    const doneToday=d[FU.FOLLOWUP]&&fmtSheetDate(d[FU.FOLLOWUP])===workDateDisplay();
    h+='<div class="fu-card'+(doneToday?' fu-done':'')+'">';
    h+='<div class="fu-head"><div><div class="fu-bank">'+esc(bank)+(doneToday?' <span class="fu-done-tag">✓ done today</span>':'')+'</div>';
    h+='<div class="fu-person">'+esc(person)+'</div></div>';
    h+='<button class="btn-log-call" style="width:auto;padding:8px 16px" onclick="openFollowupModal('+f.fri+')">Log follow-up</button></div>';
    h+='<div class="fu-meta">';
    if(contact)h+='<span class="fu-chip" onclick="copyPhone(\''+esc(phoneBase(String(contact)))+'\',this)">📞 '+esc(contact)+'</span>';
    if(hq)h+='<span class="fu-chip" onclick="copyPhone(\''+esc(phoneBase(String(hq)))+'\',this)">🏢 HQ '+esc(hq)+'</span>';
    if(reg)h+='<span class="fu-chip">'+esc(reg)+'</span>';
    if(aa)h+='<span class="fu-chip">AA: '+esc(aa)+'</span>';
    if(emailDate)h+='<span class="fu-chip">📧 Email sent '+esc(emailDate)+'</span>';
    h+='<span class="fu-chip">Last follow-up: '+esc(followDate)+'</span>';
    h+='<span class="fu-chip">'+esc(times)+'x called</span>';
    h+='</div>';
    if(notes)h+='<div class="fu-notes">'+esc(formatNotes(String(notes)))+'</div>';
    h+='</div>';
  });
  h+='</div>';
  v.innerHTML=h;
}

let fuCtx=null;
function openFollowupModal(fri){
  const f=followups.find(x=>x.fri===fri);if(!f)return;
  fuCtx={fri};
  const d=f.d;
  const bank=String(d[FU.BANK]||'').replace(/\u00a0/g,' ').trim();
  const person=d[FU.PERSON]||'';
  const contact=d[FU.CONTACT]||'';
  const hq=d[FU.HQ]||'';
  const mb=findMainBank(bank);const role=fuRole(person);
  let aa='',emailDate='',reg='';
  if(mb){aa=String(mb.d[C.AA]||'').trim();reg=String(mb.d[C.REG]||'').trim();if(role&&RC[role])emailDate=effEmailDate(mb.d,role);}
  st('nm-title',bank+' — Follow-Up');
  st('nm-sub',person+(role?' ('+role+')':''));
  let html='';
  html+='<div style="font-size:12px;color:var(--text2);background:var(--surface2);border:0.5px solid var(--border);border-radius:var(--radius);padding:9px 11px;margin-bottom:12px;line-height:1.7">';
  if(contact)html+='📞 '+esc(contact)+'<br>';
  if(hq)html+='🏢 HQ: '+esc(hq)+'<br>';
  if(reg)html+='Regulator: '+esc(reg)+'<br>';
  if(aa)html+='AA: '+esc(aa)+'<br>';
  if(emailDate)html+='📧 Last email sent: '+esc(emailDate)+'<br>';
  html+='Times called: '+esc(String(d[FU.TIMES]||'0'))+'</div>';
  const existing=String(d[FU.NOTES]||'');
  if(existing.trim()){const lines=existing.trim().split('\n').slice(-4);html+='<div class="modal-notes-preview"><div class="mnp-label">Recent notes</div><div class="mnp-text">'+esc(lines.join('\n'))+'</div></div>';}
  html+='<div class="form-group" style="margin-top:12px"><label>Today\'s note (one per day, all your calls today)</label><textarea id="fu-note" rows="3" placeholder="What happened across your calls today?"></textarea></div>';
  html+='<div class="modal-actions"><button class="btn-primary" onclick="saveFollowup()">Save follow-up (+1 called)</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
}

function saveFollowup(){
  if(!fuCtx)return;
  const f=followups.find(x=>x.fri===fuCtx.fri);if(!f)return;
  const d=f.d;
  const note=el('fu-note')?.value.trim()||'';
  const dateStr=workDateDisplay();
  // Update date, +1 times, add one dated note line
  d[FU.FOLLOWUP]=dateStr;
  d[FU.TIMES]=String((parseInt(d[FU.TIMES])||0)+1);
  if(note){
    const existing=String(d[FU.NOTES]||'');
    const entry=dateStr+': '+note;
    d[FU.NOTES]=existing?existing+'\n'+entry:entry;
  }
  // Write back to Follow-Up tab
  const fuTab=cfg.followupTab||'Follow-Up Sheet';
  const updates=[
    {row:f.fri,col:FU.FOLLOWUP,value:d[FU.FOLLOWUP]},
    {row:f.fri,col:FU.TIMES,value:d[FU.TIMES]},
    {row:f.fri,col:FU.NOTES,value:d[FU.NOTES]||''}
  ];
  fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sheetId:cfg.sheetId,tabName:fuTab,updates})}).catch(e=>console.error(e));
  closeNumModal();renderFollowups();
  toast('Follow-up logged (+1 called)','success');
}

// Extract role (CEO/CRA/CFO) from a follow-up person string like "CFO: Becky Foster"
function fuRole(personStr){
  const m=String(personStr||'').match(/\b(CEO|CRA|CFO|EA)\b/i);
  if(!m)return null;
  const r=m[1].toUpperCase();
  return r==='EA'?'CEO':r; // EA belongs to the CEO lead
}

async function loadSheet(){
  el('bank-view').innerHTML='<div class="loading">Loading your sheet...</div>';
  if(!workDate)workDate=initWorkDate();el('work-date').value=workDate;
  const url=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent("'"+cfg.tab+"'")}?key=${cfg.apiKey}`;
  try{
    const res=await fetch(url);const data=await res.json();
    if(data.error){el('bank-view').innerHTML=`<div class="loading error">❌ ${data.error.message}<br><br>Check Sheet ID, tab name, and API key in ⚙️ Settings.</div>`;return;}
    banks=(data.values||[]).slice(2).map((row,i)=>({ri:i+3,d:row})).filter(b=>b.d[C.BANK]&&String(b.d[C.BANK]).trim());
    resolveLegacyLogs();
    await detectSheetStrikethroughs();
    await loadFollowups();
    buildFuByBank();
    await loadPriority();
    buildPriByBank();
    renderStats();
    applyFilters(false,true);
  }catch(e){
    // Show error but still try to render banks if we have them
    if(banks.length){
      applyFilters(false,true);
    }else{
      el('bank-view').innerHTML='<div class="loading error">❌ '+e.message+'<br><br>Check Sheet ID, tab name, and API key in ⚙️ Settings.</div>';
    }
  }
}

function migrateLegacyLogs(){
  // Only migrate if cdt3 logs are empty
  if(Object.keys(logs).length>0)return;
  try{
    const old2Logs=JSON.parse(localStorage.getItem('cdt2_logs'))||{};
    const old2Flags=JSON.parse(localStorage.getItem('cdt2_flags'))||{};
    if(Object.keys(old2Logs).length===0&&Object.keys(old2Flags).length===0)return;
    // Migrate logs — keys were date__ri, now date__BANKNAME
    // We can't resolve bank names without the sheet loaded yet
    // So store them temporarily and resolve after sheet loads
    localStorage.setItem('cdt3_legacy_logs',JSON.stringify(old2Logs));
    localStorage.setItem('cdt3_legacy_flags',JSON.stringify(old2Flags));
    console.log('Legacy logs found — will migrate after sheet loads');
  }catch(e){console.error('Migration error',e);}
}

function resolveLegacyLogs(){
  try{
    const legacyLogs=JSON.parse(localStorage.getItem('cdt3_legacy_logs'))||{};
    const legacyFlags=JSON.parse(localStorage.getItem('cdt3_legacy_flags'))||{};
    if(Object.keys(legacyLogs).length===0&&Object.keys(legacyFlags).length===0)return;

    let migrated=0;
    // Migrate logs — key was date__ri or date_ri
    Object.entries(legacyLogs).forEach(([key,entries])=>{
      if(!Array.isArray(entries))return;
      const parts=key.split('__');
      const date=parts[0];const ri=parseInt(parts[1])||parseInt(key.split('_')[1]);
      if(!ri)return;
      const bank=banks.find(x=>x.ri===ri);
      if(!bank)return;
      const newKey=date+'__'+String(bank.d[C.BANK]||'').trim().toUpperCase();
      if(!logs[newKey]){logs[newKey]=[];}
      entries.filter(l=>!l.deleted).forEach(l=>{
        l.called=true; // assume all old logs were called
        if(!logs[newKey].find(x=>x.id===l.id)){logs[newKey].push(l);migrated++;}
      });
    });

    // Migrate flags — key was ri_role_phone or bankId__role__phone
    Object.entries(legacyFlags).forEach(([key,f])=>{
      if(f.undone)return;
      const parts=key.split('_');
      const ri=parseInt(parts[0]);
      if(!ri)return;
      const bank=banks.find(x=>x.ri===ri);
      if(!bank)return;
      const newKey=String(bank.d[C.BANK]||'').trim().toUpperCase()+'__'+f.role+'__'+f.phone;
      if(!flags[newKey])flags[newKey]={...f};
    });

    if(migrated>0){
      saveLogs();saveFlags();
      localStorage.removeItem('cdt3_legacy_logs');
      localStorage.removeItem('cdt3_legacy_flags');
      console.log('Migrated '+migrated+' log entries from old app');
      renderStats();renderList(visibleBanks());
      toast('Restored '+migrated+' entries from previous session','success');
    }
  }catch(e){console.error('Legacy resolve error',e);}
}

// HELPERS
function bankId(ri){const b=banks.find(x=>x.ri===ri);return b?String(b.d[C.BANK]||'').trim().toUpperCase():'UNKNOWN_'+ri;}
function logKey(ri){return workDate+'__'+bankId(ri);}
function logsForDate(ri,role){const all=(logs[logKey(ri)]||[]).filter(l=>!l.deleted);return role?all.filter(l=>l.role===role):all;}
function allLogsForDate(){const pfx=workDate+'__';return Object.entries(logs).filter(([k])=>k.startsWith(pfx)).flatMap(([,v])=>v.filter(l=>!l.deleted));}
function parsePhones(str){
  if(!str||!String(str).trim())return[];
  // Split on semicolons and newlines
  return String(str).split(/[;\n]/).map(p=>p.trim()).filter(Boolean);
}
function phoneDisplay(ph){
  // Shows number cleanly — ext and opt on same line
  return ph; // already formatted as XXX.XXX.XXXX ext/opt X
}
function phoneBase(ph){
  const m=String(ph).match(/(\d{3}\.\d{3}\.\d{4})/);
  return m?m[1]:ph;
}
function phoneSuffix(ph){
  const m=String(ph).match(/\d{3}\.\d{3}\.\d{4}(.*)/);
  return m?m[1].trim():'';
}
function phoneDigits(ph){
  // Extract the 10-digit number from ANY format: 815.847.7500, (815) 847-7500, 815-847-7500
  // Uses phoneBase first so ext/opt digits are excluded.
  const base=phoneBase(ph);
  const d=String(base).replace(/\D/g,'');
  if(d.length===10)return d;
  if(d.length===11&&d[0]==='1')return d.slice(1);
  return d.length>=10?d.slice(0,10):'';
}
function isDeclinedToday(ri){return allLogsForDate().some(l=>l.ri===ri&&l.outcome==='Decline');}
function isDeclinedSheet(ri){const b=banks.find(x=>x.ri===ri);if(!b)return false;return['CEO','CRA','CFO'].some(r=>b.d[RC[r].outcome]==='Decline');}
function isDeclined(ri){return isDeclinedToday(ri)||isDeclinedSheet(ri);}
function isApptHeld(ri){return apptHeld[bankId(ri)]===true;}
function setApptHeld(ri){apptHeld[bankId(ri)]=true;localStorage.setItem(APPT_KEY,JSON.stringify(apptHeld));renderStats();if(openRI===ri)renderBody(ri);rebuildCard(ri,true);toast('Appointment marked as held — bank removed from call list','success');}
function loadAppt(){try{return JSON.parse(localStorage.getItem(APPT_KEY))||{};}catch{return{};}}
function loadEmailLogs(){try{return JSON.parse(localStorage.getItem(EMAIL_KEY))||{};}catch{return{};}}
function saveEmailLogs(){localStorage.setItem(EMAIL_KEY,JSON.stringify(emailLogs));}
function getEmailLog(ri,role){return emailLogs[bankId(ri)+'__'+role]||null;}
function setEmailLog(ri,role,date,recipient){
  emailLogs[bankId(ri)+'__'+role]={date,recipient,ri,role};
  saveEmailLogs();
  showCurrentBank();
  toast('Email logged','success');
}
function bankCalledToday(ri){return allLogsForDate().some(l=>l.ri===ri&&l.called);}
// A role is "callable" if it has at least one number that is not flagged, and the lead exists
function roleCallable(ri,role){
  if(isDNE(ri,role))return false;
  const b=banks.find(x=>x.ri===ri);if(!b)return false;
  const phones=parsePhones(b.d[RC[role].phone]);
  if(!phones.length)return false;
  return phones.some(ph=>!isPhoneBad(ri,role,ph));
}
// Complete = every callable role has been called (uncallable roles don't count against completion)
function bankComplete(ri){return['CEO','CRA','CFO'].every(r=>!roleCallable(ri,r)||logsForDate(ri,r).some(l=>l.called));}
function bankIncomplete(ri){const roles=['CEO','CRA','CFO'].filter(r=>roleCallable(ri,r));const c=roles.filter(r=>logsForDate(ri,r).some(l=>l.called)).length;return c>0&&c<roles.length;}
function pendingRoles(ri){return['CEO','CRA','CFO'].filter(r=>roleCallable(ri,r)&&!logsForDate(ri,r).some(l=>l.called));}
function getFlagKey(ri,role,phone){return bankId(ri)+'__'+role+'__'+phone;}
const BAD_KW=['black box','dead air','wrong number','not in service','fax machine','did not hear','unidentifiable','wrong bank','wrong contact','call screened','invalid number','call rejected'];
function isPhoneBad(ri,role,phone){
  const f=flags[getFlagKey(ri,role,phone)];if(f&&!f.undone)return true;
  if(f&&f.undone)return false; // explicitly unflagged — never auto-flag again
  const b=banks.find(x=>x.ri===ri);if(!b)return false;
  const digits=phoneDigits(phone);if(!digits)return false;
  // Check each notes line — the phone digits AND a bad keyword must be on the SAME line
  const lines=String(b.d[RC[role].notes]||'').toLowerCase().split('\n');
  return lines.some(line=>{
    const lineDigits=line.replace(/[^\d]/g,'');
    return lineDigits.includes(digits)&&BAD_KW.some(k=>line.includes(k));
  });
}
function getBadReason(ri,role,phone){
  const f=flags[getFlagKey(ri,role,phone)];if(f&&!f.undone)return f.issue;
  const b=banks.find(x=>x.ri===ri);if(!b)return'';
  const digits=phoneDigits(phone);
  const lines=String(b.d[RC[role].notes]||'').split('\n');
  for(const line of lines){
    const lineDigits=line.replace(/[^\d]/g,'');
    if(lineDigits.includes(digits)){
      for(const kw of BAD_KW){if(line.toLowerCase().includes(kw))return kw.split(' ').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');}
    }
  }
  return'Bad number';
}
function getCallCount(ri,role,phone){return calls[bankId(ri)+'__'+role+'__'+phone]||0;}
function mostRecentEmail(d,role){
  if(role==='CEO')return d[C.CEO_EMAIL]||'';
  const a=d[role==='CRA'?C.CRA_EMAIL_I:C.CFO_EMAIL_I]||'';const b=d[role==='CRA'?C.CRA_EMAIL_R:C.CFO_EMAIL_R]||'';
  if(!a)return b;if(!b)return a;try{return new Date(b)>new Date(a)?b:a;}catch{return b||a;}
}

// FDIC banks had emails resent 6/4/2026. Show that as the most recent email
// date for FDIC banks unless the sheet has something later. Display only.
const FDIC_RESEND='6/4/2026';
function effEmailDate(d,role){
  const raw=mostRecentEmail(d,role);
  const isFDIC=String(d[C.REG]||'').toUpperCase().includes('FDIC');
  if(!isFDIC)return raw?fmtSheetDate(raw):'';
  if(!raw)return FDIC_RESEND;
  try{return new Date(raw)>new Date(FDIC_RESEND)?fmtSheetDate(raw):FDIC_RESEND;}catch{return FDIC_RESEND;}
}

function renderStats(){
  const all=allLogsForDate();
  const dials=all.reduce((acc,l)=>acc+(l.dialCount||0),0);
  const banksDialed=new Set(all.filter(l=>l.called&&(l.dialCount||0)>0).map(l=>l.ri)).size;
  // Merge sheet-scanned entries so manually-fixed sheet dates still count
  let merged=all.filter(l=>l.called);
  if(banks.length){
    const seen=new Set(merged.map(l=>l.ri+'__'+l.role));
    sheetReachedToday().forEach(s=>{if(!seen.has(s.ri+'__'+s.role)){merged=merged.concat(s);seen.add(s.ri+'__'+s.role);}});
  }
  // Bank reached = a real person answered (who not NO CONTACT), GK included
  const banksReached=new Set(merged.filter(l=>l.who&&l.who!=='NO CONTACT').map(l=>l.ri)).size;
  // People reached = decision makers only (EA/CEO/CRA/CFO)
  const DM=['EA','CEO','CFO','CRA'];
  const peopleReached=new Set(merged.filter(l=>DM.includes(l.who)).map(l=>l.ri+'_'+l.role)).size;
  const completeCnt=banks.filter(b=>bankComplete(b.ri)).length;
  const sosCnt=Object.values(flags).filter(f=>!f.undone).length;
  const decToday=new Set(all.filter(l=>l.outcome==='Decline').map(l=>l.ri)).size;
  const apptToday=new Set(all.filter(l=>l.outcome==='Expressed Interest').map(l=>l.ri)).size;
  const activeCnt=banks.filter(b=>!isDeclined(b.ri)&&!isApptHeld(b.ri)).length;
  st('st-dials',dials);st('st-bdialed',banksDialed);st('st-reached',banksReached);st('st-people',peopleReached);
  st('st-complete',completeCnt);st('st-sos',sosCnt);st('st-declined',decToday);
  st('st-appt',apptToday);st('st-total',activeCnt);
}

function buildStateFilter(){
  const sel=el('f-state');const states=[...new Set(banks.map(b=>b.d[C.STATE]).filter(Boolean))].sort();
  sel.innerHTML='<option value="">All states</option>';states.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});
}
function hasInterest(ri){const b=banks.find(x=>x.ri===ri);if(!b)return false;return logsForDate(ri).some(l=>l.outcome==='Expressed Interest')||['CEO','CRA','CFO'].some(r=>b.d[RC[r].outcome]==='Expressed Interest');}
function isSetAside(ri){return isDeclined(ri)||isApptHeld(ri)||hasInterest(ri);}
function visibleBanks(){
  const status=gv('f-status');
  // Set-aside view shows declined, expressed interest, and appointment held
  if(status==='set-aside')return banks.filter(b=>isSetAside(b.ri));
  if(status==='parked')return banks.filter(b=>isParked(b.ri));
  if(status==='declined-all')return banks.filter(b=>isDeclined(b.ri));
  if(status==='appt-held')return banks.filter(b=>isApptHeld(b.ri));
  if(status==='interest')return banks.filter(b=>hasInterest(b.ri));
  // Main carousel: exclude declined, appointment held, and expressed interest
  return banks.filter(b=>!isDeclinedSheet(b.ri)&&!isApptHeld(b.ri)&&!hasInterest(b.ri)&&!isDeclinedToday(b.ri)&&!isParked(b.ri));
}
function applyFilters(resetNav,smartStart){
  if(resetNav!==false)navIdx=0;
  buildNavList();
  if(smartStart){
    const idx=findSmartStartIdx();
    if(idx>=0&&idx<navList.length)navIdx=idx;
  }
  if(navIdx>=navList.length)navIdx=Math.max(0,navList.length-1);
  listDirty=false;
  updateNavCounter();
  showCurrentBank();
}
function buildNavList(){
  const search=gv('search').toLowerCase().trim(),status=gv('f-status');
  const result=visibleBanks().filter(b=>{
    const ri=b.ri,name=String(b.d[C.BANK]||'').toLowerCase();
    if(search&&!name.includes(search))return false;
    if(status==='called-today')return bankCalledToday(ri)&&!isDeclined(ri)&&!isApptHeld(ri);
    if(status==='not-called-today')return!bankCalledToday(ri)&&!isDeclined(ri)&&!isApptHeld(ri);
    if(status==='incomplete')return bankIncomplete(ri);
    if(status==='complete')return bankComplete(ri);
    if(status==='sos')return Object.keys(flags).some(k=>k.startsWith(bankId(ri)+'__')&&!flags[k].undone);
    if(status==='interest')return logsForDate(ri).some(l=>l.outcome==='Expressed Interest')||['CEO','CRA','CFO'].some(r=>b.d[RC[r].outcome]==='Expressed Interest');
    if(status==='declined-today')return isDeclinedToday(ri);
    if(status==='attention')return['CEO','CRA','CFO'].some(r=>{const rl=logsForDate(ri,r);return rl.filter(l=>l.called&&l.outcome==='No Answer').length>=2||rl.filter(l=>l.called&&['Left Message','Follow-up','Email requested/ Follow-up','Check Back Later'].includes(l.outcome)).length>=7;});
    return true;
  });
  const calledSet=new Set(allLogsForDate().filter(l=>l.called).map(l=>l.ri));
  navList=result.slice().sort((a,b)=>{
    const pa=(fuActive(a.ri)||priActive(a.ri,calledSet))?0:(bankHasDueAFU(a.ri)?1:2);
    const pb=(fuActive(b.ri)||priActive(b.ri,calledSet))?0:(bankHasDueAFU(b.ri)?1:2);
    return pa-pb;
  });
}
// NAVIGATION
function onSearch(){
  // Live search — filter as you type, no refresh needed
  navIdx=0;
  applyFilters(false);
}
function onFilter(){navIdx=0;applyFilters(false);}
function gotoBank(){
  const val=gv('goto-input').trim();
  if(!val)return;
  // Try row number first
  let targetRi=null;
  if(/^\d+$/.test(val)){
    targetRi=parseInt(val);
  }else{
    // Search by name across ALL banks
    const match=banks.find(b=>String(b.d[C.BANK]||'').toLowerCase().includes(val.toLowerCase()));
    if(match)targetRi=match.ri;
  }
  if(targetRi===null){toast('Bank not found','error');return;}
  // Reset filter to all banks and jump to that bank
  el('f-status').value='';
  el('search').value='';
  const list=visibleBanks();
  renderList(list);
  const idx=list.findIndex(b=>b.ri===targetRi);
  if(idx>=0){navIdx=idx;updateNavCounter();showCurrentBank();el('goto-input').value='';toast('Jumped to bank','success');}
  else{toast('Bank is set aside (declined/interest/appt)','error');}
}
function priActive(ri,calledSet){
  if(!isPriorityBank(ri))return false;
  if(calledSet.has(ri))return false; // already logged today
  // A future app-follow-up date on any lead defers this bank until that date
  const today=workDateDisplay();
  for(const r of ['CEO','CRA','CFO']){
    const x=getAFU(ri,r);
    if(x&&x.date){try{if(new Date(x.date)>new Date(today))return false;}catch{}}
  }
  return true;
}
function findSmartStartIdx(){
  // If the user marked where they stopped on a PREVIOUS day, resume from the
  // bank right after it (within the current navList after FU/priority sorting).
  if(stopMark&&stopMark.ri&&stopMark.date!==workDateDisplay()){
    const markPos=navList.findIndex(b=>b.ri===stopMark.ri);
    if(markPos>=0){
      // Next bank after the marked one; wrap to 0 if it was the last
      return markPos+1<navList.length?markPos+1:0;
    }
    // Marked bank not in current list (filtered out) -> next higher row number
    let best=-1;
    navList.forEach((b,idx)=>{if(b.ri>stopMark.ri&&(best<0||b.ri<navList[best].ri))best=idx;});
    if(best>=0)return best;
  }
  return 0;
}
function updateNavCounter(){
  const total=navList.length;
  st('nav-counter',total?'Bank '+(navIdx+1)+' of '+total:'No banks');
  el('btn-prev').disabled=total===0;
  el('btn-next').disabled=total===0;
}

function prevBank(){
  if(navList.length===0)return;
  const curRi=navList[navIdx]?navList[navIdx].ri:null;
  if(listDirty){buildNavList();listDirty=false;if(curRi!=null){const k=navList.findIndex(b=>b.ri===curRi);if(k>=0)navIdx=k;}}
  navIdx=(navIdx-1+navList.length)%navList.length;
  updateNavCounter();showCurrentBank();
}
function nextBank(){
  if(navList.length===0)return;
  const curRi=navList[navIdx]?navList[navIdx].ri:null;
  if(listDirty){buildNavList();listDirty=false;if(curRi!=null){const k=navList.findIndex(b=>b.ri===curRi);if(k>=0)navIdx=k;}}
  navIdx=(navIdx+1)%navList.length;
  updateNavCounter();showCurrentBank();
}

function showCurrentBank(){
  const container=el('bank-view');
  if(!navList.length){container.innerHTML='<div class="loading">No banks match your filter.</div>';return;}
  const b=navList[navIdx];
  container.innerHTML='';
  container.appendChild(buildBankView(b));
  container.scrollTop=0;
}

function buildBankView(b){
  const ri=b.ri,d=b.d;
  const declined=isDeclined(ri),decToday=isDeclinedToday(ri);
  const called=bankCalledToday(ri),complete=bankComplete(ri),incomplete=bankIncomplete(ri);
  const hasSOS=Object.keys(flags).some(k=>k.startsWith(bankId(ri)+'__')&&!flags[k].undone);
  const hasInt=logsForDate(ri).some(l=>l.outcome==='Expressed Interest')||['CEO','CRA','CFO'].some(r=>d[RC[r].outcome]==='Expressed Interest');
  const pending=pendingRoles(ri);

  let badges='';
  if(decToday)badges+='<span class="badge badge-red">Declined today</span>';
  else if(declined)badges+='<span class="badge badge-red">Declined</span>';
  if(isApptHeld(ri))badges+='<span class="badge badge-green">Appt held</span>';
  else if(complete)badges+='<span class="badge badge-amber">Complete</span>';
  else if(incomplete)pending.forEach(r=>{badges+='<span class="badge badge-amber">'+r+' pending</span>';});
  else if(called){badges+='<span class="badge badge-green">Called today</span>';pending.forEach(r=>{badges+='<span class="badge badge-amber">'+r+' pending</span>';});}
  if(hasSOS)badges+='<span class="badge badge-red">SOS</span>';
  if(hasInt&&!isApptHeld(ri))badges+='<span class="badge badge-green">Interest</span>';

  const emails=['CEO','CRA','CFO'].map(r=>{const dt=effEmailDate(d,r);return dt?r+': '+dt:'';}).filter(Boolean);
  const emailRow=emails.length?'<div class="bank-email-row">📧 '+emails.join(' · ')+'</div>':'';

  const div=document.createElement('div');
  div.innerHTML=`
    <div class="bank-header">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div class="bank-title">${esc(d[C.BANK])}</div>
          <div class="bank-meta">Row ${ri} · ${[d[C.CITY],d[C.STATE]].filter(Boolean).join(', ')}${d[C.REG]?' · '+d[C.REG]:''}${d[C.AA]?' · AA: '+String(d[C.AA]).trim():''}</div>
          ${d[C.HQ]?buildHQRow(ri,String(d[C.HQ])):''}
          ${isFUBank(ri)?buildFUDBanner(ri):''}
          ${emailRow}
        </div>
        <div class="bank-badges">${isPriorityBank(ri)?'<span class="badge" style="background:var(--amber-bg);color:var(--amber);border:1px solid var(--amber-border);font-weight:700">PRIORITY</span>':''}${badges}<button class="hq-btn" onclick="setStopHere(${ri})" title="Resume from the next bank tomorrow">${stopMark&&stopMark.ri===ri?'📍 Stopped here':'📍 Stop here'}</button><button class="hq-btn" onclick="toggleParked(${ri})">${isParked(ri)?'↩ Back to main list':'📂 Move off main list'}</button></div>
      </div>
    </div>
    <div class="leads-grid">${['CEO','CRA','CFO'].map(r=>buildLeadCard(ri,d,r,declined)).join('')}</div>
  `;
  return div;
}

function buildCard(b){
  const ri=b.ri,d=b.d,declined=isDeclined(ri),decToday=isDeclinedToday(ri),called=bankCalledToday(ri);
  const complete=bankComplete(ri),incomplete=bankIncomplete(ri);
  const hasSOS=Object.keys(flags).some(k=>k.startsWith(bankId(ri)+'__')&&!flags[k].undone);
  const hasInt=logsForDate(ri).some(l=>l.outcome==='Expressed Interest')||['CEO','CRA','CFO'].some(r=>d[RC[r].outcome]==='Expressed Interest');
  const pending=pendingRoles(ri);
  let badges='';
  if(decToday)badges+='<span class="badge badge-red">Declined today</span>';
  else if(declined)badges+='<span class="badge badge-red">Declined</span>';
  if(complete)badges+='<span class="badge badge-amber">Complete</span>';
  else if(incomplete){pending.forEach(r=>{badges+='<span class="badge badge-pending">'+r+' pending</span>';});}
  else if(called){badges+='<span class="badge badge-green">Called today</span>';pending.forEach(r=>{badges+='<span class="badge badge-pending">'+r+' pending</span>';});}
  if(hasSOS)badges+='<span class="badge badge-red">SOS</span>';
  if(hasInt)badges+='<span class="badge badge-green">Interest</span>';
  const card=document.createElement('div');
  card.className='bank-card'+(hasSOS?' has-sos':'')+(hasInt?' has-interest':'')+(complete?' is-complete':'')+(declined?' is-declined':'');
  card.id='card-'+ri;
  card.innerHTML='<div class="bank-card-header" onclick="toggleCard('+ri+')"><div class="bank-left"><span class="row-num">Row '+ri+'</span><div><div class="bank-name">'+esc(d[C.BANK])+'</div><div class="bank-meta">'+[d[C.CITY],d[C.STATE]].filter(Boolean).join(', ')+(d[C.REG]?' · '+d[C.REG]:'')+(d[C.AA]?' · '+String(d[C.AA]).trim():'')+'</div></div></div><div class="bank-right">'+badges+'<span class="chevron" id="chev-'+ri+'">▼</span></div></div><div class="bank-body" id="body-'+ri+'"></div>';
  return card;
}

function toggleCard(ri){
  if(openRI&&openRI!==ri){const pb=el('body-'+openRI),pc=el('chev-'+openRI);if(pb){pb.classList.remove('open');pb.innerHTML='';}if(pc)pc.classList.remove('open');}
  const body=el('body-'+ri),chev=el('chev-'+ri),isOpen=body.classList.contains('open');
  if(isOpen){body.classList.remove('open');body.innerHTML='';chev.classList.remove('open');openRI=null;}
  else{body.classList.add('open');chev.classList.add('open');openRI=ri;renderBody(ri);}
}

function renderBody(ri){
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const d=b.d,body=el('body-'+ri),dec=isDeclined(ri);
  const emails=['CEO','CRA','CFO'].map(r=>{const dt=effEmailDate(d,r);return dt?r+': '+dt:'';}).filter(Boolean);
  const emailRow=emails.length?'<div class="email-row">📧 Most recent email — '+emails.join(' · ')+'</div>':'';
  const grid='<div class="leads-grid">'+['CEO','CRA','CFO'].map(r=>buildLeadCard(ri,d,r,dec)).join('')+'</div>';
  body.innerHTML='<div style="padding:12px 14px">'+emailRow+grid+'</div>';
}

function formatNotes(notes){
  // Ensure each dated entry starts on its own line for readability.
  // Insert a newline before any date pattern M/D/YYYY that isn't already at line start.
  let s=String(notes).replace(/\r/g,'');
  // Add newline before dates like 6/9/2026 or 12/9/2025 when preceded by other text
  s=s.replace(/([^\n])\s*(\b\d{1,2}\/\d{1,2}\/\d{2,4}\b)/g,'$1\n$2');
  // Collapse 3+ newlines to 2
  s=s.replace(/\n{3,}/g,'\n\n');
  return s.trim();
}

function buildLeadCard(ri,d,role,bankDeclined){
  const rc=RC[role],name=d[rc.name]||'—',phones=parsePhones(d[rc.phone]);
  const outcome=d[rc.outcome]||'',notes=d[rc.notes]||'',recent=d[rc.recent]?fmtSheetDate(d[rc.recent]):'',times=d[rc.times]||'0';
  const ea=rc.ea!=null?(d[rc.ea]||''):'';
  const rLogs=logsForDate(ri,role),called=rLogs.some(l=>l.called);
  const hasSOS=phones.some(p=>isPhoneBad(ri,role,p));
  const hasInt=rLogs.some(l=>l.outcome==='Expressed Interest')||outcome==='Expressed Interest';
  const oc=OC[outcome]||'';
  const statusTag=called?'<span class="complete-tag">Called</span>':'<span class="pending-tag">Pending</span>';
  // Email log display
  const eLog=getEmailLog(ri,role);
  const emailBadge=eLog?'<div class="email-log-badge">📧 '+esc(eLog.date)+(eLog.recipient?' to '+esc(eLog.recipient):'')+'</div>':'';

  let attn='';
  // Per-number counters for attention flags
  phones.forEach(ph=>{
    const cnt=getCallCount(ri,role,ph);
    // Check outcomes for this specific number
    const phLogs=rLogs.filter(l=>l.called&&l.phone===ph);
    const noAns=phLogs.filter(l=>l.outcome==='No Answer').length;
    const conf=phLogs.filter(l=>['Left Message','Follow-up','Email requested/ Follow-up','Check Back Later'].includes(l.outcome)).length;
    if(noAns>=2)attn+='<div class="attention-flag">'+esc(phoneBase(ph))+' — 2x no answer</div>';
    if(conf>=7)attn+='<div class="attention-flag">'+esc(phoneBase(ph))+' — 7x attempted</div>';
  });

  let phonesHtml='';
  if(phones.length){
    phonesHtml='<div class="phones">'+phones.map((ph,pi)=>{
      const bad=isPhoneBad(ri,role,ph),reason=bad?getBadReason(ri,role,ph):'',cnt=getCallCount(ri,role,ph);
      const base=phoneBase(ph),sfx=phoneSuffix(ph);
      return '<div class="phone-row"><div class="phone-info">'
        +'<span class="phone-num'+(bad?' bad':'')+(bad&&flags[getFlagKey(ri,role,ph)]?.scope==='sheet'?' struck':'')+'" onclick="copyPhone(\''+esc(base)+'\',this)" title="Click to copy">'+esc(base)+'</span>'
        +(sfx?'<span class="phone-suffix">'+esc(sfx)+'</span>':'')
        +(bad?'<span class="bad-reason">'+esc(reason)+'</span>':'')
        +(cnt>0?'<span class="call-cnt">'+cnt+'x</span>':'')+'</div>'
        +'<div class="phone-btns">'
        +'<button class="btn-copy" onclick="copyPhone(\''+esc(base)+'\',this)">📋</button>'
        +(!bad?'<button class="btn-flag-num" onclick="openStandaloneFlag('+ri+',\''+role+'\','+pi+')" title="Flag without logging a call">⚑</button>':'')
        +(bad?'<button class="btn-undo" onclick="openUndoFlag('+ri+',\''+role+'\','+pi+')">↩ Undo flag</button>':'')
        +(!bankDeclined?'<button class="btn-log-sm" onclick="openNumModal('+ri+',\''+role+'\')">Log / Flag</button>':'')
        +'</div></div>';
    }).join('')+'</div>';
  }else{phonesHtml='<div class="no-phone">No phone on file</div>';}

  const notesHtml=notes?'<div class="lead-notes">'+esc(formatNotes(notes))+'</div>':'';

  let todayHtml='';
  if(rLogs.length){
    todayHtml='<div class="today-logs">'+rLogs.map(l=>'<div class="today-log"><span class="outcome-chip '+(OC[l.outcome]||'')+'">'+esc(l.outcome)+'</span>'
      +(l.who&&l.who!=='NO CONTACT'?'<span style="font-size:10px;color:var(--text3)">'+esc(l.who)+'</span>':'')
      +'<span class="log-note-text">'+esc(l.noteText||'')+'</span>'
      +'<button class="btn-undo" onclick="openUndoLog('+ri+',\''+role+'\',\''+l.id+'\')">↩ Undo</button></div>').join('')
      +'<button class="btn-del-all" onclick="openUndoAllLogs('+ri+',\''+role+'\')">Undo all today for '+role+'</button></div>';
  }

  const leadDNE=isDNE(ri,role);
  // Lead-level flag (app only, manual text)
  const lf=getLeadFlag(ri,role);
  const leadFlagHtml=lf?'<div class="attention-flag" style="background:var(--red-bg);color:var(--red);border-color:var(--red-border)">⚑ '+esc(lf.text)+' <button class="btn-sm" style="font-size:10px;padding:1px 6px;margin-left:6px" onclick="unflagLead('+ri+',\''+role+'\')">↩</button></div>':'';
  // App-only numbers for this lead
  let appNumHtml='';
  const anums=getAppNums(ri,role);
  if(anums.length){
    appNumHtml='<div class="phones" style="margin-top:2px">'+anums.map((n,i)=>{
      return '<div class="phone-row"><div class="phone-info"><span class="phone-num" onclick="copyPhone(\''+esc(phoneBase(n))+'\',this)" title="Click to copy">'+esc(phoneBase(n))+'</span>'
        +(phoneSuffix(n)?'<span class="phone-suffix">'+esc(phoneSuffix(n))+'</span>':'')
        +'<span class="call-cnt" style="margin-left:0;margin-top:2px;width:fit-content">app only</span></div>'
        +'<div class="phone-btns"><button class="btn-copy" onclick="copyPhone(\''+esc(phoneBase(n))+'\',this)">📋</button>'
        +'<button class="btn-sm" style="font-size:10px" onclick="removeAppNum('+ri+',\''+role+'\','+i+')">✕</button></div></div>';
    }).join('')+'</div>';
  }
  // App follow-up banner
  let afuHtml='';
  const afu=getAFU(ri,role);
  if(afu){
    const today=workDateDisplay();
    if(afu.date===today){
      const cnt=afu.dials[today]||0;
      afuHtml='<div class="afu-banner">📅 Follow-up due today · '+cnt+' dials today'
        +'<div style="display:flex;gap:6px;margin-top:6px">'
        +'<button class="btn-sm" style="background:var(--blue);color:#fff;border:none" onclick="afuDial('+ri+',\''+role+'\')">+1 dial</button>'
        +'<button class="btn-sm" onclick="openAFUModal('+ri+',\''+role+'\')">Add today\'s note</button>'
        +'</div></div>';
    }else{
      afuHtml='<div class="afu-chip">📅 Follow-up: '+esc(afu.date)+'</div>';
    }
  }
  let bottomAction='';
  if(leadDNE){
    const inRep=dne[dneKey(ri,role)]?.inReport;
    bottomAction='<div class="declined-note">Lead does not exist in bank system</div>'
      +'<button class="btn-undo-decline" onclick="toggleDNE('+ri+',\''+role+'\')">↩ Restore lead</button>'
      +'<button class="btn-log-general" onclick="toggleDNEReport('+ri+',\''+role+'\')">'+(inRep?'✓ In report (tap to remove)':'Add to report')+'</button>';
  }else if(isApptHeld(ri)){
    bottomAction='<div class="appt-held-note">Appointment held — bank complete</div>';
  }else if(bankDeclined){
    bottomAction='<div class="declined-note">Bank declined — calling stopped</div>';
    if(isDeclinedToday(ri))bottomAction+='<button class="btn-undo-decline" onclick="openUndoDecline('+ri+')">↩ Undo decline</button>';
  }else{
    bottomAction='<button class="btn-log-call" onclick="openNumModal('+ri+',\''+role+'\')">Log / Flag</button>'
      +'<button class="btn-log-general" onclick="openGenModal('+ri+',\''+role+'\')">+ Log without number</button>';
    if(hasInt)bottomAction+='<button class="btn-appt-held" onclick="setApptHeld('+ri+')">✓ Appointment held</button>';
    bottomAction+='<button class="btn-log-general" onclick="flagLead('+ri+',\''+role+'\')">⚑ Flag lead</button>';
    bottomAction+='<button class="btn-log-general" onclick="addAppNum('+ri+',\''+role+'\')">+ Add number (app only)</button>';
    bottomAction+='<button class="btn-log-general" style="color:var(--red)" onclick="toggleDNE('+ri+',\''+role+'\')">✕ Lead does not exist</button>';
  }

  const emailBtn='<button class="btn-email-log" onclick="promptEmailLog('+ri+',\''+role+'\')">📧 Log email sent</button>';
  return '<div class="lead-card'+(hasSOS?' sos':'')+(hasInt?' interest':'')+(called?' complete-lead':'')+(bankDeclined?' declined-lead':'')+(leadDNE?' declined-lead':'')+'"><div class="lead-header"><div class="lead-header-left"><div class="lead-role-row"><span class="role-tag">'+role+'</span>'+statusTag+(outcome?'<span class="outcome-chip '+oc+'">'+esc(outcome)+'</span>':'')+'</div><div class="lead-name">'+esc(name)+'</div>'+(rc.ea!=null?'<div class="lead-ea" onclick="editEA('+ri+',\''+role+'\')" title="Click to edit EA" style="cursor:pointer">'+(ea?'EA: '+esc(ea):'<span style="color:var(--text3)">+ Add EA</span>')+'</div>':'')+'</div><div class="lead-header-right">'+(recent?'Last: '+recent+'<br>':'')+times+'x total</div></div><div class="lead-body">'+afuHtml+leadFlagHtml+attn+phonesHtml+appNumHtml+notesHtml+todayHtml+bottomAction+emailBtn+'</div></div>';
}

// UNIFIED NUMBER MODAL
function openNumModal(ri,role){
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const d=b.d,rc=RC[role],phones=parsePhones(d[rc.phone]);
  numCtx={ri,role,phones};
  st('nm-title',d[C.BANK]+' — '+role+': '+(d[rc.name]||'—'));
  const regStr=d[C.REG]?d[C.REG]:'';
  const aaStr=d[C.AA]?' · AA: '+d[C.AA]:'';
  const _eff=effEmailDate(d,role);const initStr=_eff?' · Email sent: '+_eff:'';
  const hqStr=d[C.HQ]?' · 🏢 HQ: '+String(d[C.HQ]):'';
  st('nm-sub','Row '+ri+' · '+regStr+aaStr+initStr+hqStr);

  let html='';
  if(!phones.length){
    html='<div class="warn-box">No phone numbers on file for this lead.</div>';
    html+='<div class="modal-actions" style="margin-top:14px"><button class="btn-cancel" onclick="closeNumModal()">Close</button></div>';
    el('nm-body').innerHTML=html;el('num-modal').classList.remove('hidden');return;
  }

  // Find first UNFLAGGED number to auto-select (fall back to 0)
  let autoPick=phones.findIndex(ph=>!isPhoneBad(ri,role,ph));
  if(autoPick<0)autoPick=0;

  // ── SECTION 1: pick which number you are logging ──
  html+='<div class="form-group"><label>Which number did you call?</label><select id="nm-pick" onchange="updateBlackboxBtn()">';
  phones.forEach((ph,pi)=>{
    const bad=isPhoneBad(ri,role,ph);
    html+='<option value="'+pi+'"'+(pi===autoPick?' selected':'')+'>'+esc(phoneBase(ph))+(phoneSuffix(ph)?' '+esc(phoneSuffix(ph)):'')+(bad?' (flagged)':'')+'</option>';
  });
  html+='</select></div>';

  // ── Per-number controls: add extension/option + black-box toggle + manual 2x/7x ──
  html+='<div style="display:flex;gap:8px;flex-wrap:wrap;margin:-4px 0 12px">';
  html+='<button type="button" class="btn-sm" onclick="addExtOpt(\'ext\')">+ Add extension to this number</button>';
  html+='<button type="button" class="btn-sm" onclick="addExtOpt(\'opt\')">+ Add option to this number</button>';
  html+='<button type="button" class="btn-sm" id="nm-blackbox-btn" onclick="toggleBlackbox()">📦 Mark as black box</button>';
  html+='<button type="button" class="btn-sm" style="background:var(--red-bg);color:var(--red);border-color:var(--red-border)" onclick="manualRuleFlag(\'2x\')">⚑ Flag 2x</button>';
  html+='<button type="button" class="btn-sm" style="background:var(--red-bg);color:var(--red);border-color:var(--red-border)" onclick="manualRuleFlag(\'7x\')">⚑ Flag 7x</button>';
  html+='<button type="button" class="btn-sm" style="background:var(--blue-bg);color:var(--blue);border-color:var(--blue-border)" onclick="setAppFollowup()">📅 Set follow-up</button>';
  html+='</div>';

  // ── SECTION 2: ONE who, ONE outcome, ONE note ──
  html+='<div class="form-grid">';
  html+='<div class="form-group"><label>Who answered</label><select id="nm-who"><option value="NO CONTACT">NO CONTACT</option><option value="GK">GK</option><option value="EA">EA</option><option value="CEO">CEO</option><option value="CRA">CRA</option><option value="CFO">CFO</option></select></div>';
  html+='<div class="form-group"><label>Outcome</label><select id="nm-outcome" onchange="checkDeclineWarnSingle()"><option>No Answer</option><option>Left Message</option><option>Check Back Later</option><option>Expressed Interest</option><option>Follow-up</option><option>Email requested/ Follow-up</option><option>Decline</option><option>Wrong Contact</option><option>Wrong Number</option><option>Not the bank\'s fund type</option><option>Open</option><option>Request To Unsubscribe</option></select></div>';
  html+='<div class="form-group"><label>Spoke to</label><input type="text" id="nm-spoke" placeholder="Name, title"/></div>';
  html+='<div class="form-group"><label>New number</label><input type="text" id="nm-newnum" placeholder="e.g. 806.771.3227"/></div>';
  html+='</div>';
  html+='<div class="form-group"><label>Notes</label><textarea id="nm-notes" rows="2" placeholder="What happened?"></textarea></div>';
  html+='<div id="nm-decline-warn" class="warn-box hidden">Decline will stop ALL calling at this bank.</div>';

  // ── SECTION 3: flag this number (app-only or sheet) ──
  html+='<div class="num-section" style="margin-top:6px"><div style="padding:10px">';
  html+='<div class="form-group" style="margin-bottom:8px"><label>Flag this number as bad?</label><select id="nm-flag"><option value="">— number is fine</option>';
  FLAG_OPTIONS.forEach(f=>{html+='<option>'+f+'</option>';});
  html+='</select></div>';
  html+='<div style="display:flex;gap:14px;font-size:12px;color:var(--text2)">';
  html+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="nm-flagscope" value="app" checked style="width:14px;height:14px"/> App only (red, still copyable)</label>';
  html+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="nm-flagscope" value="sheet" style="width:14px;height:14px"/> App + strike on sheet</label>';
  html+='</div></div></div>';

  // ── SECTION 4: quick-dial other numbers (no contact) ──
  if(phones.length>1){
    html+='<div class="num-section" style="margin-top:6px"><div style="padding:10px">';
    html+='<div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">Also dialed (no contact) — counts as a dial only</div>';
    phones.forEach((ph,pi)=>{
      html+='<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);padding:4px 0;cursor:pointer"><input type="checkbox" class="nm-quickdial" data-pi="'+pi+'" style="width:15px;height:15px"/> '+esc(phoneBase(ph))+'</label>';
    });
    html+='</div></div>';
  }

  // Shared number notice
  const otherRoles=['CEO','CRA','CFO'].filter(r=>r!==role);
  const sharedNums={};
  phones.forEach(ph=>{
    const digits=phoneDigits(ph);
    otherRoles.forEach(r=>{
      const otherPhones=parsePhones(d[RC[r].phone]);
      if(otherPhones.some(op=>phoneDigits(op)===digits)){if(!sharedNums[ph])sharedNums[ph]=[];sharedNums[ph].push(r);}
    });
  });
  if(Object.keys(sharedNums).length){
    html+='<div class="shared-num-notice"><strong>Shared numbers:</strong><br>';
    Object.entries(sharedNums).forEach(([ph,roles])=>{html+=esc(phoneBase(ph))+' is also listed for '+roles.join(', ')+'.<br>';});
    html+='</div>';
  }

  // Recent notes
  const existingNotes=String(d[rc.notes]||'');
  if(existingNotes.trim()){
    const noteLines=existingNotes.trim().split('\n').slice(-3);
    html+='<div class="modal-notes-preview"><div class="mnp-label">Recent notes</div><div class="mnp-text">'+esc(noteLines.join('\n'))+'</div></div>';
  }

  html+='<div class="modal-actions" style="margin-top:14px"><button class="btn-primary" onclick="saveNumModal()">Save</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
  updateBlackboxBtn();
}

function checkDeclineWarnSingle(){
  const o=el('nm-outcome')?.value||'';
  el('nm-decline-warn')?.classList.toggle('hidden',o!=='Decline');
}

function addExtOpt(kind){
  if(!numCtx)return;
  const {ri,role,phones}=numCtx;
  const pi=parseInt(el('nm-pick')?.value||'0');
  const ph=phones[pi];if(!ph)return;
  const base=phoneBase(ph);
  const val=prompt('Enter the '+(kind==='ext'?'extension':'option')+' for '+base+':');
  if(val===null||!val.trim())return;
  const label=kind==='ext'?'ext':'opt';
  const newPhVal=base+' '+label+' '+val.trim();
  const b=banks.find(x=>x.ri===ri),d=b.d,rc=RC[role];
  const allPhones=parsePhones(d[rc.phone]);
  const idx=allPhones.findIndex(p=>phoneDigits(p)===phoneDigits(ph));
  if(idx>=0){allPhones[idx]=newPhVal;d[rc.phone]=allPhones.join('; ');}
  const dateStr=workDateDisplay();
  const existingNotes=String(d[rc.notes]||'');
  const noteTxt=(kind==='ext'?'new extension for ':'new option for ')+base;
  const noteEntry=existingNotes.includes(dateStr)?noteTxt:(dateStr+'\n'+noteTxt);
  d[rc.notes]=existingNotes?existingNotes+'\n'+noteEntry:noteEntry;
  writeSheet([{row:ri,col:rc.phone,value:d[rc.phone]},{row:ri,col:rc.notes,value:d[rc.notes]}]);
  numCtx.phones=parsePhones(d[rc.phone]);
  toast('Added '+label+' to '+base,'success');
  openNumModal(ri,role);
}

let sfCtx=null;
function openStandaloneFlag(ri,role,pi){
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const d=b.d,rc=RC[role],phones=parsePhones(d[rc.phone]);
  const ph=phones[pi];if(!ph)return;
  sfCtx={ri,role,ph};
  st('nm-title',d[C.BANK]+' | Flag number');
  st('nm-sub',role+': '+(d[rc.name]||'')+' | '+phoneBase(ph)+' | No call will be logged');
  let html='';
  html+='<div style="font-size:11px;color:var(--text2);background:var(--surface2);border:0.5px solid var(--border);border-radius:var(--radius);padding:7px 10px;margin-bottom:12px">Flags this number only. No call, no dial, no outcome logged. Use + Log without number if you also need to add a note for this lead.</div>';
  html+='<div class="form-group"><label>Why is this number bad?</label><select id="sf-issue">';
  html+='<option value="2x no answer (black box)">2x no answer (black box)</option>';
  html+='<option value="7x no answer (reached bank/lead)">7x no answer (reached bank/lead)</option>';
  FLAG_OPTIONS.forEach(f=>{html+='<option>'+f+'</option>';});
  html+='</select></div>';
  html+='<div style="display:flex;gap:14px;font-size:12px;color:var(--text2);margin-bottom:10px">';
  html+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="sf-scope" value="app" checked style="width:14px;height:14px"/> App only</label>';
  html+='<label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="sf-scope" value="sheet" style="width:14px;height:14px"/> App + strike on sheet</label>';
  html+='</div>';
  html+='<div class="modal-actions"><button class="btn-flag" onclick="saveStandaloneFlag()">⚑ Flag number</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
}
function saveStandaloneFlag(){
  if(!sfCtx)return;
  const {ri,role,ph}=sfCtx;sfCtx=null;
  const b=banks.find(x=>x.ri===ri),d=b.d,rc=RC[role];
  const issue=el('sf-issue')?.value||'';
  const scope=document.querySelector('input[name="sf-scope"]:checked')?.value||'app';
  if(!issue)return;
  const rule=issue.startsWith('2x')?'2x':issue.startsWith('7x')?'7x':undefined;
  flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue,undone:false,called:false,date:workDate,scope,rule};
  saveFlags();
  if(scope==='sheet'){
    // Note line + strikethrough + contact update, same as flagging through a log
    const dateStr=workDateDisplay();
    const existing=String(d[rc.notes]||'');
    const line=phoneBase(ph)+' '+issue.replace(/\s*\([^)]*\)/g,'');
    const entry=existing.includes(dateStr)?line:(dateStr+'\n'+line);
    d[rc.notes]=existing?existing+'\n'+entry:entry;
    writeSheet([{row:ri,col:rc.notes,value:d[rc.notes]}]);
    strikethrough(ri,rc.phone,ph);
    writeContactUpdate(ri,role,ph,issue,d,parsePhones(d[rc.phone]));
  }
  renderStats();closeNumModal();showCurrentBank();
  toast(phoneBase(ph)+' flagged ('+(scope==='sheet'?'app + sheet':'app only')+')','success');
}

function manualRuleFlag(rule){
  if(!numCtx)return;
  const {ri,role,phones}=numCtx;
  const pi=parseInt(el('nm-pick')?.value||'0');
  const ph=phones[pi];if(!ph)return;
  const issue=rule==='2x'?'2x no answer (black box)':'7x no answer (reached bank/lead)';
  if(!confirm('Flag '+phoneBase(ph)+' as '+rule+'? App only, you handle the sheet note yourself.'))return;
  flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue,undone:false,called:false,date:workDate,scope:'app',rule};
  saveFlags();
  toast(phoneBase(ph)+' flagged '+rule+' (app only)','success');
  openNumModal(ri,role); // refresh modal to show flagged state
}

function toggleBlackbox(){
  if(!numCtx)return;
  const {ri,role,phones}=numCtx;
  const pi=parseInt(el('nm-pick')?.value||'0');
  const ph=phones[pi];if(!ph)return;
  const key=bankId(ri)+'__'+role+'__'+phoneDigits(ph);
  if(blackbox[key]){delete blackbox[key];}else{blackbox[key]=true;}
  saveBlackbox();updateBlackboxBtn();
  toast(blackbox[key]?'Marked as black box (2x rule)':'Unmarked','success');
}
function updateBlackboxBtn(){
  if(!numCtx)return;
  const {ri,role,phones}=numCtx;
  const pi=parseInt(el('nm-pick')?.value||'0');
  const ph=phones[pi];if(!ph)return;
  const btn=el('nm-blackbox-btn');if(!btn)return;
  if(isBlackbox(ri,role,ph)){btn.textContent='📦 Black box ✓';btn.style.background='var(--amber-bg)';btn.style.color='var(--amber)';}
  else{btn.textContent='📦 Mark as black box';btn.style.background='';btn.style.color='';}
}

function promptEmailLog(ri,role){
  const recipient=prompt('Who received the email? (name or title, leave blank to skip)');
  if(recipient===null)return; // cancelled
  setEmailLog(ri,role,workDateDisplay(),recipient.trim());
}

function toggleDispForm(pi){
  const checked=el('nm-has-disp-'+pi)?.checked;
  el('disp-form-'+pi)?.classList.toggle('hidden',!checked);
}

function setCalledState(pi,called){
  el('cal-yes-'+pi).classList.toggle('active',called);
  el('cal-no-'+pi).classList.toggle('active',!called);
  el('called-form-'+pi).classList.toggle('hidden',!called);
  el('notcalled-form-'+pi).classList.toggle('hidden',called);
}

function checkDeclineWarn(pi){
  const o=el('nm-outcome-'+pi)?.value||'';
  el('nm-decline-warn-'+pi)?.classList.toggle('hidden',o!=='Decline');
}

function closeNumModal(){el('num-modal').classList.add('hidden');numCtx=null;}

async function saveNumModal(){
  if(!numCtx)return;
  const {ri,role,phones}=numCtx;
  const b=banks.find(x=>x.ri===ri),d=b.d,rc=RC[role];
  const dateStr=workDateDisplay();
  const existingNotes=String(d[rc.notes]||'');
  const dateInNotes=existingNotes.includes(dateStr);

  const pi=parseInt(el('nm-pick')?.value||'0');
  const ph=phones[pi]||'';
  const who=el('nm-who')?.value||'NO CONTACT';
  const outcome=el('nm-outcome')?.value||'No Answer';
  const spoke=el('nm-spoke')?.value.trim()||'';
  const newNum=el('nm-newnum')?.value.trim()||'';
  const notesTxt=el('nm-notes')?.value.trim()||'';
  const flagIssue=el('nm-flag')?.value||'';
  const flagScope=document.querySelector('input[name="nm-flagscope"]:checked')?.value||'app';

  const bgTasks=[];
  const pendingFlagPrompts=[];

  // Count quick-dials (other numbers dialed, no contact)
  const quickDials=[];
  document.querySelectorAll('.nm-quickdial:checked').forEach(cb=>{
    const qpi=parseInt(cb.getAttribute('data-pi'));
    if(qpi!==pi)quickDials.push(phones[qpi]);
  });

  const declineHappened=(outcome==='Decline');

  // ── Build the note (only if there is real content) ──
  const noteLines=[];
  const parts=[];
  if(notesTxt)parts.push(notesTxt);
  if(spoke)parts.push('Spoke to: '+spoke);
  if(parts.length)noteLines.push(parts.join('. ')+'.');
  // New number added to phone cell only, not notes

  // ── Dial counting: 1 for the main call + each quick-dial ──
  const cKey=bankId(ri)+'__'+role+'__'+ph;
  calls[cKey]=(calls[cKey]||0)+1;
  let dialCount=1;
  quickDials.forEach(qph=>{
    const qKey=bankId(ri)+'__'+role+'__'+qph;
    calls[qKey]=(calls[qKey]||0)+1;
    dialCount++;
  });

  // ── 2x / 7x tracking on the main number ──
  const naKey=cKey+'__na', atKey=cKey+'__at';
  //  Black box number (no identifier), no answer   -> 2x rule
  //  Confirmed bank/lead number, no answer         -> 7x rule
  const isBB=isBlackbox(ri,role,ph);
  if(outcome==='No Answer'){
    if(isBB){
      callMeta[naKey]=(callMeta[naKey]||0)+1;
      // Auto-flag (app only) at 2 for black box, once
      if((callMeta[naKey]||0)>=2&&!flags[getFlagKey(ri,role,ph)]){
        flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue:'2x no answer (black box)',undone:false,called:true,date:workDate,scope:'app',auto:true,rule:'2x'};
      }
    }else{
      callMeta[atKey]=(callMeta[atKey]||0)+1;
      // Auto-flag (app only) at 7 for confirmed number, once
      if((callMeta[atKey]||0)>=7&&!flags[getFlagKey(ri,role,ph)]){
        flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue:'7x no answer (reached bank/lead)',undone:false,called:true,date:workDate,scope:'app',auto:true,rule:'7x'};
      }
    }
  }

  // ── Flag handling (app-only or sheet) ──
  if(flagIssue){
    flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue:flagIssue,undone:false,called:true,date:workDate,scope:flagScope};
    if(flagScope==='sheet'){
      bgTasks.push(()=>strikethrough(ri,rc.phone,ph));
      bgTasks.push(()=>writeContactUpdate(ri,role,ph,flagIssue,d,phones));
    }
    // Shared numbers across roles — only when we have real digits to compare
    const digits=phoneDigits(ph);
    for(const otherRole of ['CEO','CRA','CFO'].filter(r=>r!==role)){
      if(!digits)break;
      const orc=RC[otherRole];
      const matchPh=parsePhones(d[orc.phone]).find(op=>digits&&phoneDigits(op)===digits);
      if(matchPh){
        flags[getFlagKey(ri,otherRole,matchPh)]={ri,role:otherRole,phone:matchPh,issue:flagIssue,undone:false,called:false,sharedFrom:role,date:workDate,scope:flagScope};
        if(flagScope==='sheet')bgTasks.push(()=>strikethrough(ri,orc.phone,matchPh));
      }
    }
  }

  // ── Add new number to phone cell ──
  if(newNum)d[rc.phone]=d[rc.phone]?d[rc.phone]+'; '+newNum:newNum;

  // ── If a previously flagged number now connected, offer to clear ──
  const fKey=getFlagKey(ri,role,ph);
  if(flags[fKey]&&!flags[fKey].undone&&!flagIssue&&outcome!=='No Answer'&&who!=='NO CONTACT'){
    if(confirm(phoneBase(ph)+' was flagged but you just connected. Remove the flag?')){
      const wasScope=flags[fKey].scope;
      flags[fKey].undone=true;
      const connNote=dateInNotes?(phoneBase(ph)+' connected.'):(dateStr+'\n'+phoneBase(ph)+' connected.');
      d[rc.notes]=existingNotes?(existingNotes+'\n'+connNote):connNote;
      if(wasScope==='sheet'){
        bgTasks.push(()=>fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({type:'unstrikethrough',sheetId:cfg.sheetId,tabName:cfg.tab,row:ri,col:rc.phone,phone:ph})}));
      }
    }
  }

  // ── Snapshot for undo ──
  const before={recent:d[rc.recent]||'',times:String(parseInt(d[rc.times])||0),outcome:d[rc.outcome]||'',who:d[rc.who]||'',notes:existingNotes};

  // ── Write note to notes cell ──
  let noteEntry='';
  if(noteLines.length){
    noteEntry=dateInNotes?noteLines.join('\n'):(dateStr+'\n'+noteLines.join('\n'));
    d[rc.notes]=String(d[rc.notes]||'')?String(d[rc.notes])+'\n'+noteEntry:noteEntry;
  }

  // ── Update lead columns (the ONE who, ONE outcome) ──
  // Times-called goes up on every logged call.
  d[rc.recent]=dateStr;
  d[rc.times]=String((parseInt(d[rc.times])||0)+1);
  d[rc.outcome]=outcome;
  d[rc.who]=who;

  // ── Save the log entry — who and outcome exactly as selected ──
  const logEntry={id:genId(),ri,role,who,outcome,noteEntry,noteText:noteLines.join(' '),notesTxt,spokeTo:spoke,newNum,phone:ph,called:true,dialCount,date:workDate,before,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(logEntry);
  saveLogs();saveFlags();saveCalls();saveCallMeta();

  // ── Sheet write (background) ──
  const updates=[
    {row:ri,col:rc.notes,value:d[rc.notes]||''},
    {row:ri,col:rc.recent,value:d[rc.recent]},
    {row:ri,col:rc.times,value:d[rc.times]},
    {row:ri,col:rc.outcome,value:d[rc.outcome]},
    {row:ri,col:rc.who,value:d[rc.who]}
  ];
  if(newNum)updates.push({row:ri,col:rc.phone,value:d[rc.phone]});

  // Close + refresh immediately
  renderStats();closeNumModal();rebuildCard(ri,declineHappened);
  toast(who!=='NO CONTACT'?'Logged — '+who+' reached':'Logged','success');

  // Background network
  writeSheet(updates);
  mirrorPriority(ri,role);
  bgTasks.forEach(t=>{try{t();}catch(e){console.error(e);}});

  // 2x/7x prompts
  pendingFlagPrompts.forEach(p=>{
    setTimeout(()=>{
      if(confirm(phoneBase(p.ph)+' has reached '+p.issue+' for '+p.role+'. Flag this number?')){
        flags[getFlagKey(p.ri,p.role,p.ph)]={ri:p.ri,role:p.role,phone:p.ph,issue:p.issue,undone:false,called:true,date:workDate,scope:'app',auto:true};
        saveFlags();rebuildCard(p.ri,false);renderStats();toast(phoneBase(p.ph)+' flagged (app only)','success');
      }
    },120);
  });
}

function openGenModal(ri,role){
  genCtx={ri,role};
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const rc=RC[role];
  st('gm-title',b.d[C.BANK]+' — '+role+': '+(b.d[rc.name]||'—'));
  const _geff=effEmailDate(b.d,role);st('gm-sub','Row '+ri+' · '+(b.d[C.REG]||'')+(b.d[C.AA]?' · AA: '+b.d[C.AA]:'')+(_geff?' · Email sent: '+_geff:''));
  el('gm-who').value='NO CONTACT';el('gm-outcome').value='No Answer';
  sv('gm-spoke','');sv('gm-newnum','');sv('gm-notes','');
  // Show last 2 notes for context
  const existingNotes=String(b.d[rc.notes]||'');
  const notesPreview=el('gm-notes-preview');
  if(notesPreview&&existingNotes.trim()){
    const lines=existingNotes.trim().split('\n').slice(-3);
    notesPreview.textContent=lines.join('\n');
    notesPreview.closest('.gm-notes-section').classList.remove('hidden');
  }else if(notesPreview){
    notesPreview.closest('.gm-notes-section').classList.add('hidden');
  }
  el('gm-decline-warn').classList.add('hidden');
  el('gen-modal').classList.remove('hidden');
}
function closeGenModal(){el('gen-modal').classList.add('hidden');genCtx=null;}
function checkGenWarnings(){el('gm-decline-warn').classList.toggle('hidden',gv('gm-outcome')!=='Decline');}

async function saveGenLog(){
  if(!genCtx)return;
  const {ri,role}=genCtx;
  const outcome=gv('gm-outcome'),who=gv('gm-who'),spoke=gv('gm-spoke').trim(),newNum=gv('gm-newnum').trim(),notesTxt=gv('gm-notes').trim();
  if(outcome==='Decline'){if(!confirm('Confirm decline for '+(banks.find(x=>x.ri===ri)?.d[C.BANK]||'')+'?'))return;}
  const b=banks.find(x=>x.ri===ri),d=b.d,rc=RC[role],dateStr=workDateDisplay();
  const existingNotes=String(d[rc.notes]||''),dateInNotes=existingNotes.includes(dateStr);
  const before={recent:d[rc.recent]||'',times:String(parseInt(d[rc.times])||0),outcome:d[rc.outcome]||'',who:d[rc.who]||'',notes:existingNotes};
  const parts=[];
  if(notesTxt)parts.push(notesTxt);if(spoke)parts.push('Spoke to: '+spoke);
  // Decline handled internally — nothing about it goes to notes
  let noteEntry='';
  if(parts.length){noteEntry=dateInNotes?parts.join('. ')+'.':(dateStr+'\n'+parts.join('. ')+'.');}
  if(noteEntry)d[rc.notes]=existingNotes?existingNotes+'\n'+noteEntry:noteEntry;
  d[rc.recent]=dateStr;d[rc.times]=String((parseInt(d[rc.times])||0)+1);d[rc.outcome]=outcome;d[rc.who]=who;
  if(newNum)d[rc.phone]=d[rc.phone]?d[rc.phone]+'; '+newNum:newNum;
  const logEntry={id:genId(),ri,role,who,outcome,noteEntry,noteText:parts.join(' · ')||'',called:true,date:workDate,before,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(logEntry);saveLogs();
  const updates=[{row:ri,col:rc.recent,value:d[rc.recent]},{row:ri,col:rc.times,value:d[rc.times]},{row:ri,col:rc.who,value:d[rc.who]},{row:ri,col:rc.outcome,value:d[rc.outcome]},{row:ri,col:rc.notes,value:d[rc.notes]}];
  if(newNum)updates.push({row:ri,col:rc.phone,value:d[rc.phone]});
  await writeSheet(updates);
  mirrorPriority(ri,role);
  renderStats();closeGenModal();rebuildCard(ri,outcome==='Decline');
  toast(outcome==='Decline'?'Bank marked declined':'Call logged ✓','success');
}

// UNDO SYSTEM
function openUndoLog(ri,role,id){
  const b=banks.find(x=>x.ri===ri),log=(logs[logKey(ri)]||[]).find(l=>l.id===id);if(!log)return;
  undoCtx={type:'log',ri,role,id};
  st('undo-desc','Undo "'+log.outcome+'" logged for '+role+' at '+(b?.d[C.BANK]||'')+'?\n\nThis restores the sheet to its previous state.');
  el('undo-modal').classList.remove('hidden');
}
function openUndoAllLogs(ri,role){
  const b=banks.find(x=>x.ri===ri);undoCtx={type:'allLogs',ri,role};
  st('undo-desc','Undo ALL of today\'s entries for '+role+' at '+(b?.d[C.BANK]||'')+'?');
  el('undo-modal').classList.remove('hidden');
}
function openUndoFlag(ri,role,phoneIdx){
  const b=banks.find(x=>x.ri===ri),phones=parsePhones(b?.d[RC[role].phone]||''),phone=phones[phoneIdx]||'';
  undoCtx={type:'flag',ri,role,phone};
  st('undo-desc','Undo bad number flag for '+phone+' ('+role+' at '+(b?.d[C.BANK]||'')+')?');
  el('undo-modal').classList.remove('hidden');
}
function openUndoDecline(ri){
  const b=banks.find(x=>x.ri===ri);undoCtx={type:'decline',ri};
  st('undo-desc','Undo the decline for '+(b?.d[C.BANK]||'')+'?\n\nThis bank will become active again.');
  el('undo-modal').classList.remove('hidden');
}
function closeUndoModal(){el('undo-modal').classList.add('hidden');undoCtx=null;}
async function confirmUndo(){
  if(!undoCtx)return;const{type,ri,role,id,phone}=undoCtx;closeUndoModal();
  if(type==='log')await undoLog(ri,role,id);
  if(type==='allLogs')await undoAllLogs(ri,role);
  if(type==='flag')await undoFlag(ri,role,phone);
  if(type==='decline')await undoDecline(ri);
}

async function undoLog(ri,role,id){
  const key=logKey(ri),log=(logs[key]||[]).find(l=>l.id===id);if(!log)return;
  log.deleted=true;saveLogs();
  const b=banks.find(x=>x.ri===ri),rc=RC[role];
  const remaining=(logs[key]||[]).filter(l=>!l.deleted&&l.role===role);
  // Restore from before snapshot
  if(log.before){b.d[rc.recent]=log.before.recent;b.d[rc.times]=log.before.times;b.d[rc.outcome]=log.before.outcome;b.d[rc.who]=log.before.who;b.d[rc.notes]=log.before.notes;}
  // Decrement call counter
  if(log.called&&log.phone){const cKey=bankId(ri)+'__'+role+'__'+log.phone;calls[cKey]=Math.max(0,(calls[cKey]||1)-1);saveCalls();}
  await writeSheet([{row:ri,col:rc.notes,value:b.d[rc.notes]},{row:ri,col:rc.times,value:b.d[rc.times]},{row:ri,col:rc.outcome,value:b.d[rc.outcome]},{row:ri,col:rc.who,value:b.d[rc.who]},{row:ri,col:rc.recent,value:b.d[rc.recent]}]);
  mirrorPriority(ri,role);
  renderStats();rebuildCard(ri,false);toast('Entry undone','success');
}

async function undoAllLogs(ri,role){
  const key=logKey(ri);const today=(logs[key]||[]).filter(l=>l.role===role&&!l.deleted);
  const first=today[0];today.forEach(l=>l.deleted=true);saveLogs();
  const b=banks.find(x=>x.ri===ri),rc=RC[role];
  if(first&&first.before){b.d[rc.recent]=first.before.recent;b.d[rc.times]=first.before.times;b.d[rc.outcome]=first.before.outcome;b.d[rc.who]=first.before.who;b.d[rc.notes]=first.before.notes;}
  await writeSheet([{row:ri,col:rc.notes,value:b.d[rc.notes]},{row:ri,col:rc.times,value:b.d[rc.times]},{row:ri,col:rc.outcome,value:b.d[rc.outcome]},{row:ri,col:rc.who,value:b.d[rc.who]},{row:ri,col:rc.recent,value:b.d[rc.recent]}]);
  mirrorPriority(ri,role);
  renderStats();rebuildCard(ri,false);toast('All entries undone','success');
}

async function undoFlag(ri,role,phone){
  const fKey=getFlagKey(ri,role,phone);if(!flags[fKey])return;
  const wasSheet=flags[fKey].scope==='sheet'||flags[fKey].scope===undefined&&!flags[fKey].sharedFrom;
  flags[fKey].undone=true;saveFlags();
  if(wasSheet){
    const b=banks.find(x=>x.ri===ri),rc=RC[role];
    // Remove flag note line from notes (only lines that are flag lines: number + a flag reason)
    const dg=phoneDigits(phone);
    const notes=String(b.d[rc.notes]||'').split('\n').filter(l=>{
      if(!dg)return true;
      const lineDg=l.replace(/[^\d]/g,'');
      const hasNum=lineDg.includes(dg);
      const isFlagLine=hasNum&&FLAG_OPTIONS.some(k=>l.toLowerCase().includes(k.toLowerCase()));
      return !isFlagLine;
    }).join('\n').trim();
    b.d[rc.notes]=notes;
    await writeSheet([{row:ri,col:rc.notes,value:notes}]);
    try{
      await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({type:'unstrikethrough',sheetId:cfg.sheetId,tabName:cfg.tab,row:ri,col:rc.phone,phone})});
    }catch(e){console.error('Unstrikethrough error',e);}
    await removeContactUpdate(ri,role,phone,b.d);
  }
  renderStats();rebuildCard(ri,false);toast(wasSheet?'Flag removed (app + sheet)':'Flag removed (app only, sheet untouched)','success');
}

async function undoDecline(ri){
  const key=logKey(ri);const dec=(logs[key]||[]).find(l=>l.outcome==='Decline'&&!l.deleted);
  if(dec){dec.deleted=true;saveLogs();}
  const b=banks.find(x=>x.ri===ri);
  for(const role of['CEO','CRA','CFO']){
    const rc=RC[role];b.d[rc.outcome]='';
    await writeSheet([{row:ri,col:rc.outcome,value:''}]);
  }
  renderStats();rebuildCard(ri,false);toast('Decline undone','success');
}

// CONTACT UPDATE SHEET
async function writeContactUpdate(ri,role,phone,issue,bankData,allPhones){
  if(!cfg.updateSheetId||!cfg.updateTab)return;
  // Check if same number exists across other roles at this bank
  const otherRolesWithSameNumber=['CEO','CRA','CFO'].filter(r=>r!==role&&parsePhones(bankData[RC[r].phone]).includes(phone));
  const leadTitle=role==='CRA'?'CRA OFFICER':role;
  const leadName=bankData[RC[role].name]||'';
  let combinedTitle=leadTitle,combinedName=leadName;
  if(otherRolesWithSameNumber.length){
    combinedTitle=[leadTitle,...otherRolesWithSameNumber.map(r=>r==='CRA'?'CRA OFFICER':r)].join(' & ');
    combinedName=[leadName,...otherRolesWithSameNumber.map(r=>bankData[RC[r].name]||'')].filter(Boolean).join(' & ');
  }
  try{
    await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'appendContactUpdate',sheetId:cfg.updateSheetId,tabName:cfg.updateTab,
        rowData:{rowNum:ri,bankName:bankData[C.BANK]||'',leadTitle:combinedTitle,leadName:combinedName,issue:phone+' : '+issue}})});
  }catch(e){console.error('Contact update error',e);}
}

async function removeContactUpdate(ri,role,phone,bankData){
  if(!cfg.updateSheetId||!cfg.updateTab)return;
  try{
    await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'removeContactUpdate',sheetId:cfg.updateSheetId,tabName:cfg.updateTab,rowNum:ri,bankName:bankData[C.BANK]||'',phone})});
  }catch(e){console.error('Remove contact update error',e);}
}

async function detectSheetStrikethroughs(){
  // Disabled for now - rich text API call causing network errors
  return;
  try{
    const phoneCols=['J','T','AD']; // CEO=col10, CRA=col20, CFO=col30 (A=1)
    const roleMap={'J':'CEO','T':'CRA','AD':'CFO'};
    const phoneColIdx={'J':9,'T':19,'AD':29};
    for(const col of phoneCols){
      const range=encodeURIComponent("'"+cfg.tab+"'!"+col+"3:"+col+"1025");
      const url=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?ranges=${range}&fields=sheets.data.rowData.values.textFormatRuns,sheets.data.rowData.values.userEnteredValue&key=${cfg.apiKey}`;
      const res=await fetch(url);
      const data=await res.json();
      if(data.error)continue;
      const rows=data.sheets?.[0]?.data?.[0]?.rowData||[];
      rows.forEach((row,idx)=>{
        const ri=idx+3;
        const b=banks.find(x=>x.ri===ri);
        if(!b)return;
        const role=roleMap[col];
        const cell=row.values?.[0];
        if(!cell)return;
        const cellText=cell.userEnteredValue?.stringValue||'';
        const runs=cell.textFormatRuns||[];
        if(!runs.length)return;
        // Find which portions are struck through
        const phones=parsePhones(cellText);
        phones.forEach(ph=>{
          const phStart=cellText.indexOf(ph);
          if(phStart===-1)return;
          // Check if any run covering this position has strikethrough
          let isStruck=false;
          for(let r=0;r<runs.length;r++){
            const runStart=runs[r].startIndex||0;
            const runEnd=r+1<runs.length?(runs[r+1].startIndex||cellText.length):cellText.length;
            if(runStart<=phStart&&phStart<runEnd&&runs[r].format?.strikethrough){
              isStruck=true;break;
            }
          }
          const fKey=getFlagKey(ri,role,ph);
          if(isStruck&&!flags[fKey]){
            // Auto-flag from sheet strikethrough
            flags[fKey]={ri,role,phone:ph,issue:'Flagged in sheet',undone:false,fromSheet:true};
          } else if(!isStruck&&flags[fKey]?.fromSheet){
            // Number was un-struck in sheet — remove auto-flag
            delete flags[fKey];
          }
        });
      });
    }
    saveFlags();
  }catch(e){console.error('Strikethrough detection error',e);}
}

async function writeSheet(updates){
  try{await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({sheetId:cfg.sheetId,tabName:cfg.tab,updates})});}
  catch(e){console.error('Write error',e);}
}
async function strikethrough(ri,phoneColIndex,badPhone){
  if(!badPhone)return;
  try{await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'strikethrough',sheetId:cfg.sheetId,tabName:cfg.tab,row:ri,col:phoneColIndex,badNumber:badPhone})});}
  catch(e){console.error('Strikethrough error',e);}
}

// EOD REPORT
// Scan the sheet for leads whose most-recent-call date equals the work date.
// Safety net: if a call was logged on the sheet (or fixed manually there) but the
// app has no log for that lead today, the report still counts it.
function sheetReachedToday(){
  const today=workDateDisplay();
  const out=[];
  banks.forEach(b=>{
    ['CEO','CRA','CFO'].forEach(role=>{
      const rc=RC[role];
      const raw=b.d[rc.recent];if(!raw)return;
      let dstr='';try{dstr=fmtSheetDate(raw);}catch{return;}
      if(dstr!==today)return;
      const who=String(b.d[rc.who]||'').trim()||'NO CONTACT';
      const outcome=String(b.d[rc.outcome]||'').trim()||'No Answer';
      // Pull today's note text from the notes cell (text after the last date marker)
      let notesTxt='';
      const notes=String(b.d[rc.notes]||'');
      const idx=notes.lastIndexOf(today);
      if(idx>=0){
        notesTxt=notes.slice(idx+today.length).split('\n').map(s=>s.trim()).filter(Boolean).slice(0,2).join(' ');
      }
      out.push({ri:b.ri,role,who,outcome,notesTxt,spokeTo:'',newNum:'',called:true,dialCount:0,date:workDate,fromSheetScan:true});
    });
  });
  return out;
}

function showEOD(){
  const all=allLogsForDate();
  let calledLogs=all.filter(l=>l.called);
  const appDials=calledLogs.reduce((acc,l)=>acc+(l.dialCount||1),0);
  // Merge in sheet-scanned entries for leads the app has no log for today
  const seen=new Set(calledLogs.map(l=>l.ri+'__'+l.role));
  sheetReachedToday().forEach(s=>{
    if(!seen.has(s.ri+'__'+s.role)){calledLogs=calledLogs.concat(s);seen.add(s.ri+'__'+s.role);}
  });
  // REACHED RULES (one who per log now):
  //  - who = NO CONTACT  -> not reached
  //  - who = anything else (GK included) -> bank reached
  //  - who = EA/CEO/CRA/CFO -> decision maker reached
  const DM_WHO=['EA','CEO','CFO','CRA'];
  const isReachedLog=(l)=>l.who&&l.who!=='NO CONTACT';
  const isDMLog=(l)=>DM_WHO.includes(l.who);
  const banksReached=new Set(calledLogs.filter(isReachedLog).map(l=>l.ri)).size;
  const peopleReached=new Set(calledLogs.filter(isDMLog).map(l=>l.ri+'_'+l.role)).size;

  // Build one connect entry per bank (best outcome wins)
  const PRIORITY=['Expressed Interest','Email requested/ Follow-up','Follow-up','Left Message','Check Back Later','No Answer'];
  const connectMap={};
  calledLogs.filter(isReachedLog).forEach(l=>{
    const key=l.ri;
    if(!connectMap[key]||PRIORITY.indexOf(l.outcome)<PRIORITY.indexOf(connectMap[key].outcome)){
      const b=banks.find(x=>x.ri===l.ri);
      if(b){
        const parts=[];
        if(l.outcome==='Expressed Interest')parts.push('Appointment scheduled');
        if(l.notesTxt&&l.notesTxt.trim())parts.push(l.notesTxt.trim().replace(/\.+$/,''));
        if(l.spokeTo&&l.spokeTo.trim())parts.push('Spoke to '+l.spokeTo.trim().replace(/\.+$/,''));
        // new number not shown in report notes
        const cleanNote=parts.length?parts.join('. '):l.outcome;
        connectMap[key]={row:l.ri,bank:b.d[C.BANK],outcome:l.outcome,note:cleanNote,who:l.who,isDM:DM_WHO.includes(l.who)};
      }
    }
  });
  const connects=Object.values(connectMap);
  // Split into the two groups — each bank appears in exactly one
  const dmReached=connects.filter(c=>c.isDM);
  const gkReached=connects.filter(c=>!c.isDM);

  // Declined today
  const declinedToday=[],seenDec=new Set();
  // Use the merged list (app logs + sheet scan) so declines on the sheet today always show
  calledLogs.filter(l=>l.outcome==='Decline').forEach(l=>{
    if(!seenDec.has(l.ri)){seenDec.add(l.ri);const b=banks.find(x=>x.ri===l.ri);if(b)declinedToday.push({row:l.ri,bank:b.d[C.BANK],role:l.role});}
  });
  // Also catch app-side decline markers not in calledLogs
  all.filter(l=>l.outcome==='Decline').forEach(l=>{
    if(!seenDec.has(l.ri)){seenDec.add(l.ri);const b=banks.find(x=>x.ri===l.ri);if(b)declinedToday.push({row:l.ri,bank:b.d[C.BANK],role:l.role});}
  });

  // Appointments
  const appointments=connects.filter(c=>c.outcome==='Expressed Interest');

  // SOS grouped by bank — only flags from TODAY, not auto-detected from sheet
  const sosByBank={};
  Object.values(flags).filter(f=>!f.undone&&!f.fromSheet&&f.date===workDate).forEach(f=>{
    const b=banks.find(x=>x.ri===f.ri);if(!b)return;
    const key=f.ri+'|||'+b.d[C.BANK];if(!sosByBank[key])sosByBank[key]={row:f.ri,bank:b.d[C.BANK],entries:[]};
    sosByBank[key].entries.push(f);
  });

  st('eod-sub',cfg.name+' · '+workDateDisplay());
  el('eod-dials').value=appDials;

  // Clean bank name: ALL-CAPS words become Title Case, mixed-case (EagleBank) kept as-is
  const cleanBank=(s)=>String(s||'').replace(/\u00a0/g,' ').trim().split(/\s+/).map(w=>{
    if(w.length>2&&w===w.toUpperCase()&&/[A-Z]/.test(w)){
      const low=w.toLowerCase();
      if(['of','and','the'].includes(low))return low;
      return low.charAt(0).toUpperCase()+low.slice(1);
    }
    return w;
  }).join(' ');
  // Clean issue: strip parenthetical descriptions
  const cleanIssue=(s)=>String(s||'').replace(/\s*\([^)]*\)/g,'').replace(/—/g,',').trim();

  const buildText=(dials)=>{
    const cr=dials>0?((peopleReached/dials)*100).toFixed(2)+'%':'0.00%';
    const apptDM=peopleReached>0?((appointments.length/peopleReached)*100).toFixed(2)+'%':'0.00%';
    const apptDials=dials>0?((appointments.length/dials)*100).toFixed(2)+'%':'0.00%';
    let t='Today | '+workDateDisplay()+'\n';
    t+='Total Dials Made | '+dials+'\n';
    t+='EA/CRA/CEO/CFO Reached | '+peopleReached+'\n';
    t+='EA/CRA/CEO Contact Rate (%) | '+cr+'\n';
    t+='Appointments Booked | '+appointments.length+'\n';
    t+='Appointment based on DM reached | '+apptDM+'\n';
    t+='Appointment based on Dials | '+apptDials+'\n';
    t+='Total Banks Reached | '+banksReached+'\n';

    t+='\nDecision Makers Reached\n\n';
    if(dmReached.length){
      dmReached.slice().sort((a,b)=>a.row-b.row).forEach(c=>{
        const note=c.note.replace(/\.+$/,'').trim();
        t+='Row '+c.row+' | '+cleanBank(c.bank)+' | '+c.who+' | '+note+'\n';
      });
    }else{t+='None\n';}

    t+='\nBanks Reached\n\n';
    if(gkReached.length){
      gkReached.slice().sort((a,b)=>a.row-b.row).forEach(c=>{
        t+='Row '+c.row+' | '+cleanBank(c.bank)+'\n';
      });
    }else{t+='None\n';}

    if(declinedToday.length){
      t+='\nBanks Declined Today\n\n';
      declinedToday.slice().sort((a,b)=>a.row-b.row).forEach(x=>{t+='Row '+x.row+' | '+cleanBank(x.bank)+' | declined by '+x.role+'\n';});
    }



    // Leads marked "does not exist" AND opted into report
    const dneList=Object.values(dne).filter(x=>!x.undone&&x.inReport)
      .sort((a,b)=>a.ri-b.ri).map(x=>{
        const b=banks.find(bb=>bb.ri===x.ri);
        return 'Row '+x.ri+' | '+cleanBank(b?b.d[C.BANK]:'')+' | '+x.role+(x.name?' '+x.name:'')+' | not in bank system';
      });
    if(dneList.length){t+='\nLeads Not In Bank System\n\n';dneList.forEach(l=>t+=l+'\n');}

    // Flagged Numbers: lead flags + HQ flags together, one line per number, merged by digits, sorted by row
    const todayFlags=Object.values(flags).filter(f=>!f.undone&&!f.fromSheet&&f.date===workDate);
    const hqToday=Object.values(hqFlags).filter(f=>!f.undone&&f.date===workDate);
    if(todayFlags.length||hqToday.length){
      t+='\nFlagged Numbers\n\n';
      const byBank={};
      const fmt10=(ph)=>{const dg=phoneDigits(ph);return dg.length===10?dg.slice(0,3)+'.'+dg.slice(3,6)+'.'+dg.slice(6):phoneBase(ph);};
      todayFlags.forEach(f=>{
        if(!byBank[f.ri])byBank[f.ri]={};
        const digits=phoneDigits(f.phone)||phoneBase(f.phone);
        if(!byBank[f.ri][digits])byBank[f.ri][digits]={roles:[],issue:cleanIssue(f.issue),display:fmt10(f.phone)};
        if(!byBank[f.ri][digits].roles.includes(f.role))byBank[f.ri][digits].roles.push(f.role);
      });
      hqToday.forEach(f=>{
        if(!byBank[f.ri])byBank[f.ri]={};
        const digits='HQ'+(phoneDigits(f.phone)||f.phone);
        byBank[f.ri][digits]={roles:['HQ'],issue:cleanIssue(f.issue),display:fmt10(f.phone)};
      });
      Object.keys(byBank).map(Number).sort((a,b)=>a-b).forEach(ri=>{
        const b=banks.find(x=>x.ri===ri);
        const bankName=cleanBank(b?b.d[C.BANK]:'');
        Object.values(byBank[ri]).forEach(info=>{
          t+='Row '+ri+' | '+bankName+' | '+info.roles.join(' & ')+' '+info.display+' | '+info.issue+'\n';
        });
      });
    }
    return t.trim();
  };

  el('eod-text').textContent=buildText(appDials);
  el('eod-dials').oninput=function(){el('eod-text').textContent=buildText(parseInt(this.value)||appDials);};
  el('eod-modal').classList.remove('hidden');
}
function closeEOD(){el('eod-modal').classList.add('hidden');}
function copyReport(){navigator.clipboard.writeText(el('eod-text').textContent).then(()=>toast('Report copied ✓','success')).catch(()=>toast('Select and copy manually','error'));}

function clearDayLogs(){
  if(!confirm('Clear all logged calls for '+workDateDisplay()+'?\n\nThis resets your stats but does not undo sheet writes.'))return;
  const pfx=workDate+'__';Object.keys(logs).filter(k=>k.startsWith(pfx)).forEach(k=>{(logs[k]||[]).forEach(l=>l.deleted=true);});
  saveLogs();renderStats();if(openRI)renderBody(openRI);renderList(visibleBanks());toast('Day cleared','success');
}

function showSettings(){sv('set-name',cfg.name||'');sv('set-sheet-id',cfg.sheetId||'');sv('set-tab',cfg.tab||'');sv('set-update-id',cfg.updateSheetId||'');sv('set-update-tab',cfg.updateTab||'');sv('set-followup-tab',cfg.followupTab||'');sv('set-priority-tab',cfg.priorityTab||'');sv('set-api-key',cfg.apiKey||'');el('settings-modal').classList.remove('hidden');}
function closeSettings(){el('settings-modal').classList.add('hidden');}
function saveSettings(){
  cfg.name=gv('set-name').trim();cfg.sheetId=gv('set-sheet-id').trim();cfg.tab=gv('set-tab').trim();cfg.updateSheetId=gv('set-update-id').trim();cfg.updateTab=gv('set-update-tab').trim();cfg.followupTab=gv('set-followup-tab').trim();cfg.priorityTab=gv('set-priority-tab').trim();cfg.apiKey=gv('set-api-key').trim();
  saveCfg();closeSettings();st('rep-badge',cfg.name);toast('Settings saved — reloading...','success');setTimeout(()=>loadSheet(),500);
}

function rebuildCard(ri,removeFromList){
  // Refresh current bank view if it's the current bank
  if(navList.length&&navList[navIdx]&&navList[navIdx].ri===ri){
    if(removeFromList){
      // Remove from navList and adjust index
      navList=navList.filter(b=>b.ri!==ri);
      if(navIdx>=navList.length)navIdx=Math.max(0,navList.length-1);
      updateNavCounter();
    }
    showCurrentBank();
  } else if(removeFromList){
    // Remove from navList
    navList=navList.filter(b=>b.ri!==ri);
    updateNavCounter();
  }
  renderStats();
}

function copyPhone(phone,btn){
  navigator.clipboard.writeText(phone).then(()=>{const o=btn.textContent;btn.textContent='✓';setTimeout(()=>btn.textContent=o,1500);})
  .catch(()=>{const ta=document.createElement('textarea');ta.value=phone;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);const o=btn.textContent;btn.textContent='✓';setTimeout(()=>btn.textContent=o,1500);});
}

function loadCfg(){try{return JSON.parse(localStorage.getItem(CFG_KEY))||{};}catch{return{};}}
function saveCfg(){localStorage.setItem(CFG_KEY,JSON.stringify(cfg));}
function loadLogs(){try{return JSON.parse(localStorage.getItem(LOGS_KEY))||{};}catch{return{};}}
function saveLogs(){localStorage.setItem(LOGS_KEY,JSON.stringify(logs));}
function loadFlags(){try{return JSON.parse(localStorage.getItem(FLAGS_KEY))||{};}catch{return{};}}
function saveFlags(){localStorage.setItem(FLAGS_KEY,JSON.stringify(flags));}
function loadCalls(){try{return JSON.parse(localStorage.getItem(CALLS_KEY))||{};}catch{return{};}}
function saveCalls(){localStorage.setItem(CALLS_KEY,JSON.stringify(calls));}
function loadCallMeta(){try{return JSON.parse(localStorage.getItem(CALLMETA_KEY))||{};}catch{return{};}}
function loadBlackbox(){try{return JSON.parse(localStorage.getItem(BLACKBOX_KEY))||{};}catch{return{};}}
function saveBlackbox(){localStorage.setItem(BLACKBOX_KEY,JSON.stringify(blackbox));}
function isBlackbox(ri,role,ph){return !!blackbox[bankId(ri)+'__'+role+'__'+phoneDigits(ph)];}

// ── HQ number flags & counters (app only) ──
function loadHQFlags(){try{return JSON.parse(localStorage.getItem(HQFLAG_KEY))||{};}catch{return{};}}
function saveHQFlags(){localStorage.setItem(HQFLAG_KEY,JSON.stringify(hqFlags));}
function loadHQMeta(){try{return JSON.parse(localStorage.getItem(HQMETA_KEY))||{};}catch{return{};}}
function saveHQMeta(){localStorage.setItem(HQMETA_KEY,JSON.stringify(hqMeta));}
function loadDNE(){try{return JSON.parse(localStorage.getItem(DNE_KEY))||{};}catch{return{};}}
function saveDNE(){localStorage.setItem(DNE_KEY,JSON.stringify(dne));}
function loadAFU(){try{return JSON.parse(localStorage.getItem(AFU_KEY))||{};}catch{return{};}}
function saveAFU(){localStorage.setItem(AFU_KEY,JSON.stringify(appFU));}
function exportBackup(){
  const data={};
  ['cdt3_logs','cdt3_flags','cdt3_calls','cdt3_callmeta','cdt3_blackbox','cdt3_hqflags','cdt3_hqmeta','cdt3_dne','cdt3_appfu','cdt3_parked','cdt3_appt','cdt3_email','cdt3_config'].forEach(k=>{
    const v=localStorage.getItem(k);if(v)data[k]=v;
  });
  const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='caller-dashboard-backup-'+workDateDisplay().replace(/\//g,'-')+'.json';
  a.click();
  toast('Backup downloaded','success');
}
function importBackup(){
  const inp=document.createElement('input');inp.type='file';inp.accept='.json';
  inp.onchange=()=>{
    const file=inp.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        const data=JSON.parse(reader.result);
        Object.entries(data).forEach(([k,v])=>localStorage.setItem(k,v));
        toast('Backup restored, reloading...','success');
        setTimeout(()=>location.reload(),800);
      }catch(e){toast('Invalid backup file','error');}
    };
    reader.readAsText(file);
  };
  inp.click();
}
function loadParked(){try{return JSON.parse(localStorage.getItem(PARKED_KEY))||{};}catch{return{};}}
function saveParked(){localStorage.setItem(PARKED_KEY,JSON.stringify(parked));}
function loadFUD(){try{return JSON.parse(localStorage.getItem(FUD_KEY))||{};}catch{return{};}}
function saveFUD(){localStorage.setItem(FUD_KEY,JSON.stringify(fud));}
function loadLeadFlags(){try{return JSON.parse(localStorage.getItem(LEADFLAG_KEY))||{};}catch{return{};}}
function saveLeadFlags(){localStorage.setItem(LEADFLAG_KEY,JSON.stringify(leadFlags));}
function getLeadFlag(ri,role){const x=leadFlags[bankId(ri)+'__'+role];return(x&&!x.undone)?x:null;}
function editEA(ri,role){
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const rc=RC[role];if(rc.ea==null)return;
  const cur=String(b.d[rc.ea]||'').trim();
  const val=prompt('Executive Assistant for this lead (writes to the EA column on the sheet):',cur);
  if(val===null)return;
  b.d[rc.ea]=val.trim();
  writeSheet([{row:ri,col:rc.ea,value:b.d[rc.ea]}]);
  showCurrentBank();
  toast(val.trim()?'EA saved':'EA cleared','success');
}

function flagLead(ri,role){
  const cur=getLeadFlag(ri,role);
  const text=prompt('Flag this lead (app only). Enter your reason:',cur?cur.text:'');
  if(text===null)return;
  if(!text.trim()){if(cur){leadFlags[bankId(ri)+'__'+role].undone=true;saveLeadFlags();showCurrentBank();toast('Lead flag removed','success');}return;}
  leadFlags[bankId(ri)+'__'+role]={ri,role,text:text.trim(),date:workDate,undone:false};
  saveLeadFlags();showCurrentBank();toast('Lead flagged (app only)','success');
}
function unflagLead(ri,role){
  const k=bankId(ri)+'__'+role;
  if(leadFlags[k]){leadFlags[k].undone=true;saveLeadFlags();showCurrentBank();toast('Lead flag removed','success');}
}
function loadAppNums(){try{return JSON.parse(localStorage.getItem(APPNUM_KEY))||{};}catch{return{};}}
function saveAppNums(){localStorage.setItem(APPNUM_KEY,JSON.stringify(appNums));}
function loadStopMark(){try{return JSON.parse(localStorage.getItem(STOPMARK_KEY));}catch{return null;}}
function saveStopMark(){localStorage.setItem(STOPMARK_KEY,JSON.stringify(stopMark));}
function setStopHere(ri){
  stopMark={ri,date:workDateDisplay()};saveStopMark();
  showCurrentBank();
  toast('Marked. Tomorrow you resume from the next bank','success');
}
function getAppNums(ri,role){return appNums[bankId(ri)+'__'+role]||[];}
function addAppNum(ri,role){
  const num=prompt('Add a number for this lead (app only, never written to the sheet):');
  if(num===null||!num.trim())return;
  const k=bankId(ri)+'__'+role;
  if(!appNums[k])appNums[k]=[];
  appNums[k].push(num.trim());
  saveAppNums();showCurrentBank();toast('Number added (app only)','success');
}
function removeAppNum(ri,role,idx){
  const k=bankId(ri)+'__'+role;
  if(appNums[k]){appNums[k].splice(idx,1);saveAppNums();showCurrentBank();toast('App number removed','success');}
}
function fudGet(ri){const k=bankId(ri);if(!fud[k])fud[k]={dials:{},done:{},lastTouch:0,nextDate:'',role:''};return fud[k];}
function fudRole(ri){return fudGet(ri).role||fuByBank[bankId(ri)]?.role||'CEO';}
function fudSetRole(ri,role){fudGet(ri).role=role;saveFUD();toast('Follow-up dials now go to '+role,'success');showCurrentBank();}
function isFUBank(ri){return !!fuByBank[bankId(ri)];}
function fuDoneToday(ri){return !!fudGet(ri).done[workDateDisplay()];}
// FU bank is "active" (should surface first) when: not done today, next date is today or unset/past, and not touched in the last 3 hours
function fuActive(ri){
  if(!isFUBank(ri))return false;
  const x=fudGet(ri);
  const today=workDateDisplay();
  if(x.done[today])return false;
  if(x.nextDate){try{if(new Date(x.nextDate)>new Date(today))return false;}catch{}}
  if(x.lastTouch&&(Date.now()-x.lastTouch)<3*60*60*1000)return false;
  return true;
}
async function loadPriority(){
  const pTab=cfg.priorityTab||'Priority Banks';
  try{
    const url=`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent("'"+pTab+"'")}?key=${cfg.apiKey}`;
    const res=await fetch(url);const data=await res.json();
    if(data.error){console.error('Priority load error',data.error.message);priorities=[];return;}
    priorities=(data.values||[]).slice(1).map((row,i)=>({pri:i+2,d:row}))
      .filter(p=>p.d[PRI.BANK]&&String(p.d[PRI.BANK]).trim());
  }catch(e){console.error('Priority load failed',e);priorities=[];}
}
function buildPriByBank(){
  priByBank={};
  priorities.forEach(p=>{
    const mb=findMainBank(String(p.d[PRI.BANK]||''));
    if(mb)priByBank[bankId(mb.ri)]=p;
  });
}
function isPriorityBank(ri){return !!priByBank[bankId(ri)];}
// Mirror a lead's recent-call date + notes from the main sheet into the Priority tab
function mirrorPriority(ri,role){
  const p=priByBank[bankId(ri)];if(!p)return;
  const pc=PRI[role];if(!pc)return;
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const rc=RC[role];
  const pTab=cfg.priorityTab||'Priority Banks';
  fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sheetId:cfg.sheetId,tabName:pTab,updates:[
      {row:p.pri,col:pc.recent,value:b.d[rc.recent]||''},
      {row:p.pri,col:pc.notes,value:b.d[rc.notes]||''}
    ]})}).catch(e=>console.error('Priority mirror failed',e));
}

function buildFuByBank(){
  fuByBank={};
  followups.forEach(f=>{
    const mb=findMainBank(String(f.d[FU.BANK]||''));
    if(mb)fuByBank[bankId(mb.ri)]={fri:f.fri,role:fuRole(f.d[FU.PERSON]),f};
  });
}
function buildFUDBanner(ri){
  const x=fudGet(ri);
  const today=workDateDisplay();
  const cnt=x.dials[today]||0;
  const info=fuByBank[bankId(ri)];
  const person=info?String(info.f.d[FU.PERSON]||''):'';
  if(x.done[today]){
    return '<div class="afu-banner" style="margin-top:6px">📌 Follow-up bank | ✓ done for today | '+cnt+' dials</div>';
  }
  const curRole=fudRole(ri);
  let h='<div class="afu-banner" style="margin-top:6px">📌 Follow-up bank';
  if(person)h+=' | '+esc(person);
  h+=' | '+cnt+' dials today';
  if(x.nextDate)h+=' | next: '+esc(x.nextDate);
  h+='<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap;align-items:center">';
  h+='<select onchange="fudSetRole('+ri+',this.value)" style="width:auto;font-size:11px;padding:4px 6px" title="Which lead these dials belong to">';
  ['CEO','CRA','CFO'].forEach(r=>{h+='<option value="'+r+'"'+(r===curRole?' selected':'')+'>'+r+'</option>';});
  h+='</select>';
  h+='<button class="btn-sm" style="background:var(--blue);color:#fff;border:none" onclick="fudDial('+ri+')">+1 dial</button>';
  h+='<button class="btn-sm" onclick="fudUndoDial('+ri+')">↩ Undo dial</button>';
  h+='<button class="btn-sm" style="background:var(--green-bg);color:var(--green);border-color:var(--green-border)" onclick="openFUDDone('+ri+')">✓ Done for today</button>';
  h+='</div></div>';
  return h;
}

function fudDial(ri){
  const x=fudGet(ri);const today=workDateDisplay();
  x.dials[today]=(x.dials[today]||0)+1;x.lastTouch=Date.now();saveFUD();
  const dlog={id:genId(),ri,role:fudRole(ri),who:'NO CONTACT',outcome:'No Answer',called:true,dialCount:1,date:workDate,fudDial:true,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(dlog);saveLogs();
  renderStats();showCurrentBank();
  toast('+1 dial ('+x.dials[today]+' today)','success');
}
function fudUndoDial(ri){
  const x=fudGet(ri);const today=workDateDisplay();
  if(!(x.dials[today]>0)){toast('No dials to undo today','error');return;}
  x.dials[today]--;saveFUD();
  // Remove the most recent fudDial log entry for this bank today
  const key=logKey(ri);
  if(logs[key]){
    for(let i=logs[key].length-1;i>=0;i--){
      const l=logs[key][i];
      if(l.fudDial&&!l.deleted&&l.ri===ri){l.deleted=true;break;}
    }
    saveLogs();
  }
  renderStats();showCurrentBank();
  toast('Dial removed ('+x.dials[today]+' today)','success');
}
let fudCtx=null;
function openFUDDone(ri){
  const info=fuByBank[bankId(ri)];if(!info)return;
  fudCtx={ri};
  const b=banks.find(z=>z.ri===ri);if(!b)return;
  const role=fudRole(ri);
  const person=String(info.f.d[FU.PERSON]||'');
  st('nm-title',b.d[C.BANK]+' | Follow-up done for today');
  st('nm-sub','Row '+ri+' | '+person+' | One note for the day, writes to BOTH sheets');
  let html='';
  html+='<div class="form-group"><label>Lead on main sheet (both sheets update)</label><select id="fud-role">';
  ['CEO','CRA','CFO'].forEach(r=>{html+='<option value="'+r+'"'+(r===(role||'CEO')?' selected':'')+'>'+r+(b.d[RC[r].name]?': '+esc(String(b.d[RC[r].name])):'')+'</option>';});
  html+='</select></div>';
  html+='<div class="form-grid">';
  html+='<div class="form-group"><label>Who answered</label><select id="fud-who"><option value="NO CONTACT">NO CONTACT</option><option value="GK">GK</option><option value="EA">EA</option><option value="CEO">CEO</option><option value="CRA">CRA</option><option value="CFO">CFO</option></select></div>';
  html+='<div class="form-group"><label>Outcome</label><select id="fud-outcome"><option>No Answer</option><option>Left Message</option><option>Check Back Later</option><option>Expressed Interest</option><option>Follow-up</option><option>Email requested/ Follow-up</option><option>Decline</option></select></div>';
  html+='</div>';
  html+='<div class="form-group"><label>Today\'s note (goes to main sheet and follow-up sheet)</label><textarea id="fud-note" rows="3" placeholder="What happened across your calls today?"></textarea></div>';
  html+='<div class="form-group"><label>Next follow-up date, app only (M/D/YYYY, blank = surface again tomorrow)</label><input type="text" id="fud-next" placeholder="e.g. 7/17/2026"/></div>';
  html+='<div class="modal-actions"><button class="btn-primary" onclick="saveFUDDone()">Save, done for today</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
}
function saveFUDDone(){
  if(!fudCtx)return;
  const {ri}=fudCtx;fudCtx=null;
  const info=fuByBank[bankId(ri)];if(!info)return;
  const b=banks.find(z=>z.ri===ri);if(!b)return;
  const role=el('fud-role')?.value||fudRole(ri);
  fudGet(ri).role=role; // remember for future +1 dials
  const who=el('fud-who')?.value||'NO CONTACT';
  const outcome=el('fud-outcome')?.value||'No Answer';
  const note=el('fud-note')?.value.trim()||'';
  const nextDate=el('fud-next')?.value.trim()||'';
  if(nextDate&&!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(nextDate)){toast('Use M/D/YYYY format','error');return;}
  const dateStr=workDateDisplay();
  // MAIN SHEET (only when a role is known)
  if(role&&RC[role]){
    const d=b.d,rc=RC[role];
    const existing=String(d[rc.notes]||'');
    const before={recent:d[rc.recent]||'',times:String(parseInt(d[rc.times])||0),outcome:d[rc.outcome]||'',who:d[rc.who]||'',notes:existing};
    let noteEntry='';
    if(note){
      noteEntry=existing.includes(dateStr)?note:(dateStr+'\n'+note);
      d[rc.notes]=existing?existing+'\n'+noteEntry:noteEntry;
    }
    d[rc.recent]=dateStr;
    d[rc.times]=String((parseInt(d[rc.times])||0)+1);
    d[rc.outcome]=outcome;d[rc.who]=who;
    const logEntry={id:genId(),ri,role,who,outcome,noteEntry,noteText:note,notesTxt:note,spokeTo:'',newNum:'',phone:'',called:true,dialCount:0,date:workDate,before,deleted:false,fudNote:true};
    const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(logEntry);saveLogs();
    writeSheet([
      {row:ri,col:rc.notes,value:d[rc.notes]||''},
      {row:ri,col:rc.recent,value:d[rc.recent]},
      {row:ri,col:rc.times,value:d[rc.times]},
      {row:ri,col:rc.outcome,value:d[rc.outcome]},
      {row:ri,col:rc.who,value:d[rc.who]}
    ]);
    mirrorPriority(ri,role);
  }
  // FOLLOW-UP SHEET
  const f=info.f,fd=f.d;
  fd[FU.FOLLOWUP]=dateStr;
  fd[FU.TIMES]=String((parseInt(fd[FU.TIMES])||0)+1);
  if(note){
    const ex=String(fd[FU.NOTES]||'');
    const entry=dateStr+': '+note;
    fd[FU.NOTES]=ex?ex+'\n'+entry:entry;
  }
  const fuTab=cfg.followupTab||'Follow-Up Sheet';
  fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sheetId:cfg.sheetId,tabName:fuTab,updates:[
      {row:f.fri,col:FU.FOLLOWUP,value:fd[FU.FOLLOWUP]},
      {row:f.fri,col:FU.TIMES,value:fd[FU.TIMES]},
      {row:f.fri,col:FU.NOTES,value:fd[FU.NOTES]||''}
    ]})}).catch(e=>console.error(e));
  // APP: done for today + next date (app only)
  const x=fudGet(ri);
  x.done[dateStr]=true;
  x.nextDate=nextDate;
  saveFUD();
  renderStats();closeNumModal();listDirty=true;showCurrentBank();
  toast('Done for today ✓ Both sheets updated','success');
}
function isParked(ri){return !!parked[bankId(ri)];}
function toggleParked(ri){
  const k=bankId(ri);
  if(parked[k]){delete parked[k];toast('Moved back to main list','success');}
  else{parked[k]=true;toast('Moved to parked list (app only)','success');}
  saveParked();
  listDirty=true;showCurrentBank();
}
function afuKey(ri,role){return bankId(ri)+'__'+role;}
function getAFU(ri,role){const x=appFU[afuKey(ri,role)];return(x&&!x.done)?x:null;}
function afuDueToday(ri,role){const x=getAFU(ri,role);return x&&x.date===workDateDisplay();}
function bankHasDueAFU(ri){return['CEO','CRA','CFO'].some(r=>afuDueToday(ri,r));}
function setAppFollowup(){
  if(!numCtx)return;
  const {ri,role}=numCtx;
  const date=prompt('Follow up with this lead on what date? (M/D/YYYY)');
  if(date===null||!date.trim())return;
  if(!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date.trim())){toast('Use M/D/YYYY format','error');return;}
  appFU[afuKey(ri,role)]={ri,role,date:date.trim(),done:false,dials:{},created:workDate};
  saveAFU();
  toast('Follow-up set for '+date.trim()+' (app only)','success');
}
function afuDial(ri,role){
  const x=appFU[afuKey(ri,role)];if(!x)return;
  const today=workDateDisplay();
  x.dials[today]=(x.dials[today]||0)+1;saveAFU();
  // Dial-only log so daily dials count it (no sheet write, no note)
  const dlog={id:genId(),ri,role,who:'NO CONTACT',outcome:'No Answer',called:true,dialCount:1,date:workDate,afuDial:true,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(dlog);saveLogs();
  renderStats();showCurrentBank();
  toast('+1 dial ('+x.dials[today]+' today)','success');
}
let afuCtx=null;
function openAFUModal(ri,role){
  const x=appFU[afuKey(ri,role)];if(!x)return;
  afuCtx={ri,role};
  const b=banks.find(z=>z.ri===ri);if(!b)return;
  const d=b.d,rc=RC[role];
  const today=workDateDisplay();
  st('nm-title',d[C.BANK]+' — Follow-up: '+role+' '+(d[rc.name]||''));
  st('nm-sub','Row '+ri+' · Due '+x.date+' · '+(x.dials[today]||0)+' dials today');
  let html='';
  html+='<div style="font-size:11px;color:var(--text2);background:var(--surface2);border:0.5px solid var(--border);border-radius:var(--radius);padding:7px 10px;margin-bottom:12px">One note for the whole day. Set the next follow-up date, or mark it completed if you got your answer.</div>';
  const existing=String(d[rc.notes]||'');
  if(existing.trim()){const lines=existing.trim().split('\n').slice(-3);html+='<div class="modal-notes-preview"><div class="mnp-label">Recent notes</div><div class="mnp-text">'+esc(lines.join('\n'))+'</div></div>';}
  html+='<div class="form-group" style="margin-top:12px"><label>Today\'s note</label><textarea id="afu-note" rows="3" placeholder="What happened across your calls today?"></textarea></div>';
  html+='<div class="form-grid">';
  html+='<div class="form-group"><label>Who answered</label><select id="afu-who"><option value="NO CONTACT">NO CONTACT</option><option value="GK">GK</option><option value="EA">EA</option><option value="CEO">CEO</option><option value="CRA">CRA</option><option value="CFO">CFO</option></select></div>';
  html+='<div class="form-group"><label>Outcome</label><select id="afu-outcome"><option>No Answer</option><option>Left Message</option><option>Check Back Later</option><option>Expressed Interest</option><option>Follow-up</option><option>Email requested/ Follow-up</option><option>Decline</option></select></div>';
  html+='</div>';
  html+='<div class="form-group"><label>Next follow-up date (M/D/YYYY) — leave blank if completed</label><input type="text" id="afu-next" placeholder="e.g. 7/15/2026"/></div>';
  html+='<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="afu-done" style="width:15px;height:15px"/> ✓ Follow-up completed — got the response needed</label></div>';
  html+='<div class="modal-actions"><button class="btn-primary" onclick="saveAFUModal()">Save day note</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
}
function saveAFUModal(){
  if(!afuCtx)return;
  const {ri,role}=afuCtx;
  const x=appFU[afuKey(ri,role)];if(!x)return;
  const b=banks.find(z=>z.ri===ri),d=b.d,rc=RC[role];
  const note=el('afu-note')?.value.trim()||'';
  const who=el('afu-who')?.value||'NO CONTACT';
  const outcome=el('afu-outcome')?.value||'No Answer';
  const nextDate=el('afu-next')?.value.trim()||'';
  const done=el('afu-done')?.checked||false;
  if(!done&&!nextDate){toast('Set a next date or mark completed','error');return;}
  if(nextDate&&!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(nextDate)){toast('Use M/D/YYYY format','error');return;}
  const dateStr=workDateDisplay();
  const existing=String(d[rc.notes]||'');
  const before={recent:d[rc.recent]||'',times:String(parseInt(d[rc.times])||0),outcome:d[rc.outcome]||'',who:d[rc.who]||'',notes:existing};
  // One dated note line for the day
  let noteEntry='';
  if(note){
    noteEntry=existing.includes(dateStr)?note:(dateStr+'\n'+note);
    d[rc.notes]=existing?existing+'\n'+noteEntry:noteEntry;
  }
  d[rc.recent]=dateStr;
  d[rc.times]=String((parseInt(d[rc.times])||0)+1);
  d[rc.outcome]=outcome;
  d[rc.who]=who;
  // Log entry so stats/report reflect the day
  const logEntry={id:genId(),ri,role,who,outcome,noteEntry,noteText:note,notesTxt:note,spokeTo:'',newNum:'',phone:'',called:true,dialCount:0,date:workDate,before,deleted:false,afuNote:true};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(logEntry);saveLogs();
  // Update follow-up schedule
  if(done){x.done=true;}
  else{x.date=nextDate;}
  saveAFU();
  writeSheet([
    {row:ri,col:rc.notes,value:d[rc.notes]||''},
    {row:ri,col:rc.recent,value:d[rc.recent]},
    {row:ri,col:rc.times,value:d[rc.times]},
    {row:ri,col:rc.outcome,value:d[rc.outcome]},
    {row:ri,col:rc.who,value:d[rc.who]}
  ]);
  mirrorPriority(ri,role);
  renderStats();closeNumModal();showCurrentBank();
  toast(done?'Follow-up completed ✓':'Day note saved, next: '+nextDate,'success');
}
function dneKey(ri,role){return bankId(ri)+'__'+role;}
function isDNE(ri,role){const x=dne[dneKey(ri,role)];return x&&!x.undone;}
function toggleDNE(ri,role){
  const k=dneKey(ri,role);
  if(isDNE(ri,role)){dne[k].undone=true;toast('Lead restored','success');}
  else{
    const b=banks.find(x=>x.ri===ri);
    dne[k]={ri,role,name:b?String(b.d[RC[role].name]||''):'',date:workDate,undone:false,inReport:false};
    toast('Marked: lead does not exist (app only)','success');
  }
  saveDNE();showCurrentBank();
}
function toggleDNEReport(ri,role){
  const k=dneKey(ri,role);
  if(dne[k]){dne[k].inReport=!dne[k].inReport;saveDNE();showCurrentBank();
    toast(dne[k].inReport?'Will show in report':'Removed from report','success');}
}
function hqKey(ri){return bankId(ri)+'__HQ';}
function isHQFlagged(ri){const f=hqFlags[hqKey(ri)];return f&&!f.undone;}
function isHQBlackbox(ri){return !!(hqMeta[hqKey(ri)]&&hqMeta[hqKey(ri)].blackbox);}

function buildHQRow(ri,hqRaw){
  const base=phoneBase(hqRaw);
  const flagged=isHQFlagged(ri);
  const meta=hqMeta[hqKey(ri)]||{};
  const bb=isHQBlackbox(ri);
  let cntLabel='';
  if(bb&&meta.na)cntLabel=' · '+meta.na+'x no ans';
  else if(!bb&&meta.at)cntLabel=' · '+meta.at+'x att';
  const dialed=meta.dials?' · '+meta.dials+' dials':'';
  let h='<div class="bank-hq-wrap">';
  h+='<span class="bank-hq'+(flagged?' hq-flagged':'')+'" onclick="copyPhone(\''+esc(base)+'\',this)" title="Click to copy">🏢 HQ: '+esc(hqRaw)+(flagged?' ⚑':'')+cntLabel+dialed+'</span>';
  h+='<button class="hq-btn hq-btn-flag" onclick="openHQModal('+ri+')" title="Log an HQ dial (app only)">📞 Dialed HQ</button>';
  if(flagged){h+='<button class="hq-btn hq-btn-undo" onclick="hqUndoFlag('+ri+')">↩ Unflag</button>';}
  h+='</div>';
  return h;
}

let hqCtx=null;
function openHQModal(ri){
  hqCtx={ri};
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const base=phoneBase(String(b.d[C.HQ]));
  const bb=isHQBlackbox(ri);
  st('nm-title',b.d[C.BANK]+' — HQ Number');
  st('nm-sub','Row '+ri+' · '+base+' · App only, nothing goes to sheet or notes');
  let html='';
  html+='<div style="font-size:11px;color:var(--text2);background:var(--surface2);border:0.5px solid var(--border);border-radius:var(--radius);padding:7px 10px;margin-bottom:12px">This logs a dial on the HQ number. It counts toward your daily dials but never touches the sheet or notes.</div>';
  html+='<div class="form-group"><label>Outcome</label><select id="hq-outcome"><option>No Answer</option><option>Reached</option></select></div>';
  html+='<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="hq-bb" '+(bb?'checked':'')+' style="width:15px;height:15px"/> Black box number (no identifier) — uses 2x rule instead of 7x</label></div>';
  html+='<div class="num-section" style="margin-top:6px"><div style="padding:10px">';
  html+='<div class="form-group" style="margin-bottom:0"><label>Flag this HQ number? (app only)</label><select id="hq-flag"><option value="">— number is fine</option>';
  html+='<option value="2x no answer (black box)">2x no answer (black box)</option>';
  html+='<option value="7x no answer (reached bank)">7x no answer (reached bank)</option>';
  FLAG_OPTIONS.forEach(f=>{html+='<option>'+f+'</option>';});
  html+='</select></div></div></div>';
  html+='<div class="modal-actions" style="margin-top:14px"><button class="btn-primary" onclick="saveHQModal()">Save dial</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
}

function saveHQModal(){
  if(!hqCtx)return;
  const {ri}=hqCtx;
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const base=phoneBase(String(b.d[C.HQ]));
  const k=hqKey(ri);
  const outcome=el('hq-outcome')?.value||'No Answer';
  const bb=el('hq-bb')?.checked||false;
  const flagIssue=el('hq-flag')?.value||'';

  if(!hqMeta[k])hqMeta[k]={na:0,at:0,dials:0,blackbox:false};
  hqMeta[k].blackbox=bb;
  hqMeta[k].dials=(hqMeta[k].dials||0)+1; // counts as a dial

  // 2x / 7x counters only climb on No Answer
  if(outcome==='No Answer'){
    if(bb)hqMeta[k].na=(hqMeta[k].na||0)+1;
    else hqMeta[k].at=(hqMeta[k].at||0)+1;
    // Auto-flag at threshold, app only
    if(bb&&hqMeta[k].na>=2&&!isHQFlagged(ri)){
      hqFlags[k]={ri,phone:base,issue:'2x no answer (black box)',undone:false,date:workDate,rule:'2x'};
    }else if(!bb&&hqMeta[k].at>=7&&!isHQFlagged(ri)){
      hqFlags[k]={ri,phone:base,issue:'7x no answer (reached bank)',undone:false,date:workDate,rule:'7x'};
    }
  }

  // Manual flag choice overrides/sets
  if(flagIssue){
    const rule=flagIssue.startsWith('2x')?'2x':flagIssue.startsWith('7x')?'7x':undefined;
    hqFlags[k]={ri,phone:base,issue:flagIssue,undone:false,date:workDate,rule};
  }

  saveHQMeta();saveHQFlags();
  // Record a dial-only log so daily dials include it
  const dlog={id:genId(),ri,role:'HQ',who:'NO CONTACT',outcome,called:true,dialCount:1,date:workDate,hqDial:true,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(dlog);saveLogs();

  renderStats();closeNumModal();showCurrentBank();
  toast(flagIssue||isHQFlagged(ri)?'HQ dial logged + flagged':'HQ dial logged','success');
}

function hqUndoFlag(ri){
  const k=hqKey(ri);
  if(hqFlags[k]){hqFlags[k].undone=true;saveHQFlags();showCurrentBank();toast('HQ flag removed','success');}
}

function saveCallMeta(){localStorage.setItem(CALLMETA_KEY,JSON.stringify(callMeta));}

function el(id){return document.getElementById(id);}
function gv(id){return el(id)?.value||'';}
function sv(id,v){const e=el(id);if(e)e.value=v||'';}
function st(id,v){const e=el(id);if(e)e.textContent=v;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}
function show(id){['setup-screen','main-app'].forEach(s=>{const e=el(s);if(e)e.classList.toggle('hidden',s!==id);});}
function fmtSheetDate(v){if(!v)return'';try{const d=new Date(v);return isNaN(d)?String(v):(d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear();}catch{return String(v);}}
function toast(msg,type=''){const e=el('toast');e.textContent=msg;e.className='toast'+(type?' '+type:'');e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2500);}
