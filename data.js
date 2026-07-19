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
const FALLBACK_UPCOMING = [
  { team1: 'Sentinels', team2: 'Paper Rex', flag1: 'flag_us', flag2: 'flag_sg',
    time_until_match: 'ตัวอย่างข้อมูล (API ล่ม)', match_series: 'Group Stage',
    match_event: 'VCT 2026: Demo Event', match_page: 'demo-1' },
  { team1: 'Fnatic', team2: 'LOUD', flag1: 'flag_gb', flag2: 'flag_br',
    time_until_match: 'ตัวอย่างข้อมูล (API ล่ม)', match_series: 'Group Stage',
    match_event: 'VCT 2026: Demo Event', match_page: 'demo-2' },
];

const FALLBACK_RESULTS = [];
