// CALLER DASHBOARD TESTER v3
// Built from scratch — unified number modal, date-based persistence, bank-name keying

const SCRIPT_URL='https://script.google.com/macros/s/AKfycbwQi98Cg7DD8t8xegXhelPlcGvFUCEhzs3amya0zPA3EcNl4C1mdah-8FmqrNEx29JJ/exec';
const CFG_KEY='cdt3_config';
const LOGS_KEY='cdt3_logs';
const FLAGS_KEY='cdt3_flags';
const CALLS_KEY='cdt3_calls'; // per-number call counters

// COLUMN MAP (0-based)
const C={
  ROW:0,BANK:1,STATE:4,CITY:5,REG:6,AA:7,
  CEO_NAME:8,CEO_PHONE:9,CEO_EA:10,CEO_EMAIL:11,CEO_INIT:12,
  CEO_RECENT:13,CEO_TIMES:14,CEO_WHO:15,CEO_NOTES:16,CEO_OUTCOME:17,
  CRA_NAME:18,CRA_PHONE:19,CRA_EMAIL_I:20,CRA_EMAIL_R:21,CRA_INIT:22,
  CRA_RECENT:23,CRA_TIMES:24,CRA_WHO:25,CRA_NOTES:26,CRA_OUTCOME:27,
  CFO_NAME:28,CFO_PHONE:29,CFO_EMAIL_I:30,CFO_EMAIL_R:31,CFO_INIT:32,
  CFO_RECENT:33,CFO_TIMES:34,CFO_WHO:35,CFO_NOTES:36,CFO_OUTCOME:37,
};

const RC={
  CEO:{recent:13,times:14,who:15,notes:16,outcome:17,phone:9,name:8,ea:10,email:11,init:12},
  CRA:{recent:23,times:24,who:25,notes:26,outcome:27,phone:19,name:18,ea:null,email:20,emailR:21,init:22},
  CFO:{recent:33,times:34,who:35,notes:36,outcome:37,phone:29,name:28,ea:null,email:30,emailR:31,init:32},
};

const FLAG_OPTIONS=['Black box VM','Dead air','Unidentifiable VM','No answer — no VM or identifier','Wrong number','Wrong contact','Wrong bank','Not in service','Fax machine','Did not hear full name','Call screened by AI','Invalid number','Call rejected','No exec access'];

const OC={'Expressed Interest':'green','Follow-up':'blue','Email requested/ Follow-up':'blue','Left Message':'blue','Check Back Later':'amber','Open':'amber','Decline':'red','Request To Unsubscribe':'red','Wrong Number':'red','Wrong Contact':'red',"Not the bank's fund type":'red'};

let cfg={},banks=[],logs={},flags={},calls={},apptHeld={},emailLogs={},openRI=null,numCtx=null,genCtx=null,undoCtx=null,workDate='';
let navList=[],navIdx=0;
const APPT_KEY='cdt3_appt';
const EMAIL_KEY='cdt3_email';

// Keyboard navigation
document.addEventListener('keydown',(e)=>{
  const tag=document.activeElement?.tagName?.toLowerCase();
  if(tag==='input'||tag==='textarea'||tag==='select')return;
  if(e.key==='ArrowRight'||e.key==='ArrowDown')nextBank();
  if(e.key==='ArrowLeft'||e.key==='ArrowUp')prevBank();
});

window.onload=()=>{
  cfg=loadCfg();logs=loadLogs();flags=loadFlags();calls=loadCalls();apptHeld=loadAppt();emailLogs=loadEmailLogs();
  // Migrate old cdt2 logs if cdt3 is empty
  migrateLegacyLogs();
  workDate=cfg.lastWorkDate||initWorkDate();
  if(!cfg.sheetId||!cfg.tab||!cfg.apiKey||!cfg.name){show('setup-screen');prefillSetup();}
  else{show('main-app');boot();}
};

function prefillSetup(){sv('s-name',cfg.name||'');sv('s-sheet-id',cfg.sheetId||'');sv('s-tab',cfg.tab||'');sv('s-update-id',cfg.updateSheetId||'');sv('s-update-tab',cfg.updateTab||'');sv('s-api-key',cfg.apiKey||'');}
function saveSetup(){
  const name=gv('s-name').trim(),sheetId=gv('s-sheet-id').trim(),tab=gv('s-tab').trim(),updateSheetId=gv('s-update-id').trim(),updateTab=gv('s-update-tab').trim(),apiKey=gv('s-api-key').trim();
  if(!name||!sheetId||!tab||!apiKey){toast('Please fill in all required fields','error');return;}
  cfg={name,sheetId,tab,updateSheetId,updateTab,apiKey,lastWorkDate:workDate};saveCfg();show('main-app');boot();
}
function boot(){st('rep-badge',cfg.name);if(!workDate)workDate=initWorkDate();el('work-date').value=workDate;loadSheet();}
function onDateChange(){workDate=gv('work-date').trim();if(!workDate)return;cfg.lastWorkDate=workDate;saveCfg();renderStats();applyFilters(false);}
function initWorkDate(){const now=new Date();const et=new Date(now.toLocaleString('en-US',{timeZone:'America/New_York'}));return(et.getMonth()+1)+'/'+et.getDate()+'/'+et.getFullYear();}
function workDateDisplay(){return workDate||'';}

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
    renderStats();
    // Find smart start position
    navIdx=findSmartStartIdx();
    applyFilters(false);
  }catch(e){
    // Show error but still try to render banks if we have them
    if(banks.length){
      navIdx=findSmartStartIdx();
      applyFilters(false);
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
  // Extract just the 10 digits for matching
  const m=String(ph).match(/(\d{3})\.(\d{3})\.(\d{4})/);
  return m?m[1]+m[2]+m[3]:'';
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
function bankComplete(ri){return['CEO','CRA','CFO'].every(r=>logsForDate(ri,r).some(l=>l.called));}
function bankIncomplete(ri){const c=['CEO','CRA','CFO'].filter(r=>logsForDate(ri,r).some(l=>l.called)).length;return c>0&&c<3;}
function pendingRoles(ri){return['CEO','CRA','CFO'].filter(r=>!logsForDate(ri,r).some(l=>l.called));}
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

function renderStats(){
  const all=allLogsForDate();
  // Dials = total numbers marked Called across all logs today
  const dials=allLogsForDate().reduce((acc,l)=>acc+(l.dialCount||1),0);
  // Bank reached = called at least 1 number regardless of outcome or who answered
  const banksReached=new Set(all.filter(l=>l.called).map(l=>l.ri)).size;
  const peopleReached=new Set(all.filter(l=>l.called&&l.who&&l.who!=='NO CONTACT').map(l=>l.ri+'_'+l.role)).size;
  const completeCnt=banks.filter(b=>bankComplete(b.ri)).length;
  const sosCnt=Object.values(flags).filter(f=>!f.undone).length;
  const decToday=new Set(all.filter(l=>l.outcome==='Decline').map(l=>l.ri)).size;
  const apptToday=new Set(all.filter(l=>l.outcome==='Expressed Interest').map(l=>l.ri)).size;
  const activeCnt=banks.filter(b=>!isDeclined(b.ri)&&!isApptHeld(b.ri)).length;
  st('st-dials',dials);st('st-reached',banksReached);st('st-people',peopleReached);
  st('st-complete',completeCnt);st('st-sos',sosCnt);st('st-declined',decToday);
  st('st-appt',apptToday);st('st-total',activeCnt);
}

function buildStateFilter(){
  const sel=el('f-state');const states=[...new Set(banks.map(b=>b.d[C.STATE]).filter(Boolean))].sort();
  sel.innerHTML='<option value="">All states</option>';states.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;sel.appendChild(o);});
}
function visibleBanks(){const status=gv('f-status');if(status==='declined-all')return banks.filter(b=>isDeclined(b.ri));if(status==='appt-held')return banks.filter(b=>isApptHeld(b.ri));return banks.filter(b=>!isDeclinedSheet(b.ri)&&!isApptHeld(b.ri));}
function applyFilters(resetNav){
  if(resetNav!==false)navIdx=0;
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
  renderList(result);
}
// NAVIGATION
function renderList(list){
  navList=list;
  // Clamp index
  if(navIdx>=navList.length)navIdx=Math.max(0,navList.length-1);
  updateNavCounter();
  showCurrentBank();
}

function findSmartStartIdx(){
  // Find most recent date string across all banks (compare as strings M/D/YYYY)
  let maxDateMs=0, lastBankIdx=-1;
  banks.forEach((b,idx)=>{
    ['CEO','CRA','CFO'].forEach(r=>{
      const raw=b.d[RC[r].recent];
      if(!raw)return;
      try{
        const dt=new Date(raw);
        if(!isNaN(dt.getTime())&&dt.getTime()>maxDateMs){
          maxDateMs=dt.getTime();
        }
      }catch{}
    });
  });
  if(!maxDateMs)return 0;
  // Find last bank (highest index) that has that most recent date
  banks.forEach((b,idx)=>{
    ['CEO','CRA','CFO'].forEach(r=>{
      const raw=b.d[RC[r].recent];
      if(!raw)return;
      try{
        const dt=new Date(raw);
        if(!isNaN(dt.getTime())&&Math.abs(dt.getTime()-maxDateMs)<86400000){
          lastBankIdx=idx;
        }
      }catch{}
    });
  });
  if(lastBankIdx>=0&&lastBankIdx+1<banks.length)return lastBankIdx+1;
  if(lastBankIdx>=0)return 0; // wrap around
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
  navIdx=(navIdx-1+navList.length)%navList.length;
  updateNavCounter();showCurrentBank();
}
function nextBank(){
  if(navList.length===0)return;
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

  const emails=['CEO','CRA','CFO'].map(r=>{const dt=mostRecentEmail(d,r);return dt?r+': '+fmtSheetDate(dt):'';}).filter(Boolean);
  const emailRow=emails.length?'<div class="bank-email-row">📧 '+emails.join(' · ')+'</div>':'';

  const div=document.createElement('div');
  div.innerHTML=`
    <div class="bank-header">
      <div style="display:flex;align-items:flex-start;justify-content:space-between">
        <div>
          <div class="bank-title">${esc(d[C.BANK])}</div>
          <div class="bank-meta">Row ${ri} · ${[d[C.CITY],d[C.STATE]].filter(Boolean).join(', ')}${d[C.REG]?' · '+d[C.REG]:''}${d[C.AA]?' · AA: '+String(d[C.AA]).trim():''}</div>
          ${emailRow}
        </div>
        <div class="bank-badges">${badges}</div>
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
  const emails=['CEO','CRA','CFO'].map(r=>{const dt=mostRecentEmail(d,r);return dt?r+': '+fmtSheetDate(dt):'';}).filter(Boolean);
  const emailRow=emails.length?'<div class="email-row">📧 Most recent email — '+emails.join(' · ')+'</div>':'';
  const grid='<div class="leads-grid">'+['CEO','CRA','CFO'].map(r=>buildLeadCard(ri,d,r,dec)).join('')+'</div>';
  body.innerHTML='<div style="padding:12px 14px">'+emailRow+grid+'</div>';
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
        +'<span class="phone-num'+(bad?' bad':'')+'" onclick="copyPhone(\''+esc(base)+'\',this)" title="Click to copy">'+esc(base)+'</span>'
        +(sfx?'<span class="phone-suffix">'+esc(sfx)+'</span>':'')
        +(bad?'<span class="bad-reason">'+esc(reason)+'</span>':'')
        +(cnt>0?'<span class="call-cnt">'+cnt+'x</span>':'')+'</div>'
        +'<div class="phone-btns">'
        +'<button class="btn-copy" onclick="copyPhone(\''+esc(base)+'\',this)">📋</button>'
        +(bad?'<button class="btn-undo" onclick="openUndoFlag('+ri+',\''+role+'\','+pi+')">↩ Undo flag</button>':'')
        +(!bankDeclined?'<button class="btn-log-sm" onclick="openNumModal('+ri+',\''+role+'\')">Log / Flag</button>':'')
        +'</div></div>';
    }).join('')+'</div>';
  }else{phonesHtml='<div class="no-phone">No phone on file</div>';}

  const notesHtml=notes?'<div class="lead-notes">'+esc(notes)+'</div>':'';

  let todayHtml='';
  if(rLogs.length){
    todayHtml='<div class="today-logs">'+rLogs.map(l=>'<div class="today-log"><span class="outcome-chip '+(OC[l.outcome]||'')+'">'+esc(l.outcome)+'</span>'
      +(l.who&&l.who!=='NO CONTACT'?'<span style="font-size:10px;color:var(--text3)">'+esc(l.who)+'</span>':'')
      +'<span class="log-note-text">'+esc(l.noteText||'')+'</span>'
      +'<button class="btn-undo" onclick="openUndoLog('+ri+',\''+role+'\',\''+l.id+'\')">↩ Undo</button></div>').join('')
      +'<button class="btn-del-all" onclick="openUndoAllLogs('+ri+',\''+role+'\')">Undo all today for '+role+'</button></div>';
  }

  let bottomAction='';
  if(isApptHeld(ri)){
    bottomAction='<div class="appt-held-note">Appointment held — bank complete</div>';
  }else if(bankDeclined){
    bottomAction='<div class="declined-note">Bank declined — calling stopped</div>';
    if(isDeclinedToday(ri))bottomAction+='<button class="btn-undo-decline" onclick="openUndoDecline('+ri+')">↩ Undo decline</button>';
  }else{
    bottomAction='<button class="btn-log-call" onclick="openNumModal('+ri+',\''+role+'\')">Log / Flag</button>'
      +'<button class="btn-log-general" onclick="openGenModal('+ri+',\''+role+'\')">+ Log without number</button>';
    if(hasInt)bottomAction+='<button class="btn-appt-held" onclick="setApptHeld('+ri+')">✓ Appointment held</button>';
  }

  const emailBtn='<button class="btn-email-log" onclick="promptEmailLog('+ri+',\''+role+'\')">📧 Log email sent</button>';
  return '<div class="lead-card'+(hasSOS?' sos':'')+(hasInt?' interest':'')+(called?' complete-lead':'')+(bankDeclined?' declined-lead':'')+'"><div class="lead-header"><div class="lead-header-left"><div class="lead-role-row"><span class="role-tag">'+role+'</span>'+statusTag+(outcome?'<span class="outcome-chip '+oc+'">'+esc(outcome)+'</span>':'')+'</div><div class="lead-name">'+esc(name)+'</div>'+(ea?'<div class="lead-ea">EA: '+esc(ea)+'</div>':'')+'</div><div class="lead-header-right">'+(recent?'Last: '+recent+'<br>':'')+times+'x total</div></div><div class="lead-body">'+attn+phonesHtml+notesHtml+todayHtml+bottomAction+'</div></div>';
}

// UNIFIED NUMBER MODAL
function openNumModal(ri,role){
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const d=b.d,rc=RC[role],phones=parsePhones(d[rc.phone]);
  numCtx={ri,role};
  st('nm-title',d[C.BANK]+' — '+role+': '+(d[rc.name]||'—'));
  const regStr=d[C.REG]?d[C.REG]:'';
  const aaStr=d[C.AA]?' · AA: '+d[C.AA]:'';
  const initStr=d[rc.init]?' · Email sent: '+fmtSheetDate(d[rc.init]):'';
  st('nm-sub','Row '+ri+' · '+regStr+aaStr+initStr);

  // Build per-number sections
  let html='';
  if(!phones.length){
    html='<div class="warn-box">No phone numbers on file for this lead.</div>';
  }else{
    phones.forEach((ph,pi)=>{
      const bad=isPhoneBad(ri,role,ph),reason=bad?getBadReason(ri,role,ph):'';
      const nbase=phoneBase(ph),nsfx=phoneSuffix(ph);
      html+='<div class="num-section" id="ns-'+pi+'">';
      html+='<div class="num-section-header">';
      html+='<span class="num-ph'+(bad?' bad':'')+'">'+(bad?'<s>':'')+esc(nbase)+(bad?'</s>':'')+(nsfx?' <span class="num-suffix-display">'+esc(nsfx)+'</span>':'')+' '+(bad?'<span class="bad-reason">'+esc(reason)+'</span>':'')+'</span>';
      html+='<div class="called-toggle"><button class="toggle-btn called-yes" id="cal-yes-'+pi+'" onclick="setCalledState('+pi+',true)">Called</button><button class="toggle-btn called-no active" id="cal-no-'+pi+'" onclick="setCalledState('+pi+',false)">Not called</button></div>';
      html+='</div>';
      // Called section (hidden by default)
      html+='<div id="called-form-'+pi+'" class="called-form hidden">';
      html+='<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;padding:6px 9px;background:var(--surface3);border-radius:7px">';
      html+='<input type="checkbox" id="nm-has-disp-'+pi+'" checked style="width:15px;height:15px" onchange="toggleDispForm('+pi+')"/>';
      html+='<label for="nm-has-disp-'+pi+'" style="font-size:12px;color:var(--text2);cursor:pointer">Log outcome and notes for this number</label>';
      html+='</div>';
      html+='<div id="disp-form-'+pi+'">';
      html+='<div class="form-grid">';
      html+='<div class="form-group"><label>Who answered</label><select id="nm-who-'+pi+'"><option value="NO CONTACT">NO CONTACT</option><option value="GK">GK</option><option value="EA">EA</option><option value="CEO">CEO</option><option value="CRA">CRA</option><option value="CFO">CFO</option></select></div>';
      html+='<div class="form-group"><label>Outcome</label><select id="nm-outcome-'+pi+'" onchange="checkDeclineWarn('+pi+')"><option>No Answer</option><option>Left Message</option><option>Check Back Later</option><option>Expressed Interest</option><option>Follow-up</option><option>Email requested/ Follow-up</option><option>Decline</option><option>Wrong Contact</option><option>Wrong Number</option><option>Not the bank\'s fund type</option><option>Open</option><option>Request To Unsubscribe</option></select></div>';
      html+='<div class="form-group"><label>Spoke to</label><input type="text" id="nm-spoke-'+pi+'" placeholder="Name, title"/></div>';
      html+='<div class="form-group"><label>New number</label><input type="text" id="nm-newnum-'+pi+'" placeholder="e.g. 806-771-3227"/></div>';
      html+='</div>';
      html+='<div class="form-group"><label>Notes</label><textarea id="nm-notes-'+pi+'" rows="2" placeholder="What happened?"></textarea></div>';
      html+='<div id="nm-decline-warn-'+pi+'" class="warn-box hidden">Decline will stop ALL calling at this bank.</div>';
      html+='</div>';
      html+='<div class="form-group"><label>Is this number bad?</label><select id="nm-flag-'+pi+'"><option value="">— number is fine</option>';
      FLAG_OPTIONS.forEach(f=>{html+='<option>'+f+'</option>';});
      html+='</select></div>';
      html+='</div>';
      // Not called section (shown by default)
      html+='<div id="notcalled-form-'+pi+'" class="notcalled-form">';
      html+='<div class="warn-info">Date and times called will not be updated.</div>';
      html+='<div class="form-group"><label>Is this number bad?</label><select id="nm-flagonly-'+pi+'"><option value="">— not flagging</option>';
      FLAG_OPTIONS.forEach(f=>{html+='<option>'+f+'</option>';});
      html+='</select></div>';
      html+='</div>';
      html+='</div>';
    });
  }

  // Detect if any number is shared with other roles
  const otherRoles=['CEO','CRA','CFO'].filter(r=>r!==role);
  const sharedNums={};
  phones.forEach(ph=>{
    const digits=phoneDigits(ph);
    otherRoles.forEach(r=>{
      const otherPhones=parsePhones(d[RC[r].phone]);
      if(otherPhones.some(op=>phoneDigits(op)===digits)){
        if(!sharedNums[ph])sharedNums[ph]=[];
        sharedNums[ph].push(r);
      }
    });
  });
  if(Object.keys(sharedNums).length){
    html+='<div class="shared-num-notice"><strong>Shared numbers detected:</strong><br>';
    Object.entries(sharedNums).forEach(([ph,roles])=>{
      html+=esc(ph)+' is also listed for '+roles.join(', ')+'. Flagging here will flag all roles.<br>';
    });
    html+='</div>';
  }

  // Last 2 notes
  const existingNotes=String(banks.find(x=>x.ri===ri)?.d[RC[role].notes]||'');
  if(existingNotes.trim()){
    const noteLines=existingNotes.trim().split('\n').slice(-3);
    html+='<div class="modal-notes-preview"><div class="mnp-label">Recent notes</div><div class="mnp-text">'+esc(noteLines.join('\n'))+'</div></div>';
  }

  html+='<div class="modal-actions" style="margin-top:14px"><button class="btn-primary" onclick="saveNumModal()">Save</button><button class="btn-cancel" onclick="closeNumModal()">Cancel</button></div>';
  el('nm-body').innerHTML=html;
  el('num-modal').classList.remove('hidden');
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
  const {ri,role}=numCtx;
  const b=banks.find(x=>x.ri===ri),d=b.d,rc=RC[role];
  const phones=parsePhones(d[rc.phone]);
  const dateStr=workDateDisplay();
  const existingNotes=String(d[rc.notes]||'');
  const dateInNotes=existingNotes.includes(dateStr);

  let noteLines=[];
  let anyCall=false,anyFlag=false;
  let lastWho='',lastOutcome='',lastSpoke='',lastNewNum='',lastNotesTxt='',lastPhone='';
  let declineHappened=false;

  // Track all called numbers and their outcomes for best-outcome logic
  const calledNumbers=[];
  const bgTasks=[]; // network calls to fire after modal closes

  for(let pi=0;pi<phones.length;pi++){
    const ph=phones[pi];
    const calledYes=el('cal-yes-'+pi)?.classList.contains('active');

    if(calledYes){
      anyCall=true;
      const hasDisp=el('nm-has-disp-'+pi)?.checked!==false;
      const who=hasDisp?(el('nm-who-'+pi)?.value||'NO CONTACT'):'NO CONTACT';
      const outcome=hasDisp?(el('nm-outcome-'+pi)?.value||'No Answer'):'No Answer';
      const spoke=hasDisp?(el('nm-spoke-'+pi)?.value.trim()||''):'';
      const newNum=el('nm-newnum-'+pi)?.value.trim()||'';
      const notesTxt=hasDisp?(el('nm-notes-'+pi)?.value.trim()||''):'';
      const flagIssue=el('nm-flag-'+pi)?.value||'';

      calledNumbers.push({ph,who,outcome,spoke,newNum,notesTxt,flagIssue,hasDisp});
      lastPhone=ph;
      if(outcome==='Decline')declineHappened=true;

      // Build note line only if there is something to note
      if(hasDisp){
        const parts=[];
        if(notesTxt)parts.push(notesTxt);
        if(spoke)parts.push('Spoke to: '+spoke);
        if(flagIssue)parts.push(ph+' '+flagIssue);
        if(parts.length)noteLines.push(parts.join('. ')+'.');
        // New number goes on its OWN line — never beside a flag keyword
        if(newNum)noteLines.push('New number: '+newNum+'.');
      }

      // Update call counter — each number called = 1 dial
      const cKey=bankId(ri)+'__'+role+'__'+ph;
      calls[cKey]=(calls[cKey]||0)+1;

      // Save flag if issue selected
      if(flagIssue){
        anyFlag=true;
        flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue:flagIssue,undone:false,called:true,date:workDate};
        bgTasks.push(()=>strikethrough(ri,rc.phone,ph));
        bgTasks.push(()=>writeContactUpdate(ri,role,ph,flagIssue,d,phones));
        // Auto-flag same number on other roles if shared
        const digits=phoneDigits(ph);
        for(const otherRole of['CEO','CRA','CFO'].filter(r=>r!==role)){
          const orc=RC[otherRole];
          const otherPhones=parsePhones(d[orc.phone]);
          const matchPh=otherPhones.find(op=>phoneDigits(op)===digits);
          if(matchPh){
            flags[getFlagKey(ri,otherRole,matchPh)]={ri,role:otherRole,phone:matchPh,issue:flagIssue,undone:false,called:false,sharedFrom:role,date:workDate};
            bgTasks.push(()=>strikethrough(ri,orc.phone,matchPh));
          }
        }
      }

      if(newNum){
        // Add new number — never inherit flags from other numbers
        d[rc.phone]=d[rc.phone]?d[rc.phone]+'; '+newNum:newNum;
      }
    } else {
      // Not called — flag only
      const flagIssue=el('nm-flagonly-'+pi)?.value||'';
      if(flagIssue){
        anyFlag=true;
        flags[getFlagKey(ri,role,ph)]={ri,role,phone:ph,issue:flagIssue,undone:false,called:false,date:workDate};
        noteLines.push(ph+' '+flagIssue+'.');
        bgTasks.push(()=>strikethrough(ri,rc.phone,ph));
        bgTasks.push(()=>writeContactUpdate(ri,role,ph,flagIssue,d,phones));
      }
    }
  }

  // Determine best outcome from all called numbers (sheet gets this)
  const OUTCOME_PRIORITY=['Expressed Interest','Email requested/ Follow-up','Follow-up','Left Message','Check Back Later','Decline','Wrong Contact','Wrong Number',"Not the bank's fund type",'Open','Request To Unsubscribe','No Answer'];
  if(calledNumbers.length){
    const best=calledNumbers.filter(c=>c.hasDisp).sort((a,b)=>OUTCOME_PRIORITY.indexOf(a.outcome)-OUTCOME_PRIORITY.indexOf(b.outcome))[0]||calledNumbers[0];
    lastWho=best.who;lastOutcome=best.outcome;lastSpoke=best.spoke;lastNewNum=best.newNum;lastNotesTxt=best.notesTxt;
  }

  if(!anyCall&&!anyFlag){toast('Nothing to save — select called or flag a number','error');return;}

  // Check if any called number was previously flagged and outcome is not bad
  const BAD_OUTCOMES=['No Answer'];
  for(let pi=0;pi<phones.length;pi++){
    const ph=phones[pi];
    const calledYes=el('cal-yes-'+pi)?.classList.contains('active');
    if(!calledYes)continue;
    const outcome=el('nm-outcome-'+pi)?.value||'';
    const fKey=getFlagKey(ri,role,ph);
    if(flags[fKey]&&!flags[fKey].undone&&!BAD_OUTCOMES.includes(outcome)){
      // Number was flagged but now connected — ask user
      if(confirm('The number '+ph+' was previously flagged as bad but you just logged a successful call on it. Remove the flag and note that it connected?')){
        flags[fKey].undone=true;
        // Add note that number connected
        const dateStr=workDateDisplay();
        const existingN=String(d[rc.notes]||'');
        const dateInN=existingN.includes(dateStr);
        const connNote=dateInN?(ph+' connected.'):(dateStr+'\n'+ph+' connected.');
        d[rc.notes]=existingN?(existingN+'\n'+connNote):connNote;
        // Remove strikethrough in sheet (background)
        bgTasks.push(()=>fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({type:'unstrikethrough',sheetId:cfg.sheetId,tabName:cfg.tab,row:ri,col:rc.phone,phone:ph})}));
      }
    }
  }

  // Save snapshot before update
  const before={recent:d[rc.recent]||'',times:String(parseInt(d[rc.times])||0),outcome:d[rc.outcome]||'',who:d[rc.who]||'',notes:existingNotes};

  // Build full note entry
  let noteEntry='';
  if(noteLines.length){
    noteEntry=dateInNotes?noteLines.join('\n'):(dateStr+'\n'+noteLines.join('\n'));
    d[rc.notes]=existingNotes?existingNotes+'\n'+noteEntry:noteEntry;
  }

  if(anyCall){
    d[rc.recent]=dateStr;
    d[rc.times]=String((parseInt(d[rc.times])||0)+1);
    if(lastOutcome)d[rc.outcome]=lastOutcome;
    if(lastWho)d[rc.who]=lastWho;
  }

  // Save log entry
  const logEntry={id:genId(),ri,role,who:lastWho||'NO CONTACT',outcome:lastOutcome||'',noteEntry,noteText:noteLines.join(' '),notesTxt:lastNotesTxt||'',spokeTo:lastSpoke||'',newNum:lastNewNum||'',phone:lastPhone||'',called:anyCall,date:workDate,before,deleted:false};
  const key=logKey(ri);if(!logs[key])logs[key]=[];logs[key].push(logEntry);
  saveLogs();saveFlags();saveCalls();

  // Write to sheet (background — don't block modal close)
  const updates=[{row:ri,col:rc.notes,value:d[rc.notes]||''}];
  if(anyCall){
    updates.push({row:ri,col:rc.recent,value:d[rc.recent]});
    updates.push({row:ri,col:rc.times,value:d[rc.times]});
    updates.push({row:ri,col:rc.outcome,value:d[rc.outcome]});
    updates.push({row:ri,col:rc.who,value:d[rc.who]});
    if(lastNewNum)updates.push({row:ri,col:rc.phone,value:d[rc.phone]});
  }

  if(declineHappened){
    const decLog={id:genId(),ri,role,who:lastWho,outcome:'Decline',noteEntry:'',noteText:'Decline',called:true,date:workDate,before:{},deleted:false,isDecline:true};
    if(!logs[key])logs[key]=[];logs[key].push(decLog);saveLogs();
  }

  // Close modal and refresh UI IMMEDIATELY — everything is already in localStorage
  renderStats();closeNumModal();rebuildCard(ri,declineHappened);
  toast(anyCall&&anyFlag?'Call logged + number flagged':anyCall?'Call logged ✓':'Number flagged','success');

  // Fire all network calls in the background (not awaited)
  writeSheet(updates);
  bgTasks.forEach(task=>{try{task();}catch(e){console.error('bg task error',e);}});
}

// GENERAL LOG MODAL
function openGenModal(ri,role){
  genCtx={ri,role};
  const b=banks.find(x=>x.ri===ri);if(!b)return;
  const rc=RC[role];
  st('gm-title',b.d[C.BANK]+' — '+role+': '+(b.d[rc.name]||'—'));
  st('gm-sub','Row '+ri+' · '+(b.d[C.REG]||'')+(b.d[C.AA]?' · AA: '+b.d[C.AA]:'')+(b.d[rc.init]?' · Email sent: '+fmtSheetDate(b.d[rc.init]):''));
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
  if(notesTxt)parts.push(notesTxt);if(spoke)parts.push('Spoke to: '+spoke);if(newNum)parts.push('New number: '+newNum);
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
  renderStats();rebuildCard(ri,false);toast('Entry undone','success');
}

async function undoAllLogs(ri,role){
  const key=logKey(ri);const today=(logs[key]||[]).filter(l=>l.role===role&&!l.deleted);
  const first=today[0];today.forEach(l=>l.deleted=true);saveLogs();
  const b=banks.find(x=>x.ri===ri),rc=RC[role];
  if(first&&first.before){b.d[rc.recent]=first.before.recent;b.d[rc.times]=first.before.times;b.d[rc.outcome]=first.before.outcome;b.d[rc.who]=first.before.who;b.d[rc.notes]=first.before.notes;}
  await writeSheet([{row:ri,col:rc.notes,value:b.d[rc.notes]},{row:ri,col:rc.times,value:b.d[rc.times]},{row:ri,col:rc.outcome,value:b.d[rc.outcome]},{row:ri,col:rc.who,value:b.d[rc.who]},{row:ri,col:rc.recent,value:b.d[rc.recent]}]);
  renderStats();rebuildCard(ri,false);toast('All entries undone','success');
}

async function undoFlag(ri,role,phone){
  const fKey=getFlagKey(ri,role,phone);if(!flags[fKey])return;
  flags[fKey].undone=true;saveFlags();
  const b=banks.find(x=>x.ri===ri),rc=RC[role];
  // Remove flag note line from notes
  const notes=String(b.d[rc.notes]||'').split('\n').filter(l=>!l.includes(phoneDigits(phone).slice(0,6))).join('\n').trim();
  b.d[rc.notes]=notes;
  await writeSheet([{row:ri,col:rc.notes,value:notes}]);
  // Remove strikethrough from sheet
  try{
    await fetch(SCRIPT_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'unstrikethrough',sheetId:cfg.sheetId,tabName:cfg.tab,row:ri,col:rc.phone,phone})});
  }catch(e){console.error('Unstrikethrough error',e);}
  await removeContactUpdate(ri,role,phone,b.d);
  renderStats();rebuildCard(ri,false);toast('Flag removed','success');
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
        rowData:{rowNum:ri,bankName:bankData[C.BANK]||'',leadTitle:combinedTitle,leadName:combinedName,issue:phone+' — '+issue}})});
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
function showEOD(){
  const all=allLogsForDate();
  const calledLogs=all.filter(l=>l.called);
  const appDials=calledLogs.length;
  // CEO definition: reached = an actual contact answered (EA, CEO, CFO, CRA) — NOT GK or NO CONTACT
  const REACHED_WHO=['EA','CEO','CFO','CRA'];
  const banksReached=new Set(calledLogs.filter(l=>REACHED_WHO.includes(l.who)).map(l=>l.ri)).size;
  const peopleReached=new Set(calledLogs.filter(l=>REACHED_WHO.includes(l.who)).map(l=>l.ri+'_'+l.role)).size;

  // Connects — banks where real person reached, priority: Expressed Interest > Left Message > Check Back Later > No Answer
  const PRIORITY=['Expressed Interest','Email requested/ Follow-up','Follow-up','Left Message','Check Back Later','No Answer'];
  // Connects = banks where someone actually answered (not NO CONTACT)
  const connectMap={};
  calledLogs.filter(l=>REACHED_WHO.includes(l.who)).forEach(l=>{
    const key=l.ri;
    if(!connectMap[key]||PRIORITY.indexOf(l.outcome)<PRIORITY.indexOf(connectMap[key].outcome)){
      const b=banks.find(x=>x.ri===l.ri);
      if(b){
        // Build clean one-line note — only what was typed, no duplicates
        const parts=[];
        if(l.outcome==='Expressed Interest')parts.push('Appointment scheduled');
        if(l.notesTxt&&l.notesTxt.trim())parts.push(l.notesTxt.trim().replace(/\.+$/,''));
        if(l.spokeTo&&l.spokeTo.trim())parts.push('Spoke to '+l.spokeTo.trim().replace(/\.+$/,''));
        if(l.newNum&&l.newNum.trim())parts.push('New number: '+l.newNum.trim());
        const cleanNote=parts.length?parts.join('. '):l.outcome;
        connectMap[key]={row:l.ri,bank:b.d[C.BANK],outcome:l.outcome,note:cleanNote};
      }
    }
  });
  const connects=Object.values(connectMap);

  // Declined today
  const declinedToday=[],seenDec=new Set();
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
    t+='\nToday I reached '+peopleReached+' EA/CRA/CFO/CEO\n\n';
    connects.forEach(c=>{
      const note=c.note.replace(/\.+$/,'').trim();
      t+='Row '+c.row+' — '+c.bank+' — '+note+'.\n';
    });
    if(declinedToday.length){t+='\nBanks Declined Today\n\n';declinedToday.forEach(x=>{t+='Row '+x.row+' — '+x.bank+' — declined by '+x.role+'\n';});}
    if(Object.keys(sosByBank).length){
      t+='\nFlagged Numbers Report\n\n';
      Object.values(sosByBank).forEach(sb=>{
        t+='Row '+sb.row+' — '+sb.bank+'\n';
        const byRole={};sb.entries.forEach(e=>{if(!byRole[e.role])byRole[e.role]=[];byRole[e.role].push(e);});
        // Group shared numbers
        const seen={};
        Object.entries(byRole).forEach(([role,entries])=>{
          entries.forEach(e=>{
            if(!seen[e.phone]){seen[e.phone]={roles:[],issue:e.issue};}
            else if(!seen[e.phone].roles.includes(role)){seen[e.phone].roles.push(role);}
          });
        });
        Object.entries(byRole).forEach(([role,entries])=>{
          entries.forEach(e=>{
            const sh=seen[e.phone];
            if(sh&&sh.roles.length>1){
              if(sh.roles[0]===role)t+=sh.roles.join(' & ')+': '+e.phone+' | '+e.issue+'\n';
            }else{t+=role+': '+e.phone+' | '+e.issue+'\n';}
          });
        });
        t+='\n';
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

function showSettings(){sv('set-name',cfg.name||'');sv('set-sheet-id',cfg.sheetId||'');sv('set-tab',cfg.tab||'');sv('set-update-id',cfg.updateSheetId||'');sv('set-update-tab',cfg.updateTab||'');sv('set-api-key',cfg.apiKey||'');el('settings-modal').classList.remove('hidden');}
function closeSettings(){el('settings-modal').classList.add('hidden');}
function saveSettings(){
  cfg.name=gv('set-name').trim();cfg.sheetId=gv('set-sheet-id').trim();cfg.tab=gv('set-tab').trim();cfg.updateSheetId=gv('set-update-id').trim();cfg.updateTab=gv('set-update-tab').trim();cfg.apiKey=gv('set-api-key').trim();
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

function el(id){return document.getElementById(id);}
function gv(id){return el(id)?.value||'';}
function sv(id,v){const e=el(id);if(e)e.value=v||'';}
function st(id,v){const e=el(id);if(e)e.textContent=v;}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2);}
function show(id){['setup-screen','main-app'].forEach(s=>{const e=el(s);if(e)e.classList.toggle('hidden',s!==id);});}
function fmtSheetDate(v){if(!v)return'';try{const d=new Date(v);return isNaN(d)?String(v):(d.getMonth()+1)+'/'+d.getDate()+'/'+d.getFullYear();}catch{return String(v);}}
function toast(msg,type=''){const e=el('toast');e.textContent=msg;e.className='toast'+(type?' '+type:'');e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),2500);}
