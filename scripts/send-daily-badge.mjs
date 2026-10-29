import admin from 'firebase-admin';
import webpush from 'web-push';

const firebaseCredential = process.env.FIREBASE_ADMIN_JSON;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const vapidPublic = process.env.VAPID_PUBLIC_KEY;
if (!firebaseCredential || !vapidPrivate || !vapidPublic) throw new Error('Required server secrets are not configured');

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(firebaseCredential)) });
const db = admin.firestore();
webpush.setVapidDetails('https://jwkim250014.github.io/ekdrms/', vapidPublic, vapidPrivate);

function todayKST() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return [Number(p.year), Number(p.month), Number(p.day)];
}
function dplus(value) {
  const [y,m,d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return 0;
  const [ty,tm,td] = todayKST();
  return Math.floor((Date.UTC(ty,tm-1,td) - Date.UTC(y,m-1,d)) / 86400000) + 1;
}

const users = await db.collection('users').where('pushEnabled','==',true).get();
let sent = 0;
for (const userDoc of users.docs) {
  const u = userDoc.data();
  if (!u.coupleId || !u.pushSubscription?.endpoint) continue;
  const couple = await db.collection('couples').doc(u.coupleId).get();
  const count = dplus(couple.exists ? couple.data().relationshipDate : null);
  if (count <= 0) continue;
  try {
    await webpush.sendNotification(u.pushSubscription, JSON.stringify({ badge:count, title:'우리의 하루 ♡', body:`오늘은 D+${count}일 ♡` }), { TTL:21600 });
    sent++;
  } catch (e) {
    if ([404,410].includes(Number(e?.statusCode || 0))) {
      await userDoc.ref.set({ pushEnabled:false, pushSubscription:admin.firestore.FieldValue.delete() }, { merge:true });
    } else {
      console.error('push failed', e?.statusCode || '', e?.message || e);
    }
  }
}
console.log(`daily D+ push sent: ${sent}`);
