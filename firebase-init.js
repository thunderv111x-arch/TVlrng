// firebase-init.js
// ---------------------------------------------------------------------------
// ไฟล์นี้แยกออกมาต่างหากจาก app.js โดยเจตนา เพราะ Firebase modular SDK ต้องโหลดผ่าน
// <script type="module">  ถ้าเอาไปรวมกับ app.js (ซึ่งเป็น classic script ที่ index.html
// เรียกใช้ฟังก์ชันตรงๆ ผ่าน onclick="...") จะทำให้ทุกฟังก์ชันใน app.js หลุดจาก global scope
// (module มี scope ของตัวเอง) แล้วปุ่มทุกปุ่มในหน้าเว็บจะพังทันที
//
// ไฟล์นี้เลยทำหน้าที่แค่ต่อกับ Firebase แล้ว "แปะ" ฟังก์ชันที่ app.js ต้องใช้ไว้ที่ window.fb
// ให้ app.js (classic script) เรียกใช้งานได้ตามปกติ เช่น window.fb.syncMyProfile(...)
// ---------------------------------------------------------------------------

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';

// ได้จาก Firebase Console > Project settings > Your apps > SDK setup and configuration
// ค่าพวกนี้เป็น public config ปกติ ไม่ใช่ secret key — ความปลอดภัยจริงไปอยู่ที่ Firestore
// Security Rules ต่างหาก (ดูไฟล์ firestore.rules ที่แนบมาด้วย)
const firebaseConfig = {
  apiKey: "AIzaSyAwqqmi_WeK5BCtWKPtEx1LlP1LSthMfSw",
  authDomain: "predicttvlr.firebaseapp.com",
  projectId: "predicttvlr",
  storageBucket: "predicttvlr.firebasestorage.app",
  messagingSenderId: "524935435037",
  appId: "1:524935435037:web:94c3091763ebc1a1f647f4",
  measurementId: "G-S8HN7J9XX9"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const PLAYERS_COLLECTION = 'players';
const TRANSFERS_COLLECTION = 'transfers';           // log การโอนแต้มทุกครั้ง (อ้าง uid ทั้งฝั่งส่ง/รับ)
const PENDING_TRANSFERS_COLLECTION = 'pendingTransfers'; // คิวแต้มที่โอนไปหาอีเมลที่ยังไม่เคยผูก uid

// ---- Auth: ใช้ id_token เดิมที่ได้จาก Google Identity Services (ตัวที่ app.js ใช้ล็อกอินเว็บอยู่แล้ว)
// มาแลกเป็น Firebase Auth session อีกที เพื่อให้ Firestore Security Rules เช็ค request.auth.uid ได้
async function signInWithGoogleIdToken(idToken) {
  const credential = GoogleAuthProvider.credential(idToken);
  const result = await signInWithCredential(auth, credential);
  return result.user; // .uid ตัวนี้แหละคือ document id ใน players/{uid}
}

async function signOutFirebase() {
  try { await firebaseSignOut(auth); } catch (e) { /* เงียบไว้ ไม่ critical */ }
}

// ---- เขียน/อัปเดตโปรไฟล์ตัวเอง (merge: true กันเขียนทับ field อื่นที่ไม่ได้ส่งมา) ----
async function syncMyProfile(uid, data) {
  if (!uid) return;
  await setDoc(
    doc(db, PLAYERS_COLLECTION, uid),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true }
  );
}

// ---- subscribe ลีดเดอร์บอร์ด แบบ real-time (เรียงแต้มมากไปน้อย) ----
// คืนค่าเป็น unsubscribe function ให้เรียกตอนเลิกใช้ (เช่น สลับออกจากแท็บ) กันหน่วยความจำรั่ว
function subscribeLeaderboard(limitN, onUpdate, onError) {
  const q = query(collection(db, PLAYERS_COLLECTION), orderBy('points', 'desc'), limit(limitN));
  return onSnapshot(
    q,
    (snap) => {
      const rows = [];
      snap.forEach((d) => rows.push({ uid: d.id, ...d.data() }));
      onUpdate(rows);
    },
    (err) => { if (onError) onError(err); }
  );
}

// ---- ดึงโปรไฟล์คนอื่นแบบครั้งเดียว (ไม่ real-time) สำหรับหน้า "ดูโปรไฟล์" ----
async function getPlayerProfile(uid) {
  const snap = await getDoc(doc(db, PLAYERS_COLLECTION, uid));
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null;
}

// ---- โอนแต้ม (uid-based, ข้ามอุปกรณ์ได้จริงเพราะเก็บบน Firestore ไม่ใช่ localStorage) ----

// หา uid ของผู้รับจาก emailLower ที่ sync ไว้ใน players/{uid}.emailLower
// (ต้องเคย sync อย่างน้อย 1 ครั้งถึงจะเจอ เพราะ Firestore ไม่รู้จัก "อีเมล Google" ตรงๆ รู้แค่ uid)
async function findPlayerByEmail(emailLower) {
  const q = query(collection(db, PLAYERS_COLLECTION), where('emailLower', '==', emailLower), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
}

// โอนแต้มจาก uid หนึ่งไปอีก uid หนึ่ง แบบ atomic (Firestore transaction กันแต้มหาย/ซ้ำถ้ามีคนกดพร้อมกัน)
// โยน error ออกมาถ้าแต้มไม่พอ ให้ฝั่ง app.js ไป catch แล้วแจ้ง user เอง
async function transferPointsByUid(fromUid, toUid, amount, meta = {}) {
  if (!fromUid || !toUid) throw new Error('missing uid');
  if (fromUid === toUid) throw new Error('SELF_TRANSFER');
  if (!(amount > 0)) throw new Error('INVALID_AMOUNT');

  const fromRef = doc(db, PLAYERS_COLLECTION, fromUid);
  const toRef = doc(db, PLAYERS_COLLECTION, toUid);

  await runTransaction(db, async (tx) => {
    const fromSnap = await tx.get(fromRef);
    const toSnap = await tx.get(toRef);
    const fromPoints = (fromSnap.exists() ? fromSnap.data().points : 0) || 0;
    if (fromPoints < amount) throw new Error('INSUFFICIENT_POINTS');
    const toPoints = (toSnap.exists() ? toSnap.data().points : 0) || 0;
    tx.set(fromRef, { points: fromPoints - amount, updatedAt: serverTimestamp() }, { merge: true });
    tx.set(toRef, { points: toPoints + amount, updatedAt: serverTimestamp() }, { merge: true });
  });

  await addDoc(collection(db, TRANSFERS_COLLECTION), {
    fromUid, toUid, amount,
    fromName: meta.fromName || null,
    toName: meta.toName || null,
    createdAt: serverTimestamp(),
  });
}

// ผู้รับยังไม่เคยเชื่อมต่อ Firebase มาก่อน (ไม่เจอ uid จากอีเมล) -> พักแต้มไว้ที่เอกสาร
// pendingTransfers/{emailLower} ก่อน แต้มจะเข้าบัญชีอัตโนมัติตอนอีเมลนั้นล็อกอินครั้งแรก (ข้ามอุปกรณ์ได้)
async function queuePendingTransfer(emailLower, entry) {
  const ref = doc(db, PENDING_TRANSFERS_COLLECTION, emailLower);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const queue = (snap.exists() && Array.isArray(snap.data().queue)) ? snap.data().queue : [];
    queue.push({ ...entry, at: Date.now() }); // ห้ามใช้ serverTimestamp() ในอิลิเมนต์ของ array
    tx.set(ref, { queue }, { merge: true });
  });
}

// เรียกตอน login สำเร็จ (รู้ทั้ง uid ตัวเองและ emailLower ตัวเอง) เพื่อรับแต้มที่เพื่อนโอนมาค้างไว้ก่อนหน้านี้
// คืนค่า { total, items } ถ้ามีของค้างรับ, หรือ null ถ้าไม่มี
async function claimPendingTransfers(uid, emailLower) {
  const pendRef = doc(db, PENDING_TRANSFERS_COLLECTION, emailLower);
  const playerRef = doc(db, PLAYERS_COLLECTION, uid);

  const result = await runTransaction(db, async (tx) => {
    const pendSnap = await tx.get(pendRef);
    if (!pendSnap.exists()) return null;
    const queue = pendSnap.data().queue || [];
    if (!queue.length) return null;

    const total = queue.reduce((sum, item) => sum + (item.amount || 0), 0);
    const playerSnap = await tx.get(playerRef);
    const currentPoints = (playerSnap.exists() ? playerSnap.data().points : 0) || 0;

    tx.set(playerRef, { points: currentPoints + total, updatedAt: serverTimestamp() }, { merge: true });
    tx.delete(pendRef); // เคลียร์คิวทิ้งหลังจ่ายแล้ว กันรับซ้ำ

    return { total, items: queue };
  });

  return result; // null = ไม่มีอะไรค้าง
}

window.fb = {
  signInWithGoogleIdToken,
  signOutFirebase,
  syncMyProfile,
  subscribeLeaderboard,
  getPlayerProfile,
  findPlayerByEmail,
  transferPointsByUid,
  queuePendingTransfer,
  claimPendingTransfers,
};
// เผื่อโค้ดฝั่ง app.js อยากรอด้วย await window.fbReady ก่อนเรียกใช้ (กันเคสไทม์มิ่งชนกัน)
window.fbReady = Promise.resolve(window.fb);

console.log('[firebase-init] เชื่อมต่อ Firebase (project: ' + firebaseConfig.projectId + ') พร้อมใช้งานแล้ว');
