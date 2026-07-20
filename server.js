/**
 * ตัวอย่างการเปิดเป็น API ด้วย Express
 * รัน: node server.js
 * ทดสอบ: ดูตัวอย่างคำสั่ง curl ด้านล่างสุดของไฟล์
 */

const express = require("express");
const {
  registerLogin,
  hasLoggedInBefore,
  getBalance,
  addPoints,
  transferPoints,
} = require("./pointSystem");

const app = express();
app.use(express.json());

// เรียกตอน user ล็อกอินเข้าแอพ (ใส่ตรง flow login ของคุณ)
app.post("/login", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "ต้องระบุ email" });

  const user = registerLogin(email);
  res.json({ message: "ล็อกอินสำเร็จ", user });
});

// เช็คยอดพอยท์
app.get("/points/:email", (req, res) => {
  const email = req.params.email;
  if (!hasLoggedInBefore(email)) {
    return res.status(404).json({ error: "ไม่พบผู้ใช้นี้ (ยังไม่เคยล็อกอิน)" });
  }
  res.json({ email, points: getBalance(email) });
});

// แอดมินเติมพอยท์ให้ user (ตัวอย่าง)
app.post("/points/add", (req, res) => {
  const { email, amount, reason } = req.body;
  try {
    const user = addPoints(email, amount, reason);
    res.json({ message: "เติมพอยท์สำเร็จ", user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// โอนพอยท์ระหว่างผู้ใช้
app.post("/points/transfer", async (req, res) => {
  const { fromEmail, toEmail, amount } = req.body;

  const result = await transferPoints(fromEmail, toEmail, amount, {
    sendBackupEmail: true, // ตั้งเป็น false ถ้ายังไม่พร้อมตั้งค่า SMTP
  });

  if (!result.success) {
    return res.status(400).json({ error: result.reason });
  }

  res.json({
    message: "โอนพอยท์สำเร็จ",
    from: result.from,
    to: result.to,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Point system API running on port ${PORT}`));

/**
 * ตัวอย่างการทดสอบด้วย curl:
 *
 * 1. ล็อกอิน 2 คนก่อน (ต้องล็อกอินก่อนถึงจะรับโอนได้)
 *    curl -X POST http://localhost:3000/login -H "Content-Type: application/json" -d '{"email":"a@gmail.com"}'
 *    curl -X POST http://localhost:3000/login -H "Content-Type: application/json" -d '{"email":"b@gmail.com"}'
 *
 * 2. เติมพอยท์ให้ a@gmail.com
 *    curl -X POST http://localhost:3000/points/add -H "Content-Type: application/json" -d '{"email":"a@gmail.com","amount":100}'
 *
 * 3. โอนพอยท์จาก a ไป b
 *    curl -X POST http://localhost:3000/points/transfer -H "Content-Type: application/json" -d '{"fromEmail":"a@gmail.com","toEmail":"b@gmail.com","amount":30}'
 *
 * 4. ลองโอนไปอีเมลที่ไม่เคยล็อกอิน -> ต้องถูกปฏิเสธ
 *    curl -X POST http://localhost:3000/points/transfer -H "Content-Type: application/json" -d '{"fromEmail":"a@gmail.com","toEmail":"c@gmail.com","amount":10}'
 */
