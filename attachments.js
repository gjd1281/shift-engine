/* The Ultimate Shift Engine — attachments  v3
   Resume upload, ticket attachments, job pack.
   Additive: touches nothing in index.html's own script.
   Same-filename replacement for attachments.js — no index.html change.

   ---------------------------------------------------------------------------
   WHAT CHANGED IN v3, AND WHY

   1. OPEN DID NOTHING ON TICKETS.
      v1/v2 read the file out of IndexedDB and THEN called window.open(). That
      read is asynchronous, so by the time the window is asked for, iOS has
      closed the gesture window that started with the tap, and Safari blocks it
      without an error. Files now display in an in-app viewer instead: setting
      an <img>/<iframe> src needs no gesture, so the async read is harmless.
      A real <a download> and the native share sheet sit inside that viewer,
      and both are driven by the user's own tap, so both survive.

   2. THE APP STOPPED OPENING ONCE FILES WERE ADDED.
      renderPack() loaded EVERY stored record — blobs included — purely to
      print names and sizes, and it re-ran on every repaint of the ticket list.
      Five 4 MB photos meant ~20 MB pulled into memory over and over, which is
      enough to have iOS kill the tab, and far worse in a home-screen PWA where
      the memory ceiling is lower. Metadata now lives in its own object store,
      so listing files never touches a blob. Blobs are read on tap and on tap
      only.

   3. PHOTOS WERE STORED AT FULL CAMERA RESOLUTION.
      A 12 MP ticket photo is ~4 MB and completely unnecessary — 1600px on the
      long edge reads a licence perfectly and lands around 300-500 KB. Images
      are downscaled before they are stored. This is the root cause behind (2):
      fix the size and the memory pressure never builds in the first place.

   MIGRATION
      Existing installs are upgraded silently on first load: the metadata store
      is built from whatever is already saved. Nobody has to re-add anything.
      Already-stored full-size photos stay full-size — they are only shrunk if
      re-attached — but they are no longer loaded to render the list, which is
      what was doing the damage.
   --------------------------------------------------------------------------- */

(function(){
  const $=id=>document.getElementById(id);

  /* Bumped to 2 to add the `meta` store. onupgradeneeded handles both the
     fresh-install and the upgrade-from-v1 case. */
  const DB='shiftEngineFiles', FILES='files', META='meta', DBV=2;
  const MAX=15*1024*1024;          // hard ceiling on what we accept at all
  const IMG_MAX_EDGE=1600;         // long edge after downscaling
  const IMG_QUALITY=0.82;          // JPEG quality — plenty for documents

  /* ---------- store ---------------------------------------------------- */
  let dbp=null;
  function db(){
    if(dbp) return dbp;
    dbp=new Promise((res,rej)=>{
      const r=indexedDB.open(DB,DBV);
      r.onupgradeneeded=()=>{
        const d=r.result;
        if(!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES);
        if(!d.objectStoreNames.contains(META))  d.createObjectStore(META);
      };
      r.onsuccess=()=>res(r.result);
      r.onerror  =()=>rej(r.error);
    });
    return dbp;
  }

  /* One small helper per operation. Keeping them separate is more code than a
     generic wrapper but makes it obvious at every call site whether a blob is
     being touched — which is the whole point of this rewrite. */
  function req(store,mode,fn){
    return db().then(d=>new Promise((res,rej)=>{
      const t=d.transaction(store,mode);
      const q=fn(t.objectStore(store));
      t.oncomplete=()=>res(q?q.result:undefined);
      t.onerror   =()=>rej(t.error);
      t.onabort   =()=>rej(t.error);
    }));
  }

  const getMeta   = k => req(META ,'readonly' ,s=>s.get(k));
  const allMeta   = ()=> req(META ,'readonly' ,s=>s.getAll());
  const allMetaKeys=()=> req(META ,'readonly' ,s=>s.getAllKeys());
  const getBlob   = k => req(FILES,'readonly' ,s=>s.get(k));   // ONLY on tap
  const delMeta   = k => req(META ,'readwrite',s=>s.delete(k));
  const delBlob   = k => req(FILES,'readwrite',s=>s.delete(k));

  /** Write the blob and its metadata. Two transactions, blob first, so a
      failure can never leave a meta row pointing at nothing. */
  function putFile(key,meta,blob){
    return req(FILES,'readwrite',s=>s.put(blob,key))
      .then(()=>req(META,'readwrite',s=>s.put(meta,key)));
  }
  function removeFile(key){
    return delBlob(key).then(()=>delMeta(key)).catch(()=>{});
  }

  /** Build the metadata store from v1 records on first run after the upgrade.
      v1 stored {name,size,type,saved,blob} under one key in `files`. */
  function migrate(){
    return allMetaKeys().then(mk=>{
      if(mk && mk.length) return;                       // already migrated
      return req(FILES,'readonly',s=>s.getAllKeys()).then(fk=>{
        if(!fk || !fk.length) return;
        return Promise.all(fk.map(k=>getBlob(k).then(rec=>{
          if(!rec) return;
          // v1 record, or a v3 raw blob written by a half-finished upgrade.
          const meta = rec.blob
            ? {name:rec.name,size:rec.size,type:rec.type,saved:rec.saved}
            : {name:'file',size:rec.size||0,type:rec.type||'',saved:Date.now()};
          return req(META,'readwrite',s=>s.put(meta,k));
        })));
      });
    }).catch(()=>{});
  }

  /** v1 stored the blob wrapped in the record; v3 stores it bare. Accept both
      so migrated installs keep working without a re-upload. */
  const unwrap = rec => (rec && rec.blob) ? rec.blob : rec;

  const sizeTxt=b=>b>1048576?(b/1048576).toFixed(1)+' MB':Math.round(b/1024)+' KB';

  /* display:none can stop the picker opening on iOS. Visually-hidden does not. */
  const HIDE='position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0)';
  const ACCEPT_DOC='application/pdf,image/*';
  const ACCEPT_CV ='application/pdf,image/*,application/msword,'+
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  /* ---------- image downscaling ----------------------------------------
     Runs before anything is stored. PDFs and documents pass straight through;
     only raster images are touched. If anything goes wrong we return the file
     untouched rather than failing the upload. */
  function shrinkImage(file){
    return new Promise(resolve=>{
      if(!/^image\//.test(file.type) || /svg/i.test(file.type)) return resolve(file);
      const url=URL.createObjectURL(file);
      const img=new Image();
      img.onload=()=>{
        try{
          const long=Math.max(img.naturalWidth,img.naturalHeight);
          const scale=Math.min(1, IMG_MAX_EDGE/long);
          // Already small and already light — leave it alone.
          if(scale===1 && file.size<900*1024){ URL.revokeObjectURL(url); return resolve(file); }
          const w=Math.max(1,Math.round(img.naturalWidth *scale));
          const h=Math.max(1,Math.round(img.naturalHeight*scale));
          const c=document.createElement('canvas');
          c.width=w; c.height=h;
          const ctx=c.getContext('2d');
          ctx.drawImage(img,0,0,w,h);
          c.toBlob(b=>{
            URL.revokeObjectURL(url);
            if(b && b.size<file.size){
              const nm=file.name.replace(/\.[^.]+$/,'')+'.jpg';
              resolve(new File([b],nm,{type:'image/jpeg',lastModified:Date.now()}));
            }else{
              resolve(file);
            }
          },'image/jpeg',IMG_QUALITY);
        }catch(e){ URL.revokeObjectURL(url); resolve(file); }
      };
      img.onerror=()=>{ URL.revokeObjectURL(url); resolve(file); };
      img.src=url;
    });
  }

  /** Shrink, then store. Returns the metadata that was written. */
  function acceptFile(key,file){
    return shrinkImage(file).then(f=>{
      const meta={name:f.name,size:f.size,type:f.type,saved:Date.now()};
      return putFile(key,meta,f).then(()=>meta);
    });
  }

  /* ---------- in-app viewer --------------------------------------------
     Replaces window.open(). Built once, lazily, and injected at the end of
     <body> so it sits above the app's own chrome. The object URL is created
     when a file is shown and revoked when the viewer closes, so exactly one
     blob is ever held in memory. */
  let vEl=null, vURL=null, vFile=null;

  function buildViewer(){
    if(vEl) return vEl;
    const css=document.createElement('style');
    css.textContent=
      '#fileViewer{position:fixed;inset:0;z-index:9999;display:none;'+
        'background:#0b0f0dF2;flex-direction:column}'+
      '#fileViewer.on{display:flex}'+
      '#fvBar{display:flex;gap:8px;align-items:center;padding:10px 12px;'+
        'background:#111917;border-bottom:1px solid #2a3a34;flex:0 0 auto}'+
      '#fvName{flex:1;color:#e8f2ee;font:600 13px/1.3 system-ui,sans-serif;'+
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'+
      '#fvBar button,#fvBar a{font:600 13px/1 system-ui,sans-serif;'+
        'padding:9px 12px;border-radius:8px;border:1px solid #33534a;'+
        'background:#16241f;color:#e8f2ee;text-decoration:none;cursor:pointer}'+
      '#fvBody{flex:1;overflow:auto;display:flex;align-items:center;'+
        'justify-content:center;padding:10px}'+
      '#fvBody img{max-width:100%;max-height:100%;object-fit:contain}'+
      '#fvBody iframe{width:100%;height:100%;border:0;background:#fff}'+
      '#fvNote{color:#9db3aa;font:13px/1.5 system-ui,sans-serif;text-align:center;padding:20px}';
    document.head.appendChild(css);

    vEl=document.createElement('div');
    vEl.id='fileViewer';
    vEl.innerHTML=
      '<div id="fvBar">'+
        '<span id="fvName"></span>'+
        '<a id="fvOpen" target="_blank" rel="noopener">Full screen</a>'+
        '<button type="button" id="fvShare">Share</button>'+
        '<button type="button" id="fvClose">Close</button>'+
      '</div>'+
      '<div id="fvBody"></div>';
    document.body.appendChild(vEl);

    $('fvClose').addEventListener('click',closeViewer);

    /* Share runs from the user's own tap, so the gesture is intact and the
       native sheet is allowed. */
    $('fvShare').addEventListener('click',async()=>{
      if(!vFile) return;
      try{
        if(navigator.canShare && navigator.canShare({files:[vFile]})){
          await navigator.share({files:[vFile],title:vFile.name});
        }else if(navigator.share){
          await navigator.share({title:vFile.name,text:vFile.name});
        }
      }catch(e){ /* user cancelled, or sharing unsupported — nothing to do */ }
    });
    return vEl;
  }

  function closeViewer(){
    if(!vEl) return;
    vEl.classList.remove('on');
    $('fvBody').innerHTML='';
    if(vURL){ URL.revokeObjectURL(vURL); vURL=null; }
    vFile=null;
  }

  /** Show one stored file. Reads the blob on demand — the async read is fine
      here because nothing we do afterwards needs the tap's gesture. */
  function showFile(key,fallbackName){
    buildViewer();
    Promise.all([getBlob(key),getMeta(key)]).then(([raw,meta])=>{
      const blob=unwrap(raw);
      if(!blob){ return; }
      const name=(meta&&meta.name)||fallbackName||'file';
      const type=blob.type||(meta&&meta.type)||'';

      if(vURL) URL.revokeObjectURL(vURL);
      vURL=URL.createObjectURL(blob);
      vFile=new File([blob],name,{type:type||'application/octet-stream'});

      $('fvName').textContent=name;
      const a=$('fvOpen');
      a.href=vURL;
      a.setAttribute('download',name);

      const body=$('fvBody');
      if(/^image\//.test(type)){
        body.innerHTML='<img alt="">';
        body.querySelector('img').src=vURL;
      }else if(/pdf/i.test(type)){
        // iOS renders PDFs in an iframe inconsistently, so the Full screen
        // link above is the reliable path and stays visible either way.
        body.innerHTML='<iframe title="document"></iframe>';
        body.querySelector('iframe').src=vURL;
      }else{
        body.innerHTML='<div id="fvNote">'+name+'<br><br>'+
          'This file type cannot be previewed here.<br>'+
          'Use Full screen or Share to open it.</div>';
      }
      vEl.classList.add('on');
    }).catch(()=>{});
  }

  /* ---------- resume ---------------------------------------------------- */
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
      rBox.innerHTML='<div class="empty">Saving…</div>';
      acceptFile('resume',f)
        .then(renderResume)
        .catch(()=>{ rBox.innerHTML='<div class="empty">Could not save to this phone. '+
          'If you are in Private Browsing, switch to a normal tab.</div>'; });
    });
  }
  if(rClear) rClear.addEventListener('click',()=>removeFile('resume').then(()=>{
    renderResume(); renderPack();
  }));

  /* Renders from METADATA only — never pulls the blob. */
  function renderResume(){
    if(!rBox) return Promise.resolve();
    return getMeta('resume').then(meta=>{
      if(!meta){
        rBox.innerHTML='<div class="empty">Nothing uploaded yet.</div>';
        if(rClear) rClear.style.display='none';
        if(rLabel) rLabel.textContent='Upload resume';
        return;
      }
      rBox.innerHTML=
        '<ul class="plain"><li>'+
          '<span class="fname">'+meta.name+
            '<div class="fmeta">Saved '+new Date(meta.saved).toLocaleDateString('en-AU',
              {day:'numeric',month:'short',year:'numeric'})+'</div></span>'+
          '<span class="fmeta">'+sizeTxt(meta.size)+'</span>'+
          '<a class="open" href="#" id="resumeOpen">Open</a>'+
        '</li></ul>';
      $('resumeOpen').addEventListener('click',e=>{
        e.preventDefault(); showFile('resume',meta.name);
      });
      if(rClear) rClear.style.display='block';
      if(rLabel) rLabel.textContent='Replace resume';
    }).catch(()=>{});
  }

  /* ---------- ticket attachments ----------------------------------------
     renderTickets() in index.html rebuilds #ticketList whenever a date
     changes, so we watch it and re-inject rather than editing the main script. */
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

      /* Metadata only. This runs for every ticket on every repaint, which is
         precisely why it must not touch blobs. */
      function paint(){
        return getMeta(key).then(meta=>{
          if(meta){
            lab.classList.add('has'); lab.firstChild.nodeValue='Replace';
            oBtn.style.display=''; dBtn.style.display='';
            note.textContent=meta.name+' · '+sizeTxt(meta.size);
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
        if(f.size>MAX){
          note.style.display=''; note.textContent='Too big — keep it under 15 MB';
          return;
        }
        note.style.display=''; note.textContent='Saving…';
        acceptFile(key,f)
          .then(()=>{ paint(); renderPack(); })
          .catch(()=>{ note.textContent='Could not save that file.'; });
      });

      oBtn.addEventListener('click',()=>showFile(key,name));
      dBtn.addEventListener('click',()=>removeFile(key).then(()=>{paint();renderPack()}));

      paint().then(renderPack);
    });
  }

  if(tList){
    decorate();
    new MutationObserver(()=>decorate()).observe(tList,{childList:true});
  }

  /* ---------- job pack --------------------------------------------------- */
  const packList=$('packList'), packMsg=$('packMsg'), quota=$('quotaLine'), sendBtn=$('sendPack');

  function ticketNames(){
    if(!tList) return [];
    return [...tList.querySelectorAll('.tick')].map(ticketName).filter(Boolean);
  }

  /* Metadata only — this is the function that used to load every blob. */
  function renderPack(){
    if(!packList) return;
    Promise.all([allMetaKeys(),allMeta()]).then(([ks,ms])=>{
      const items=ks.map((k,i)=>({key:k,meta:ms[i]})).filter(x=>x.meta);
      const rows=[];
      const cv=items.find(i=>i.key==='resume');
      rows.push(cv?'<b>Resume</b> — '+cv.meta.name:'Resume — not uploaded');

      const tickets=items.filter(i=>i.key.indexOf('ticket:')===0);
      const names=ticketNames();
      (names.length?names:tickets.map(t=>t.key.slice(7))).forEach(n=>{
        const hit=tickets.find(t=>t.key.slice(7)===n);
        rows.push(hit?'<b>'+n+'</b> — '+hit.meta.name:n+' — nothing attached');
      });
      rows.push('<b>Operator profile</b> — from your machines and hours');
      packList.innerHTML=rows.join('<br>');

      const total=items.reduce((a,i)=>a+(i.meta.size||0),0);
      if(quota) quota.textContent=items.length
        ? items.length+' file'+(items.length>1?'s':'')+' · '+sizeTxt(total)+' stored on this phone'
        : 'No files attached yet.';
    }).catch(()=>{});
  }

  function profileText(){
    const el=$('profileOut');
    return el?el.innerText:'';
  }

  /* Sending is the one place blobs legitimately all come into memory at once,
     because the share sheet needs the actual files. It happens on an explicit
     tap, once, rather than on every repaint. */
  if(sendBtn) sendBtn.addEventListener('click',async()=>{
    packMsg.textContent='';
    let ks,ms;
    try{ [ks,ms]=await Promise.all([allMetaKeys(),allMeta()]); }
    catch(e){ packMsg.textContent='Could not read your files.'; return; }

    const items=ks.map((k,i)=>({key:k,meta:ms[i]})).filter(x=>x.meta);
    if(!items.length){
      packMsg.textContent='Nothing attached yet — upload your resume and tickets first.';
      return;
    }

    packMsg.textContent='Preparing…';
    const files=[];
    for(const it of items){
      const blob=unwrap(await getBlob(it.key));
      if(blob) files.push(new File([blob],it.meta.name,
        {type:it.meta.type||'application/octet-stream'}));
    }
    packMsg.textContent='';

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
    }catch(e){ if(e&&e.name==='AbortError'){ packMsg.textContent=''; return; } }

    try{
      await navigator.clipboard.writeText(text);
      packMsg.textContent='Profile copied. Open each file above and attach it to your email.';
    }catch(e){
      packMsg.textContent='Open each file above and attach it to your email.';
    }
  });

  /* ---------- boot ------------------------------------------------------- */
  migrate().then(renderResume).then(renderPack);
})();
