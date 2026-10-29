import './firebase-client.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

const VAPID_PUBLIC_KEY = 'BFALazfhHsea6OECm9Zyc0ONVhlG4apcOtCe91rp6_SD7x3N0wZDkqraWx5UwP9d1VvDkhvQQSaWfaTbLi2uNB8';

const app = getApp();
const auth = getAuth(app);
const db = getFirestore(app);

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function dplusFromDate(value) {
  if (!value) return 0;
  const [y, m, d] = String(value).split('-').map(Number);
  if (!y || !m || !d) return 0;
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((b - a) / 86400000) + 1;
}

async function profileAndCouple() {
  const user = auth.currentUser;
  if (!user) return null;
  const userRef = doc(db, 'users', user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists() || !userSnap.data().coupleId) return null;
  const coupleId = userSnap.data().coupleId;
  const coupleSnap = await getDoc(doc(db, 'couples', coupleId));
  if (!coupleSnap.exists()) return null;
  return {
    userRef,
    userData: userSnap.data(),
    coupleId,
    couple: coupleSnap.data()
  };
}

async function setForegroundBadge() {
  if (!('setAppBadge' in navigator)) return;
  const data = await profileAndCouple().catch(() => null);
  const count = dplusFromDate(data?.couple?.relationshipDate);
  try {
    if (count > 0) await navigator.setAppBadge(count);
    else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch (e) {
    console.debug('badge update skipped', e);
  }
}

async function getPushState() {
  if (!('serviceWorker' in navigator)) return { supported: false };
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager?.getSubscription?.();
  return { supported: !!reg.pushManager, subscription: sub || null };
}

function ensureButton() {
  const hero = document.querySelector('#homeView .hero');
  if (!hero || document.getElementById('dplusBadgeBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'dplusBadgeBtn';
  btn.className = 'settings-btn';
  btn.style.marginLeft = '6px';
  btn.textContent = 'D+ 배지 켜기';
  btn.addEventListener('click', enableDailyBadge);
  hero.appendChild(btn);
  refreshButton();
}

async function refreshButton() {
  const btn = document.getElementById('dplusBadgeBtn');
  if (!btn) return;
  if (!isStandalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    btn.textContent = '홈 화면 설치 후 D+ 배지 켜기';
    return;
  }
  const state = await getPushState().catch(() => ({ supported: false }));
  if (!state.supported || !('Notification' in window)) {
    btn.textContent = '이 기기에서는 배지 미지원';
    btn.disabled = true;
    return;
  }
  btn.disabled = false;
  btn.textContent = Notification.permission === 'granted' && state.subscription ? 'D+ 배지 켜짐 ✓' : 'D+ 배지 켜기';
}

async function enableDailyBadge() {
  const btn = document.getElementById('dplusBadgeBtn');
  try {
    if (!isStandalone() && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      alert('아이폰에서는 Safari 공유 버튼 → 홈 화면에 추가한 뒤, 홈 화면의 앱에서 이 버튼을 눌러줘.');
      return;
    }
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      alert('이 기기에서는 홈 화면 배지/알림 기능을 사용할 수 없어.');
      return;
    }
    const data = await profileAndCouple();
    if (!data?.couple?.relationshipDate) {
      alert('먼저 사귄 날짜를 설정해줘.');
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '권한 확인 중...'; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('알림을 허용해야 앱 아이콘에 D+ 숫자를 표시할 수 있어.');
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    await setDoc(data.userRef, {
      pushEnabled: true,
      pushSubscription: sub.toJSON(),
      pushUpdatedAt: serverTimestamp()
    }, { merge: true });
    await setForegroundBadge();
    alert('D+ 배지를 켰어 ♡\n이제 매일 자정 무렵 D+ 숫자 갱신 알림을 받을 수 있어.');
  } catch (e) {
    console.error(e);
    alert('D+ 배지를 켜는 중 오류가 발생했어.');
  } finally {
    if (btn) btn.disabled = false;
    refreshButton();
  }
}

onAuthStateChanged(auth, user => {
  if (!user) return;
  const observer = new MutationObserver(() => {
    ensureButton();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  ensureButton();
  setTimeout(() => { ensureButton(); setForegroundBadge(); }, 800);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    ensureButton();
    setForegroundBadge();
    refreshButton();
  }
});
