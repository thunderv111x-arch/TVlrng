/* ============================================================
   app.js — Valorant Prediction site
   Everything is client-side. User data lives in localStorage
   only (per-browser). Google Sign-In is used purely to show a
   name/avatar — it is NOT a secure multi-device account system.
   ============================================================ */

// !!! ตั้งค่าก่อนใช้งานจริง: ใส่ Google OAuth Client ID ของคุณเองที่นี่ !!!
// วิธีสร้าง อ่านใน README.md
const GOOGLE_CLIENT_ID = '382344978450-e86echom7fqs2jrpckg3qafobf4tdrgr.apps.googleusercontent.com';

// vlrggapi.vercel.app (the original unofficial API) is currently down —
// its own maintainer confirms it exceeded free-tier limits. Using a working
// alternative unofficial API instead: https://github.com/Orloxx23/vlresports
const API_BASE = 'https://vlr.orlandomm.net/api/v1';
const FETCH_TIMEOUT_MS = 6000;

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
  upcoming: [],
  results: [],
  usingFallback: false,
  leagueFilter: localStorage.getItem(LEAGUE_FILTER_STORAGE_KEY) || 'all', // ตัวกรองลีก (global ไม่ผูกกับ user)
};

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
    equippedTag: null,     // id ของแท็กที่กำลังสวมอยู่ (null = ไม่ใส่)
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
  localStorage.removeItem('valo_predict_last_sub');
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
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

function normalizeMatch(m) {
  const t1 = m.teams?.[0] || {};
  const t2 = m.teams?.[1] || {};
  const tournamentName = m.tournament || '';
  return {
    team1: t1.name || 'TBD',
    team2: t2.name || 'TBD',
    team1_logo: t1.logo || PLACEHOLDER_LOGO,
    team2_logo: t2.logo || PLACEHOLDER_LOGO,
    match_event: tournamentName,
    match_series: m.event || '',
    time_until_match: m.in ? `เริ่มใน ${m.in}` : (m.status || ''),
    match_page: String(m.id),
    category: classifyTournament(tournamentName),
  };
}

function normalizeResult(r) {
  const t1 = r.teams?.[0] || {};
  const t2 = r.teams?.[1] || {};
  const tournamentName = r.tournament || '';
  return {
    team1: t1.name || 'TBD',
    team2: t2.name || 'TBD',
    team1_logo: t1.logo || PLACEHOLDER_LOGO,
    team2_logo: t2.logo || PLACEHOLDER_LOGO,
    score1: t1.score,
    score2: t2.score,
    match_event: tournamentName,
    match_page: String(r.id),
    category: classifyTournament(tournamentName),
  };
}

// ---- China backfill ----
// API หลัก (/matches, /results แบบไม่ระบุภูมิภาค) บางทีดึงแมตช์ China มาไม่ครบ
// เพราะ VCT China เล่นบนไคลเอนต์/เซิร์ฟเวอร์คนละชุดจากภูมิภาคอื่น ข้อมูลเลยไม่ค่อยไหลเข้า
// pipeline เดียวกัน แทนที่จะไปพึ่ง API เจ้าอื่นที่ไม่มี public host ให้ใช้ฟรี (เช็คมาแล้วไม่มี)
// เราใช้ API ตัวเดิมนี่แหละ ยิง query แยกด้วย region=ch (โค้ดภูมิภาคที่ vlr.gg ใช้เองสำหรับ China)
// เป็นการ "เสริม" ไม่ใช่แทนที่ ถ้า endpoint ไม่รองรับพารามิเตอร์นี้จริง มันจะแค่คืนอาเรย์ว่าง
// ไม่ทำให้หน้าเว็บพัง
async function fetchChinaBackfill(endpoint) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/${endpoint}?region=ch`, FETCH_TIMEOUT_MS);
    return res?.data || [];
  } catch (e) {
    console.warn(`[China backfill] ดึง ${endpoint}?region=ch ไม่สำเร็จ (endpoint นี้อาจไม่รองรับ region filter หรือช่วงนี้ไม่มีแมตช์จีน)`, e);
    return [];
  }
}

async function loadMatches() {
  const statusEl = document.getElementById('data-status');
  statusEl.textContent = 'กำลังดึงข้อมูลแมตช์จาก vlr.gg ...';
  try {
    const [matchesRes, resultsRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/matches`, FETCH_TIMEOUT_MS),
      fetchWithTimeout(`${API_BASE}/results`, FETCH_TIMEOUT_MS),
    ]);
    const rawUpcoming = (matchesRes?.data || []).filter(m => m.status === 'Upcoming');
    const rawResults = resultsRes?.data || [];

    // ยิงเสริมเฉพาะ China แบบขนาน แล้วรวมเข้าไปโดยไม่ซ้ำ (เทียบด้วย id)
    const [chinaMatchesExtra, chinaResultsExtra] = await Promise.all([
      fetchChinaBackfill('matches'),
      fetchChinaBackfill('results'),
    ]);
    const chinaUpcomingExtra = chinaMatchesExtra.filter(m => m.status === 'Upcoming');
    const seenUpcomingIds = new Set(rawUpcoming.map(m => m.id));
    const newChinaUpcoming = chinaUpcomingExtra.filter(m => !seenUpcomingIds.has(m.id));
    const seenResultIds = new Set(rawResults.map(r => r.id));
    const newChinaResults = chinaResultsExtra.filter(r => !seenResultIds.has(r.id));

    state.upcoming = [...rawUpcoming, ...newChinaUpcoming].map(normalizeMatch);
    state.results = [...rawResults, ...newChinaResults].map(normalizeResult);
    state.usingFallback = false;
    statusEl.textContent = `เชื่อมต่อ vlr.gg สำเร็จ • ทุกลีก • ${state.upcoming.length} แมตช์ที่กำลังจะแข่ง` +
      (newChinaUpcoming.length ? ` (รวม China ที่เสริมมาเพิ่ม ${newChinaUpcoming.length})` : '');

    // DEBUG: เปิด F12 -> Console เพื่อดูว่า API ส่ง tournament ชื่ออะไรมาบ้าง
    // และระบบจัดหมวดลงลีกไหน (ช่วยตรวจว่าทำไมบางลีกไม่โผล่ในตัวกรอง)
    const rawStatuses = [...new Set((matchesRes?.data || []).map(m => m.status))];
    console.log('[predict.vlr debug] สถานะแมตช์ทั้งหมดที่ API หลักส่งมา:', rawStatuses);
    console.log('[predict.vlr debug] แมตช์ China ที่ backfill เพิ่มเข้ามา:', newChinaUpcoming);
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
    const match = state.results.find(r =>
      (r.match_page && key && r.match_page === key) ||
      (norm(r.team1) === norm(pred.team1) && norm(r.team2) === norm(pred.team2)) ||
      (norm(r.team1) === norm(pred.team2) && norm(r.team2) === norm(pred.team1)) // เผื่อ API คืนลำดับทีมสลับข้าง
    );
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

function makePrediction(matchKey, pick, team1, team2, event, rawBet, rawScorePick) {
  if (!state.user) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะทายผลได้'); return; }
  if (state.data.predictions[matchKey]) return; // already predicted

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
  if (!owned.length) {
    grid.innerHTML = '<p class="empty">ยังไม่มีแท็ก — ปลดล็อกได้ด้วยโค้ดพิเศษ</p>';
    return;
  }
  grid.innerHTML = owned.map(id => {
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
  }

  const logo1 = match.team1_logo || PLACEHOLDER_LOGO;
  const logo2 = match.team2_logo || PLACEHOLDER_LOGO;

  const betPicker = (!locked && canAfford) ? `
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

  return `
  <div class="match-card">
    <div class="match-meta">
      <span>${match.match_event || ''}</span>
      <span>${match.match_series || ''}</span>
    </div>
    <div class="match-teams">
      <button class="team-pick ${pickedTeam1 ? 'picked' : ''}" ${locked || !canAfford ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team1','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs},${getScoreJs})">
        <img class="team-logo" src="${logo1}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team-name">${match.team1}</span>
      </button>
      <span class="vs">VS</span>
      <button class="team-pick ${pickedTeam2 ? 'picked' : ''}" ${locked || !canAfford ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team2','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs},${getScoreJs})">
        <img class="team-logo" src="${logo2}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team-name">${match.team2}</span>
      </button>
    </div>
    ${betPicker}
    <div class="match-footer">
      <span class="match-time">${match.time_until_match || ''}</span>
      ${statusBadge || (canAfford ? `<span class="bet-hint">เลือกเดิมพัน ${MIN_BET}–${maxBettable} PT</span>` : `<span class="bet-hint bet-hint-warn">แต้มไม่พอเดิมพัน (ขั้นต่ำ ${MIN_BET})</span>`)}
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
  if (state.leagueFilter === 'all') return state.upcoming;
  return state.upcoming.filter(m => m.category === state.leagueFilter);
}

function renderPredictTab() {
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
  if (equippedTag) {
    tagBadge.className = 'profile-tag-badge ' + equippedTag.css;
    tagBadge.innerHTML = `<span class="profile-tag-name">${equippedTag.name}</span><span class="profile-tag-text">${equippedTag.text}</span>`;
    tagBadge.style.display = 'inline-flex';
  } else {
    tagBadge.style.display = 'none';
    tagBadge.innerHTML = '';
  }
  renderTagGrid();

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

/* ---------------- tabs ---------------- */

function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.tab-btn[data-tab="${name}"]`).classList.add('active');
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
  setInterval(loadMatches, 5 * 60 * 1000); // refresh every 5 min
  setInterval(updateDailyBonusUI, 1000); // นับถอยหลังปุ่มรับโบนัสรายวันแบบเรียลไทม์
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('case-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'case-overlay') closeCaseOverlay();
  });
});
