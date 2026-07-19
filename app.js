/* ============================================================
   app.js — Valorant Prediction site
   Everything is client-side. User data lives in localStorage
   only (per-browser). Google Sign-In is used purely to show a
   name/avatar — it is NOT a secure multi-device account system.
   ============================================================ */

// !!! ตั้งค่าก่อนใช้งานจริง: ใส่ Google OAuth Client ID ของคุณเองที่นี่ !!!
// วิธีสร้าง อ่านใน README.md
const GOOGLE_CLIENT_ID = '382344978450-e86echom7fqs2jrpckg3qafobf4tdrgr.apps.googleusercontent.com';

const API_BASE = 'https://vlr.orlandomm.net/api/v1';
const FETCH_TIMEOUT_MS = 6000;

const state = {
  user: null,        // { sub, name, picture, email }
  data: null,        // per-user save data (points, inventory, predictions, equipped)
  upcoming: [],
  results: [],
  usingFallback: false,
};

/* ---------------- storage helpers ---------------- */

function saveKey(sub) { return `valo_predict_user_${sub}`; }

function defaultUserData() {
  return {
    points: 100, // starter points
    ownedFrames: ['frame_default'],
    ownedThemes: ['theme_tactical'],
    equippedFrame: 'frame_default',
    equippedTheme: 'theme_tactical',
    predictions: {},     // match_page -> { pick:'team1'|'team2', team1, team2, event, resolved, correct }
    stats: { total: 0, correct: 0 },
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
  onSignedIn();
}

function signOut() {
  state.user = null;
  state.data = null;
  localStorage.removeItem('valo_predict_last_sub');
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  document.getElementById('app-shell').classList.add('signed-out');
  renderTopbar();
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

async function loadMatches() {
  const statusEl = document.getElementById('data-status');
  statusEl.textContent = 'กำลังดึงข้อมูลแมตช์จาก vlr.gg ...';
  try {
    const [upcomingRes, resultsRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/match?q=upcoming`, FETCH_TIMEOUT_MS),
      fetchWithTimeout(`${API_BASE}/match?q=results`, FETCH_TIMEOUT_MS),
    ]);
    state.upcoming = upcomingRes?.data?.segments || [];
    state.results = resultsRes?.data?.segments || [];
    state.usingFallback = false;
    statusEl.textContent = `เชื่อมต่อ vlr.gg สำเร็จ • ${state.upcoming.length} แมตช์ที่กำลังจะแข่ง`;
  } catch (e) {
    console.warn('ดึงข้อมูลจาก vlr.gg ไม่สำเร็จ ใช้ข้อมูลตัวอย่างแทน', e);
    state.upcoming = FALLBACK_UPCOMING;
    state.results = FALLBACK_RESULTS;
    state.usingFallback = true;
    statusEl.textContent = '⚠️ ต่อ API ของ vlr.gg ไม่ได้ตอนนี้ (unofficial API อาจล่มชั่วคราว) กำลังแสดงข้อมูลตัวอย่าง';
  }
  resolvePendingPredictions();
  renderPredictTab();
}

/* ---------------- prediction resolution ---------------- */

function resolvePendingPredictions() {
  if (!state.data) return;
  let changed = false;
  for (const key of Object.keys(state.data.predictions)) {
    const pred = state.data.predictions[key];
    if (pred.resolved) continue;
    const match = state.results.find(r =>
      (r.match_page && r.match_page === key) ||
      (r.team1 === pred.team1 && r.team2 === pred.team2)
    );
    if (!match) continue;
    const s1 = parseInt(match.score1, 10);
    const s2 = parseInt(match.score2, 10);
    if (isNaN(s1) || isNaN(s2)) continue;
    const winner = s1 > s2 ? 'team1' : (s2 > s1 ? 'team2' : null);
    if (!winner) continue;
    pred.resolved = true;
    pred.correct = winner === pred.pick;
    state.data.stats.total += 1;
    if (pred.correct) {
      state.data.stats.correct += 1;
      state.data.points += 20;
    } else {
      state.data.points += 3; // participation points
    }
    changed = true;
  }
  if (changed) persist();
}

/* ---------------- predicting ---------------- */

function makePrediction(matchKey, pick, team1, team2, event) {
  if (!state.user) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะทายผลได้'); return; }
  if (state.data.predictions[matchKey]) return; // already predicted
  state.data.predictions[matchKey] = { pick, team1, team2, event, resolved: false, correct: null };
  persist();
  renderPredictTab();
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
  if (state.data.points < GACHA_COST) { alert('แต้มไม่พอ ต้องมีอย่างน้อย ' + GACHA_COST + ' แต้ม'); return; }

  const pool = [...FRAME_CATALOG, ...THEME_CATALOG];
  const won = weightedPick(pool);
  state.data.points -= GACHA_COST;

  const isFrame = FRAME_CATALOG.includes(won);
  const ownedList = isFrame ? state.data.ownedFrames : state.data.ownedThemes;
  const alreadyOwned = ownedList.includes(won.id);
  if (!alreadyOwned) ownedList.push(won.id);
  else state.data.points += 15; // duplicate compensation

  persist();
  playCaseAnimation(pool, won, alreadyOwned);
  renderGachaTab();
  renderTopbar();
}

function playCaseAnimation(pool, won, wasDuplicate) {
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
    document.getElementById('case-result-rarity').textContent = RARITY[won.rarity].label + (wasDuplicate ? ' • ได้ซ้ำ (+15 แต้มชดเชย)' : ' • ไอเทมใหม่!');
    document.getElementById('case-result-rarity').style.color = RARITY[won.rarity].color;
    document.getElementById('case-result').classList.add('show');
  }, 3700);
}

function closeCaseOverlay() {
  document.getElementById('case-overlay').classList.remove('open');
  document.getElementById('case-result').classList.remove('show');
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
    document.getElementById('user-avatar').src = state.user.picture;
    document.getElementById('user-name').textContent = state.user.name;
    document.getElementById('user-points').textContent = state.data.points + ' PT';
  }
}

function matchCardHtml(match, kind) {
  const key = match.match_page || `${match.team1}-${match.team2}`;
  const pred = state.data ? state.data.predictions[key] : null;
  const pickedTeam1 = pred && pred.pick === 'team1';
  const pickedTeam2 = pred && pred.pick === 'team2';
  const locked = !!pred;

  let statusBadge = '';
  if (pred && pred.resolved) {
    statusBadge = pred.correct
      ? `<span class="badge badge-correct">ทายถูก +20</span>`
      : `<span class="badge badge-wrong">ทายพลาด +3</span>`;
  } else if (pred) {
    statusBadge = `<span class="badge badge-pending">รอผล</span>`;
  }

  return `
  <div class="match-card">
    <div class="match-meta">
      <span>${match.match_event || ''}</span>
      <span>${match.match_series || ''}</span>
    </div>
    <div class="match-teams">
      <button class="team-pick ${pickedTeam1 ? 'picked' : ''}" ${locked ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team1','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}')">
        ${match.team1}
      </button>
      <span class="vs">VS</span>
      <button class="team-pick ${pickedTeam2 ? 'picked' : ''}" ${locked ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team2','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}')">
        ${match.team2}
      </button>
    </div>
    <div class="match-footer">
      <span class="match-time">${match.time_until_match || ''}</span>
      ${statusBadge}
    </div>
  </div>`;
}

function renderPredictTab() {
  const list = document.getElementById('upcoming-list');
  if (!state.upcoming.length) {
    list.innerHTML = '<p class="empty">ยังไม่มีแมตช์ที่กำลังจะแข่งในตอนนี้</p>';
  } else {
    list.innerHTML = state.upcoming.map(m => matchCardHtml(m, 'upcoming')).join('');
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
        <span class="history-pick">ทาย: ${p.pick === 'team1' ? p.team1 : p.team2}</span>
        <span>${p.resolved ? (p.correct ? '<span class="badge badge-correct">ถูก</span>' : '<span class="badge badge-wrong">ผิด</span>') : '<span class="badge badge-pending">รอผล</span>'}</span>
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
  document.getElementById('frame-grid').innerHTML = itemGridHtml(FRAME_CATALOG, state.data.ownedFrames, state.data.equippedFrame, 'frame');
  document.getElementById('theme-grid').innerHTML = itemGridHtml(THEME_CATALOG, state.data.ownedThemes, state.data.equippedTheme, 'theme');
}

function renderProfileTab() {
  if (!state.user || !state.data) return;
  const frame = FRAME_CATALOG.find(f => f.id === state.data.equippedFrame) || FRAME_CATALOG[0];
  document.getElementById('profile-avatar').src = state.user.picture;
  document.getElementById('profile-avatar-wrap').className = 'profile-avatar-wrap ' + frame.css;
  document.getElementById('profile-name').textContent = state.user.name;
  document.getElementById('profile-points').textContent = state.data.points + ' PT';
  const { total, correct } = state.data.stats;
  document.getElementById('profile-total').textContent = total;
  document.getElementById('profile-correct').textContent = correct;
  document.getElementById('profile-accuracy').textContent = total ? Math.round((correct / total) * 100) + '%' : '—';
  renderGachaTab();
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
  renderTopbar();
  renderPredictTab();
  renderGachaTab();
  renderProfileTab();
}

window.addEventListener('DOMContentLoaded', () => {
  initGoogleSignIn();
  loadMatches();
  setInterval(loadMatches, 5 * 60 * 1000); // refresh every 5 min
  document.getElementById('signout-btn').addEventListener('click', signOut);
  document.getElementById('case-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'case-overlay') closeCaseOverlay();
  });
});
