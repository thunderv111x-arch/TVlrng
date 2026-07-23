/* ============================================================
   ดีบักบนหน้าจอ (สำหรับดูตอนเปิดจากมือถือ/iPad ที่ไม่มี DevTools ให้เปิด)
   กดปุ่ม 🐞 มุมขวาล่าง เพื่อดู log/error ทั้งหมด + สถานะ Firebase แบบสด
   ลบ block นี้ทิ้งได้ทีหลังตอนดีบักเสร็จแล้ว ไม่กระทบการทำงานของเว็บส่วนอื่น
   ============================================================ */
(function setupOnScreenDebugConsole() {
  const logs = [];
  function push(level, args) {
    const text = args.map(a => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); }
      catch (e) { return String(a); }
    }).join(' ');
    logs.push({ level, text, t: new Date().toLocaleTimeString('th-TH') });
    if (logs.length > 200) logs.shift();
    renderIfOpen();
  }
  ['log', 'warn', 'error'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); push(level, args); };
  });
  window.addEventListener('error', e => push('error', [`Uncaught: ${e.message} (${e.filename}:${e.lineno})`]));
  window.addEventListener('unhandledrejection', e => push('error', [`Unhandled promise rejection: ${e.reason}`]));

  let panel, btn, open = false;
  function build() {
    btn = document.createElement('button');
    btn.textContent = '🐞';
    btn.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:99999;width:44px;height:44px;border-radius:50%;background:#ff3b4e;color:#fff;border:none;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,.4);';
    btn.onclick = () => { open = !open; panel.style.display = open ? 'block' : 'none'; if (open) renderNow(); };
    document.body.appendChild(btn);

    panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:fixed;inset:60px 10px 70px 10px;z-index:99998;background:#0b0d10;color:#c9d1d9;border:1px solid #333;border-radius:6px;overflow:auto;font:11px/1.5 monospace;padding:10px;';
    document.body.appendChild(panel);
  }
  function statusLine() {
    return `--- สถานะ ---\nwindow.fb: ${window.fb ? 'พร้อมใช้งาน ✅' : 'ยังไม่มี (firebase-init.js ยังไม่โหลด) ❌'}\n` +
      `window.fbReady: ${window.fbReady ? 'มี ✅' : 'ยังไม่มี ❌'}\n` +
      `state.user: ${(typeof state !== 'undefined' && state.user) ? state.user.email : 'ยังไม่ล็อกอิน'}\n` +
      `state.fbUid: ${(typeof state !== 'undefined' && state.fbUid) ? state.fbUid : 'ยังไม่มี (Firebase Auth ยังไม่เชื่อมสำเร็จ) ❌'}`;
  }
  function renderNow() {
    if (!panel) return;
    const rows = logs.map(l => `<div style="color:${l.level === 'error' ? '#ff6b6b' : l.level === 'warn' ? '#e8b93b' : '#8b949e'}">[${l.t}] ${escapeForPanel(l.text)}</div>`).join('');
    panel.innerHTML = `<pre style="white-space:pre-wrap;color:#4de896;margin:0 0 10px">${escapeForPanel(statusLine())}</pre><div>${rows || '(ยังไม่มี log)'}</div>`;
    panel.scrollTop = panel.scrollHeight;
  }
  function renderIfOpen() { if (open) renderNow(); }
  function escapeForPanel(s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
  setInterval(renderIfOpen, 1000); // อัปเดตสถานะ (state.fbUid ฯลฯ) แบบสดตลอดเวลาที่เปิดพาเนลอยู่
})();

/* ============================================================
   app.js — Valorant Prediction site
   Everything is client-side. User data lives in localStorage
   only (per-browser). Google Sign-In is used purely to show a
   name/avatar — it is NOT a secure multi-device account system.
   ============================================================ */

// !!! ตั้งค่าก่อนใช้งานจริง: ใส่ Google OAuth Client ID ของคุณเองที่นี่ !!!
// วิธีสร้าง อ่านใน README.md
const GOOGLE_CLIENT_ID = '382344978450-e86echom7fqs2jrpckg3qafobf4tdrgr.apps.googleusercontent.com';

// เดิมเว็บนี้เคยใช้ vlrggapi.vercel.app (ของ Andre Saddler) แต่ URL สาธารณะนั้นล่มเพราะเกินโควตาฟรีของ Vercel
// (ผู้ดูแลเองแนะนำให้ self-host) แล้วเปลี่ยนไปใช้ vlr.orlandomm.net ชั่วคราว แต่พบว่า endpoint ผลแมตช์ของ
// เจ้านั้นไม่ส่งสกอร์จริงมาให้ (score เป็นค่าว่างทุกแมตช์) ทำให้ resolve ผลไม่ได้เลย
// ตอนนี้แก้ปัญหาด้วยการ fork+deploy vlrggapi เป็น instance ของเราเอง (ฟรี บน Vercel) ซึ่งให้สกอร์จริง
// ที่มา: https://github.com/axsddlr/vlrggapi (deploy เองตามคำแนะนำในไฟล์ README)
const API_BASE = 'https://vlrggapi-psi.vercel.app';
const FETCH_TIMEOUT_MS = 6000;

// API ตัวนี้ (vlrggapi ที่เรา self-host) ฝั่ง /match (upcoming/results) ไม่ได้ส่ง "โลโก้ทีม" มาให้
// ส่งมาแค่ flag1/flag2 (ธงชาติ เช่น "flag_us") เท่านั้น ซึ่งไม่ใช่โลโก้ทีม เอามาแสดงเป็นโลโก้ไม่ได้
// เดิมเว็บนี้เคยไปดึงโลโก้เสริมจาก API อื่น (vlr.orlandomm.net) แต่ตอนนี้เลิกใช้แล้ว
// (ให้ vlrggapi ตัวที่ self-host ไว้เป็น "หลัก" แหล่งเดียวตามที่ต้องการ)
// แก้โดยดึงโลโก้จาก endpoint /rankings ของ vlrggapi ตัวเดียวกันแทน (มีฟิลด์ "logo" ของทีมที่ติดอันดับ
// และ "last_played_team_logo" ของคู่แข่งนัดล่าสุด ซึ่งช่วยครอบคลุมทีมที่ไม่ติดอันดับ top ของภูมิภาคด้วย)
// ดึงหลายภูมิภาคพร้อมกันให้ครอบคลุมทุกลีกที่เว็บนี้แสดง แล้ว cache ผลไว้ฝั่ง client กันยิงรัว ๆ ทุก 5 นาที
const RANKING_REGIONS = ['na', 'eu', 'ap', 'la', 'la-s', 'la-n', 'oce', 'kr', 'mn', 'gc', 'br', 'cn', 'jp', 'col'];
const LOGO_MAP_TTL_MS = 60 * 60 * 1000; // cache แผนที่โลโก้ไว้ 1 ชม. (ฝั่ง API เองก็ cache /rankings ไว้ 1 ชม. อยู่แล้ว)
let logoMapCache = { map: new Map(), names: new Map(), builtAt: 0 };

// เดิมเว็บนี้ล็อกไว้แค่ VCT Pacific เท่านั้น ตอนนี้เปลี่ยนเป็นดึงมาทุกลีก
// แล้วให้ผู้ใช้เลือกดูเองผ่านตัวกรองลีกในหน้า "ทายผล" แทน
// (การจัดหมวดหมู่ทำที่ data.js ผ่าน LEAGUE_CATEGORIES / classifyTournament)
const LEAGUE_FILTER_STORAGE_KEY = 'valo_predict_league_filter';

// ---- Point transfer (email-based) ----
// สำคัญ: เว็บนี้เก็บข้อมูลใน localStorage ของเบราว์เซอร์เท่านั้น ไม่มีเซิร์ฟเวอร์กลาง
// ดังนั้นการโอนแต้มจะ "โอนจริง" ก็ต่อเมื่อผู้รับเคย (หรือจะ) ล็อกอินบนเบราว์เซอร์/อุปกรณ์เครื่องเดียวกันนี้
// - USER_REGISTRY: อีเมล -> {sub, name} จำเฉพาะคนที่เคยล็อกอินบนเครื่องนี้
// - PENDING_TRANSFERS: อีเมลผู้รับ -> รายการแต้มที่ยังไม่มีใครมารับ (ค้างไว้จนกว่าจะล็อกอิน)
const USER_REGISTRY_KEY = 'valo_predict_registry';
const PENDING_TRANSFERS_KEY = 'valo_predict_pending_transfers';
const MIN_TRANSFER = 5; // โอนขั้นต่ำต่อครั้ง

const state = {
  user: null,        // { sub, name, picture, email }
  data: null,        // per-user save data (points, inventory, predictions, equipped)
  fbUid: null,        // Firebase Auth uid หลังเชื่อมต่อสำเร็จ (ใช้เป็น doc id ใน players/{uid} บน Firestore)
  upcoming: [],
  live: [],           // แมตช์ที่กำลังแข่งอยู่ตอนนี้ พร้อมสกอร์เรียลไทม์ (จาก q=live_score)
  results: [],
  usingFallback: false,
  leagueFilter: localStorage.getItem(LEAGUE_FILTER_STORAGE_KEY) || 'all', // ตัวกรองลีก (global ไม่ผูกกับ user)
  finishedLive: loadFinishedLiveCache(), // แมตช์ที่เพิ่งจบ จาก live_score — คีย์ = match_page, ค่า = { match, finishedAt }
};

// ล้างรายการที่จบไปเกิน 24 ชม. ทิ้งตั้งแต่ตอนโหลดหน้าเว็บ (เผื่อไม่มีใครเปิดเว็บทิ้งไว้ให้ poll ลบเอง)
pruneFinishedLive(state.finishedLive);
saveFinishedLiveCache(state.finishedLive);

// ---- Live score polling ----
// vlrggapi เอง cache endpoint q=live_score ไว้แค่ 30 วิ (ดู README) เลย poll ถี่กว่า loadMatches()
// (ซึ่งดึง upcoming/results หนักกว่าและ cache 5 นาที) แยกกันเพื่อไม่ต้องยิงทุกอย่างซ้ำทุก 30 วิ
const LIVE_POLL_MS = 30 * 1000;

// ---- แมตช์ที่เพิ่งจบ (จาก live_score) ----
// เดิม endpoint live_score พอแมตช์จบ (ตกจาก list) หน้าเว็บจะทำให้การ์ดหายวับไปทันที ทำให้พลาดดูสกอร์สุดท้าย
// แก้โดย snapshot รายการที่ไลฟ์อยู่ทุกรอบไว้ใน localStorage เทียบกับรอบก่อน ถ้าแมตช์ไหนหลุดจาก live_score
// ไปแล้ว ให้เก็บสกอร์สุดท้ายไว้โชว์ต่อ (badge "จบแล้ว" แทน "LIVE") จนกว่าจะครบ 24 ชม. นับจากจบ ค่อยลบทิ้ง
// เก็บไว้ใน localStorage ด้วย (ไม่ใช่แค่ state ใน memory) เพื่อให้รอดแม้ผู้ใช้รีเฟรช/ปิดเปิดหน้าเว็บใหม่
const FINISHED_LIVE_KEY = 'valo_predict_finished_live';
const LIVE_SNAPSHOT_KEY = 'valo_predict_live_snapshot';
const FINISHED_LIVE_TTL_MS = 24 * 60 * 60 * 1000; // โชว์ผลที่เพิ่งจบต่อ 24 ชม. ก่อนลบ

function loadFinishedLiveCache() {
  try {
    const raw = localStorage.getItem(FINISHED_LIVE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveFinishedLiveCache(cache) {
  try { localStorage.setItem(FINISHED_LIVE_KEY, JSON.stringify(cache)); } catch (e) {}
}
function loadLiveSnapshot() {
  try {
    const raw = localStorage.getItem(LIVE_SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}
function saveLiveSnapshot(map) {
  try { localStorage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify(map)); } catch (e) {}
}
// ลบรายการที่จบเกิน 24 ชม. ออกจาก cache (mutate ตรงๆ)
function pruneFinishedLive(cache) {
  const now = Date.now();
  Object.keys(cache).forEach(key => {
    if (now - cache[key].finishedAt > FINISHED_LIVE_TTL_MS) delete cache[key];
  });
}

/* ---------------- storage helpers ---------------- */

function saveKey(sub) { return `valo_predict_user_${sub}`; }

// ชื่อ/รูปที่ "แสดงจริง" บนเว็บ — ถ้าผู้ใช้ตั้งค่าเองไว้ (customName/customAvatar) จะใช้ค่านั้นแทนของ Google
function displayName() {
  if (!state.user) return '';
  return (state.data && state.data.customName) || state.user.name;
}

function displayAvatar() {
  if (!state.user) return '';
  return (state.data && state.data.customAvatar) || state.user.picture;
}

function defaultUserData() {
  return {
    points: 100, // starter points
    ownedFrames: ['frame_default'],
    ownedThemes: ['theme_tactical'],
    equippedFrame: 'frame_default',
    equippedTheme: 'theme_tactical',
    ownedTags: [],         // แท็กโปรไฟล์ที่ปลดล็อกแล้ว (ได้จากโค้ดเท่านั้น)
    ownedTeamTags: [],     // แท็กทีมที่ซื้อด้วยแต้ม [{ id, name, logo }] — คนละชุดกับ ownedTags (โค้ดเท่านั้น)
    equippedTag: null,     // id ของแท็กที่กำลังสวมอยู่ (null = ไม่ใส่) ใช้ร่วมกันทั้ง ownedTags และ ownedTeamTags
    redeemedCodes: [],     // โค้ดที่เคยกรอกไปแล้ว (เก็บเป็นตัวพิมพ์เล็กทั้งหมด) กันกรอกซ้ำ
    predictions: {},     // match_page -> { pick:'team1'|'team2', team1, team2, event, bet, resolved, correct, reward }
    stats: { total: 0, correct: 0 },
    lastLoginBonusAt: null, // timestamp (ms) ครั้งล่าสุดที่ "กดรับ" โบนัสรายวัน (รีทุก 24 ชม. นับจากเวลานี้)
    freeCases: 0,           // จำนวนกล่องสุ่มฟรีที่ได้จากโบนัสรายวัน ยังไม่ได้เปิด
    transferLog: [],      // [{ type:'sent'|'received', amount, counterpart, date }]
    customName: null,     // ชื่อที่ผู้ใช้ตั้งเอง (overrides ชื่อจาก Google) — null = ใช้ชื่อ Google ตามปกติ
    customAvatar: null,   // URL รูปโปรไฟล์ที่ผู้ใช้ตั้งเอง (overrides รูปจาก Google) — null = ใช้รูป Google ตามปกติ
  };
}

function loadUserData(sub) {
  try {
    const raw = localStorage.getItem(saveKey(sub));
    if (!raw) return defaultUserData();
    const parsed = JSON.parse(raw);
    return { ...defaultUserData(), ...parsed };
  } catch (e) {
    console.error('โหลดข้อมูลผู้เล่นไม่สำเร็จ', e);
    return defaultUserData();
  }
}

function persist() {
  if (!state.user) return;
  localStorage.setItem(saveKey(state.user.sub), JSON.stringify(state.data));
  pushProfileToFirestore(); // sync ขึ้น Firestore (debounced) ทุกครั้งที่ข้อมูลผู้ใช้เปลี่ยน
}

/* ---------------- point transfer: registry + pending queue ---------------- */

function loadRegistry() {
  try { return JSON.parse(localStorage.getItem(USER_REGISTRY_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveRegistry(reg) {
  localStorage.setItem(USER_REGISTRY_KEY, JSON.stringify(reg));
}

// จำอีเมล -> sub ของทุกคนที่เคยล็อกอินบนเบราว์เซอร์นี้ ใช้ค้นหาผู้รับตอนโอนแต้ม
function registerSelfInDirectory() {
  if (!state.user) return;
  const reg = loadRegistry();
  reg[state.user.email.toLowerCase()] = { sub: state.user.sub, name: state.user.name };
  saveRegistry(reg);
}

function loadPendingTransfers() {
  try { return JSON.parse(localStorage.getItem(PENDING_TRANSFERS_KEY)) || {}; }
  catch (e) { return {}; }
}

function savePendingTransfers(p) {
  localStorage.setItem(PENDING_TRANSFERS_KEY, JSON.stringify(p));
}

// เช็คตอนล็อกอินว่ามีแต้มที่คนอื่นโอนมาค้างไว้ให้อีเมลนี้หรือเปล่า (กรณีตอนโอน ผู้รับยังไม่เคยล็อกอินบนเครื่องนี้)
function applyPendingTransfers() {
  if (!state.user || !state.data) return;
  const pending = loadPendingTransfers();
  const email = state.user.email.toLowerCase();
  const mine = pending[email];
  if (!mine || !mine.length) return;

  let total = 0;
  mine.forEach(t => {
    total += t.amount;
    state.data.transferLog.unshift({ type: 'received', amount: t.amount, counterpart: t.fromName || t.fromEmail, date: t.date });
  });
  state.data.points += total;
  delete pending[email];
  savePendingTransfers(pending);
  persist();
  setTimeout(() => alert(`📩 มีแต้มที่เพื่อนโอนค้างไว้ให้คุณ ได้รับรวม +${total} แต้ม!`), 60);
}

/* ---------------- Google Identity Services ---------------- */

function initGoogleSignIn() {
  if (!window.google || !google.accounts || !google.accounts.id) {
    setTimeout(initGoogleSignIn, 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: true,
  });
  google.accounts.id.renderButton(
    document.getElementById('g_signin_btn'),
    { theme: 'filled_black', shape: 'pill', size: 'medium', text: 'signin_with' }
  );
  // Try silent sign-in if user signed in before
  const last = localStorage.getItem('valo_predict_last_sub');
  if (last) google.accounts.id.prompt();
}

function decodeJwt(token) {
  const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(
    atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
  return JSON.parse(json);
}

function handleGoogleCredential(response) {
  const payload = decodeJwt(response.credential);
  state.user = { sub: payload.sub, name: payload.name, picture: payload.picture, email: payload.email };
  state.data = loadUserData(state.user.sub);
  localStorage.setItem('valo_predict_last_sub', state.user.sub);
  registerSelfInDirectory();
  onSignedIn();
  linkFirebaseAuth(response.credential); // เดินคู่ขนาน ไม่บล็อกการล็อกอินฝั่งเว็บถ้า Firebase ช้า/ล่ม
}

/* ---------------- Firebase sync: leaderboard + public profile ---------------- */
// state.fbUid = uid ฝั่ง Firebase Auth (คนละตัวกับ state.user.sub ที่เป็น Google "sub" ดิบๆ)
// ต้องรอ sign-in Firebase สำเร็จก่อนถึงจะรู้ uid นี้ และ Firestore rules อนุญาตให้เขียนเฉพาะ
// เอกสารที่ id ตรงกับ uid นี้เท่านั้น (ดู firestore.rules)

// module script (firebase-init.js) โหลด/รันช้ากว่า classic script เล็กน้อยเสมอ โดยเฉพาะตอน
// auto sign-in ที่ Google callback อาจยิงมาเร็วมาก ถ้า window.fbReady ยังไม่ถูกตั้งค่าตอนนั้นพอดี
// ฟังก์ชันนี้จะ poll รอสักพัก (สูงสุด ~4 วิ) แทนที่จะยอมแพ้ทันทีแบบเดิม
function waitForFirebaseReady(retries = 20) {
  return new Promise((resolve, reject) => {
    (function attempt(n) {
      if (window.fbReady) { resolve(window.fbReady); return; }
      if (n <= 0) { reject(new Error('firebase-init.js ยังไม่พร้อมหลังรอครบเวลาแล้ว')); return; }
      setTimeout(() => attempt(n - 1), 200);
    })(retries);
  });
}

async function linkFirebaseAuth(idToken) {
  try {
    const fb = await waitForFirebaseReady();
    const user = await fb.signInWithGoogleIdToken(idToken);
    state.fbUid = user.uid;
    pushProfileToFirestore(true); // sync ทันทีรอบแรกหลังล็อกอิน ไม่ต้องรอ debounce
  } catch (e) {
    console.warn('[firebase] เชื่อมต่อ Firebase Auth ไม่สำเร็จ (leaderboard/โปรไฟล์สาธารณะจะยังไม่อัปเดต):', e);
  }
}

let profileSyncTimer = null;
function pushProfileToFirestore(immediate = false) {
  if (!state.fbUid || !state.data || !window.fb) return;
  const doSync = () => {
    const { total, correct } = state.data.stats || { total: 0, correct: 0 };
    // ถ้าแท็กที่สวมอยู่เป็น "แท็กทีม" (ซื้อด้วยแต้ม ไม่ใช่โค้ด) ต้องแนบชื่อ/โลโก้ไปด้วย
    // เพราะ client คนอื่นที่ดู leaderboard/โปรไฟล์สาธารณะ ไม่มีทางรู้ชื่อ/โลโก้ทีมนี้จาก id เฉยๆ
    // (TAG_CATALOG เป็น static list ที่ทุกคนมีเหมือนกัน แต่แท็กทีมเป็นข้อมูลไดนามิกที่ผู้ซื้อรู้เองคนเดียว)
    const equippedTeamTag = (state.data.ownedTeamTags || []).find(t => t.id === state.data.equippedTag);
    window.fb.syncMyProfile(state.fbUid, {
      displayName: displayName(),
      avatarUrl: displayAvatar(),
      points: state.data.points || 0,
      totalPredictions: total,
      correctPredictions: correct,
      equippedFrame: state.data.equippedFrame,
      equippedTag: state.data.equippedTag,
      equippedTeamTagName: equippedTeamTag ? equippedTeamTag.name : null,
      equippedTeamTagLogo: equippedTeamTag ? equippedTeamTag.logo : null,
    }).catch(e => console.warn('[firebase] sync โปรไฟล์ไม่สำเร็จ:', e));
  };
  clearTimeout(profileSyncTimer);
  if (immediate) doSync();
  else profileSyncTimer = setTimeout(doSync, 1000); // debounce กัน persist() ที่ถูกเรียกรัวๆ ยิง Firestore รัวตาม
}

/* ---------------- daily login bonus ---------------- */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// เหลือเวลาอีกกี่ ms ก่อนจะกดรับโบนัสรายวันได้อีกครั้ง (<=0 แปลว่ากดรับได้เลย)
function dailyBonusRemainingMs() {
  if (!state.data) return Infinity;
  const last = state.data.lastLoginBonusAt;
  if (!last) return 0;
  return DAILY_BONUS_COOLDOWN_MS - (Date.now() - last);
}

// ผู้ใช้ต้องกดปุ่มเองถึงจะได้รับ (ไม่ auto-grant ตอนล็อกอินแล้ว)
// ข้อมูล lastLoginBonusAt/points/freeCases ถูกเก็บแยกตาม sub ของบัญชี Google
// ที่ล็อกอินอยู่ (saveKey(state.user.sub)) จึงผูกกับอีเมลที่ล็อกอินเท่านั้นโดยธรรมชาติ
function claimDailyBonus() {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะรับโบนัสรายวันได้'); return; }
  const remaining = dailyBonusRemainingMs();
  if (remaining > 0) { updateDailyBonusUI(); return; }

  state.data.lastLoginBonusAt = Date.now();
  state.data.points += DAILY_LOGIN_BONUS;
  state.data.freeCases = (state.data.freeCases || 0) + DAILY_LOGIN_FREE_CASES;
  persist();
  renderTopbar();
  renderGachaTab();
  updateDailyBonusUI();
  alert(`🎁 รับโบนัสรายวันสำเร็จ! +${DAILY_LOGIN_BONUS} แต้ม และกล่องสุ่มฟรี ${DAILY_LOGIN_FREE_CASES} ใบ`);
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateDailyBonusUI() {
  const btn = document.getElementById('daily-bonus-btn');
  const timerEl = document.getElementById('daily-bonus-timer');
  if (!btn || !timerEl) return;

  if (!state.user || !state.data) {
    btn.disabled = true;
    btn.textContent = 'รับโบนัสวันนี้';
    timerEl.textContent = 'เข้าสู่ระบบก่อนถึงจะรับได้';
    return;
  }

  const remaining = dailyBonusRemainingMs();
  if (remaining <= 0) {
    btn.disabled = false;
    btn.textContent = `รับโบนัสวันนี้ (+${DAILY_LOGIN_BONUS} PT + กล่องฟรี ${DAILY_LOGIN_FREE_CASES})`;
    timerEl.textContent = '🎁 พร้อมรับแล้ว!';
  } else {
    btn.disabled = true;
    btn.textContent = 'รับแล้ว รอรอบถัดไป';
    timerEl.textContent = `รับใหม่ได้ในอีก ${formatCountdown(remaining)}`;
  }
}

function signOut() {
  state.user = null;
  state.data = null;
  state.fbUid = null;
  localStorage.removeItem('valo_predict_last_sub');
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  if (window.fb) window.fb.signOutFirebase();
  document.getElementById('app-shell').classList.add('signed-out');
  renderTopbar();
  updateDailyBonusUI();
}

/* ---------------- data fetching (vlr.gg unofficial API) ---------------- */

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// ---- ดึงรหัสแมตช์ตัวเลขจาก vlr.gg ออกมาจาก match_page ----
// API ใหม่ใช้ URL เต็มเป็น match_page (เช่น "https://www.vlr.gg/715879/team-a-vs-team-b-...")
// ทั้งฝั่ง upcoming และ results ใช้ฟอร์แมตเดียวกัน จับคู่กันได้ตรงๆ
// แต่ prediction เก่าที่ทายไว้ตอนใช้ API ตัวก่อนหน้า (vlr.orlandomm.net) จะเก็บ key เป็นแค่ตัวเลขล้วน
// (เช่น "715879") ฟังก์ชันนี้ดึง "รหัสตัวเลข" ออกมาให้เทียบกันได้ไม่ว่าจะเก็บมาแบบไหน
function extractVlrMatchId(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/vlr\.gg\/(\d+)/);
  if (m) return m[1];
  return /^\d+$/.test(s) ? s : null;
}

// ---- ดึงโลโก้ทีมจาก /rankings ของ vlrggapi (ตัวเดียวกับ API หลัก ไม่พึ่ง API อื่นแล้ว) ----
// ยิงแยกทีละภูมิภาค แล้วรวมเป็น Map เดียว: ชื่อทีม (ตัวพิมพ์เล็ก, ตัดช่องว่างหัวท้าย) -> URL โลโก้
// ใช้ Promise.allSettled เพราะบางภูมิภาคอาจดึงไม่สำเร็จ/timeout แต่ไม่อยากให้ภูมิภาคอื่นพังไปด้วย
// มี cache ฝั่ง client (LOGO_MAP_TTL_MS) กันยิงซ้ำทุกครั้งที่ loadMatches ทำงาน (ทุก 5 นาที)
async function buildLogoMap() {
  const now = Date.now();
  if (logoMapCache.map.size && (now - logoMapCache.builtAt) < LOGO_MAP_TTL_MS) {
    return logoMapCache.map;
  }

  const map = new Map();
  const names = new Map(); // key (lowercase) -> ชื่อทีมตัวพิมพ์จริงตามที่ API ส่งมา ใช้โชว์ในหน้าร้านแท็กทีม
  const addLogo = (name, logo) => {
    if (!name || !logo) return;
    const key = name.trim().toLowerCase();
    if (!key || map.has(key)) return;
    // บาง URL จาก vlr.gg ขึ้นต้นด้วย "//" (protocol-relative) เติม https: ให้ก่อนใช้เป็น src รูป
    map.set(key, logo.startsWith('//') ? `https:${logo}` : logo);
    names.set(key, name.trim());
  };
  // "last_played_team" ในผลลัพธ์ /rankings จะมีคำนำหน้า "vs. " ติดมาด้วย เช่น "vs. Evil Geniuses" ต้องตัดออกก่อน
  const stripVsPrefix = (name) => (name || '').replace(/^vs\.?\s*/i, '');

  const results = await Promise.allSettled(
    RANKING_REGIONS.map(region => fetchWithTimeout(`${API_BASE}/rankings?region=${region}`, FETCH_TIMEOUT_MS))
  );
  results.forEach(r => {
    if (r.status !== 'fulfilled') return;
    const rows = r.value?.data || [];
    rows.forEach(row => {
      addLogo(row.team, row.logo);
      // เผื่อโลโก้ของคู่แข่งนัดล่าสุด ซึ่งอาจเป็นทีมที่ไม่ติดอันดับ top ของภูมิภาคนั้นเอง
      addLogo(stripVsPrefix(row.last_played_team), row.last_played_team_logo);
    });
  });

  if (map.size) {
    logoMapCache = { map, names, builtAt: now };
    return map;
  }
  // ถ้ารอบนี้ดึงไม่สำเร็จเลยสักภูมิภาค ใช้แคชเก่า (ถ้ามี) ดีกว่าไม่มีโลโก้เลย
  console.warn('[predict.vlr debug] ดึงโลโก้ทีมจาก /rankings ไม่สำเร็จรอบนี้ ใช้แคชเดิม (ถ้ามี) แทน');
  return logoMapCache.map;
}

/* ---------------- team info modal (roster / rating / players) ---------------- */
// ปุ่ม "ⓘ" บนการ์ดแมตช์ -> เปิด modal แสดงข้อมูลทีม: โลโก้, rating/rank, roster (ผู้เล่น+role+กัปตัน), ผลงานล่าสุด
// ดึงจาก vlrggapi ตัวเดียวกัน (API_BASE) 2 ขั้นตอน: 1) /search หาไอดีทีมจากชื่อ 2) /team?id=..&q=profile ดึงโปรไฟล์
//
// หมายเหตุ: README ของ vlrggapi บอกว่า endpoint เดิม (ไม่ใช่ /v2) "mirror" โครงสร้างข้อมูลเดียวกับ v2
// แต่ไม่ได้ยืนยันชัดว่า wrap ด้วย {"data":...} หรือ {"status":"success","data":...} เหมือนกันเป๊ะ
// unwrapPayload() ด้านล่างเลยรองรับทั้งสองแบบกันพัง ถ้า instance ที่ self-host ไว้ตอบมาคนละฟอร์แมต

// ชื่อทีม (lowercase) -> team id ของ vlr.gg (ได้จาก /search) ไม่ต้องหมดอายุเพราะไอดีทีมไม่เปลี่ยน
const teamIdCache = new Map();
// team id -> { data: profile, fetchedAt } cache กันยิงซ้ำเวลาเปิดดูทีมเดิมซ้ำๆ
const teamProfileCache = new Map();
const TEAM_PROFILE_TTL_MS = 30 * 60 * 1000; // 30 นาที
let teamInfoRequestSeq = 0; // กันเคสกดเปิดทีม A แล้วรีบกดเปิดทีม B ก่อนทีม A โหลดเสร็จ ไม่ให้ผลของ A มา render ทับ B

function unwrapPayload(res) {
  if (!res) return null;
  if (res.status === 'success' && res.data !== undefined) return res.data;
  if (res.data !== undefined) return res.data;
  return res;
}

// ลองยิงหลาย path เรียงลำดับ ใช้ผลแรกที่สำเร็จ (กันเคส self-host คนละ commit กัน บาง instance มีแค่ endpoint
// เดิม บาง instance ต้องใช้ /v2 เท่านั้น) ถ้าพังหมดทุก path จะ throw error ของ path สุดท้ายออกไป พร้อม log ราย path
async function apiGetFirstOk(paths, debugLabel) {
  let lastErr;
  for (const path of paths) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}${path}`, FETCH_TIMEOUT_MS);
      console.log(`[predict.vlr debug] ${debugLabel}: ${path} สำเร็จ`, res);
      return res;
    } catch (e) {
      console.warn(`[predict.vlr debug] ${debugLabel}: ${path} พลาด —`, e.message || e);
      lastErr = e;
    }
  }
  throw lastErr;
}

async function findTeamId(teamName) {
  const key = (teamName || '').trim().toLowerCase();
  if (!key) return null;
  if (teamIdCache.has(key)) return teamIdCache.get(key);
  try {
    const res = await apiGetFirstOk([
      `/search?q=${encodeURIComponent(teamName)}`,
      `/v2/search?q=${encodeURIComponent(teamName)}`,
    ], `findTeamId("${teamName}")`);
    const payload = unwrapPayload(res);
    const teams = payload?.segments?.results?.teams || payload?.results?.teams || payload?.teams || [];
    // แมตช์บางอันในฟีดใช้ "ชื่อย่อ/แท็ก" ของทีม (เช่น "FS" = Full Sense, "GE" = Global Esports) แทนชื่อเต็ม
    // เช็ค field "tag" ของผลลัพธ์ก่อนชื่อเต็ม เพื่อให้แม่นขึ้นเวลาค้นด้วยชื่อย่อ
    // ถ้าไม่มีอันไหนตรงเป๊ะเลย (ทั้งแท็กและชื่อ) ค่อย fallback ไปผลลัพธ์แรกที่ API คืนมาเหมือนเดิม
    // (ดีกว่าไม่โชว์อะไรเลย เพราะส่วนใหญ่ผลลัพธ์แรกที่ vlr.gg search คืนมาก็มักจะถูกอยู่แล้ว)
    const tagExact = teams.find(t => (t.tag || '').trim().toLowerCase() === key);
    const nameExact = teams.find(t => (t.name || '').trim().toLowerCase() === key);
    const picked = tagExact || nameExact || teams[0] || null;
    const id = picked ? picked.id : null;
    if (!id) console.warn(`[predict.vlr debug] findTeamId("${teamName}") ไม่พบทีมใน response`, payload);
    teamIdCache.set(key, id);
    return id;
  } catch (e) {
    console.warn('[predict.vlr debug] ค้นหา team id ไม่สำเร็จ (ทุก path พังหมด):', teamName, e);
    return null;
  }
}

async function fetchTeamProfile(teamId) {
  const cached = teamProfileCache.get(teamId);
  if (cached && (Date.now() - cached.fetchedAt) < TEAM_PROFILE_TTL_MS) return cached.data;
  const res = await apiGetFirstOk([
    `/team?id=${encodeURIComponent(teamId)}&q=profile`,
    `/v2/team?id=${encodeURIComponent(teamId)}&q=profile`,
  ], `fetchTeamProfile(${teamId})`);
  const data = unwrapPayload(res);
  if (!data?.info) console.warn(`[predict.vlr debug] fetchTeamProfile(${teamId}) response ไม่มี info`, data);
  if (data) teamProfileCache.set(teamId, { data, fetchedAt: Date.now() });
  return data;
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function teamInfoErrorHtml(teamName) {
  return `
    <div class="team-info-header"><h3 class="team-info-name">${escapeHtml(teamName)}</h3></div>
    <p class="team-info-error">⚠️ ดึงข้อมูลทีมนี้ไม่ได้ตอนนี้ — อาจหาทีมนี้ไม่เจอบน vlr.gg (เช่น ชื่อทีมสะกดคนละแบบ) หรือ API ล่มชั่วคราว<br>
    (เปิด F12 → Console เพื่อดู log รายละเอียดว่า endpoint ไหนพัง)</p>`;
}

function teamInfoHtml(profile, fallbackName) {
  const info = profile.info || {};
  const rating = profile.rating || {};
  const roster = profile.roster || [];
  const placements = profile.event_placements || [];
  const rawLogo = info.logo || '';
  const logo = rawLogo ? (rawLogo.startsWith('//') ? `https:${rawLogo}` : rawLogo) : PLACEHOLDER_LOGO;

  const rosterHtml = roster.length ? roster.map(p => `
    <div class="roster-card">
      <img class="roster-avatar" src="${p.avatar || PLACEHOLDER_LOGO}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div class="roster-alias">${escapeHtml(p.alias)}${p.is_captain ? ' <span class="roster-captain" title="กัปตันทีม">★</span>' : ''}</div>
      <div class="roster-role">${escapeHtml(p.role || '')}</div>
    </div>`).join('') : '<p class="team-info-empty">ไม่มีข้อมูลผู้เล่น</p>';

  const placementsHtml = placements.length ? `
    <ul class="placement-list">
      ${placements.slice(0, 8).map(pl => `
        <li>
          <span>${escapeHtml(pl.event || '')}</span>
          <span class="placement-badge">${escapeHtml(pl.placement || '')}</span>
          ${pl.prize ? `<span class="placement-prize">${escapeHtml(pl.prize)}</span>` : ''}
        </li>`).join('')}
    </ul>` : '<p class="team-info-empty">ยังไม่มีประวัติผลงาน</p>';

  return `
    <div class="team-info-header">
      <img class="team-info-logo" src="${logo}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      <div>
        <h3 class="team-info-name">${escapeHtml(info.name || fallbackName)}${info.tag ? ` <span class="team-info-tag">[${escapeHtml(info.tag)}]</span>` : ''}</h3>
        <p class="team-info-country">${escapeHtml(info.country || '')}</p>
        <div class="team-info-rating-row">
          ${rating.vlr_rating ? `<span class="team-info-stat">RATING <strong>${escapeHtml(rating.vlr_rating)}</strong></span>` : ''}
          ${rating.rank ? `<span class="team-info-stat">RANK <strong>#${escapeHtml(rating.rank)}</strong></span>` : ''}
          ${rating.region ? `<span class="team-info-stat">REGION <strong>${escapeHtml(String(rating.region).toUpperCase())}</strong></span>` : ''}
        </div>
      </div>
    </div>
    ${profile.total_winnings ? `<p class="team-info-winnings">รายได้รวม: <strong>${escapeHtml(profile.total_winnings)}</strong></p>` : ''}
    <h4 class="team-info-subtitle">รายชื่อผู้เล่น</h4>
    <div class="roster-grid">${rosterHtml}</div>
    <h4 class="team-info-subtitle">ผลงานล่าสุด</h4>
    ${placementsHtml}`;
}

// จำแท็บที่ผู้ใช้อยู่ก่อนกดปุ่ม ⓘ ไว้ เพื่อให้ปุ่ม "กลับ" พาย้อนกลับไปหน้าเดิมที่ถูกต้อง
let teamInfoPreviousTab = 'predict';

function goToTeamInfoPage() {
  const activePanel = document.querySelector('.tab-panel.active');
  // ถ้าแท็บที่ active อยู่ตอนนี้ไม่ใช่หน้า teaminfo เอง ให้จำไว้เป็นแท็บที่จะย้อนกลับไป
  if (activePanel && activePanel.id !== 'tab-teaminfo') {
    teamInfoPreviousTab = activePanel.id.replace('tab-', '');
  }
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-teaminfo').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function openTeamInfo(teamName) {
  goToTeamInfoPage();
  const body = document.getElementById('team-info-body');
  const mySeq = ++teamInfoRequestSeq;
  body.innerHTML = `<p class="team-info-loading">กำลังโหลดข้อมูล ${escapeHtml(teamName)} ...</p>`;

  try {
    const teamId = await findTeamId(teamName);
    if (mySeq !== teamInfoRequestSeq) return; // ผู้ใช้เปิดทีมอื่นไปแล้วระหว่างรอ ไม่ต้อง render ทับ
    if (!teamId) { body.innerHTML = teamInfoErrorHtml(teamName); return; }
    const profile = await fetchTeamProfile(teamId);
    if (mySeq !== teamInfoRequestSeq) return;
    if (!profile || !profile.info) { body.innerHTML = teamInfoErrorHtml(teamName); return; }
    body.innerHTML = teamInfoHtml(profile, teamName);
  } catch (e) {
    console.warn('[predict.vlr debug] เปิดข้อมูลทีมไม่สำเร็จ:', teamName, e);
    if (mySeq === teamInfoRequestSeq) body.innerHTML = teamInfoErrorHtml(teamName);
  }
}

function closeTeamInfo() {
  switchTab(teamInfoPreviousTab);
}

// ---- แปลงเวลาแข่งจาก API เป็น Date object ใช้เทียบเวลาปิดรับเดิมพัน (BET_CUTOFF_MS) ----
// vlrggapi field ชื่อ "unix_timestamp" แต่บางเวอร์ชันส่งเป็นตัวเลข epoch วินาทีจริงๆ
// บางเวอร์ชันส่งเป็นสตริงวันที่ "YYYY-MM-DD HH:mm:ss" (ถือว่าเป็น UTC) เลยรองรับทั้งสองแบบ
function parseMatchTimestamp(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return isNaN(d.getTime()) ? null : d;
}

function normalizeMatch(m, logoMap) {
  const tournamentName = m.match_event || '';
  const lookupLogo = name => (logoMap && logoMap.get((name || '').trim().toLowerCase())) || PLACEHOLDER_LOGO;
  return {
    team1: m.team1 || 'TBD',
    team2: m.team2 || 'TBD',
    team1_logo: lookupLogo(m.team1),
    team2_logo: lookupLogo(m.team2),
    match_event: tournamentName,
    match_series: m.match_series || '',
    time_until_match: m.time_until_match || '',
    match_time: parseMatchTimestamp(m.unix_timestamp), // ใช้เช็คปิดรับเดิมพันก่อนแข่งเริ่ม
    match_page: m.match_page || `${m.team1}-${m.team2}-${m.time_until_match}`,
    category: classifyTournament(tournamentName),
  };
}

function normalizeResult(r, logoMap) {
  const tournamentName = r.tournament_name || '';
  const lookupLogo = name => (logoMap && logoMap.get((name || '').trim().toLowerCase())) || PLACEHOLDER_LOGO;
  return {
    team1: r.team1 || 'TBD',
    team2: r.team2 || 'TBD',
    team1_logo: lookupLogo(r.team1),
    team2_logo: lookupLogo(r.team2),
    score1: r.score1,
    score2: r.score2,
    match_event: tournamentName,
    match_page: r.match_page,
    time_completed: r.time_completed || '',
    category: classifyTournament(tournamentName),
  };
}

// ---- แมตช์สด (q=live_score) ----
// endpoint นี้ต่างจาก upcoming/results ตรงที่ส่ง team1_logo/team2_logo มาให้ตรงๆ อยู่แล้ว
// (ไม่ต้องพึ่ง logoMap จาก /rankings) แต่ใส่ fallback ไว้เผื่อบางแมตช์ไม่มีโลโก้ติดมา

// บาง instance ของ vlrggapi (self-host) ถ้า scraper ฝั่ง backend ดึงข้อมูลแมพ/ราวด์จากหน้า vlr.gg
// ไม่สำเร็จ (เช่นโครงสร้างหน้าเปลี่ยน หรือแมตช์นั้นยังไม่เริ่มจริงๆ) จะส่ง string literal เช่น
// "Unknown" หรือ "N/A" กลับมาแทนที่จะเป็นค่าว่าง ถ้าไม่กรองทิ้งจะโชว์ทะลุขึ้นหน้าเว็บเป็นข้อความมั่วๆ
// (เช่น "Unknown · แมพที่ Unknown", "CT N/A / T N/A") ฟังก์ชันนี้แปลง placeholder พวกนี้ให้เป็นค่าว่าง
const LIVE_PLACEHOLDER_VALUES = new Set(['unknown', 'n/a', 'na', 'tbd', '-', '--', 'null', 'undefined']);
function cleanLiveField(value) {
  const s = (value ?? '').toString().trim();
  return LIVE_PLACEHOLDER_VALUES.has(s.toLowerCase()) ? '' : s;
}

function normalizeLiveMatch(m, logoMap) {
  const tournamentName = m.match_event || '';
  const lookupLogo = name => (logoMap && logoMap.get((name || '').trim().toLowerCase())) || PLACEHOLDER_LOGO;
  return {
    team1: m.team1 || 'TBD',
    team2: m.team2 || 'TBD',
    team1_logo: m.team1_logo || lookupLogo(m.team1),
    team2_logo: m.team2_logo || lookupLogo(m.team2),
    score1: m.score1 ?? '0',
    score2: m.score2 ?? '0',
    team1_round_ct: cleanLiveField(m.team1_round_ct),
    team1_round_t: cleanLiveField(m.team1_round_t),
    team2_round_ct: cleanLiveField(m.team2_round_ct),
    team2_round_t: cleanLiveField(m.team2_round_t),
    map_number: cleanLiveField(m.map_number),
    current_map: cleanLiveField(m.current_map),
    match_event: tournamentName,
    match_series: m.match_series || '',
    match_page: m.match_page || `${m.team1}-${m.team2}-${tournamentName}-live`,
    category: classifyTournament(tournamentName),
  };
}

// ---- หมายเหตุ China ----
// API ตัวก่อนหน้า (vlr.orlandomm.net) มีปัญหาดึงแมตช์ China มาไม่ครบ เลยต้องมีโค้ด backfill แยกยิง region=ch
// API ตัวใหม่ (vlrggapi ที่ deploy เอง) สแครปหน้าแมตช์ vlr.gg ตรงๆ แบบเดียวกับที่เว็บ vlr.gg แสดงผลเอง
// จึงไม่มีปัญหานี้แล้ว — ตัดโค้ด backfill ทิ้งเพื่อความเรียบง่าย ถ้าพบว่าแมตช์ China ยังหายไปอีก ค่อยกลับมาเพิ่มทีหลัง

async function loadMatches() {
  const statusEl = document.getElementById('data-status');
  statusEl.textContent = 'กำลังดึงข้อมูลแมตช์จาก vlr.gg ...';
  try {
    // แก้บั๊ก "แมตช์มีน้อย": เดิมยิง q=upcoming ซึ่งคืนมาแค่ชุดสั้นๆ (เหมือนวิดเจ็ตหน้าแรก vlr.gg)
    // เปลี่ยนเป็น q=upcoming_extended ซึ่ง endpoint เดียวกันของ vlrggapi ให้รายการแมตช์ที่กำลังจะมาถึงยาวกว่ามาก
    const [matchesRes, resultsRes, logoMap] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/match?q=upcoming_extended`, FETCH_TIMEOUT_MS),
      fetchWithTimeout(`${API_BASE}/match?q=results`, FETCH_TIMEOUT_MS),
      buildLogoMap(),
    ]);
    const rawUpcoming = matchesRes?.data?.segments || [];
    const rawResults = resultsRes?.data?.segments || [];

    state.upcoming = rawUpcoming.map(m => normalizeMatch(m, logoMap));
    state.results = rawResults.map(r => normalizeResult(r, logoMap));
    state.usingFallback = false;
    statusEl.textContent = `เชื่อมต่อ vlr.gg สำเร็จ • ทุกลีก • ${state.upcoming.length} แมตช์ที่กำลังจะแข่ง`;

    // DEBUG: เปิด F12 -> Console เพื่อดูข้อมูลดิบที่ API ส่งมา ช่วยตรวจสอบตอนมีปัญหา
    console.log(`[predict.vlr debug] จำนวนแมตช์ที่กำลังจะแข่ง: ${state.upcoming.length}`, state.upcoming.slice(0, 5));
    console.log(`[predict.vlr debug] จำนวนผลแมตช์ที่ดึงมาได้ (state.results): ${state.results.length}`, state.results.slice(0, 5));
    console.table(
      [...new Map(state.upcoming.map(m => [m.match_event, m.category])).entries()]
        .map(([tournament, category]) => ({ tournament, category }))
    );
  } catch (e) {
    console.warn('ดึงข้อมูลจาก vlr.gg ไม่สำเร็จ ใช้ข้อมูลตัวอย่างแทน', e);
    state.upcoming = FALLBACK_UPCOMING.map(m => ({ ...m, category: classifyTournament(m.match_event) }));
    state.results = FALLBACK_RESULTS.map(r => ({ ...r, category: classifyTournament(r.match_event) }));
    state.usingFallback = true;
    statusEl.textContent = '⚠️ ต่อ API ของ vlr.gg ไม่ได้ตอนนี้ (unofficial API อาจล่มชั่วคราว) กำลังแสดงข้อมูลตัวอย่าง';
  }
  resolvePendingPredictions();
  renderPredictTab();
}

// ---- แมตช์สด + สกอร์เรียลไทม์ (ของใหม่) ----
// vlrggapi มี endpoint q=live_score แยกต่างหาก ให้สกอร์ปัจจุบัน/ราวด์ CT-T/แมพที่กำลังเล่นของแมตช์ที่ไลฟ์อยู่
// เดิมเว็บนี้ไม่เคยเรียก endpoint นี้เลย เลยไม่มีการแสดงผลสดๆ แก้โดยเพิ่มฟังก์ชันนี้ + poll ทุก 30 วิ (ตาม cache ของ API)
async function loadLiveScores() {
  try {
    const logoMap = await buildLogoMap(); // ใช้แคชเดิมถ้ายังไม่หมดอายุ ไม่ยิงซ้ำ
    const liveRes = await fetchWithTimeout(`${API_BASE}/match?q=live_score`, FETCH_TIMEOUT_MS);
    const rawLive = liveRes?.data?.segments || [];
    const newLive = rawLive.map(m => normalizeLiveMatch(m, logoMap));
    const newLiveKeys = new Set(newLive.map(m => m.match_page));

    // เทียบกับ snapshot รอบก่อน (เก็บไว้ใน localStorage): แมตช์ไหนเคยอยู่ใน live_score
    // แต่รอบนี้หลุดไปแล้ว = เพิ่งจบ ให้เก็บสกอร์สุดท้ายไว้โชว์ต่อ (ตั้งเวลาจบครั้งแรกเท่านั้น ไม่รีเซ็ตซ้ำ)
    const prevSnapshot = loadLiveSnapshot();
    Object.keys(prevSnapshot).forEach(key => {
      if (!newLiveKeys.has(key) && !state.finishedLive[key]) {
        state.finishedLive[key] = { match: prevSnapshot[key], finishedAt: Date.now() };
      }
    });
    // ถ้าแมตช์กลับมาไลฟ์อีก (API แกว่ง/รีสตาร์ทแมพ) เอาออกจากรายการ "จบแล้ว"
    newLiveKeys.forEach(key => { delete state.finishedLive[key]; });

    pruneFinishedLive(state.finishedLive); // ลบรายการที่จบเกิน 24 ชม. ทิ้ง
    saveFinishedLiveCache(state.finishedLive);

    // เก็บ snapshot ของไลฟ์ตอนนี้ไว้เทียบรอบถัดไป (คีย์ตาม match_page)
    const snapshotMap = {};
    newLive.forEach(m => { snapshotMap[m.match_page] = m; });
    saveLiveSnapshot(snapshotMap);

    state.live = newLive;
    console.log(`[predict.vlr debug] จำนวนแมตช์ที่กำลังแข่งสด (live): ${state.live.length}`, state.live);
  } catch (e) {
    // ไม่ล้าง state.live ทิ้งถ้าพลาดรอบนี้ (เช่น timeout ชั่วคราว) ปล่อยให้โชว์ค่าล่าสุดที่เคยได้ต่อไปก่อน
    console.warn('ดึงสกอร์เรียลไทม์ (live_score) ไม่สำเร็จรอบนี้', e);
  }
  renderPredictTab();
}

/* ---------------- prediction resolution ---------------- */

// สกอร์จริงของแมตช์ในรูปแบบ "2-0" / "2-1" นับจากมุมมองของ pick (ทีมที่ผู้เล่นทาย)
// คืนค่า null ถ้าตัดสินสกอร์แบบ BO3 ไม่ได้ (เช่น ผลรวมไม่ใช่ 3 เกม อย่าง BO5)
function bo3ScoreFromPickPerspective(s1, s2, pick) {
  const total = s1 + s2;
  if (total !== 3) return null; // ไม่ใช่ผล BO3 (2-0 หรือ 2-1) ตัดสินสกอร์ไม่ได้
  const pickScore = pick === 'team1' ? s1 : s2;
  const oppScore = pick === 'team1' ? s2 : s1;
  return `${pickScore}-${oppScore}`;
}

function resolvePendingPredictions() {
  if (!state.data) return;
  let changed = false;
  const newlyResolved = []; // เก็บผลที่เพิ่งตัดสินได้ในรอบนี้ ไว้เด้งแจ้งเตือนหลังลูป
  for (const key of Object.keys(state.data.predictions)) {
    const pred = state.data.predictions[key];
    if (pred.resolved) continue;
    const norm = s => (s || '').trim().toLowerCase();
    const keyId = extractVlrMatchId(key);
    const match = state.results.find(r => {
      const rId = extractVlrMatchId(r.match_page);
      return (keyId && rId && keyId === rId) ||
        (norm(r.team1) === norm(pred.team1) && norm(r.team2) === norm(pred.team2)) ||
        (norm(r.team1) === norm(pred.team2) && norm(r.team2) === norm(pred.team1)); // เผื่อ API คืนลำดับทีมสลับข้าง
    });
    if (!match) {
      // DEBUG: เปิด F12 -> Console เพื่อดูว่าทำไม prediction นี้ยังจับคู่กับผลไม่เจอ
      // (ช่วยเช็คว่าชื่อทีม/ไอดีไม่ตรงกันแบบไหน)
      console.log(`[predict.vlr debug] ยังหาผลไม่เจอสำหรับ: ${pred.team1} vs ${pred.team2} (key=${key})`);
      // หาผลแมตช์นี้ใน feed ปัจจุบันไม่เจอ (อาจยังไม่จบ หรือจบไปนานจนหลุด feed แล้ว)
      // prediction เก่าที่สร้างไว้ก่อนอัปเดตนี้จะไม่มี createdAt -> เริ่มนับอายุจาก "ตอนนี้" แทน
      // (กันไม่ให้ของเก่าที่ค้างอยู่แล้วโดนตัดสินว่า "หมดอายุ" ทันทีตั้งแต่รอบแรกที่เจอ)
      if (!pred.createdAt) {
        pred.createdAt = Date.now();
        changed = true;
        continue;
      }
      const age = Date.now() - pred.createdAt;
      if (age < STALE_PREDICTION_MS) continue; // ยังไม่นานพอ รอรอบถัดไป

      // ค้างเกิน STALE_PREDICTION_DAYS วันแล้วยังหาผลไม่เจอ -> คืนเดิมพันเต็มจำนวน ไม่นับสถิติ
      pred.resolved = true;
      pred.correct = null; // ไม่รู้ผลจริง จึงไม่นับเป็นถูกหรือผิด
      pred.reward = pred.bet || BET_COST;
      state.data.points += pred.reward;
      changed = true;
      newlyResolved.push({ key, pred, outcome: 'expired' });
      continue;
    }
    // ถ้า API คืนลำดับทีมสลับข้าง ต้องสลับสกอร์ให้ตรงมุมมอง pred.team1/pred.team2 ด้วย
    // ไม่งั้นจะตัดสินผู้ชนะผิดฝั่ง (team1 ของ pred อาจไม่ใช่ team1 ของผลลัพธ์)
    const isSwapped = norm(match.team1) === norm(pred.team2) && norm(match.team2) === norm(pred.team1);
    const s1 = parseInt(isSwapped ? match.score2 : match.score1, 10);
    const s2 = parseInt(isSwapped ? match.score1 : match.score2, 10);
    if (isNaN(s1) || isNaN(s2)) continue;
    const winner = s1 > s2 ? 'team1' : (s2 > s1 ? 'team2' : null);
    if (!winner) continue;
    pred.resolved = true;
    pred.correct = winner === pred.pick;
    state.data.stats.total += 1;
    const bet = pred.bet || BET_COST;

    // โหมดทายสกอร์ BO3: pred.predictedScore เป็น "2-0" หรือ "2-1" (มุมมองทีมที่ pick ไว้ว่าจะชนะ)
    const actualScoreFromPickView = bo3ScoreFromPickPerspective(s1, s2, pred.pick);
    let outcome; // 'score_exact' | 'score_mirror' | 'normal'
    if (pred.predictedScore && actualScoreFromPickView) {
      if (pred.correct && pred.predictedScore === actualScoreFromPickView) {
        outcome = 'score_exact'; // ทายทีมถูก และสกอร์ตรงเป๊ะ
      } else if (!pred.correct && pred.predictedScore === actualScoreFromPickView) {
        outcome = 'score_mirror'; // ทายทีมผิด (แพ้แทนที่จะชนะ) แต่สกอร์ตรงกับที่ทายไว้แบบสลับข้าง
      } else {
        outcome = 'normal';
      }
    } else {
      outcome = 'normal';
    }

    if (outcome === 'score_exact') {
      state.data.stats.correct += 1;
      pred.reward = Math.round(bet * SCORE_WIN_MULTIPLIER); // ทายสกอร์ถูกเป๊ะ -> x3
      state.data.points += pred.reward;
    } else if (outcome === 'score_mirror') {
      pred.reward = Math.round(bet * SCORE_MIRROR_REFUND_RATE); // สกอร์ตรงแต่ทายทีมผิด -> คืน 50%
      state.data.points += pred.reward;
    } else if (pred.correct) {
      state.data.stats.correct += 1;
      pred.reward = Math.round(bet * WIN_PAYOUT_MULTIPLIER);
      state.data.points += pred.reward;
    } else {
      pred.reward = Math.round(bet * LOSE_REFUND_RATE); // คืนแค่ 25% ของที่เสียไป
      state.data.points += pred.reward;
    }
    changed = true;
    newlyResolved.push({ key, pred, outcome });
  }
  if (changed) {
    persist();
    renderTopbar();
    newlyResolved.forEach(({ pred, outcome }) => showMatchResultToast(pred, outcome));
  }
}

/* ---------------- match-result toast notifications ---------------- */
// เด้งแจ้งเตือนมุมจอเมื่อแมตช์ที่ทายไว้ตัดสินผลได้แล้ว (ไม่ใช้ alert() เพราะถ้าจบพร้อมกันหลายแมตช์
// จะบล็อกหน้าจอทีละอัน) กล่องนี้จะหายไปเองหลังไม่กี่วินาที หรือกดปิดเองได้
function getOrCreateToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showMatchResultToast(pred, outcome) {
  const container = getOrCreateToastContainer();
  const pickedTeam = pred.pick === 'team1' ? pred.team1 : pred.team2;
  const isWin = outcome === 'score_exact' || (outcome === 'normal' && pred.correct);
  const isMirror = outcome === 'score_mirror';

  let statusClass, statusLabel;
  if (outcome === 'expired') { statusClass = 'toast-expired'; statusLabel = '⏳ หาผลไม่เจอ (ค้างนานเกินไป) คืนแต้มเต็ม'; }
  else if (outcome === 'score_exact') { statusClass = 'toast-win'; statusLabel = '🎯 ทายสกอร์ถูกเป๊ะ!'; }
  else if (isMirror) { statusClass = 'toast-mirror'; statusLabel = '🔁 สกอร์ตรงแต่ทายทีมพลาด'; }
  else if (isWin) { statusClass = 'toast-win'; statusLabel = '✅ ทายถูก!'; }
  else { statusClass = 'toast-lose'; statusLabel = '❌ ทายผิด'; }

  const toast = document.createElement('div');
  toast.className = `match-toast ${statusClass}`;
  toast.innerHTML = `
    <button class="match-toast-close" aria-label="ปิด">✕</button>
    <p class="match-toast-status">${statusLabel}</p>
    <p class="match-toast-match">${pred.team1} vs ${pred.team2}</p>
    <p class="match-toast-detail">คุณทาย: ${pickedTeam}${pred.predictedScore ? ` (${pred.predictedScore})` : ''}</p>
    <p class="match-toast-reward">${pred.reward >= 0 ? '+' : ''}${pred.reward} PT</p>
  `;
  toast.querySelector('.match-toast-close').addEventListener('click', () => removeToast(toast));
  container.appendChild(toast);

  // auto-dismiss หลัง 8 วินาที
  const timer = setTimeout(() => removeToast(toast), 8000);
  toast.dataset.timerId = timer;
}

function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  clearTimeout(Number(toast.dataset.timerId));
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 200);
}

/* ---------------- predicting ---------------- */

// เดิมพันได้ก็ต่อเมื่อยังเหลือเวลาก่อนแข่งเริ่มมากกว่า BET_CUTOFF_MS (1 ชม.)
// เดิม code ถ้าไม่รู้เวลาแข่ง (match_time = null) จะปล่อยให้เดิมพันได้ตลอด (bug: แมตช์ที่ API
// ส่ง unix_timestamp มาไม่ได้/parse ไม่ออก จะเดิมพันได้ไปเรื่อยๆ แม้แข่งเริ่มไปแล้วก็ตาม)
// แก้ให้ปล่อยผ่าน (true) เฉพาะตอนใช้ "ข้อมูลตัวอย่าง" (state.usingFallback) เท่านั้น
// ส่วนข้อมูลจริงจาก API ถ้าไม่รู้เวลาแข่ง ให้ถือว่าปิดรับเดิมพันไว้ก่อนเพื่อความปลอดภัย
function isBettingOpen(match) {
  if (!match) return true;
  if (!match.match_time) return !!state.usingFallback;
  return (match.match_time.getTime() - Date.now()) > BET_CUTOFF_MS;
}

function makePrediction(matchKey, pick, team1, team2, event, rawBet, rawScorePick) {
  if (!state.user) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะทายผลได้'); return; }
  if (state.data.predictions[matchKey]) return; // already predicted

  // เช็คซ้ำฝั่งนี้กันกรณี UI ยังไม่ re-render ทันตอนใกล้ปิดรับเดิมพันพอดี (การ์ดจะ re-render เองทุก 30 วิ อยู่แล้ว)
  const match = state.upcoming.find(m => (m.match_page || `${m.team1}-${m.team2}`) === matchKey);
  if (match && !isBettingOpen(match)) {
    alert(`ปิดรับเดิมพันแมตช์นี้แล้ว (เหลือเวลาน้อยกว่า ${Math.round(BET_CUTOFF_MS / 60000)} นาทีก่อนแข่งเริ่ม)`);
    renderPredictTab();
    return;
  }

  let bet = parseInt(rawBet, 10);
  if (isNaN(bet)) bet = BET_COST;
  // ไม่มีเพดานบนอีกต่อไป (MAX_BET = Infinity) เดิมพันได้สูงสุดเท่าที่มีแต้ม (รองรับ ALL IN)
  bet = Math.max(MIN_BET, Math.min(MAX_BET, bet, state.data.points));

  if (state.data.points < bet) { alert(`แต้มไม่พอสำหรับเดิมพัน ${bet} แต้ม (มีอยู่ ${state.data.points})`); return; }
  if (state.data.points < MIN_BET) { alert(`แต้มไม่พอสำหรับเดิมพันขั้นต่ำ ${MIN_BET} แต้ม (มีอยู่ ${state.data.points})`); return; }

  // ทายสกอร์ BO3 (ตัวเลือกเสริม): '2-0' | '2-1' | '' (ไม่ทายสกอร์)
  const predictedScore = (rawScorePick === '2-0' || rawScorePick === '2-1') ? rawScorePick : null;

  state.data.points -= bet;
  state.data.predictions[matchKey] = { pick, team1, team2, event, bet, predictedScore, resolved: false, correct: null, reward: null, createdAt: Date.now() };
  persist();
  renderPredictTab();
  renderTopbar();
}

// ผู้เล่นกด ALL IN เพื่อเดิมพันแต้มทั้งหมดที่มี (เติมค่าลงช่องกรอกเดิมพันให้)
function setAllIn(betInputId) {
  const input = document.getElementById(betInputId);
  if (!input || !state.data) return;
  input.value = state.data.points;
}

/* ---------------- gacha ---------------- */

function weightedPick(catalog) {
  const withWeight = catalog.map(item => ({ item, weight: RARITY[item.rarity].weight }));
  const total = withWeight.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * total;
  for (const w of withWeight) {
    if (r < w.weight) return w.item;
    r -= w.weight;
  }
  return withWeight[0].item;
}

function openCase() {
  if (!state.user) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะเปิดกล่องได้'); return; }
  const freeAvailable = (state.data.freeCases || 0) > 0;
  if (!freeAvailable && state.data.points < GACHA_COST) { alert('แต้มไม่พอ ต้องมีอย่างน้อย ' + GACHA_COST + ' แต้ม (หรือรอรับกล่องฟรีจากโบนัสรายวัน)'); return; }

  // ไอเทมที่ทำเครื่องหมาย codeOnly (เช่น frame_fullsense) ปลดล็อกได้ผ่านโค้ดเท่านั้น ห้ามหลุดมาให้สุ่มติดจากกล่อง
  const pool = [...FRAME_CATALOG, ...THEME_CATALOG].filter(item => !item.codeOnly);
  const won = weightedPick(pool);
  if (freeAvailable) {
    state.data.freeCases -= 1;
  } else {
    state.data.points -= GACHA_COST;
  }

  const isFrame = FRAME_CATALOG.includes(won);
  const ownedList = isFrame ? state.data.ownedFrames : state.data.ownedThemes;
  const alreadyOwned = ownedList.includes(won.id);
  if (!alreadyOwned) ownedList.push(won.id);
  else state.data.points += 15; // duplicate compensation

  persist();
  playCaseAnimation(pool, won, alreadyOwned, freeAvailable);
  renderGachaTab();
  renderTopbar();
}

function playCaseAnimation(pool, won, wasDuplicate, wasFree) {
  const track = document.getElementById('case-track');
  const overlay = document.getElementById('case-overlay');
  overlay.classList.add('open');
  track.innerHTML = '';

  // build a long strip of random items ending in the winner
  const strip = [];
  for (let i = 0; i < 40; i++) strip.push(pool[Math.floor(Math.random() * pool.length)]);
  strip.push(won);
  for (let i = 0; i < 6; i++) strip.push(pool[Math.floor(Math.random() * pool.length)]);

  strip.forEach(item => {
    const el = document.createElement('div');
    el.className = 'case-item rarity-' + item.rarity;
    el.innerHTML = `<div class="case-item-swatch"></div><div class="case-item-name">${item.name}</div><div class="case-item-rarity">${RARITY[item.rarity].label}</div>`;
    track.appendChild(el);
  });

  const itemWidth = 132;
  const winnerIndex = 40;
  const offset = winnerIndex * itemWidth - itemWidth * 2.3;
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';
  // force reflow
  void track.offsetWidth;
  track.style.transition = 'transform 3.6s cubic-bezier(.12,.85,.15,1)';
  track.style.transform = `translateX(-${offset}px)`;

  setTimeout(() => {
    document.getElementById('case-result-name').textContent = won.name;
    const freeTag = wasFree ? ' • ใช้กล่องฟรีจากโบนัสรายวัน' : '';
    document.getElementById('case-result-rarity').textContent = RARITY[won.rarity].label + (wasDuplicate ? ' • ได้ซ้ำ (+15 แต้มชดเชย)' : ' • ไอเทมใหม่!') + freeTag;
    document.getElementById('case-result-rarity').style.color = RARITY[won.rarity].color;
    document.getElementById('case-result').classList.add('show');
  }, 3700);
}

function closeCaseOverlay() {
  document.getElementById('case-overlay').classList.remove('open');
  document.getElementById('case-result').classList.remove('show');
}

/* ---------------- point transfer ---------------- */

function transferPoints() {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะโอนแต้มได้'); return; }

  const emailInput = document.getElementById('transfer-email');
  const amountInput = document.getElementById('transfer-amount');
  const email = (emailInput.value || '').trim().toLowerCase();
  const amount = parseInt(amountInput.value, 10);

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert('กรอกอีเมลผู้รับให้ถูกต้อง'); return; }
  if (email === state.user.email.toLowerCase()) { alert('โอนแต้มให้ตัวเองไม่ได้'); return; }
  if (isNaN(amount) || amount < MIN_TRANSFER) { alert(`โอนขั้นต่ำ ${MIN_TRANSFER} แต้ม`); return; }
  if (amount > state.data.points) { alert(`แต้มไม่พอ (มีอยู่ ${state.data.points} แต้ม)`); return; }

  const registry = loadRegistry();
  const target = registry[email];

  state.data.points -= amount;

  if (target && target.sub !== state.user.sub) {
    // ผู้รับเคยล็อกอินบนเบราว์เซอร์นี้แล้ว -> โอนเข้าบัญชีได้ทันที
    const targetData = loadUserData(target.sub);
    targetData.points += amount;
    targetData.transferLog = targetData.transferLog || [];
    targetData.transferLog.unshift({ type: 'received', amount, counterpart: state.user.name, date: todayKey() });
    localStorage.setItem(saveKey(target.sub), JSON.stringify(targetData));

    state.data.transferLog.unshift({ type: 'sent', amount, counterpart: target.name || email, date: todayKey() });
    alert(`✅ โอน ${amount} แต้ม ให้ ${target.name || email} สำเร็จ!`);
  } else {
    // ยังไม่เจอบัญชีนี้บนเบราว์เซอร์นี้ -> พักแต้มไว้ก่อน จะได้รับอัตโนมัติตอนเขาล็อกอินบนเครื่องนี้
    const pending = loadPendingTransfers();
    if (!pending[email]) pending[email] = [];
    pending[email].push({ amount, fromName: state.user.name, fromEmail: state.user.email, date: todayKey() });
    savePendingTransfers(pending);

    state.data.transferLog.unshift({ type: 'sent', amount, counterpart: email, date: todayKey() });
    alert(`⏳ ยังไม่เจอบัญชีอีเมลนี้บนเบราว์เซอร์นี้เลย ระบบพัก ${amount} แต้มไว้ให้แล้ว จะเข้าบัญชีอัตโนมัติเมื่อ ${email} ล็อกอินบน "เบราว์เซอร์/อุปกรณ์เครื่องนี้" (เว็บนี้ยังไม่มีเซิร์ฟเวอร์กลาง จึงข้ามอุปกรณ์ไม่ได้)`);
  }

  persist();
  emailInput.value = '';
  amountInput.value = '';
  renderProfileTab();
  renderTopbar();
}

/* ---------------- redeem codes ---------------- */

function redeemCode() {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะกรอกโค้ดได้'); return; }

  const input = document.getElementById('redeem-code-input');
  const raw = (input.value || '').trim();
  if (!raw) { alert('กรอกโค้ดก่อนสิ'); return; }

  const key = raw.toLowerCase();
  const def = REDEEM_CODES[key];
  if (!def) { alert('โค้ดนี้ไม่ถูกต้อง หรือไม่มีอยู่จริง'); return; }

  state.data.redeemedCodes = state.data.redeemedCodes || [];
  if (!def.repeatable && state.data.redeemedCodes.includes(key)) { alert('คุณใช้โค้ดนี้ไปแล้ว ใช้ซ้ำไม่ได้นะ'); return; }

  // โค้ดแบบ repeatable (เช่น "fullsense") กรอกซ้ำได้ไม่จำกัดจำนวนครั้ง
  // แต่ถ้าไอเทม (แท็ก/เฟรม) ที่โค้ดให้ "มีอยู่ในบัญชีแล้ว" จะไม่เพิ่มของซ้ำเข้าบัญชีอีก
  // grantedNew ใช้เช็คว่ารอบนี้ได้ของ/แต้มใหม่จริงไหม เพื่อโชว์ข้อความให้ตรงกับสิ่งที่เกิดขึ้นจริง
  let grantedNew = false;

  if (def.amount) {
    state.data.points += def.amount;
    grantedNew = true; // แต้มบวกเพิ่มได้ทุกครั้ง ไม่มีของซ้ำให้เช็ค
  }

  if (def.tagId) {
    state.data.ownedTags = state.data.ownedTags || [];
    if (!state.data.ownedTags.includes(def.tagId)) {
      state.data.ownedTags.push(def.tagId);
      if (!state.data.equippedTag) state.data.equippedTag = def.tagId; // ใส่ให้อัตโนมัติถ้ายังไม่มีแท็กอื่นอยู่
      grantedNew = true;
    }
  }

  if (def.frameId) {
    state.data.ownedFrames = state.data.ownedFrames || [];
    if (!state.data.ownedFrames.includes(def.frameId)) {
      state.data.ownedFrames.push(def.frameId);
      grantedNew = true;
    }
  }

  if (!def.repeatable) state.data.redeemedCodes.push(key);
  persist();
  input.value = '';
  renderProfileTab();
  renderTopbar();

  if (grantedNew) {
    alert('🎉 ' + def.message);
  } else {
    alert('ℹ️ คุณมีของจากโค้ดนี้ครบทุกอย่างแล้ว โค้ดนี้ใช้ซ้ำได้ไม่จำกัด แต่จะไม่เพิ่มไอเทมซ้ำเข้าบัญชี');
  }
}

/* ---------------- profile editing: name + avatar ---------------- */

function updateDisplayName() {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อน'); return; }
  const input = document.getElementById('edit-name-input');
  const val = (input.value || '').trim();
  if (!val) { alert('กรอกชื่อก่อนสิ'); return; }
  if (val.length > 40) { alert('ชื่อยาวเกินไป (สูงสุด 40 ตัวอักษร)'); return; }
  state.data.customName = val;
  persist();
  renderTopbar();
  renderProfileTab();
  alert('✅ เปลี่ยนชื่อโปรไฟล์สำเร็จ');
}

function resetDisplayName() {
  if (!state.user || !state.data) return;
  state.data.customName = null;
  persist();
  renderTopbar();
  renderProfileTab();
}

function updateAvatar() {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อน'); return; }
  const input = document.getElementById('edit-avatar-input');
  const val = (input.value || '').trim();
  if (!val) { alert('กรอกลิงก์รูปก่อนสิ'); return; }
  try { new URL(val); } catch (e) { alert('ลิงก์รูปไม่ถูกต้อง'); return; }
  state.data.customAvatar = val;
  persist();
  renderTopbar();
  renderProfileTab();
  alert('✅ เปลี่ยนรูปโปรไฟล์สำเร็จ');
}

function resetAvatar() {
  if (!state.user || !state.data) return;
  state.data.customAvatar = null;
  persist();
  renderTopbar();
  renderProfileTab();
}

/* ---------------- profile tags ---------------- */

function equipTag(id) {
  state.data.equippedTag = id;
  persist();
  renderProfileTab();
}

function unequipTag() {
  state.data.equippedTag = null;
  persist();
  renderProfileTab();
}

function renderTagGrid() {
  const grid = document.getElementById('tag-grid');
  if (!grid || !state.data) return;
  const owned = state.data.ownedTags || [];
  const ownedTeams = state.data.ownedTeamTags || [];
  if (!owned.length && !ownedTeams.length) {
    grid.innerHTML = '<p class="empty">ยังไม่มีแท็ก — ปลดล็อกด้วยโค้ดพิเศษ หรือซื้อแท็กทีมด้านล่างด้วยแต้ม</p>';
    return;
  }
  const codeTagsHtml = owned.map(id => {
    const tag = TAG_CATALOG.find(t => t.id === id);
    if (!tag) return '';
    const equipped = state.data.equippedTag === id;
    return `
    <div class="inv-item ${equipped ? 'equipped' : ''}">
      <div class="tag-preview ${tag.css}">
        <span class="tag-preview-name">${tag.name}</span>
        <span class="tag-preview-text">${tag.text}</span>
      </div>
      <button class="inv-equip-btn" onclick="${equipped ? 'unequipTag()' : `equipTag('${tag.id}')`}">${equipped ? 'เลิกใส่' : 'สวมใส่'}</button>
    </div>`;
  }).join('');
  const teamTagsHtml = ownedTeams.map(t => {
    const equipped = state.data.equippedTag === t.id;
    return `
    <div class="inv-item ${equipped ? 'equipped' : ''}">
      <div class="tag-preview tag-team">
        <img class="tag-preview-logo" src="${t.logo || PLACEHOLDER_LOGO}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="tag-preview-name">${escapeHtml(t.name)}</span>
        <span class="tag-preview-text">realfan ${escapeHtml(t.name)}</span>
      </div>
      <button class="inv-equip-btn" onclick="${equipped ? 'unequipTag()' : `equipTag('${t.id}')`}">${equipped ? 'เลิกใส่' : 'สวมใส่'}</button>
    </div>`;
  }).join('');
  grid.innerHTML = codeTagsHtml + teamTagsHtml;
}

/* ---------------- team fan tags: shop (ซื้อด้วยแต้ม, โลโก้ดึงสดจาก vlr.gg) ---------------- */

// แปลงชื่อทีมเป็น id คงที่ เช่น "Paper Rex" -> "tag_team_paper-rex"
function teamTagId(teamName) {
  const slug = (teamName || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `tag_team_${slug}`;
}

let teamTagShopLoaded = false; // กัน buildLogoMap() ยิงซ้ำถ้าเปิดหน้าโปรไฟล์หลายรอบ (มี TTL cache ของตัวเองอยู่แล้วเช่นกัน)

async function ensureTeamTagShop(filterText = '') {
  const statusEl = document.getElementById('team-tag-shop-status');
  const grid = document.getElementById('team-tag-shop-grid');
  if (!grid) return;
  if (!teamTagShopLoaded) {
    if (statusEl) statusEl.textContent = 'กำลังโหลดรายชื่อทีม...';
    try {
      await buildLogoMap();
      teamTagShopLoaded = true;
      if (statusEl) statusEl.textContent = '';
    } catch (e) {
      if (statusEl) statusEl.textContent = 'โหลดรายชื่อทีมไม่สำเร็จ ลองรีเฟรชใหม่อีกครั้ง';
      console.warn('[team-tag-shop] โหลดรายชื่อทีมไม่สำเร็จ:', e);
      return;
    }
  }
  renderTeamTagShop(filterText);
}

function renderTeamTagShop(filterText = '') {
  const grid = document.getElementById('team-tag-shop-grid');
  if (!grid || !state.data) return;
  const q = filterText.trim().toLowerCase();
  const ownedIds = new Set((state.data.ownedTeamTags || []).map(t => t.id));
  let entries = [...logoMapCache.names.entries()] // [key, ชื่อทีมตัวพิมพ์จริง]
    .map(([key, name]) => ({ key, name, logo: logoMapCache.map.get(key) }))
    .filter(t => !q || t.key.includes(q));
  entries.sort((a, b) => a.name.localeCompare(b.name));
  if (q) entries = entries.slice(0, 60); // จำกัดผลค้นหาไม่ให้ยาวเกินไป
  else entries = entries.slice(0, 30);   // ไม่ค้นหา: โชว์ตัวอย่างพอหอมปากหอมคอ ให้พิมพ์ค้นหาต่อเอา

  if (!entries.length) {
    grid.innerHTML = `<p class="empty">ไม่พบชื่อทีมที่ตรงกับ "${escapeHtml(filterText)}"</p>`;
    return;
  }

  grid.innerHTML = entries.map(t => {
    const id = teamTagId(t.name);
    const owned = ownedIds.has(id);
    const equipped = state.data.equippedTag === id;
    const btnLabel = equipped ? 'เลิกใส่' : owned ? 'สวมใส่' : `ซื้อ ${TEAM_TAG_PRICE.toLocaleString()} PT`;
    const btnClick = equipped
      ? 'unequipTag()'
      : owned
        ? `equipTag('${id}')`
        : `buyTeamTag('${t.key.replace(/'/g, "\\'")}')`;
    return `
    <div class="inv-item ${equipped ? 'equipped' : ''}">
      <div class="tag-preview tag-team">
        <img class="tag-preview-logo" src="${t.logo || PLACEHOLDER_LOGO}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="tag-preview-name">${escapeHtml(t.name)}</span>
        <span class="tag-preview-text">realfan ${escapeHtml(t.name)}</span>
      </div>
      <button class="inv-equip-btn" onclick="${btnClick}">${btnLabel}</button>
    </div>`;
  }).join('');
}

async function buyTeamTag(key) {
  if (!state.user || !state.data) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะซื้อแท็กได้'); return; }
  // เผื่อ logoMap หมดอายุ/ยังไม่โหลดตอนนี้พอดี ต่อให้เพิ่งเปิดหน้าเว็บมาสดๆ ก็ยังซื้อได้
  if (!logoMapCache.names.size) await buildLogoMap();
  const name = logoMapCache.names.get(key);
  const logo = logoMapCache.map.get(key);
  if (!name) { alert('ไม่พบทีมนี้ในระบบแล้ว ลองรีเฟรชหน้าใหม่'); return; }

  const id = teamTagId(name);
  state.data.ownedTeamTags = state.data.ownedTeamTags || [];
  if (state.data.ownedTeamTags.some(t => t.id === id)) return; // มีอยู่แล้ว กันซื้อซ้ำ

  if ((state.data.points || 0) < TEAM_TAG_PRICE) {
    alert(`แต้มไม่พอ ต้องใช้ ${TEAM_TAG_PRICE.toLocaleString()} PT (คุณมี ${(state.data.points || 0).toLocaleString()} PT)`);
    return;
  }
  if (!confirm(`ซื้อแท็ก "realfan ${name}" ราคา ${TEAM_TAG_PRICE.toLocaleString()} แต้ม?`)) return;

  state.data.points -= TEAM_TAG_PRICE;
  state.data.ownedTeamTags.push({ id, name, logo });
  if (!state.data.equippedTag) state.data.equippedTag = id; // ใส่ให้อัตโนมัติถ้ายังไม่มีแท็กอื่นสวมอยู่
  persist();
  renderTopbar();
  renderProfileTab();
  renderTeamTagShop(document.getElementById('team-tag-search')?.value || '');
  alert(`🎉 ซื้อแท็ก "realfan ${name}" สำเร็จ! ไปสวมใส่ได้ที่แท็บโปรไฟล์`);
}

/* ---------------- profile ---------------- */

function equipFrame(id) {
  state.data.equippedFrame = id;
  persist();
  renderProfileTab();
}

function equipTheme(id) {
  state.data.equippedTheme = id;
  persist();
  applyTheme(id);
  renderProfileTab();
}

function applyTheme(id) {
  const theme = THEME_CATALOG.find(t => t.id === id) || THEME_CATALOG[0];
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

/* ---------------- rendering ---------------- */

function renderTopbar() {
  const signedIn = !!state.user;
  document.getElementById('app-shell').classList.toggle('signed-out', !signedIn);
  document.getElementById('g_signin_btn').style.display = signedIn ? 'none' : 'inline-block';
  document.getElementById('user-box').style.display = signedIn ? 'flex' : 'none';
  if (signedIn) {
    document.getElementById('user-avatar').src = displayAvatar();
    document.getElementById('user-name').textContent = displayName();
    document.getElementById('user-points').textContent = state.data.points + ' PT';
  }
}

function safeDomId(key) {
  return 'bet_' + String(key).replace(/[^a-zA-Z0-9]/g, '_');
}

function matchCardHtml(match, kind) {
  const key = match.match_page || `${match.team1}-${match.team2}`;
  const pred = state.data ? state.data.predictions[key] : null;
  const pickedTeam1 = pred && pred.pick === 'team1';
  const pickedTeam2 = pred && pred.pick === 'team2';
  const locked = !!pred;
  const bettingOpen = isBettingOpen(match); // false ถ้าเหลือน้อยกว่า BET_CUTOFF_MS (1 ชม.) ก่อนแข่งเริ่ม
  const points = state.data ? state.data.points : 0;
  const canAfford = state.data ? points >= MIN_BET : true;
  const betInputId = safeDomId(key);
  const scoreSelectId = betInputId + '_score';
  // ไม่มีเพดานบนแล้ว (MAX_BET = Infinity) เดิมพันสูงสุดได้เท่ากับแต้มที่มีอยู่ (รองรับ ALL IN)
  const maxBettable = Math.max(MIN_BET, points);
  const defaultBet = Math.min(BET_COST, maxBettable);

  let statusBadge = '';
  if (pred && pred.resolved) {
    if (pred.correct === null) {
      statusBadge = `<span class="badge badge-expired">หาผลไม่เจอ · คืนเต็ม +${pred.reward}</span>`;
    } else if (pred.predictedScore) {
      if (pred.correct && pred.reward >= pred.bet) {
        statusBadge = `<span class="badge badge-correct">ทายสกอร์ถูกเป๊ะ (${pred.predictedScore}) +${pred.reward}</span>`;
      } else if (!pred.correct && pred.reward === Math.round(pred.bet * SCORE_MIRROR_REFUND_RATE)) {
        statusBadge = `<span class="badge badge-wrong">สกอร์ตรงแต่ทายทีมผิด +${pred.reward} (คืน 50%)</span>`;
      } else if (pred.correct) {
        statusBadge = `<span class="badge badge-correct">ทายทีมถูก (สกอร์ไม่ตรง) +${pred.reward}</span>`;
      } else {
        statusBadge = `<span class="badge badge-wrong">ทายพลาด +${pred.reward} (คืน 25%)</span>`;
      }
    } else {
      statusBadge = pred.correct
        ? `<span class="badge badge-correct">ทายถูก +${pred.reward}</span>`
        : `<span class="badge badge-wrong">ทายพลาด +${pred.reward} (คืน 25%)</span>`;
    }
  } else if (pred) {
    const scoreNote = pred.predictedScore ? ` · ทายสกอร์ ${pred.predictedScore}` : '';
    statusBadge = `<span class="badge badge-pending">เดิมพัน ${pred.bet} PT${scoreNote} · รอผล</span>`;
  } else if (!bettingOpen) {
    statusBadge = `<span class="badge badge-expired">⏱️ ปิดรับเดิมพันแล้ว (เหลือ &lt;${Math.round(BET_CUTOFF_MS / 60000)} นาทีก่อนแข่ง)</span>`;
  }

  const logo1 = match.team1_logo || PLACEHOLDER_LOGO;
  const logo2 = match.team2_logo || PLACEHOLDER_LOGO;

  const betPicker = (!locked && canAfford && bettingOpen) ? `
    <div class="bet-picker">
      <label for="${betInputId}">เดิมพัน:</label>
      <input type="number" id="${betInputId}" class="bet-input"
        min="${MIN_BET}" max="${maxBettable}" step="5" value="${defaultBet}">
      <span class="bet-unit">PT</span>
      <button type="button" class="allin-btn" title="เดิมพันแต้มทั้งหมดที่มี" onclick="setAllIn('${betInputId}')">ALL IN</button>
    </div>
    <div class="score-picker">
      <label for="${scoreSelectId}">ทายสกอร์ BO3 (ไม่บังคับ):</label>
      <select id="${scoreSelectId}" class="score-select">
        <option value="">ไม่ทายสกอร์ (เดิมพันปกติ)</option>
        <option value="2-0">ชนะ 2-0</option>
        <option value="2-1">ชนะ 2-1</option>
      </select>
      <span class="score-hint">ทายทีม+สกอร์ถูกเป๊ะ = x${SCORE_WIN_MULTIPLIER} · สกอร์ตรงแต่ทายทีมผิด = คืน ${Math.round(SCORE_MIRROR_REFUND_RATE * 100)}%</span>
    </div>` : '';

  const getBetJs = `document.getElementById('${betInputId}').value`;
  const getScoreJs = `document.getElementById('${scoreSelectId}').value`;
  const pickDisabled = locked || !canAfford || !bettingOpen;

  return `
  <div class="match-card">
    <div class="match-meta">
      <span>${match.match_event || ''}</span>
      <span>${match.match_series || ''}</span>
    </div>
    <div class="match-teams">
      <div class="team-slot">
        <button class="team-pick ${pickedTeam1 ? 'picked' : ''}" ${pickDisabled ? 'disabled' : ''}
          onclick="makePrediction('${key.replace(/'/g, "\\'")}','team1','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs},${getScoreJs})">
          <img class="team-logo" src="${logo1}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="team-name">${match.team1}</span>
        </button>
        <button type="button" class="team-info-btn" title="ข้อมูลทีม ${(match.team1 || '').replace(/"/g, '&quot;')}"
          onclick="event.stopPropagation(); openTeamInfo('${(match.team1||'').replace(/'/g,"\\'")}')">ⓘ</button>
      </div>
      <span class="vs">VS</span>
      <div class="team-slot">
        <button class="team-pick ${pickedTeam2 ? 'picked' : ''}" ${pickDisabled ? 'disabled' : ''}
          onclick="makePrediction('${key.replace(/'/g, "\\'")}','team2','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs},${getScoreJs})">
          <img class="team-logo" src="${logo2}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="team-name">${match.team2}</span>
        </button>
        <button type="button" class="team-info-btn" title="ข้อมูลทีม ${(match.team2 || '').replace(/"/g, '&quot;')}"
          onclick="event.stopPropagation(); openTeamInfo('${(match.team2||'').replace(/'/g,"\\'")}')">ⓘ</button>
      </div>
    </div>
    ${betPicker}
    <div class="match-footer">
      <span class="match-time">${match.time_until_match || ''}</span>
      ${statusBadge || (canAfford ? `<span class="bet-hint">เลือกเดิมพัน ${MIN_BET}–${maxBettable} PT</span>` : `<span class="bet-hint bet-hint-warn">แต้มไม่พอเดิมพัน (ขั้นต่ำ ${MIN_BET})</span>`)}
    </div>
  </div>`;
}

// ---- การ์ดแมตช์สด: โชว์สกอร์เรียลไทม์ ไม่มีปุ่มทายผล (เดิมพันได้เฉพาะแมตช์ที่ยังไม่เริ่มเท่านั้น) ----
function liveMatchCardHtml(match, isFinished = false) {
  const logo1 = match.team1_logo || PLACEHOLDER_LOGO;
  const logo2 = match.team2_logo || PLACEHOLDER_LOGO;
  const mapInfo = [match.current_map, match.map_number ? `แมพที่ ${match.map_number}` : '']
    .filter(Boolean).join(' · ');
  const hasRounds = match.team1_round_ct || match.team1_round_t || match.team2_round_ct || match.team2_round_t;
  const roundLine = hasRounds
    ? `CT ${match.team1_round_ct || 0} / T ${match.team1_round_t || 0}  —  CT ${match.team2_round_ct || 0} / T ${match.team2_round_t || 0}`
    : '';
  const badge = isFinished
    ? `<span class="live-badge live-badge-ended">จบแล้ว${mapInfo ? ' · ' + mapInfo : ''}</span>`
    : `<span class="live-badge"><span class="live-dot"></span>LIVE${mapInfo ? ' · ' + mapInfo : ''}</span>`;
  const footerRight = isFinished
    ? `<span class="bet-hint">ผลจบแล้ว</span>`
    : `<span class="bet-hint">อัปเดตทุก ${LIVE_POLL_MS / 1000} วิ</span>`;

  return `
  <div class="match-card live-card${isFinished ? ' live-card-ended' : ''}">
    <div class="match-meta">
      <span>${match.match_event || ''}</span>
      ${badge}
    </div>
    <div class="match-teams live-teams">
      <div class="team-slot">
        <img class="team-logo" src="${logo1}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team-name">${match.team1}</span>
      </div>
      <span class="live-score">${match.score1}<span class="live-score-sep">–</span>${match.score2}</span>
      <div class="team-slot">
        <img class="team-logo" src="${logo2}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team-name">${match.team2}</span>
      </div>
    </div>
    <div class="match-footer">
      <span class="match-time">${roundLine}</span>
      ${footerRight}
    </div>
  </div>`;
}

/* ---------------- league filter ---------------- */

function setLeagueFilter(id) {
  state.leagueFilter = id;
  localStorage.setItem(LEAGUE_FILTER_STORAGE_KEY, id);
  renderPredictTab();
}

function renderLeagueFilterBar() {
  const bar = document.getElementById('league-filter-bar');
  if (!bar) return;

  // นับจำนวนแมตช์ต่อลีก จากแมตช์ที่กำลังจะแข่งตอนนี้ เพื่อโชว์เฉพาะลีกที่มีจริง
  const counts = {};
  state.upcoming.forEach(m => { counts[m.category] = (counts[m.category] || 0) + 1; });
  const presentCategories = LEAGUE_CATEGORIES.filter(cat => counts[cat.id]);

  if (!presentCategories.length) { bar.innerHTML = ''; return; }

  const totalCount = state.upcoming.length;
  const options = [`<option value="all" ${state.leagueFilter === 'all' ? 'selected' : ''}>ทุกลีก (${totalCount})</option>`]
    .concat(presentCategories.map(cat =>
      `<option value="${cat.id}" ${state.leagueFilter === cat.id ? 'selected' : ''}>${cat.label} (${counts[cat.id]})</option>`
    ));

  bar.innerHTML = `
    <label for="league-filter-select">แสดงลีก:</label>
    <select id="league-filter-select" onchange="setLeagueFilter(this.value)">${options.join('')}</select>`;
}

function getFilteredUpcoming() {
  // กันแมตช์ที่เริ่มไลฟ์ไปแล้วแต่ endpoint upcoming_extended cache ยังไม่ทันอัปเดต (cache 5 นาที)
  // ไม่ให้โผล่ซ้ำเป็นการ์ด "กำลังจะแข่ง" ที่ยังกดเดิมพันได้อยู่
  const liveKeys = new Set((state.live || []).map(m => m.match_page));
  const base = state.upcoming.filter(m => !liveKeys.has(m.match_page));
  if (state.leagueFilter === 'all') return base;
  return base.filter(m => m.category === state.leagueFilter);
}

// จำนวนผลแมตช์ล่าสุดสูงสุดที่จะดึงมาเสริม (เผื่อ state.results ยาวมาก ไม่อยากให้การ์ดล้นเกินไป)
const MAX_RECENT_RESULT_CARDS = 8;

// finishedLive (จาก live_score) จับได้แค่แมตช์ที่ "เพิ่งจบระหว่างที่เปิดเว็บอยู่" เท่านั้น เพราะมันเทียบ
// สแนปช็อตไลฟ์รอบก่อนกับรอบปัจจุบัน ถ้าแมตช์จบไปตั้งแต่ก่อนเปิดเว็บ/ก่อน refresh (ไม่เคยเห็นตอนไลฟ์เลย)
// จะไม่มีทางถูกจับได้ด้วยกลไกนั้น เลยต้องดึงเสริมจาก state.results (endpoint q=results ที่มีผลแมตช์
// ที่จบไปแล้วทั้งหมดอยู่แล้ว ไม่ต้องพึ่งการ track ตอนไลฟ์) มาแสดงเพิ่ม กันพลาดแมตช์ที่จบไปก่อนหน้านั้น
function getRecentResultCards(finishedEntries) {
  const norm = s => (s || '').trim().toLowerCase();
  const alreadyShown = new Set();
  finishedEntries.forEach(f => {
    alreadyShown.add(`${norm(f.match.team1)}|${norm(f.match.team2)}`);
    alreadyShown.add(`${norm(f.match.team2)}|${norm(f.match.team1)}`); // กันสลับข้าง
  });

  const extras = [];
  for (const r of (state.results || [])) {
    const pairKey = `${norm(r.team1)}|${norm(r.team2)}`;
    if (alreadyShown.has(pairKey)) continue; // แมตช์นี้มีการ์ดจาก finishedLive อยู่แล้ว ไม่ต้องซ้ำ
    if (r.score1 === undefined || r.score1 === null || r.score1 === '') continue; // ยังไม่มีสกอร์ ข้าม
    alreadyShown.add(pairKey);
    extras.push(r);
    if (extras.length >= MAX_RECENT_RESULT_CARDS) break; // สมมติว่า API เรียงใหม่สุดมาก่อนอยู่แล้ว
  }
  return extras;
}

function renderPredictTab() {
  const liveSection = document.getElementById('live-section');
  const liveList = document.getElementById('live-list');
  const liveSectionTitle = document.getElementById('live-section-title');
  if (liveSection && liveList) {
    // แมตช์ที่เพิ่งจบ (ยังไม่ครบ 24 ชม.) เรียงตามเวลาจบล่าสุดก่อน ต่อท้ายรายการที่ไลฟ์อยู่จริง
    const finishedEntries = Object.values(state.finishedLive || {})
      .sort((a, b) => b.finishedAt - a.finishedAt);
    // เสริมด้วยผลแมตช์ที่จบไปแล้วก่อนเปิดเว็บ/ก่อน refresh ซึ่ง finishedLive เพียงอย่างเดียวจับไม่ได้
    const recentResultCards = getRecentResultCards(finishedEntries);
    const hasLive = !!(state.live && state.live.length);
    const hasAny = hasLive || finishedEntries.length || recentResultCards.length;

    if (hasAny) {
      liveSection.style.display = '';
      liveList.innerHTML =
        (state.live || []).map(m => liveMatchCardHtml(m, false)).join('') +
        finishedEntries.map(f => liveMatchCardHtml(f.match, true)).join('') +
        recentResultCards.map(r => liveMatchCardHtml(r, true)).join('');
      if (liveSectionTitle) {
        liveSectionTitle.textContent = hasLive ? '🔴 กำลังแข่งสด (Live)' : '🕓 ผลที่เพิ่งจบ';
      }
    } else {
      liveSection.style.display = 'none';
      liveList.innerHTML = '';
    }
  }

  renderLeagueFilterBar();
  const list = document.getElementById('upcoming-list');
  const filtered = getFilteredUpcoming();
  if (!state.upcoming.length) {
    list.innerHTML = '<p class="empty">ตอนนี้ยังไม่มีแมตช์ที่กำลังจะแข่ง</p>';
  } else if (!filtered.length) {
    list.innerHTML = '<p class="empty">ไม่มีแมตช์ในลีกที่เลือกตอนนี้ ลองเลือก "ทุกลีก" ดูนะ</p>';
  } else {
    list.innerHTML = filtered.map(m => matchCardHtml(m, 'upcoming')).join('');
  }

  const historyEl = document.getElementById('history-list');
  if (!state.data) { historyEl.innerHTML = ''; return; }
  const entries = Object.entries(state.data.predictions);
  if (!entries.length) {
    historyEl.innerHTML = '<p class="empty">ยังไม่เคยทายผล</p>';
  } else {
    historyEl.innerHTML = entries.slice().reverse().map(([key, p]) => `
      <div class="history-row">
        <span>${p.team1} vs ${p.team2}</span>
        <span class="history-pick">ทาย: ${p.pick === 'team1' ? p.team1 : p.team2} · เดิมพัน ${p.bet ?? BET_COST} PT${p.predictedScore ? ` · สกอร์ ${p.predictedScore}` : ''}</span>
        <span>${p.resolved ? (p.correct === null ? `<span class="badge badge-expired">หมดอายุ +${p.reward}</span>` : (p.correct ? `<span class="badge badge-correct">ถูก +${p.reward}</span>` : `<span class="badge badge-wrong">ผิด +${p.reward}</span>`)) : '<span class="badge badge-pending">รอผล</span>'}</span>
      </div>`).join('');
  }
}

function itemGridHtml(catalog, ownedIds, equippedId, kind) {
  return catalog.map(item => {
    const owned = ownedIds.includes(item.id);
    const equipped = item.id === equippedId;
    return `
    <div class="inv-item rarity-${item.rarity} ${owned ? '' : 'locked'} ${equipped ? 'equipped' : ''}">
      <div class="inv-swatch"></div>
      <div class="inv-name">${item.name}</div>
      <div class="inv-rarity" style="color:${RARITY[item.rarity].color}">${RARITY[item.rarity].label}</div>
      ${owned
        ? `<button class="inv-equip-btn" onclick="${kind === 'frame' ? 'equipFrame' : 'equipTheme'}('${item.id}')" ${equipped ? 'disabled' : ''}>${equipped ? 'ใช้งานอยู่' : 'สวมใส่'}</button>`
        : `<div class="inv-lock">🔒 ยังไม่ปลดล็อก</div>`}
    </div>`;
  }).join('');
}

function renderGachaTab() {
  if (!state.data) return;
  document.getElementById('gacha-points').textContent = state.data.points + ' PT';
  document.getElementById('gacha-cost').textContent = GACHA_COST;
  const freeCases = state.data.freeCases || 0;
  document.getElementById('gacha-free-cases').textContent = freeCases;
  const openBtn = document.getElementById('open-case-btn');
  if (openBtn) openBtn.textContent = freeCases > 0 ? `เปิดกล่อง (ฟรี × ${freeCases})` : 'เปิดกล่อง';
  document.getElementById('frame-grid').innerHTML = itemGridHtml(FRAME_CATALOG, state.data.ownedFrames, state.data.equippedFrame, 'frame');
  document.getElementById('theme-grid').innerHTML = itemGridHtml(THEME_CATALOG, state.data.ownedThemes, state.data.equippedTheme, 'theme');
}

function renderProfileTab() {
  if (!state.user || !state.data) return;
  const frame = FRAME_CATALOG.find(f => f.id === state.data.equippedFrame) || FRAME_CATALOG[0];
  document.getElementById('profile-avatar').src = displayAvatar();
  document.getElementById('profile-avatar-wrap').className = 'profile-avatar-wrap ' + frame.css;
  document.getElementById('profile-name').textContent = displayName();
  document.getElementById('profile-points').textContent = state.data.points + ' PT';
  const { total, correct } = state.data.stats;
  document.getElementById('profile-total').textContent = total;
  document.getElementById('profile-correct').textContent = correct;
  document.getElementById('profile-accuracy').textContent = total ? Math.round((correct / total) * 100) + '%' : '—';

  const tagBadge = document.getElementById('profile-tag-badge');
  const equippedTag = TAG_CATALOG.find(t => t.id === state.data.equippedTag);
  const equippedTeamTag = (state.data.ownedTeamTags || []).find(t => t.id === state.data.equippedTag);
  if (equippedTag) {
    tagBadge.className = 'profile-tag-badge ' + equippedTag.css;
    tagBadge.innerHTML = `<span class="profile-tag-name">${equippedTag.name}</span><span class="profile-tag-text">${equippedTag.text}</span>`;
    tagBadge.style.display = 'inline-flex';
  } else if (equippedTeamTag) {
    tagBadge.className = 'profile-tag-badge tag-team';
    tagBadge.innerHTML = `<img class="profile-tag-logo" src="${equippedTeamTag.logo || PLACEHOLDER_LOGO}" alt="" onerror="this.style.visibility='hidden'"><span class="profile-tag-name">${escapeHtml(equippedTeamTag.name)}</span><span class="profile-tag-text">realfan ${escapeHtml(equippedTeamTag.name)}</span>`;
    tagBadge.style.display = 'inline-flex';
  } else {
    tagBadge.style.display = 'none';
    tagBadge.innerHTML = '';
  }
  renderTagGrid();
  ensureTeamTagShop(document.getElementById('team-tag-search')?.value || '');

  const nameInput = document.getElementById('edit-name-input');
  if (nameInput && document.activeElement !== nameInput) nameInput.value = state.data.customName || '';
  const avatarInput = document.getElementById('edit-avatar-input');
  if (avatarInput && document.activeElement !== avatarInput) avatarInput.value = state.data.customAvatar || '';

  renderTransferLog();
  renderGachaTab();
}

function renderTransferLog() {
  const el = document.getElementById('transfer-log');
  if (!el || !state.data) return;
  const log = state.data.transferLog || [];
  if (!log.length) { el.innerHTML = '<p class="empty">ยังไม่มีประวัติการโอน</p>'; return; }
  el.innerHTML = log.slice(0, 10).map(t => `
    <div class="history-row">
      <span>${t.type === 'sent' ? 'ส่งให้' : 'ได้รับจาก'} ${t.counterpart}</span>
      <span class="${t.type === 'sent' ? 'transfer-out' : 'transfer-in'}">${t.type === 'sent' ? '-' : '+'}${t.amount} PT</span>
      <span>${t.date}</span>
    </div>`).join('');
}

/* ---------------- Leaderboard (Firestore, real-time, ทุกคนเห็นร่วมกัน) ---------------- */

const LEADERBOARD_SIZE = 50;
let leaderboardUnsub = null; // unsubscribe function ของ onSnapshot ตัวปัจจุบัน กันเปิดซ้ำซ้อนหลายอัน

// UID ของบัญชีแอดมิน/เทส ที่ไม่อยากให้โชว์บน leaderboard สาธารณะ
// หา UID ได้จาก Firebase Console > Authentication > Users
const ADMIN_UIDS = [
  'DTHEkJRU5DTd5Q2CNFw2PUPVaPc2',
  'tvqxSv4X45RYTOoFJEwmarkmH7A2',
];

function ensureLeaderboardSubscription() {
  if (leaderboardUnsub || !window.fb) return; // subscribe อยู่แล้ว หรือ firebase ยังไม่พร้อม
  const statusEl = document.getElementById('leaderboard-status');
  if (statusEl) statusEl.textContent = 'กำลังโหลดอันดับ...';
  leaderboardUnsub = window.fb.subscribeLeaderboard(
    LEADERBOARD_SIZE,
    (rows) => {
      if (statusEl) statusEl.textContent = '';
      const visibleRows = rows.filter(row => !ADMIN_UIDS.includes(row.uid));
      renderLeaderboardRows(visibleRows);
    },
    (err) => {
      console.warn('[firebase] โหลดลีดเดอร์บอร์ดไม่สำเร็จ:', err);
      if (statusEl) statusEl.textContent = 'โหลดอันดับไม่สำเร็จ ลองรีเฟรชใหม่อีกครั้ง';
    }
  );
}

function leaderboardAvatarFrameClass(row) {
  const frame = FRAME_CATALOG.find(f => f.id === row.equippedFrame) || FRAME_CATALOG[0];
  return frame.css;
}

function renderLeaderboardRows(rows) {
  const list = document.getElementById('leaderboard-list');
  if (!list) return;
  if (!rows.length) {
    list.innerHTML = '<p class="empty">ยังไม่มีใครขึ้นอันดับเลย เป็นคนแรกสิ!</p>';
    return;
  }
  list.innerHTML = rows.map((row, i) => {
    const rank = i + 1;
    const total = row.totalPredictions || 0;
    const correct = row.correctPredictions || 0;
    const acc = total ? Math.round((correct / total) * 100) + '%' : '—';
    const isMe = row.uid === state.fbUid;
    const tag = TAG_CATALOG.find(t => t.id === row.equippedTag);
    // แท็กทีม (ซื้อด้วยแต้ม) ไม่ได้อยู่ใน TAG_CATALOG แบบ static — ต้องอ่านชื่อ/โลโก้ที่ sync มาคู่กันแทน
    const teamTagHtml = (!tag && row.equippedTeamTagName)
      ? `<span class="leaderboard-tag tag-team-inline">${row.equippedTeamTagLogo ? `<img src="${row.equippedTeamTagLogo}" alt="" onerror="this.style.display='none'">` : ''}realfan ${escapeHtml(row.equippedTeamTagName)}</span>`
      : '';
    return `
    <div class="leaderboard-row${isMe ? ' leaderboard-row-me' : ''}" onclick="openPublicProfile('${row.uid}')">
      <span class="leaderboard-rank${rank <= 3 ? ' leaderboard-rank-top' : ''}">#${rank}</span>
      <div class="leaderboard-avatar-wrap ${leaderboardAvatarFrameClass(row)}">
        <img class="leaderboard-avatar" src="${row.avatarUrl || PLACEHOLDER_LOGO}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
      </div>
      <div class="leaderboard-name-col">
        <span class="leaderboard-name">${escapeHtml(row.displayName || 'ไม่ทราบชื่อ')}${isMe ? ' <span class="leaderboard-me-badge">คุณ</span>' : ''}</span>
        ${tag ? `<span class="leaderboard-tag ${tag.css}">${tag.text}</span>` : teamTagHtml}
      </div>
      <span class="leaderboard-acc">${acc}</span>
      <span class="leaderboard-points">${row.points || 0} PT</span>
    </div>`;
  }).join('');
}

/* ---------------- Public profile page (ดูโปรไฟล์คนอื่น อ่านอย่างเดียว) ---------------- */

let publicProfilePreviousTab = 'leaderboard';

function goToPublicProfilePage() {
  const activePanel = document.querySelector('.tab-panel.active');
  if (activePanel && activePanel.id !== 'tab-publicprofile') {
    publicProfilePreviousTab = activePanel.id.replace('tab-', '');
  }
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-publicprofile').classList.add('active');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

async function openPublicProfile(uid) {
  if (!window.fb) return;
  goToPublicProfilePage();
  const body = document.getElementById('public-profile-body');
  body.innerHTML = '<p class="team-info-loading">กำลังโหลดโปรไฟล์...</p>';
  try {
    const profile = await window.fb.getPlayerProfile(uid);
    if (!profile) { body.innerHTML = '<p class="team-info-error">ไม่พบโปรไฟล์นี้ (อาจถูกลบ หรือยังไม่เคยเล่น)</p>'; return; }
    const frame = FRAME_CATALOG.find(f => f.id === profile.equippedFrame) || FRAME_CATALOG[0];
    const tag = TAG_CATALOG.find(t => t.id === profile.equippedTag);
    const teamTagBadgeHtml = (!tag && profile.equippedTeamTagName)
      ? `<span class="profile-tag-badge tag-team">${profile.equippedTeamTagLogo ? `<img class="profile-tag-logo" src="${profile.equippedTeamTagLogo}" alt="" onerror="this.style.visibility='hidden'">` : ''}<span class="profile-tag-name">${escapeHtml(profile.equippedTeamTagName)}</span><span class="profile-tag-text">realfan ${escapeHtml(profile.equippedTeamTagName)}</span></span>`
      : '';
    const total = profile.totalPredictions || 0;
    const correct = profile.correctPredictions || 0;
    const acc = total ? Math.round((correct / total) * 100) + '%' : '—';
    body.innerHTML = `
      <div class="profile-card">
        <div class="profile-avatar-wrap ${frame.css}">
          <img class="profile-avatar" src="${profile.avatarUrl || PLACEHOLDER_LOGO}" alt="" onerror="this.style.visibility='hidden'">
        </div>
        <div class="profile-info">
          <h3 class="profile-name">${escapeHtml(profile.displayName || 'ไม่ทราบชื่อ')}</h3>
          ${tag ? `<span class="profile-tag-badge ${tag.css}"><span class="profile-tag-name">${tag.name}</span><span class="profile-tag-text">${tag.text}</span></span>` : teamTagBadgeHtml}
          <p class="profile-points">${profile.points || 0} PT</p>
          <div class="profile-stats">
            <div><span>${total}</span><label>ทายทั้งหมด</label></div>
            <div><span>${correct}</span><label>ทายถูก</label></div>
            <div><span>${acc}</span><label>ความแม่น</label></div>
          </div>
        </div>
      </div>`;
  } catch (e) {
    console.warn('[firebase] เปิดโปรไฟล์ไม่สำเร็จ:', uid, e);
    body.innerHTML = '<p class="team-info-error">โหลดโปรไฟล์ไม่สำเร็จ ลองใหม่อีกครั้ง</p>';
  }
}

function closePublicProfile() {
  switchTab(publicProfilePreviousTab);
}

/* ---------------- tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
  if (name === 'leaderboard') ensureLeaderboardSubscription();
}

/* ---------------- boot ---------------- */

function onSignedIn() {
  applyTheme(state.data.equippedTheme);
  applyPendingTransfers();
  renderTopbar();
  renderPredictTab();
  renderGachaTab();
  renderProfileTab();
  updateDailyBonusUI();
}

window.addEventListener('DOMContentLoaded', () => {
  initGoogleSignIn();
  loadMatches();
  loadLiveScores();
  setInterval(loadMatches, 5 * 60 * 1000); // refresh every 5 min
  setInterval(loadLiveScores, LIVE_POLL_MS); // สกอร์เรียลไทม์: poll ทุก 30 วิ ตาม cache ของ vlrggapi
  setInterval(updateDailyBonusUI, 1000); // นับถอยหลังปุ่มรับโบนัสรายวันแบบเรียลไทม์
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('case-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'case-overlay') closeCaseOverlay();
  });
});
