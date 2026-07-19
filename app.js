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

function defaultUserData() {
  return {
    points: 100, // starter points
    ownedFrames: ['frame_default'],
    ownedThemes: ['theme_tactical'],
    equippedFrame: 'frame_default',
    equippedTheme: 'theme_tactical',
    predictions: {},     // match_page -> { pick:'team1'|'team2', team1, team2, event, bet, resolved, correct, reward }
    stats: { total: 0, correct: 0 },
    lastLoginBonus: null, // 'YYYY-MM-DD' ของวันล่าสุดที่ได้รับโบนัสรายวัน
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

/* ---------------- daily login bonus ---------------- */

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkDailyLoginBonus() {
  if (!state.data) return;
  const today = todayKey();
  if (state.data.lastLoginBonus === today) return; // รับไปแล้ววันนี้
  state.data.lastLoginBonus = today;
  state.data.points += DAILY_LOGIN_BONUS;
  persist();
  setTimeout(() => alert(`🎁 โบนัสล็อกอินรายวัน: +${DAILY_LOGIN_BONUS} แต้ม!`), 50);
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

async function loadMatches() {
  const statusEl = document.getElementById('data-status');
  statusEl.textContent = 'กำลังดึงข้อมูลแมตช์จาก vlr.gg ...';
  try {
    const [matchesRes, resultsRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/matches`, FETCH_TIMEOUT_MS),
      fetchWithTimeout(`${API_BASE}/results`, FETCH_TIMEOUT_MS),
    ]);
    const rawUpcoming = (matchesRes?.data || []).filter(m => m.status === 'Upcoming');
    state.upcoming = rawUpcoming.map(normalizeMatch);
    state.results = (resultsRes?.data || []).map(normalizeResult);
    state.usingFallback = false;
    statusEl.textContent = `เชื่อมต่อ vlr.gg สำเร็จ • ทุกลีก • ${state.upcoming.length} แมตช์ที่กำลังจะแข่ง`;
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
    const bet = pred.bet || BET_COST;
    if (pred.correct) {
      state.data.stats.correct += 1;
      pred.reward = Math.round(bet * WIN_PAYOUT_MULTIPLIER);
      state.data.points += pred.reward;
    } else {
      pred.reward = Math.round(bet * LOSE_REFUND_RATE); // คืนแค่ 25% ของที่เสียไป
      state.data.points += pred.reward;
    }
    changed = true;
  }
  if (changed) {
    persist();
    renderTopbar();
  }
}

/* ---------------- predicting ---------------- */

function makePrediction(matchKey, pick, team1, team2, event, rawBet) {
  if (!state.user) { alert('เข้าสู่ระบบด้วย Google ก่อนถึงจะทายผลได้'); return; }
  if (state.data.predictions[matchKey]) return; // already predicted

  let bet = parseInt(rawBet, 10);
  if (isNaN(bet)) bet = BET_COST;
  bet = Math.max(MIN_BET, Math.min(MAX_BET, bet));

  if (state.data.points < bet) { alert(`แต้มไม่พอสำหรับเดิมพัน ${bet} แต้ม (มีอยู่ ${state.data.points})`); return; }
  if (state.data.points < MIN_BET) { alert(`แต้มไม่พอสำหรับเดิมพันขั้นต่ำ ${MIN_BET} แต้ม (มีอยู่ ${state.data.points})`); return; }

  state.data.points -= bet;
  state.data.predictions[matchKey] = { pick, team1, team2, event, bet, resolved: false, correct: null, reward: null };
  persist();
  renderPredictTab();
  renderTopbar();
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
  const maxBettable = Math.max(MIN_BET, Math.min(MAX_BET, points));
  const defaultBet = Math.min(BET_COST, maxBettable);

  let statusBadge = '';
  if (pred && pred.resolved) {
    statusBadge = pred.correct
      ? `<span class="badge badge-correct">ทายถูก +${pred.reward}</span>`
      : `<span class="badge badge-wrong">ทายพลาด +${pred.reward} (คืน 25%)</span>`;
  } else if (pred) {
    statusBadge = `<span class="badge badge-pending">เดิมพัน ${pred.bet} PT · รอผล</span>`;
  }

  const logo1 = match.team1_logo || PLACEHOLDER_LOGO;
  const logo2 = match.team2_logo || PLACEHOLDER_LOGO;

  const betPicker = (!locked && canAfford) ? `
    <div class="bet-picker">
      <label for="${betInputId}">เดิมพัน:</label>
      <input type="number" id="${betInputId}" class="bet-input"
        min="${MIN_BET}" max="${maxBettable}" step="5" value="${defaultBet}">
      <span class="bet-unit">PT</span>
    </div>` : '';

  const getBetJs = `document.getElementById('${betInputId}').value`;

  return `
  <div class="match-card">
    <div class="match-meta">
      <span>${match.match_event || ''}</span>
      <span>${match.match_series || ''}</span>
    </div>
    <div class="match-teams">
      <button class="team-pick ${pickedTeam1 ? 'picked' : ''}" ${locked || !canAfford ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team1','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs})">
        <img class="team-logo" src="${logo1}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="team-name">${match.team1}</span>
      </button>
      <span class="vs">VS</span>
      <button class="team-pick ${pickedTeam2 ? 'picked' : ''}" ${locked || !canAfford ? 'disabled' : ''}
        onclick="makePrediction('${key.replace(/'/g, "\\'")}','team2','${(match.team1||'').replace(/'/g,"\\'")}','${(match.team2||'').replace(/'/g,"\\'")}','${(match.match_event||'').replace(/'/g,"\\'")}',${getBetJs})">
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
        <span class="history-pick">ทาย: ${p.pick === 'team1' ? p.team1 : p.team2} · เดิมพัน ${p.bet ?? BET_COST} PT</span>
        <span>${p.resolved ? (p.correct ? `<span class="badge badge-correct">ถูก +${p.reward}</span>` : `<span class="badge badge-wrong">ผิด +${p.reward}</span>`) : '<span class="badge badge-pending">รอผล</span>'}</span>
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
  checkDailyLoginBonus();
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
