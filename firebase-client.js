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

if (auth) setPersistence(auth, browserLocalPersistence).catch(console.error);

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeInviteCode = () => Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const cleanNickname = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 12);

async function writeMemberProfile(coupleId, uid, nickname) {
  if (!coupleId || !uid || !nickname) return;
  await setDoc(doc(db, 'couples', coupleId, 'records', `profile_${uid}`), {
    type: 'member-profile',
    date: '0000-00-00',
    authorUid: uid,
    authorName: nickname,
    updatedAt: serverTimestamp()
  }, { merge: true });
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
}

export async function getMyProfile() {
  if (!auth?.currentUser) return null;
  const snap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveNickname(value) {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const nickname = cleanNickname(value);
  if (!nickname) throw new Error('이름을 입력해 주세요.');
  const uid = auth.currentUser.uid;
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    await setDoc(userRef, { uid, nickname, updatedAt: serverTimestamp() }, { merge: true });
    if (snap.data().coupleId) await writeMemberProfile(snap.data().coupleId, uid, nickname);
  } else {
    await setDoc(userRef, {
      uid,
      nickname,
      coupleId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  return nickname;
}

export async function createCoupleSpace() {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const nickname = cleanNickname(userSnap.exists() ? userSnap.data().nickname : '');
  if (!nickname) throw new Error('먼저 앱에서 사용할 이름을 설정해 주세요.');
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
  batch.set(userRef, { uid, nickname, coupleId: coupleRef.id, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  await writeMemberProfile(coupleRef.id, uid, nickname);
  return { coupleId: coupleRef.id, code };
}

export async function joinCoupleSpace(codeInput) {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const code = String(codeInput || '').trim().toUpperCase();
  if (!code) throw new Error('초대 코드를 입력해 주세요.');

  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const nickname = cleanNickname(userSnap.exists() ? userSnap.data().nickname : '');
  if (!nickname) throw new Error('먼저 앱에서 사용할 이름을 설정해 주세요.');
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
  batch.set(userRef, { uid, nickname, coupleId, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  await writeMemberProfile(coupleId, uid, nickname);
  return coupleId;
}

export function watchCouple(coupleId, callback, onError) {
  if (!coupleId) { callback(null); return () => {}; }
  return onSnapshot(
    doc(db, 'couples', coupleId),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError || console.error
  );
}

export function watchRecords(coupleId, callback, onError) {
  if (!coupleId) { callback([]); return () => {}; }
  const q = query(collection(db, 'couples', coupleId, 'records'), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
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
  const profileSnap = await getDoc(doc(db, 'users', auth.currentUser.uid));
  const nickname = cleanNickname(profileSnap.exists() ? profileSnap.data().nickname : '');
  if (!nickname) throw new Error('앱에서 사용할 이름을 먼저 설정해 주세요.');

  const refDoc = await addDoc(collection(db, 'couples', coupleId, 'records'), {
    date: data.date,
    title: data.title || '우리의 하루',
    text: data.text || '',
    location: data.location || '',
    mood: data.mood || '',
    photos: Array.isArray(data.photos) ? data.photos.slice(0, 3) : [],
    authorUid: auth.currentUser.uid,
    authorName: nickname,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return refDoc.id;
}

export function currentUser() {
  return auth?.currentUser || null;
}
