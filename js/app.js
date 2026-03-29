/* ═══════════════════════════════════════════════════════════
   KARAOKE PARTY — app.js
   Firebase Realtime DB + LRCLIB lyrics + YouTube IFrame API
   ═══════════════════════════════════════════════════════════ */
'use strict';

// ── Firebase instances (set after ready) ──────────────────
let db = null, fbRef = null, fbUpdate = null, fbSet = null,
    fbGet = null, fbOnValue = null, fbOff = null, fbRemove = null;

// ── State ─────────────────────────────────────────────────
const S = {
  code:null, roomName:null, myId:null, myName:null, isHost:false,
  unsub:[], nowPlaying:null, ldata:null, ltimer:null,
  ytReady:false, ytPlayer:null,
};

// ── Voice / PeerJS State ──────────────────────────────────
let myPeer = null;
let activeCalls = {};
let localStream = null;
let wakeLock = null;

// ── Boot ──────────────────────────────────────────────────
window.addEventListener('fb-ready', () => {
  const { initializeApp, getDatabase, ref, set, get, update,
          onValue, push, remove, off, onDisconnect } = window._fb;
  fbRef = ref; fbSet = set; fbGet = get; fbUpdate = update;
  fbOnValue = onValue; fbOff = off; fbRemove = remove; fbOnDisconnect = onDisconnect;

  const raw = localStorage.getItem('kp_fb_cfg');
  if (!raw) { document.getElementById('cfg-modal').style.display = 'flex'; return; }
  try {
    const cfg = JSON.parse(raw);
    const app = initializeApp(cfg);
    db = getDatabase(app);
    initUI();
  } catch { document.getElementById('cfg-modal').style.display = 'flex'; }
});

async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
}
function releaseWakeLock() {
  if (wakeLock !== null) { wakeLock.release().then(() => { wakeLock = null; }); }
}
document.addEventListener('visibilitychange', () => { if (wakeLock !== null && document.visibilityState === 'visible') requestWakeLock(); });

window.saveCfg = function() {
  const raw = document.getElementById('cfg-in').value.trim();
  try {
    const cfg = JSON.parse(raw);
    if (!cfg.apiKey || !cfg.databaseURL) throw new Error('missing fields');
    localStorage.setItem('kp_fb_cfg', raw);
    document.getElementById('cfg-modal').style.display = 'none';
    const { initializeApp, getDatabase } = window._fb;
    const app = initializeApp(cfg, 'main');
    db = getDatabase(app);
    initUI();
    toast('Firebase configurado ✅');
  } catch { toast('JSON inválido — verifica o formato ❌'); }
};

function initUI() { 
  spawnNotes(); 
  const n = getRandomName();
  ['c-name', 'j-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = n;
  });
}

const PRE = ['Abelha', 'Chouriço', 'Pinto', 'Gato', 'Galo', 'Pinguim', 'Mestre', 'Voz', 'Anjo', 'Estrela', 'Lenda', 'Rei', 'Rainha', 'Faraó', 'Tubarão', 'Dragão'];
const SUF = ['do Rock', 'Afinado', 'Famoso', 'do Fado', 'da Noite', 'do Pimba', 'Punk', 'Pop', 'Metal', 'da Tasca', 'Vip', 'dos Palcos', 'Divino', 'do Karaoké', 'Supremo'];
function getRandomName() {
  return PRE[Math.floor(Math.random()*PRE.length)] + ' ' + SUF[Math.floor(Math.random()*SUF.length)];
}

// ── Navigation ────────────────────────────────────────────
window.goHome   = () => setScreen('home');
window.goCreate = () => setScreen('create-screen');
window.goJoin   = () => setScreen('join-screen');

function setScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Create Room ───────────────────────────────────────────
window.createRoom = async function() {
  const name = v('c-name'), room = v('c-room');
  const err = document.getElementById('c-err');
  err.textContent = '';
  if (!name) { err.textContent = 'Precisas de um nome!'; return; }
  if (!room) { err.textContent = 'Dá um nome à festa!'; return; }
  if (!db)   { err.textContent = 'Firebase não configurado!'; return; }

  const code = mkCode(), myId = mkId();
  const roomData = {
    name: room, host: myId,
    participants: { [myId]: { name, isHost: true } },
    queue: {}, nowPlaying: null,
    createdAt: Date.now(),
  };
  try {
    await fbSet(fbRef(db, `rooms/${code}`), roomData);
    Object.assign(S, { code, roomName: room, myId, myName: name, isHost: true });
    enterRoom();
  } catch(e) { err.textContent = 'Erro: ' + e.message; }
};

// ── Join Room ─────────────────────────────────────────────
window.joinRoom = async function() {
  const name = v('j-name');
  const code = document.getElementById('j-code').value.trim().toUpperCase();
  const err = document.getElementById('j-err');
  err.textContent = '';
  if (!name) { err.textContent = 'Precisas de um nome!'; return; }
  if (code.length !== 6) { err.textContent = 'Código inválido (6 letras)!'; return; }
  if (!db) { err.textContent = 'Firebase não configurado!'; return; }

  try {
    const snap = await fbGet(fbRef(db, `rooms/${code}`));
    if (!snap.exists()) { err.textContent = 'Sala não encontrada!'; return; }
    const myId = mkId();
    await fbSet(fbRef(db, `rooms/${code}/participants/${myId}`), { name, isHost: false });
    Object.assign(S, {
      code, roomName: snap.val().name,
      myId, myName: name, isHost: false,
    });
    enterRoom();
  } catch(e) { err.textContent = 'Erro: ' + e.message; }
};

// ── Enter Room ────────────────────────────────────────────
function enterRoom() {
  setScreen('room-screen');
  document.getElementById('rc').textContent    = S.code;
  document.getElementById('rname').textContent = S.roomName;
  
  if (db && S.code && S.myId) {
    try { fbOnDisconnect(fbRef(db, `rooms/${S.code}/participants/${S.myId}`)).remove(); } catch(e){}
  }

  requestWakeLock();
  subscribeRoom();
  subscribeChat();
  subscribeSuggestions();
}

let lastScoreRender = null;
function subscribeRoom() {
  const r = fbRef(db, `rooms/${S.code}`);
  const unsub = fbOnValue(r, snap => {
    if (!snap.exists()) { leaveRoom(); return; }
    const data = snap.val();
    
    // Offline detection of Host
    if (data.hostActive === false && !S.isHost) {
      toast('Sinal do Servidor Host perdeu-se! ⚠️', 5000);
    }
    
    applyRoom(data);

    const pb = data.playback;
    if (pb && pb.ended && pb.score !== undefined) {
      if (lastScoreRender !== pb.ts) {
        lastScoreRender = pb.ts;
        showScoreClient(pb.score);
      }
    } else {
      document.getElementById('score-overlay').classList.remove('show');
    }
  });
  S.unsub.push(() => fbOff(r));
}

function applyRoom(data) {
  // participants
  const parts = data.participants || {};
  const pArr = Object.entries(parts).map(([id,p]) => ({id,...p}));
  renderParticipants(pArr);

  // queue — stored as ordered object
  const q = data.queue || {};
  const qArr = Object.entries(q)
    .sort(([,a],[,b]) => (a._order||0) - (b._order||0))
    .map(([id,item]) => ({id,...item}));
  renderQueue(qArr);

  // nowPlaying
  const np = data.nowPlaying || null;
  if (JSON.stringify(np) !== JSON.stringify(S.nowPlaying)) {
    S.nowPlaying = np;
    renderNowPlaying(np);
  }
}

function subscribeSuggestions() {
  const r = fbRef(db, `rooms/${S.code}/suggestions`);
  const unsub = fbOnValue(r, snap => {
    const data = snap.val() || {};
    const sArr = Object.entries(data).sort(([,a],[,b])=>(b.votes||0)-(a.votes||0)).map(([id, s]) => ({id, ...s}));
    renderSuggestions(sArr);
  });
  S.unsub.push(() => fbOff(r));
}

// ── Render ────────────────────────────────────────────────
function renderParticipants(arr) {
  document.getElementById('pcnt').textContent = `(${arr.length})`;
  document.getElementById('plist').innerHTML = arr.map(p => `
    <li class="${p.isHost?'p-host':''} ${p.id===S.myId?'p-me':''}">
      ${p.isHost?'👑':'🎤'} ${esc(p.name)}
    </li>`).join('');

  // Voice Call logic
  const vPeers = arr.filter(p => p.inVoice);
  document.getElementById('vc-peers').innerHTML = vPeers.map(p => `
    <div class="vpeer ${p.isMuted?'vmuted':''} ${!p.isMuted?'speaking':''}">
      <div class="vpdot"></div>
      ${esc(p.name)} ${p.id===S.myId ? '(Tu)' : ''}
    </div>`).join('');
}

function renderQueue(arr) {
  const el = document.getElementById('qlist');
  if (!arr.length) { el.innerHTML = '<li class="q-empty">Fila vazia</li>'; return; }
  el.innerHTML = arr.map((item,i) => `
    <li>
      <span class="q-title">${esc(item.title)}</span>
      <span class="q-artist">${esc(item.artist)}</span>
      <span class="q-who">🎤 ${esc(item.singerName)}</span>
      ${(S.isHost || item.singerId===S.myId) && i>0
        ? `<button class="btn btn-danger btn-sm" style="margin-top:4px" onclick="removeQ('${item.id}')">Remover</button>`
        : ''}
    </li>`).join('');
}

function renderSuggestions(arr) {
  const el = document.getElementById('sugg-list');
  if (!el) return;
  if (!arr.length) { el.innerHTML = '<div class="qempty">Sem sugestões ativas</div>'; return; }
  el.innerHTML = arr.map(s => `
    <div class="res-item" style="display:flex; justify-content:space-between; align-items:center; background:var(--card); padding:0.6rem; border-radius:6px; margin-bottom:0.4rem; border:1px solid var(--bdr);">
      <div style="display:flex; flex-direction:column;">
        <span style="font-weight:700; font-size:0.8rem">${esc(s.title)}</span>
        <span style="font-size:0.65rem; color:var(--dim)">por ${esc(s.suggestedBy)}</span>
      </div>
      <button class="btn btn-pink btn-sm" style="flex-shrink:0" onclick="voteSuggestion('${s.id}')">
        ▲ ${s.votes||0}
      </button>
    </div>
  `).join('');
}

function renderNowPlaying(np) {
  const card  = document.getElementById('np-card');
  const idle  = document.getElementById('idle');
  const sCtrl = document.getElementById('singer-ctrl');
  const hCtrl = document.getElementById('host-ctrl');
  const rCard = document.getElementById('react-row');

  document.getElementById('yt-error-overlay').style.display = 'none';

  if (!np) {
    card.style.display = 'none';
    idle.style.display = 'block';
    sCtrl.style.display = hCtrl.style.display = rCard.style.display = 'none';
    stopLyrics(); stopYT(); return;
  }

  card.style.display = 'block';
  idle.style.display = 'none';
  rCard.style.display = 'flex';
  document.getElementById('np-who').textContent    = '🎤 ' + np.singerName;
  document.getElementById('np-title').textContent  = np.title;
  document.getElementById('np-artist').textContent = np.artist;
  
  if(document.getElementById('sync-display')) document.getElementById('sync-display').textContent = (np.syncOffset||0).toFixed(1);
  if(document.getElementById('sync-display-h')) document.getElementById('sync-display-h').textContent= (np.syncOffset||0).toFixed(1);

  const mine = np.singerId === S.myId;
  sCtrl.style.display = mine ? 'flex' : 'none';
  hCtrl.style.display = (S.isHost && !mine) ? 'flex' : 'none';

  // YouTube
  const wrap = document.getElementById('yt-wrap');
  if (np.ytId) {
    wrap.style.display = 'block';
    loadYT(np.ytId);
  } else {
    wrap.style.display = 'none'; stopYT();
  }

  // Lyrics
  const key = np.title + '|' + np.artist;
  if (!S.ldata || S.ldata._key !== key) fetchLyrics(np.title, np.artist, key);
}

// ── YouTube ───────────────────────────────────────────────
window.onYouTubeIframeAPIReady = function() { S.ytReady = true; };

function loadYT(videoId) {
  if (S.ytPlayer) {
    try { S.ytPlayer.loadVideoById(videoId); S.ytPlayer.playVideo(); } catch {}
    document.getElementById('yt-error-overlay').style.display = 'none';
    return;
  }
  if (!S.ytReady) { setTimeout(() => loadYT(videoId), 500); return; }
  document.getElementById('yt-error-overlay').style.display = 'none';
  S.ytPlayer = new YT.Player('ytplayer', {
    videoId,
    playerVars: { autoplay:1, controls:1, rel:0 },
    events: {
      onStateChange: e => {
        if (e.data === YT.PlayerState.PLAYING) startLyricsSync();
      },
      onError: e => {
        if (e.data === 150 || e.data === 101) {
          document.getElementById('yt-error-overlay').style.display = 'flex';
          setTimeout(() => { if (S.nowPlaying && S.nowPlaying.ytId === videoId) startNext(); }, 6000);
        } else {
          toast("Erro no Player YouTube: " + e.data);
        }
      }
    }
  });
}

function stopYT() { if (S.ytPlayer) try { S.ytPlayer.stopVideo(); } catch {} }

function ytId(url) {
  if (!url) return null;
  const m = url.match(/(?:v=|youtu\.be\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ── Lyrics (LRCLIB) ───────────────────────────────────────
async function fetchLyrics(title, artist, key) {
  const ll = document.getElementById('lload');
  const ln = document.getElementById('lnone');
  const lv = document.getElementById('llines');
  lv.innerHTML = ''; ln.style.display = 'none'; ll.style.display = 'flex';

  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data?.length) throw 0;

    const entry = data.find(d=>d.syncedLyrics) || data.find(d=>d.plainLyrics) || data[0];
    if (entry.syncedLyrics) {
      S.ldata = parseLRC(entry.syncedLyrics); S.ldata._key = key; S.ldata.type = 'synced';
    } else if (entry.plainLyrics) {
      S.ldata = parsePlain(entry.plainLyrics); S.ldata._key = key; S.ldata.type = 'plain';
    } else throw 0;

    renderLyrics();
  } catch {
    S.ldata = null;
    ln.style.display = 'block';
  } finally { ll.style.display = 'none'; }
}

function parseLRC(lrc) {
  const lines = [];
  lrc.split('\n').forEach(l => {
    const m = l.match(/\[(\d+):(\d+\.\d+)\](.*)/);
    if (m) lines.push({ t: +m[1]*60 + +m[2], text: m[3].trim() });
  });
  return { lines };
}
function parsePlain(p) {
  return { lines: p.split('\n').filter(l=>l.trim()).map(text=>({t:null,text})) };
}

function renderLyrics() {
  if (!S.ldata) return;
  document.getElementById('llines').innerHTML =
    S.ldata.lines.map((l,i)=>`<div class="lyric" id="l${i}">${esc(l.text)||'&nbsp;'}</div>`).join('');
}

function startLyricsSync() {
  stopLyrics();
  if (!S.ldata || S.ldata.type!=='synced') return;
  S.ltimer = setInterval(()=>{
    if (!S.ytPlayer?.getCurrentTime) return;
    const offset = S.nowPlaying?.syncOffset || 0;
    const t = S.ytPlayer.getCurrentTime() + offset;
    const lines = S.ldata.lines;
    let cur = 0;
    for (let i=0; i<lines.length; i++) if (lines[i].t!==null && lines[i].t<=t) cur=i;
    document.querySelectorAll('.lyric').forEach((el,i)=>{
      el.classList.remove('active','past');
      if (i===cur) { el.classList.add('active'); el.scrollIntoView({behavior:'smooth',block:'center'}); }
      else if (i<cur) el.classList.add('past');
    });
  }, 300);
}
function stopLyrics() { if (S.ltimer) { clearInterval(S.ltimer); S.ltimer=null; } }

window.adjustSync = async function(val) {
  if (!S.nowPlaying || !S.code) return;
  const cur = S.nowPlaying.syncOffset || 0;
  const next = cur + val;
  await fbSet(fbRef(db, `rooms/${S.code}/nowPlaying/syncOffset`), next);
};

// ── Song Search ───────────────────────────────────────────
window.searchSongs = async function() {
  const q = document.getElementById('sq').value.trim();
  const el = document.getElementById('sres');
  if (!q) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:.78rem">A pesquisar…</div>';
  try {
    const r = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
    const data = await r.json();
    if (!data?.length) { el.innerHTML = '<div style="color:var(--muted)">Sem resultados 😢</div>'; return; }
    const seen = new Set();
    const items = data.filter(d=>{ const k=d.trackName+'|'+d.artistName; if(seen.has(k)) return false; seen.add(k); return true; }).slice(0,7);
    el.innerHTML = items.map(item=>`
      <div class="res-item" onclick="addToQueue(${JSON.stringify(esc(item.trackName))},${JSON.stringify(esc(item.artistName))},null)">
        <div class="res-info">
          <span class="res-title">${esc(item.trackName)}</span>
          <span class="res-artist">${esc(item.artistName)}</span>
        </div>
        <button class="btn btn-yellow btn-sm">+ Fila</button>
      </div>`).join('');
  } catch { el.innerHTML = '<div style="color:#ff6b6b">Erro 😢</div>'; }
};

window.addManual = function() {
  const title  = document.getElementById('m-title').value.trim();
  const artist = document.getElementById('m-artist').value.trim() || 'Desconhecido';
  const yt     = document.getElementById('m-yt').value.trim() || null;
  if (!title) { toast('Falta o título!'); return; }
  addToQueue(title, artist, yt);
  ['m-title','m-artist','m-yt'].forEach(id=>document.getElementById(id).value='');
};

window.addToQueue = async function(title, artist, ytUrl) {
  if (!db) { toast('Firebase não configurado!'); return; }
  const songId = mkId();
  
  if (S.isHost) {
    const snap = await fbGet(fbRef(db, `rooms/${S.code}/queue`));
    const existing = snap.val() || {};
    const order = Object.keys(existing).length;
    const item = { title, artist, ytId: ytId(ytUrl), singerId: S.myId, singerName: S.myName, _order: order };

    await fbSet(fbRef(db, `rooms/${S.code}/queue/${songId}`), item);

    const npSnap = await fbGet(fbRef(db, `rooms/${S.code}/nowPlaying`));
    if (!npSnap.val()) await startNext();

    toast(`"${title}" na fila! 🎵`);
  } else {
    // Audience suggestions
    const item = { title, artist, ytId: ytId(ytUrl), suggestedBy: S.myName, votes: 1, ts: Date.now() };
    await fbSet(fbRef(db, `rooms/${S.code}/suggestions/${songId}`), item);
    toast(`"${title}" sugerida! 💡 Aguarda pelo aprovação do anfitrião.`);
  }

  document.getElementById('sres').innerHTML = '';
  document.getElementById('sq').value = '';
};

window.voteSuggestion = async function(id) {
  if (!db || !S.code) return;
  try { if ('vibrate' in navigator) navigator.vibrate(30); } catch(e){}
  const r = fbRef(db, `rooms/${S.code}/suggestions/${id}/votes`);
  const snap = await fbGet(r);
  const cur = snap.val() || 0;
  await fbSet(r, cur + 1);
  const btn = event.currentTarget;
  if(btn) {
    btn.style.transform = 'scale(1.2)';
    setTimeout(() => btn.style.transform = 'scale(1)', 150);
  }
};

window.removeQ = async function(id) {
  await fbRemove(fbRef(db, `rooms/${S.code}/queue/${id}`));
};

// ── Now Playing control ───────────────────────────────────
async function startNext() {
  const snap = await fbGet(fbRef(db, `rooms/${S.code}/queue`));
  const q = snap.val() || {};
  const arr = Object.entries(q).sort(([,a],[,b])=>(a._order||0)-(b._order||0));
  if (!arr.length) {
    await fbSet(fbRef(db, `rooms/${S.code}/nowPlaying`), null);
    return;
  }
  const [nextId, next] = arr[0];
  await fbRemove(fbRef(db, `rooms/${S.code}/queue/${nextId}`));
  const { _order, ...song } = next;
  await fbSet(fbRef(db, `rooms/${S.code}/nowPlaying`), { ...song, id: nextId });
}

window.finishSong = async function() {
  stopLyrics(); stopYT();
  await pushSysMsg(`🎉 ${S.myName} terminou "${S.nowPlaying?.title}"!`);
  await startNext();
};

window.skipSong = async function() {
  stopLyrics(); stopYT();
  await startNext();
};

// ── Chat ──────────────────────────────────────────────────
function subscribeChat() {
  const r = fbRef(db, `rooms/${S.code}/chat`);
  fbOnValue(r, snap => {
    const msgs = snap.val() || {};
    const el = document.getElementById('cmsg');
    el.innerHTML = '';
    Object.values(msgs)
      .sort((a,b)=>a.ts-b.ts)
      .slice(-60)
      .forEach(m => appendMsg(m));
    el.scrollTop = el.scrollHeight;
  });
  S.unsub.push(()=>fbOff(r));
}

window.sendChat = async function() {
  const input = document.getElementById('cin');
  const text = input.value.trim();
  if (!text || !db) return;
  input.value = '';
  const msg = { type:'user', author:S.myName, authorId:S.myId, text, ts:Date.now() };
  const chatRef = fbRef(db, `rooms/${S.code}/chat`);
  const snap = await fbGet(chatRef); const cur = snap.val()||{};
  const keys = Object.keys(cur).sort();
  // keep last 80 messages
  if (keys.length > 78) await fbRemove(fbRef(db, `rooms/${S.code}/chat/${keys[0]}`));
  await fbSet(fbRef(db, `rooms/${S.code}/chat/${mkId()}`), msg);
};

async function pushSysMsg(text) {
  if (!db) return;
  await fbSet(fbRef(db, `rooms/${S.code}/chat/${mkId()}`), { type:'sys', text, ts:Date.now() });
}

function appendMsg(m) {
  const el = document.getElementById('cmsg');
  const d  = document.createElement('div');
  d.className = `msg ${m.type==='sys'?'sys':''} ${m.authorId===S.myId?'mine':''}`;
  if (m.type==='sys') d.textContent = m.text;
  else d.innerHTML = `<span class="who">${esc(m.author)}:</span>${esc(m.text)}`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

// ── Leave Room ────────────────────────────────────────────
window.leaveRoom = async function() {
  leaveVoice(); // Ensure voice drops properly
  stopLyrics(); stopYT();
  releaseWakeLock();
  S.unsub.forEach(fn=>{ try{fn()}catch{} }); S.unsub.length=0;
  if (db && S.code && S.myId) {
    await fbRemove(fbRef(db, `rooms/${S.code}/participants/${S.myId}`));
    const snap = await fbGet(fbRef(db, `rooms/${S.code}/participants`));
    if (!snap.val()) await fbRemove(fbRef(db, `rooms/${S.code}`));
  }
  Object.assign(S,{code:null,roomName:null,myId:null,myName:null,isHost:false,
    nowPlaying:null,ldata:null,ltimer:null});
  goHome();
  toast('Saíste da sala 👋');
};

window.copyCode = function() {
  navigator.clipboard.writeText(S.code).then(()=>toast('Código copiado! 📋'));
};

// ── Utils ─────────────────────────────────────────────────
function v(id)     { return document.getElementById(id).value.trim(); }
function mkCode()  { const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:6},()=>c[Math.floor(Math.random()*c.length)]).join(''); }
function mkId()    { return Math.random().toString(36).slice(2,10)+Date.now().toString(36); }
function esc(s)    { if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toast(msg, d=3000) {
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),d);
}

function spawnNotes() {
  const c=document.getElementById('notesRain');
  const n=['🎵','🎶','🎤','🎸','🥁','🎹','🎺','🎻','⭐','✨'];
  setInterval(()=>{
    const el=document.createElement('div');
    el.className='note'; el.textContent=n[Math.floor(Math.random()*n.length)];
    el.style.left=Math.random()*100+'vw';
    el.style.animationDuration=(5+Math.random()*6)+'s';
    el.style.animationDelay='0s';
    el.style.fontSize=(.8+Math.random()*1.2)+'rem';
    c.appendChild(el);
    setTimeout(()=>el.remove(),12000);
  }, 900);
}

window.sendReaction = async function(emoji) {
  if (!db || !S.code) return;
  // Cooldown logic (Pinnacle feature)
  if (S.reactCooldown) return;
  S.reactCooldown = true;
  const btnEl = document.querySelector(`.react-btn[onclick*="'${emoji}'"]`);
  if (btnEl) btnEl.style.opacity = '0.3';
  setTimeout(() => { S.reactCooldown = false; if(btnEl) btnEl.style.opacity = '1'; }, 2000);

  try { if ('vibrate' in navigator) navigator.vibrate(40); } catch(e){}
  
  // Create small local bubble for visual feedback!
  const btn = document.querySelector(`.react-btn[data-emoji="${emoji}"]`) || document.getElementById('react-row');
  const feed = document.createElement('span');
  feed.textContent = emoji;
  feed.style.position = 'absolute';
  feed.style.fontSize = '2.4rem';
  feed.style.top = btn ? (btn.getBoundingClientRect().top - 40) + 'px' : '50%';
  feed.style.left = btn ? btn.getBoundingClientRect().left + 'px' : '50%';
  feed.style.pointerEvents = 'none';
  feed.style.transition = 'all 1s ease-out';
  feed.style.zIndex = '9999';
  document.body.appendChild(feed);
  requestAnimationFrame(() => {
    feed.style.transform = 'translateY(-100px) scale(1.5)';
    feed.style.opacity = '0';
  });
  setTimeout(()=>feed.remove(), 1000);

  // Save reaction in DB for visuals on Host
  await fbSet(fbRef(db, `rooms/${S.code}/reactions/feed/${mkId()}`), { emoji, ts: Date.now() });

  // Save sound event (Soundboard) for the Host to play
  await fbSet(fbRef(db, `rooms/${S.code}/reactions/audio_sfx`), { emoji, ts: Date.now() });

  // Increment internal counter natively safely
  const snap = await fbGet(fbRef(db, `rooms/${S.code}/reactions/total`));
  const current = snap.val() || 0;
  await fbSet(fbRef(db, `rooms/${S.code}/reactions/total`), current + 1);

  // Increment Crowd Power! (Game mechanic)
  const cpSnap = await fbGet(fbRef(db, `rooms/${S.code}/playback/crowdPower`));
  const cpVal = cpSnap.val() || 0;
  if (cpVal < 100) await fbSet(fbRef(db, `rooms/${S.code}/playback/crowdPower`), Math.min(100, cpVal + 6));
};

// ── Voice Call (PeerJS) ───────────────────────────────────
window.joinVoice = async function() {
  if (myPeer) return;
  document.getElementById('vc-status').textContent = 'A ligar...';
  
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }, 
      video: false 
    });
    
    myPeer = new Peer(S.myId);
    
    myPeer.on('open', id => {
      document.getElementById('vc-status').textContent = 'Voz Ativa 🎙️';
      document.getElementById('vc-join').style.display = 'none';
      document.getElementById('vc-leave').style.display = 'inline-block';
      document.getElementById('vc-mute').style.display = 'inline-block';
      
      if (db && S.code && S.myId) {
        fbUpdate(fbRef(db, `rooms/${S.code}/participants/${S.myId}`), { inVoice: true, isMuted: false });
      }
      
      // Call others who are in voice
      fbGet(fbRef(db, `rooms/${S.code}/participants`)).then(snap => {
        const parts = snap.val() || {};
        Object.keys(parts).forEach(peerId => {
          if (peerId !== S.myId && parts[peerId].inVoice) {
            callPeer(peerId);
          }
        });
      });
    });

    myPeer.on('call', call => {
      call.answer(localStream);
      call.on('stream', remoteStream => {
        addRemoteAudio(call.peer, remoteStream);
      });
      call.on('close', () => {
        const audio = document.getElementById('audio-' + call.peer);
        if (audio) audio.remove();
      });
      activeCalls[call.peer] = call;
    });

    myPeer.on('disconnected', () => {
      if (myPeer) myPeer.reconnect();
    });

    myPeer.on('close', () => leaveVoice());

    myPeer.on('error', err => {
      if (err.type !== 'peer-unavailable') {
        toast('Erro no PeerJS: ' + err.type);
        leaveVoice();
      }
    });
  } catch(e) {
    toast('Sem acesso ao microfone! 🎙️❌');
    document.getElementById('vc-status').textContent = 'Erro Mic';
  }
};

function callPeer(peerId) {
  if (!myPeer || !localStream) return;
  const call = myPeer.call(peerId, localStream);
  call.on('stream', remoteStream => {
    addRemoteAudio(peerId, remoteStream);
  });
  call.on('close', () => {
    const audio = document.getElementById('audio-' + peerId);
    if (audio) audio.remove();
  });
  activeCalls[peerId] = call;
}

function addRemoteAudio(peerId, stream) {
  let audio = document.getElementById('audio-' + peerId);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = 'audio-' + peerId;
    audio.controls = false;
    audio.style.display = 'none';
    audio.playsInline = true;
    audio.autoplay = true;
    document.body.appendChild(audio);
  }
  audio.srcObject = stream;
}

window.leaveVoice = function() {
  if (myPeer) { myPeer.destroy(); myPeer = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  Object.values(activeCalls).forEach(c => c.close());
  activeCalls = {};
  
  document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());
  
  document.getElementById('vc-status').textContent = 'Desligado';
  document.getElementById('vc-join').style.display = 'inline-block';
  document.getElementById('vc-leave').style.display = 'none';
  document.getElementById('vc-mute').style.display = 'none';
  
  if (db && S.code && S.myId) {
    fbUpdate(fbRef(db, `rooms/${S.code}/participants/${S.myId}`), { inVoice: false, isMuted: false });
  }
};

window.toggleMute = function() {
  if (!localStream) return;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !audioTrack.enabled;
    const btn = document.getElementById('vc-mute');
    if (audioTrack.enabled) {
      btn.textContent = '🎙️ Mudo';
      btn.classList.remove('muted');
    } else {
      btn.textContent = '🔇 Silêncio';
      btn.classList.add('muted');
    }
    fbUpdate(fbRef(db, `rooms/${S.code}/participants/${S.myId}`), { isMuted: !audioTrack.enabled });
  }
};
