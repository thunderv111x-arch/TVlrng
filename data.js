/* ============================================================
   data.js — static catalogs + offline fallback data
   These are ORIGINAL profile-decoration items (frames/themes),
   not in-game Valorant skins. No Riot IP is reproduced.
   ============================================================ */

// ---- Rarity weights for the case-opening gacha ----
const RARITY = {
  common:    { label: 'COMMON',    weight: 55, color: '#8A94A3' },
  rare:      { label: 'RARE',      weight: 28, color: '#4DE8FF' },
  epic:      { label: 'EPIC',      weight: 13, color: '#B980FF' },
  legendary: { label: 'LEGENDARY', weight: 4,  color: '#E8B93B' },
};

const GACHA_COST = 40; // points per case

// ---- Betting economy: points are deducted the moment you predict ----
// ผู้เล่นเลือกจำนวนแต้มเดิมพันเองได้ (ภายใน MIN_BET–MAX_BET และไม่เกินแต้มที่มี)
const BET_COST = 15;          // ค่าเริ่มต้นที่โชว์ในช่องกรอกเดิมพัน
const MIN_BET = 10;           // เดิมพันขั้นต่ำ
const MAX_BET = 300;          // เดิมพันสูงสุดต่อครั้ง
const WIN_PAYOUT_MULTIPLIER = 2.3; // ทายถูก: ได้คืน = เดิมพัน x ตัวคูณนี้ (กำไรสุทธิ ~130%)
const LOSE_REFUND_RATE = 0.25;     // ทายผิด: ได้คืนแค่ 25% ของแต้มที่เสียไป

// ---- Daily login bonus ----
const DAILY_LOGIN_BONUS = 100; // แต้มที่ได้ฟรีทุกวันตอนเข้าสู่ระบบครั้งแรกของวัน

// ---- Profile frame "skins" (decorative border/glow around avatar+card) ----
const FRAME_CATALOG = [
  { id: 'frame_default',   name: 'มาตรฐาน',        rarity: 'common',    css: 'frame-default' },
  { id: 'frame_steel',     name: 'Steel Line',       rarity: 'common',    css: 'frame-steel' },
  { id: 'frame_signal',    name: 'Signal Red',       rarity: 'rare',      css: 'frame-signal' },
  { id: 'frame_holo',      name: 'Holo Circuit',     rarity: 'rare',      css: 'frame-holo' },
  { id: 'frame_spectrum',  name: 'Spectrum Break',   rarity: 'epic',      css: 'frame-spectrum' },
  { id: 'frame_phantom',   name: 'Phantom Static',   rarity: 'epic',      css: 'frame-phantom' },
  { id: 'frame_ascendant', name: 'Ascendant Halo',   rarity: 'legendary', css: 'frame-ascendant' },
  { id: 'frame_radiant',   name: 'Radiant Protocol', rarity: 'legendary', css: 'frame-radiant' },
];

// ---- Full-site decoration themes (recolor CSS variables) ----
const THEME_CATALOG = [
  { id: 'theme_tactical', name: 'Tactical (ค่าเริ่มต้น)', rarity: 'common',
    vars: { '--accent': '#FF3B4E', '--accent-2': '#4DE8FF', '--bg': '#0B0E12', '--bg-panel': '#12161C' } },
  { id: 'theme_frost',    name: 'Frost Line', rarity: 'common',
    vars: { '--accent': '#4DE8FF', '--accent-2': '#8AF0FF', '--bg': '#0A1114', '--bg-panel': '#101A1E' } },
  { id: 'theme_ember',    name: 'Ember Protocol', rarity: 'rare',
    vars: { '--accent': '#FF7A3D', '--accent-2': '#FFC24D', '--bg': '#120C0A', '--bg-panel': '#1B1310' } },
  { id: 'theme_violet',   name: 'Violet Recon', rarity: 'epic',
    vars: { '--accent': '#B980FF', '--accent-2': '#4DE8FF', '--bg': '#0D0B14', '--bg-panel': '#16131F' } },
  { id: 'theme_radiant',  name: 'Radiant Gold', rarity: 'legendary',
    vars: { '--accent': '#E8B93B', '--accent-2': '#FF3B4E', '--bg': '#0F0D08', '--bg-panel': '#1A1610' } },
];

// ---- Offline fallback matches (used only if the live vlr.gg API is unreachable) ----
const PLACEHOLDER_LOGO = 'https://www.vlr.gg/img/vlr/tmp/vlr.png';

const FALLBACK_UPCOMING = [
  { team1: 'Paper Rex', team2: 'T1', flag1: 'flag_sg', flag2: 'flag_kr',
    team1_logo: PLACEHOLDER_LOGO, team2_logo: PLACEHOLDER_LOGO,
    time_until_match: 'ตัวอย่างข้อมูล (API ล่ม)', match_series: 'Group Stage',
    match_event: 'VCT 2026: Pacific Stage 2 (ตัวอย่าง)', match_page: 'demo-1' },
  { team1: 'DRX', team2: 'Rex Regum Qeon', flag1: 'flag_kr', flag2: 'flag_id',
    team1_logo: PLACEHOLDER_LOGO, team2_logo: PLACEHOLDER_LOGO,
    time_until_match: 'ตัวอย่างข้อมูล (API ล่ม)', match_series: 'Group Stage',
    match_event: 'VCT 2026: Pacific Stage 2 (ตัวอย่าง)', match_page: 'demo-2' },
];

const FALLBACK_RESULTS = [];
