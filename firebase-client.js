import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, OAuthProvider, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, runTransaction,
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js';
import { firebaseConfig, firebaseReady } from './firebase-config.js';

let app, auth, db, storage;
if (firebaseReady) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const inviteCode = () => Array.from({length:8}, () => alphabet[Math.floor(Math.random()*alphabet.length)]).join('');

export { firebaseReady };

export async function loginGoogle() {
  if (!firebaseReady) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  await signInWithRedirect(auth, provider);
}

export async function loginApple() {
  if (!firebaseReady) throw new Error('Firebase 설정이 아직 연결되지 않았습니다.');
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  provider.setCustomParameters({ locale: 'ko_KR' });
  await signInWithRedirect(auth, provider);
}

export async function finishRedirectLogin() {
  if (!firebaseReady) return null;
  try { return await getRedirectResult(auth); }
  catch (e) { console.error(e); throw e; }
}

export function watchAuth(callback) {
  if (!firebaseReady) { callback(null); return () => {}; }
  return onAuthStateChanged(auth, async user => {
    if (user) {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          displayName: user.displayName || '',
          email: user.email || '',
          photoURL: user.photoURL || '',
          spaceId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        await updateDoc(userRef, {
          displayName: user.displayName || snap.data().displayName || '',
          email: user.email || snap.data().email || '',
          photoURL: user.photoURL || snap.data().photoURL || '',
          updatedAt: serverTimestamp()
        });
      }
    }
    callback(user);
  });
}

export async function logout() {
  if (firebaseReady && auth) await signOut(auth);
}

export async function getMyProfile() {
  if (!auth?.currentUser) return null;
  const s = await getDoc(doc(db, 'users', auth.currentUser.uid));
  return s.exists() ? s.data() : null;
}

export async function createCoupleSpace() {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const spaceRef = doc(collection(db, 'spaces'));
  const code = inviteCode();
  const inviteRef = doc(db, 'invites', code);
  await runTransaction(db, async tx => {
    const userRef = doc(db, 'users', uid);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists() && userSnap.data().spaceId) throw new Error('이미 커플 공간에 참여 중입니다.');
    tx.set(spaceRef, {
      memberIds: [uid],
      ownerId: uid,
      relationshipDate: null,
      inviteCode: code,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    tx.set(inviteRef, {
      code,
      spaceId: spaceRef.id,
      ownerId: uid,
      active: true,
      createdAt: serverTimestamp()
    });
    tx.set(userRef, { spaceId: spaceRef.id, updatedAt: serverTimestamp() }, { merge: true });
  });
  return { spaceId: spaceRef.id, code };
}

export async function joinCoupleSpace(codeInput) {
  if (!auth?.currentUser) throw new Error('로그인이 필요합니다.');
  const uid = auth.currentUser.uid;
  const code = String(codeInput || '').trim().toUpperCase();
  if (!code) throw new Error('초대 코드를 입력해 주세요.');
  const inviteRef = doc(db, 'invites', code);
  let joinedSpaceId = null;
  await runTransaction(db, async tx => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists() || !inviteSnap.data().active) throw new Error('유효하지 않거나 이미 사용된 초대 코드입니다.');
    const { spaceId } = inviteSnap.data();
    const spaceRef = doc(db, 'spaces', spaceId);
    const userRef = doc(db, 'users', uid);
    const [spaceSnap, userSnap] = await Promise.all([tx.get(spaceRef), tx.get(userRef)]);
    if (!spaceSnap.exists()) throw new Error('커플 공간을 찾을 수 없습니다.');
    if (userSnap.exists() && userSnap.data().spaceId) throw new Error('이미 다른 커플 공간에 참여 중입니다.');
    const members = Array.from(new Set([...(spaceSnap.data().memberIds || []), uid]));
    if (members.length > 2) throw new Error('이미 두 명이 참여한 공간입니다.');
    tx.update(spaceRef, { memberIds: members, inviteCode: null, updatedAt: serverTimestamp() });
    tx.update(inviteRef, { active: false, usedBy: uid, usedAt: serverTimestamp() });
    tx.set(userRef, { spaceId, updatedAt: serverTimestamp() }, { merge: true });
    joinedSpaceId = spaceId;
  });
  return joinedSpaceId;
}

export function watchSpace(spaceId, callback) {
  if (!spaceId) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'spaces', spaceId), snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

export function watchMemories(spaceId, callback) {
  if (!spaceId) { callback([]); return () => {}; }
  const q = query(collection(db, 'spaces', spaceId, 'memories'), orderBy('date', 'desc'));
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function saveRelationshipDate(spaceId, value) {
  if (!spaceId) throw new Error('커플 공간이 없습니다.');
  await updateDoc(doc(db, 'spaces', spaceId), { relationshipDate: value, updatedAt: serverTimestamp() });
}

export async function saveMemory(spaceId, data, files = []) {
  if (!auth?.currentUser || !spaceId) throw new Error('로그인과 커플 공간이 필요합니다.');
  const uid = auth.currentUser.uid;
  const photoURLs = [];
  for (const file of files.slice(0, 3)) {
    const safeName = file.name?.replace(/[^a-zA-Z0-9._-]/g, '_') || 'photo.jpg';
    const path = `spaces/${spaceId}/memories/${Date.now()}-${Math.random().toString(36).slice(2)}/${safeName}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' });
    photoURLs.push(await getDownloadURL(storageRef));
  }
  const refDoc = await addDoc(collection(db, 'spaces', spaceId, 'memories'), {
    date: data.date,
    title: data.title || '우리의 하루',
    text: data.text || '',
    location: data.location || '',
    mood: data.mood || '',
    photos: photoURLs,
    authorId: uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return refDoc.id;
}

export function currentUser() { return auth?.currentUser || null; }
