/* The Ultimate Shift Engine — attachments
   Resume upload, ticket attachments, job pack.
   Additive: touches nothing in index.html's own script.
   Files go in IndexedDB so localStorage stays free for settings. */

(function(){
  const $=id=>document.getElementById(id);
  const DB='shiftEngineFiles', STORE='files', MAX=15*1024*1024;

  /* ---------- store ---------- */
  let dbp=null;
  function db(){
    if(dbp) return dbp;
    dbp=new Promise((res,rej)=>{
      const r=indexedDB.open(DB,1);
      r.onupgradeneeded=()=>{const d=r.result;
        if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)};
      r.onsuccess=()=>res(r.result);
      r.onerror  =()=>rej(r.error);
    });
    return dbp;
  }
  const op=(mode,fn)=>db().then(d=>new Promise((res,rej)=>{
    const t=d.transaction(STORE,mode), q=fn(t.objectStore(STORE));
    t.oncomplete=()=>res(q&&q.result); t.onerror=()=>rej(t.error);
  }));
  const put =(k,v)=>op('readwrite',s=>s.put(v,k));
  const get =k    =>op('readonly', s=>s.get(k));
  const del =k    =>op('readwrite',s=>s.delete(k));
  const keys=()   =>op('readonly', s=>s.getAllKeys());

  const sizeTxt=b=>b>1048576?(b/1048576).toFixed(1)+' MB':Math.round(b/1024)+' KB';

  /* display:none can stop the picker opening on iOS. Visually-hidden does not. */
  const HIDE='position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)';
  const ACCEPT_DOC='application/pdf,image/*';
  const ACCEPT_CV ='application/pdf,image/*,application/msword,'+
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function openBlob(rec){
    const u=URL.createObjectURL(rec.blob);
    window.open(u,'_blank');
    setTimeout(()=>URL.revokeObjectURL(u),60000);
  }

  /* ---------- resume ---------- */
  const rIn=$('resumeIn'), rBox=$('resumeBox'), rClear=$('resumeClear');
  const rLabel=document.querySelector('label[for="resumeIn"]');

  if(rIn){
    rIn.style.cssText=HIDE;
    rIn.accept=ACCEPT_CV;
    rIn.addEventListener('change',()=>{
      const f=rIn.files&&rIn.files[0];
      rIn.value='';
      if(!f) return;
      if(f.size>MAX){
        rBox.innerHTML='<div class="empty">That file is '+sizeTxt(f.size)+
          '. Keep it under 15 MB — export a PDF rather than photographing a printout.</div>';
        return;
      }
      put('resume',{name:f.name,size:f.size,type:f.type,saved:Date.now(),blob:f})
        .then(renderResume)
        .catch(()=>{ rBox.innerHTML='<div class="empty">Could not save to this phone. '+
          'If you are in Private Browsing, switch to a normal tab.</div>'; });
    });
  }
  if(rClear) rClear.addEventListener('click',()=>del('resume').then(renderResume));

  function renderResume(){
    if(!rBox) return Promise.resolve();
    return get('resume').then(rec=>{
      if(!rec){
        rBox.innerHTML='<div class="empty">Nothing uploaded yet.</div>';
        if(rClear) rClear.style.display='none';
        if(rLabel) rLabel.textContent='Upload resume';
        return;
      }
      rBox.innerHTML=
        '<ul class="plain"><li>'+
          '<span class="fname">'+rec.name+
            '<div class="fmeta">Saved '+new Date(rec.saved).toLocaleDateString('en-AU',
              {day:'numeric',month:'short',year:'numeric'})+'</div></span>'+
          '<span class="fmeta">'+sizeTxt(rec.size)+'</span>'+
          '<a class="open" href="#" id="resumeOpen">Open</a>'+
        '</li></ul>';
      $('resumeOpen').addEventListener('click',e=>{e.preventDefault();openBlob(rec)});
      if(rClear) rClear.style.display='block';
      if(rLabel) rLabel.textContent='Replace resume';
    }).catch(()=>{});
  }

  /* ---------- ticket attachments ----------
     renderTickets() rebuilds #ticketList whenever a date changes,
     so watch it and re-inject instead of editing the main script. */
  const tList=$('ticketList');

  function ticketName(row){
    const n=row.querySelector('.tn2');
    if(!n) return null;
    const first=n.childNodes[0];
    return first&&first.nodeValue?first.nodeValue.trim():null;
  }

  function decorate(){
    if(!tList) return;
    tList.querySelectorAll('.tick').forEach(row=>{
      if(row.querySelector('.tickActions')) return;
      const name=ticketName(row); if(!name) return;
      const key='ticket:'+name;

      const bar=document.createElement('div');
      bar.className='tickActions';
      bar.innerHTML=
        '<label>Attach<input type="file" style="'+HIDE+'" accept="'+ACCEPT_DOC+'"></label>'+
        '<button type="button" data-a="open">Open</button>'+
        '<button type="button" data-a="del">Remove</button>';

      const note=document.createElement('div');
      note.className='attached';

      row.appendChild(bar); row.appendChild(note);

      const lab =bar.querySelector('label');
      const file=bar.querySelector('input');
      const oBtn=bar.querySelector('[data-a=open]');
      const dBtn=bar.querySelector('[data-a=del]');

      function paint(){
        return get(key).then(rec=>{
          if(rec){
            lab.classList.add('has'); lab.firstChild.nodeValue='Replace';
            oBtn.style.display=''; dBtn.style.display='';
            note.textContent=rec.name+' · '+sizeTxt(rec.size);
            note.style.display='';
          }else{
            lab.classList.remove('has'); lab.firstChild.nodeValue='Attach';
            oBtn.style.display='none'; dBtn.style.display='none';
            note.style.display='none';
          }
        }).catch(()=>{});
      }

      file.addEventListener('change',()=>{
        const f=file.files&&file.files[0]; file.value='';
        if(!f) return;
        if(f.size>MAX){ note.style.display=''; note.textContent='Too big — keep it under 15 MB'; return; }
        put(key,{name:f.name,size:f.size,type:f.type,saved:Date.now(),blob:f})
          .then(()=>{paint();renderPack()});
      });
      oBtn.addEventListener('click',()=>get(key).then(r=>r&&openBlob(r)));
      dBtn.addEventListener('click',()=>del(key).then(()=>{paint();renderPack()}));

      paint().then(renderPack);
    });
  }

  if(tList){
    decorate();
    new MutationObserver(()=>decorate()).observe(tList,{childList:true});
  }

  /* ---------- job pack ---------- */
  const packList=$('packList'), packMsg=$('packMsg'), quota=$('quotaLine'), sendBtn=$('sendPack');

  function collect(){
    return keys().then(ks=>Promise.all(ks.map(k=>get(k).then(r=>r?{key:k,rec:r}:null))))
                 .then(a=>a.filter(Boolean));
  }

  function ticketNames(){
    if(!tList) return [];
    return [...tList.querySelectorAll('.tick')].map(ticketName).filter(Boolean);
  }

  function renderPack(){
    if(!packList) return;
    collect().then(items=>{
      const rows=[];
      const cv=items.find(i=>i.key==='resume');
      rows.push(cv?'<b>Resume</b> — '+cv.rec.name:'Resume — not uploaded');
      const tickets=items.filter(i=>i.key.indexOf('ticket:')===0);
      const names=ticketNames();
      (names.length?names:tickets.map(t=>t.key.slice(7))).forEach(n=>{
        const hit=tickets.find(t=>t.key.slice(7)===n);
        rows.push(hit?'<b>'+n+'</b> — '+hit.rec.name:n+' — nothing attached');
      });
      rows.push('<b>Operator profile</b> — from your machines and hours');
      packList.innerHTML=rows.join('<br>');
      const total=items.reduce((a,i)=>a+i.rec.size,0);
      if(quota) quota.textContent=items.length
        ? items.length+' file'+(items.length>1?'s':'')+' · '+sizeTxt(total)+' stored on this phone'
        : 'No files attached yet.';
    }).catch(()=>{});
  }

  function profileText(){
    const el=$('profileOut');
    return el?el.innerText:'';
  }

  if(sendBtn) sendBtn.addEventListener('click',async()=>{
    packMsg.textContent='';
    const items=await collect();
    if(!items.length){
      packMsg.textContent='Nothing attached yet — upload your resume and tickets first.';
      return;
    }
    const files=items.map(i=>new File([i.rec.blob],i.rec.name,
      {type:i.rec.type||'application/octet-stream'}));
    const text='Operator profile\n\n'+profileText()+'\n\nFrom The Ultimate Shift Engine';

    try{
      if(navigator.canShare&&navigator.canShare({files})){
        await navigator.share({title:'Job pack',text,files});
        return;
      }
      if(navigator.share){
        await navigator.share({title:'Job pack',text});
        packMsg.textContent='Profile sent. This browser will not attach files to a share — open each one above and attach it to the email.';
        return;
      }
    }catch(e){ if(e&&e.name==='AbortError') return; }

    try{
      await navigator.clipboard.writeText(text);
      packMsg.textContent='Profile copied. Open each file above and attach it to your email.';
    }catch(e){
      packMsg.textContent='Open each file above and attach it to your email.';
    }
  });

  /* ---------- boot ---------- */
  renderResume().then(renderPack);
})();
