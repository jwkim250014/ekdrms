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
  return onAuthStateChanged(auth, async user => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      const base = {
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || '',
        updatedAt: serverTimestamp()
      };
      if (!snap.exists()) {
        await setDoc(userRef, { ...base, coupleId: null, createdAt: serverTimestamp() });
      } else {
        await setDoc(userRef, base, { merge: true });
      }
    }
    callback(user);
  });
}

export async function logout() {
  if (auth) await signOut(auth);
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
  batch.set(userRef, { coupleId: coupleRef.id, updatedAt: serverTimestamp() }, { merge: true });
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
  batch.set(userRef, { coupleId, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
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
  const refDoc = await addDoc(collection(db, 'couples', coupleId, 'records'), {
    date: data.date,
    title: data.title || '우리의 하루',
    text: data.text || '',
    location: data.location || '',
    mood: data.mood || '',
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
