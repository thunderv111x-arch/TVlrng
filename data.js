/* ============================================================
   data.js — static catalogs + offline fallback data
   These are ORIGINAL profile-decoration items (frames/themes),
   not in-game Valorant skins. No Riot IP is reproduced.
   ============================================================ */

/* ============================================================
   League categories — used to classify whatever tournament name
   the API returns, so the user can filter by league themselves
   instead of the site hard-locking to one region.
   Order matters: first matching test wins. 'other' must stay last.
   ============================================================ */
const LEAGUE_CATEGORIES = [
  // สำคัญ: ต้องเช็คภูมิภาคก่อน "international" เสมอ เพราะ "Kickoff" เป็นทัวร์นาเมนต์
  // เปิดฤดูกาลของ "แต่ละภูมิภาค" (เช่น "VCT 2026: China Kickoff") ไม่ใช่รายการนานาชาติ
  // มีแค่ Masters กับ Champions เท่านั้นที่เป็นนานาชาติจริงๆ (รวมทุกภูมิภาคมาแข่งกัน)
  { id: 'vct_pacific',   label: 'VCT Pacific',           test: n => /pacific/i.test(n) },
  { id: 'vct_americas',  label: 'VCT Americas',          test: n => /americas/i.test(n) },
  { id: 'vct_emea',      label: 'VCT EMEA',              test: n => /emea/i.test(n) },
  { id: 'vct_china',     label: 'VCT China',             test: n => /china|\bcn\b/i.test(n) },
  { id: 'challengers',   label: 'VCT Challengers',       test: n => /challenger/i.test(n) },
  { id: 'game_changers', label: 'VCT Game Changers',     test: n => /game changers/i.test(n) },
  { id: 'vct_intl',      label: 'VCT International',    test: n => /champions|masters/i.test(n) },
  { id: 'other',         label: 'ลีก/ทัวร์นาเมนต์อื่นๆ', test: () => true },
];

function classifyTournament(name) {
  const n = name || '';
  const found = LEAGUE_CATEGORIES.find(cat => cat.test(n));
  return found ? found.id : 'other';
}


const RARITY = {
  common:    { label: 'COMMON',    weight: 55, color: '#8A94A3' },
  rare:      { label: 'RARE',      weight: 28, color: '#4DE8FF' },
  epic:      { label: 'EPIC',      weight: 13, color: '#B980FF' },
  legendary: { label: 'LEGENDARY', weight: 4,  color: '#E8B93B' },
};

const GACHA_COST = 40; // points per case

// ---- Betting economy: points are deducted the moment you predict ----
// ผู้เล่นเลือกจำนวนแต้มเดิมพันเองได้ (ขั้นต่ำ MIN_BET ไม่มีเพดานบนแล้ว —
// เดิมพันได้สูงสุดเท่าที่มีแต้ม รวมถึงกด "ALL IN" ได้)
const BET_COST = 15;          // ค่าเริ่มต้นที่โชว์ในช่องกรอกเดิมพัน
const MIN_BET = 10;           // เดิมพันขั้นต่ำ
const MAX_BET = Infinity;     // ไม่จำกัดเดิมพันสูงสุดอีกต่อไป (เดิมเคยล็อกไว้ที่ 300)
const WIN_PAYOUT_MULTIPLIER = 2.3; // ทายถูก (แค่ทายทีมชนะ): ได้คืน = เดิมพัน x ตัวคูณนี้ (กำไรสุทธิ ~130%)
const LOSE_REFUND_RATE = 0.25;     // ทายผิด: ได้คืนแค่ 25% ของแต้มที่เสียไป

// ---- Betting cutoff ----
// ปิดรับเดิมพันล่วงหน้าก่อนแมตช์เริ่ม กันไม่ให้เดิมพันตอนใกล้แข่ง/รู้ผลจากที่อื่นมาก่อนแล้ว
// เทียบจาก match.match_time (แปลงจาก unix_timestamp ที่ vlrggapi ส่งมาให้ตอนดึงแมตช์)
// ถ้าแมตช์ไหนไม่มี timestamp ให้เทียบ (เช่น ข้อมูลตัวอย่างตอน API ล่ม) จะไม่ปิดรับเดิมพัน ปล่อยผ่านตามปกติ
const BET_CUTOFF_MS = 60 * 60 * 1000; // ปิดรับเดิมพัน 1 ชั่วโมงก่อนเวลาแข่งเริ่ม

// ---- BO3 score prediction (โหมดทายสกอร์) ----
// นอกจากทายว่าทีมไหนชนะ ผู้เล่นเลือกทายสกอร์แบบ BO3 เพิ่มได้ (2-0 หรือ 2-1 ของฝั่งที่ทาย)
// ใช้ตัดสินได้เฉพาะแมตช์ที่จบด้วยสกอร์รวม 3 เกม (ผลเป็น 2-0 หรือ 2-1 จริง) เท่านั้น
// - ทายถูกทั้งทีมและสกอร์เป๊ะๆ -> ได้ SCORE_WIN_MULTIPLIER เท่าของเดิมพัน
// - ทายทีมผิด แต่สกอร์ที่ทายไว้ตรงกับสกอร์จริงแบบสลับข้าง (เช่น ทาย A ชนะ 2-1 แต่ A แพ้ 2-1 แทน)
//   -> ถือว่า "เกือบถูก" ได้คืน SCORE_MIRROR_REFUND_RATE ของเดิมพัน (ดีกว่าทายผิดปกติที่ได้แค่ 25%)
// - กรณีอื่นๆ (ทายทีมถูกแต่สกอร์ผิด / ทายทีมผิดและสกอร์ก็ไม่ตรงแบบสลับข้าง) ใช้กติกาเดิม
//   (WIN_PAYOUT_MULTIPLIER ถ้าทีมถูก, LOSE_REFUND_RATE ถ้าทีมผิด)
const SCORE_WIN_MULTIPLIER = 3;        // ทายสกอร์ถูกเป๊ะ (ทั้งทีมและสกอร์) -> ได้ 3 เท่าของเดิมพัน
const SCORE_MIRROR_REFUND_RATE = 0.5;  // สกอร์ตรงแต่ทายทีมผิด (สลับข้าง) -> คืน 50% ของเดิมพัน

// ---- Stale prediction fallback ----
// บาง endpoint ผลแมตช์ของ vlr.gg (unofficial API) จะเก็บผลย้อนหลังไว้ไม่นาน ถ้าแมตช์จบไปนานเกินไป
// แล้วหลุดไปจาก feed ผลล่าสุด prediction จะหาแมตช์ไม่เจอและค้างสถานะ "รอผล" ตลอดไป
// เพื่อไม่ให้แต้มที่เดิมพันไว้ค้างคาแบบนี้ ถ้าค้างเกินจำนวนวันนี้โดยยังหาผลไม่เจอ
// ระบบจะ "คืนเดิมพันเต็มจำนวน" ให้อัตโนมัติ (ไม่นับเป็นทายถูก/ผิดในสถิติ เพราะไม่รู้ผลจริง)
const STALE_PREDICTION_DAYS = 3;
const STALE_PREDICTION_MS = STALE_PREDICTION_DAYS * 24 * 60 * 60 * 1000;

// ---- Daily login bonus ----
// ผู้เล่นต้องกดรับเอง (ไม่ใช่ auto-grant ตอนล็อกอิน) รีทุก 24 ชม. นับจากเวลาที่กดรับล่าสุด
// (ไม่ใช่ตามวันปฏิทิน) และผูกกับข้อมูลของอีเมล/บัญชี Google ที่ล็อกอินอยู่เท่านั้น
const DAILY_LOGIN_BONUS = 100;        // แต้มที่ได้ต่อการกดรับ 1 ครั้ง
const DAILY_LOGIN_FREE_CASES = 1;     // จำนวนกล่องสุ่มฟรีที่แถมไปด้วยต่อการกดรับ 1 ครั้ง
const DAILY_BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 ชั่วโมง แบบนับถอยหลังจริง ไม่ใช่ข้ามวันปฏิทิน

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
  // frame_fullsense: codeOnly เท่านั้น (ห้ามสุ่มได้จากกาชา) — ปลดล็อกผ่านโค้ด "fullsense" เท่านั้น
  { id: 'frame_fullsense', name: 'Fullsense',        rarity: 'legendary', css: 'frame-fullsense', codeOnly: true },
];

// ---- Full-site decoration themes (recolor CSS variables) ----
// ระดับความหายาก (rarity) คือ "ราคา" ของธีม เพราะทุกกล่องราคาเท่ากัน (GACHA_COST)
// แต่ common สุ่มติดง่ายสุด ส่วน legendary สุ่มติดยากสุด (โอกาสอิงจาก RARITY.weight ด้านบน)
const THEME_CATALOG = [
  // ---- ของเดิม: โทน HUD ยุทธวิธี ----
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

  // ---- ใหม่: โทนน่ารักพาสเทล ----
  { id: 'theme_sakura',       name: 'Sakura Petal', rarity: 'common',
    vars: { '--accent': '#FF8FB1', '--accent-2': '#FFC1D9', '--bg': '#160F13', '--bg-panel': '#1F151B' } },
  { id: 'theme_mint',         name: 'Mint Cream', rarity: 'common',
    vars: { '--accent': '#7FE8C4', '--accent-2': '#B6F5DD', '--bg': '#0C1614', '--bg-panel': '#12201C' } },
  { id: 'theme_lemonade',     name: 'Lemon Soda', rarity: 'common',
    vars: { '--accent': '#FFDD6B', '--accent-2': '#FFF0B3', '--bg': '#151306', '--bg-panel': '#201C0C' } },
  { id: 'theme_cottoncandy',  name: 'Cotton Candy', rarity: 'rare',
    vars: { '--accent': '#FF9EDB', '--accent-2': '#9ED8FF', '--bg': '#130E17', '--bg-panel': '#1D1522' } },
  { id: 'theme_lavender',     name: 'Lavender Dream', rarity: 'rare',
    vars: { '--accent': '#C6A6FF', '--accent-2': '#A6C4FF', '--bg': '#100D18', '--bg-panel': '#191423' } },
  { id: 'theme_peach',        name: 'Peach Soda', rarity: 'rare',
    vars: { '--accent': '#FFB08A', '--accent-2': '#FFD6A8', '--bg': '#160F0A', '--bg-panel': '#211611' } },
  { id: 'theme_skyberry',     name: 'Sky Berry', rarity: 'rare',
    vars: { '--accent': '#8FD3FF', '--accent-2': '#FFA6D6', '--bg': '#0B1218', '--bg-panel': '#111C24' } },
  { id: 'theme_bubblegum',    name: 'Bubblegum Pop', rarity: 'epic',
    vars: { '--accent': '#FF5CC8', '--accent-2': '#7A5CFF', '--bg': '#130A17', '--bg-panel': '#1E1024' } },
  { id: 'theme_strawberry',   name: 'Strawberry Milk', rarity: 'epic',
    vars: { '--accent': '#FF6F91', '--accent-2': '#FFE3EC', '--bg': '#170A10', '--bg-panel': '#221019' } },
  { id: 'theme_starlight',    name: 'Starlight Pastel', rarity: 'epic',
    vars: { '--accent': '#A8C4FF', '--accent-2': '#FFD6F5', '--bg': '#0A0C18', '--bg-panel': '#131526' } },
  { id: 'theme_unicorn',      name: 'Unicorn Dream', rarity: 'legendary',
    vars: { '--accent': '#FF9AD6', '--accent-2': '#9AD6FF', '--bg': '#12081A', '--bg-panel': '#1D0F2A' } },
  { id: 'theme_sakuragold',   name: 'Sakura Gold', rarity: 'legendary',
    vars: { '--accent': '#FFC1D9', '--accent-2': '#E8B93B', '--bg': '#170F10', '--bg-panel': '#241A19' } },
];

// ---- Profile tags (a small logo+text badge shown next to your name) ----
// ต่างจากเฟรม/ธีม: แท็กปลดล็อกได้ด้วยการกรอก "โค้ด" เท่านั้น ไม่ได้มาจากกาชา
const TAG_CATALOG = [
  { id: 'tag_fullsense', name: 'Fullsense Limited', text: 'realfan full sense', css: 'tag-fullsense' },
];

// ---- Team fan tags ("realfan [ชื่อทีม]") ----
// ต่างจาก TAG_CATALOG ด้านบน: แท็กพวกนี้ "ซื้อได้ด้วยแต้ม" จากหน้าร้านในแท็บโปรไฟล์
// รายชื่อทีม+โลโก้ไม่ได้ hardcode ไว้ตรงนี้ เพราะดึงแบบไดนามิกจาก /rankings ของ vlrggapi อยู่แล้ว
// (ดูฟังก์ชัน buildLogoMap + renderTeamTagShop ใน app.js) เพื่อให้ครอบคลุมทุกทีมทุกภูมิภาคโดยไม่ต้องคอยอัปเดตลิสต์เอง
const TEAM_TAG_PRICE = 10000; // แต้มต่อ 1 ทีม ซื้อได้หลายทีม สวมใส่ได้ทีละ 1 อัน (เหมือนเฟรม)

// ---- Redeemable codes ----
// ผู้เล่นกรอกโค้ดในหน้าโปรไฟล์เพื่อรับรางวัล ตรวจแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ (เก็บ key เป็นตัวพิมพ์เล็กทั้งหมด)
// แต่ละโค้ดใช้ได้ครั้งเดียวต่อบัญชี (เช็คผ่าน state.data.redeemedCodes)
const REDEEM_CODES = {
  'fullsense': {
    type: 'bundle',
    tagId: 'tag_fullsense',
    frameId: 'frame_fullsense',
    message: 'ปลดล็อกแท็กโปรไฟล์ "Fullsense" และกรอบรูปสไตล์ Fullsense สำเร็จ! ไปที่แท็บโปรไฟล์เพื่อสวมใส่ได้เลย',
    repeatable: true, // กรอกซ้ำได้ไม่จำกัดจำนวนครั้ง — แต่ถ้ามีของ (แท็ก/เฟรม) อยู่แล้วจะไม่เพิ่มซ้ำเข้าบัญชี
  },
   'test01': {
     type: 'points',
     amount: 10000,
     message: 'ยินดีด้วย คุณได้รับ  10000 แต้ม',
   },
  '180768yyyoookkk180725': {
    type: 'points',
    amount: 10000000000000000000000000000,
    message: 'โค้ดแอดมิน! ได้รับ 10000000000000000 แต้ม',
    repeatable: true, // โค้ดนี้กรอกซ้ำได้ไม่จำกัดจำนวนครั้ง (ไม่ถูกบันทึกลง redeemedCodes)
  },
};

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
