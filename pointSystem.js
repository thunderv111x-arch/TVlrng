/**
 * ระบบโอน Point ระหว่างผู้ใช้ด้วยอีเมล
 * -----------------------------------------
 * - ข้อมูล point ของแต่ละคนผูกกับ "อีเมล" เป็น key หลัก
 * - เก็บข้อมูลลงไฟล์ JSON (data.json) แทน database จริง
 *   -> ถ้าจะใช้กับ MySQL/Postgres/Mongo จริง แค่เปลี่ยนฟังก์ชัน
 *      loadData()/saveData() ให้ไปอ่าน/เขียน DB แทนไฟล์
 * - ถ้าอีเมลปลายทาง "ไม่เคยล็อกอิน" (ไม่มี record ในระบบ) -> ปฏิเสธการโอนทันที
 * - ทุกครั้งที่โอนสำเร็จ ระบบจะส่งอีเมลสรุป (backup) กลับไปหาทั้งผู้ส่งและผู้รับ
 */

const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer"); // npm install nodemailer

const DATA_FILE = path.join(__dirname, "data.json");

// ---------- Storage layer (เปลี่ยนตรงนี้ถ้าจะย้ายไปใช้ DB จริง) ----------

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

// ---------- User / Login ----------

/**
 * เรียกฟังก์ชันนี้ตอนผู้ใช้ล็อกอินเข้าแอพ (ครั้งแรกหรือครั้งไหนก็ได้)
 * จะสร้าง record ให้ถ้ายังไม่เคยมี -> ถือว่า "เคยล็อกอินแล้ว"
 */
function registerLogin(email) {
  const data = loadData();
  const key = normalizeEmail(email);

  if (!data.users[key]) {
    data.users[key] = {
      email: key,
      points: 0,
      history: [],
      firstLoginAt: new Date().toISOString(),
    };
    saveData(data);
  }
  return data.users[key];
}

/** เช็คว่าอีเมลนี้เคยล็อกอิน (มี record) หรือยัง */
function hasLoggedInBefore(email) {
  const data = loadData();
  const key = normalizeEmail(email);
  return Boolean(data.users[key]);
}

function getBalance(email) {
  const data = loadData();
  const key = normalizeEmail(email);
  return data.users[key] ? data.users[key].points : 0;
}

/** ไว้ให้แอดมิน/ระบบเติม point ให้ user (เช่น จากการซื้อ, ทำเควส ฯลฯ) */
function addPoints(email, amount, reason = "เติมพอยท์") {
  const data = loadData();
  const key = normalizeEmail(email);

  if (!data.users[key]) {
    throw new Error("อีเมลนี้ยังไม่เคยล็อกอินเข้าระบบ ไม่สามารถเติมพอยท์ได้");
  }
  if (amount <= 0) {
    throw new Error("จำนวนพอยท์ต้องมากกว่า 0");
  }

  data.users[key].points += amount;
  data.users[key].history.push({
    type: "ADD",
    amount,
    reason,
    at: new Date().toISOString(),
  });
  saveData(data);
  return data.users[key];
}

// ---------- Transfer ----------

/**
 * โอน point จาก fromEmail ไปยัง toEmail
 * เงื่อนไขการปฏิเสธ:
 *  1. toEmail ไม่เคยล็อกอินเข้าแอพมาก่อน -> ปฏิเสธ
 *  2. fromEmail ไม่เคยล็อกอิน -> ปฏิเสธ (กันกรณีปลอมอีเมลผู้ส่ง)
 *  3. fromEmail มี point ไม่พอ -> ปฏิเสธ
 *  4. โอนให้ตัวเอง -> ปฏิเสธ
 */
async function transferPoints(fromEmail, toEmail, amount, { sendBackupEmail = false } = {}) {
  const data = loadData();
  const from = normalizeEmail(fromEmail);
  const to = normalizeEmail(toEmail);

  if (from === to) {
    return { success: false, reason: "ไม่สามารถโอนให้ตัวเองได้" };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, reason: "จำนวนพอยท์ไม่ถูกต้อง" };
  }

  if (!data.users[from]) {
    return { success: false, reason: "อีเมลผู้ส่งไม่เคยล็อกอินเข้าระบบ" };
  }

  // *** เงื่อนไขหลักตามที่ต้องการ ***
  if (!data.users[to]) {
    return {
      success: false,
      reason: `อีเมลผู้รับ (${to}) ไม่เคยล็อกอินเข้าแอพ -> ปฏิเสธการโอน`,
    };
  }

  if (data.users[from].points < amount) {
    return { success: false, reason: "พอยท์ของผู้ส่งไม่เพียงพอ" };
  }

  // ทำการโอน
  data.users[from].points -= amount;
  data.users[to].points += amount;

  const timestamp = new Date().toISOString();
  data.users[from].history.push({
    type: "TRANSFER_OUT",
    to,
    amount,
    at: timestamp,
  });
  data.users[to].history.push({
    type: "TRANSFER_IN",
    from,
    amount,
    at: timestamp,
  });

  saveData(data);

  if (sendBackupEmail) {
    await Promise.all([
      backupToEmail(from).catch((e) => console.error("backup email error:", e.message)),
      backupToEmail(to).catch((e) => console.error("backup email error:", e.message)),
    ]);
  }

  return {
    success: true,
    from: data.users[from],
    to: data.users[to],
  };
}

// ---------- Backup ผ่านอีเมล ----------

/**
 * ส่งอีเมลสรุปยอด point + ประวัติล่าสุดกลับไปหาผู้ใช้
 * ต้องตั้งค่า SMTP ของตัวเองใน createTransport
 */
async function backupToEmail(email) {
  const data = loadData();
  const key = normalizeEmail(email);
  const user = data.users[key];
  if (!user) throw new Error("ไม่พบผู้ใช้นี้ในระบบ");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const recentHistory = user.history.slice(-10).reverse();
  const historyText = recentHistory
    .map((h) => `- [${h.at}] ${h.type} ${h.amount} พอยท์ ${h.to ? "ไปหา " + h.to : ""}${h.from ? "จาก " + h.from : ""}`)
    .join("\n");

  await transporter.sendMail({
    from: process.env.SMTP_FROM || "no-reply@yourapp.com",
    to: user.email,
    subject: "สรุปยอด Point ของคุณ (Backup)",
    text: `ยอดพอยท์ปัจจุบันของคุณ: ${user.points} แต้ม\n\nประวัติล่าสุด:\n${historyText || "-"}`,
  });
}

module.exports = {
  registerLogin,
  hasLoggedInBefore,
  getBalance,
  addPoints,
  transferPoints,
  backupToEmail,
};
