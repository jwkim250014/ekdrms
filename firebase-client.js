import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc,
  query, orderBy, onSnapshot, serverTimestamp, writeBatch, arrayUnion
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';
import { firebaseConfig, firebaseReady } from './firebase-config.js';

const app = firebaseReady ? initializeApp(firebaseConfig) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getFirestore(app) : null;

if (auth) {
  setPersistence(auth, browserLocalPersistence).catch(console.error);
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeInviteCode = () => Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

function shortName(user) {
  const raw = user?.displayName || user?.email?.split('@')[0] || '나';
  return String(raw).trim().slice(0, 14) || '나';
}

function ensureIdentityStyle() {
  if (document.getElementById('ourdayIdentityStyle')) return;
  const style = document.createElement('style');
  style.id = 'ourdayIdentityStyle';
  style.textContent = `
    .couple-identity{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;margin:16px 0 2px;padding:12px;background:#fff;border:1px solid #f1dfe5;border-radius:20px}
    .couple-identity .person{text-align:center;min-width:0}.couple-identity .heart{font-size:22px;color:#e76b8d}
    .couple-identity .avatar{width:42px;height:42px;border-radius:50%;overflow:hidden;background:#ffe7ee;display:grid;place-items:center;margin:0 auto 6px;color:#d86585;font-weight:800}
    .couple-identity .avatar img{width:100%;height:100%;object-fit:cover}.couple-identity .name{font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .couple-identity .sub{font-size:11px;color:#9b8990;margin-top:3px}.couple-identity .me{display:inline-block;margin-left:4px;padding:2px 6px;border-radius:999px;background:#ffedf2;color:#d85f80;font-size:10px;vertical-align:1px}`;
  document.head.appendChild(style);
}

function renderIdentityBar(couple) {
  if (!auth?.currentUser) return;
  const appSection = document.getElementById('app');
  const top = appSection?.querySelector('.top');
  if (!appSection || !top) return;
  ensureIdentityStyle();

  let box = document.getElementById('coupleIdentity');
  if (!box) {
    box = document.createElement('div');
    box.id = 'coupleIdentity';
    box.className = 'couple-identity';
    top.insertAdjacentElement('afterend', box);
  }

  const me = auth.currentUser;
  const myName = shortName(me);
  const avatar = me.photoURL
    ? `<div class="avatar"><img src="${esc(me.photoURL)}" alt=""></div>`
    : `<div class="avatar">${esc(myName.slice(0,1))}</div>`;
  const partnerConnected = Array.isArray(couple?.members) && couple.members.some(uid => uid !== me.uid);

  box.innerHTML = `
    <div class="person">${avatar}<div class="name">${esc(myName)} <span class="me">나</span></div><div class="sub">내 계정</div></div>
    <div class="heart">♡</div>
    <div class="person"><div class="avatar">♡</div><div class="name">상대방</div><div class="sub">${partnerConnected ? '연결됨' : '초대 대기 중'}</div></div>`;
}

function decorateRecord(data) {
  const mine = !!auth?.currentUser && data.authorUid === auth.currentUser.uid;
  const who = mine ? '나' : '상대방';
  const mood = String(data.mood || '♡').replace(/\s·\s(?:나|상대방)$/,'');
  return { ...data, mood: `${mood} · ${who}`, _authorLabel: who };
}

export { firebaseReady };

export async function loginGoogle() {
  if (!auth) throw new Error('Firebase 연결이 준비되지 않았습니다.');
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function loginApple() {
  if (!auth) throw new Error('Firebase 연결이 준비되지 않았습니다.');
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  await signInWithRedirect(auth, provider);
}

export async function finishRedirectLogin() {
  if (!auth) return null;
  return getRedirectResult(auth);
}

export function watchAuth(callback) {
  if (!auth) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, user => callback(user));
}

export async function logout() {
  if (auth) await signOut(auth);
  document.getElementById('coupleIdentity')?.remove();
}

export async function getMyProfile() {
  if (!auth?.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createCoupleSpace() {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists() && userSnap.data().coupleId) throw new Error('이미 커플 공간에 참여 중입니다.');

  const coupleRef = doc(collection(db, 'couples'));
  const code = makeInviteCode();
  const inviteRef = doc(db, 'invites', code);
  const batch = writeBatch(db);
  batch.set(coupleRef, {
    ownerUid: uid,
    members: [uid],
    relationshipDate: null,
    inviteCode: code,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(inviteRef, {
    code,
    coupleId: coupleRef.id,
    ownerUid: uid,
    active: true,
    createdAt: serverTimestamp()
  });
  batch.set(userRef, {
    uid,
    displayName: auth.currentUser.displayName || '',
    email: auth.currentUser.email || '',
    photoURL: auth.currentUser.photoURL || '',
    coupleId: coupleRef.id,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
  return { coupleId: coupleRef.id, code };
}

export async function joinCoupleSpace(codeInput) {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const code = String(codeInput || '').trim().toUpperCase();
  if (!code) throw new Error('초대 코드를 입력해 주세요.');

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists() && userSnap.data().coupleId) throw new Error('이미 커플 공간에 참여 중입니다.');

  const inviteRef = doc(db, 'invites', code);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists() || !inviteSnap.data().active) throw new Error('유효하지 않거나 이미 사용된 초대 코드입니다.');

  const coupleId = inviteSnap.data().coupleId;
  const coupleRef = doc(db, 'couples', coupleId);
  const batch = writeBatch(db);
  batch.update(coupleRef, {
    members: arrayUnion(uid),
    inviteCode: null,
    updatedAt: serverTimestamp()
  });
  batch.update(inviteRef, {
    active: false,
    usedBy: uid,
    usedAt: serverTimestamp()
  });
  batch.set(userRef, {
    uid,
    displayName: auth.currentUser.displayName || '',
    email: auth.currentUser.email || '',
    photoURL: auth.currentUser.photoURL || '',
    coupleId,
    updatedAt: serverTimestamp()
  }, { merge: true });
  await batch.commit();
  return coupleId;
}

export function watchCouple(coupleId, callback, onError) {
  if (!coupleId) { callback(null); return () => {}; }
  return onSnapshot(
    doc(db, 'couples', coupleId),
    snap => {
      const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      renderIdentityBar(data);
      callback(data);
    },
    onError || console.error
  );
}

export function watchRecords(coupleId, callback, onError) {
  if (!coupleId) { callback([]); return () => {}; }
  const q = query(collection(db, 'couples', coupleId, 'records'), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => decorateRecord({ id: d.id, ...d.data() }))),
    onError || console.error
  );
}

export async function saveRelationshipDate(coupleId, value) {
  if (!coupleId) throw new Error('커플 공간이 없습니다.');
  await updateDoc(doc(db, 'couples', coupleId), {
    relationshipDate: value,
    updatedAt: serverTimestamp()
  });
}

export async function saveRecord(coupleId, data) {
  if (!auth?.currentUser || !coupleId) throw new Error('로그인과 커플 공간이 필요합니다.');
  const refDoc = await addDoc(collection(db, 'couples', coupleId, 'records'), {
    date: data.date,
    title: data.title || '우리의 하루',
    text: data.text || '',
    location: data.location || '',
    mood: String(data.mood || '').replace(/\s·\s(?:나|상대방)$/,''),
    photos: Array.isArray(data.photos) ? data.photos.slice(0, 3) : [],
    authorUid: auth.currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return refDoc.id;
}

export function currentUser() {
  return auth?.currentUser || null;
}
