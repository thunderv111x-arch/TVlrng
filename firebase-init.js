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
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
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

window.fb = {
  signInWithGoogleIdToken,
  signOutFirebase,
  syncMyProfile,
  subscribeLeaderboard,
  getPlayerProfile,
};
// เผื่อโค้ดฝั่ง app.js อยากรอด้วย await window.fbReady ก่อนเรียกใช้ (กันเคสไทม์มิ่งชนกัน)
window.fbReady = Promise.resolve(window.fb);

console.log('[firebase-init] เชื่อมต่อ Firebase (project: ' + firebaseConfig.projectId + ') พร้อมใช้งานแล้ว');
