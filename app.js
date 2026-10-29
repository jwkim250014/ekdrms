import {
  firebaseReady, loginGoogle, finishRedirectLogin, watchAuth, logout,
  getMyProfile, saveNickname, createCoupleSpace, joinCoupleSpace, watchCouple,
  watchRecords, saveRelationshipDate, saveRecord
} from './firebase-client.js';

let records = [];
let couple = null;
let coupleId = null;
let user = null;
let myProfile = null;
let memberNames = {};
let selectedDate = '';
let calendarMonth = new Date();
let currentTab = 'home';
let pendingPhotos = [];
let stopCouple = null;
let stopRecords = null;
let autoJoinTried = false;

const qs = s => document.querySelector(s);
const todayISO = () => dateISO(new Date());
const inviteFromUrl = () => new URLSearchParams(location.search).get('invite')?.trim().toUpperCase() || '';

function errText(e) {
  const code = e?.code || '';
  if (code.includes('unauthorized-domain')) return '이 도메인이 Firebase 로그인 허용 목록에 아직 없어요.';
  if (code.includes('popup-closed') || code.includes('cancelled')) return '로그인이 취소됐어요.';
  if (code.includes('permission-denied')) return 'Firestore 보안 규칙을 확인해야 해요.';
  return e?.message || '처리 중 오류가 발생했어요.';
}

function showOnly(id) {
  ['login','profile','space','app'].forEach(x => qs('#'+x).classList.toggle('hidden', x !== id));
}

async function bootstrapUser(authUser) {
  user = authUser;
  if (!user) {
    stopLive();
    couple = null;
    coupleId = null;
    myProfile = null;
    memberNames = {};
    records = [];
    showOnly('login');
    return;
  }

  const profile = await getMyProfile();
  if (!profile?.nickname) {
    myProfile = profile || null;
    qs('#nicknameInput').value = '';
    showOnly('profile');
    return;
  }

  myProfile = profile;
  if (profile.coupleId) {
    connectCouple(profile.coupleId);
    return;
  }

  const invite = inviteFromUrl();
  if (invite && !autoJoinTried) {
    autoJoinTried = true;
    try {
      const joinedId = await joinCoupleSpace(invite);
      myProfile = await getMyProfile();
      history.replaceState({}, '', location.pathname);
      connectCouple(joinedId);
      return;
    } catch (e) {
      alert(errText(e));
    }
  }

  qs('#spaceUser').textContent = `사용할 이름: ${profile.nickname}`;
  showOnly('space');
}

async function saveNicknameAction() {
  const value = qs('#nicknameInput').value.trim();
  if (!value) { alert('앱에서 사용할 이름을 입력해 주세요.'); return; }
  try {
    await saveNickname(value);
    myProfile = await getMyProfile();
    await bootstrapUser(user);
  } catch (e) {
    alert(errText(e));
  }
}

function stopLive() {
  if (stopCouple) stopCouple();
  if (stopRecords) stopRecords();
  stopCouple = null;
  stopRecords = null;
}

function connectCouple(id) {
  stopLive();
  coupleId = id;
  showOnly('app');

  stopCouple = watchCouple(id, data => {
    couple = data;
    if (!couple) {
      alert('커플 공간을 찾을 수 없어요.');
      showOnly('space');
      return;
    }
    renderCouplePeople();
    renderRelationship();
  }, e => alert(errText(e)));

  stopRecords = watchRecords(id, data => {
    memberNames = {};
    data.forEach(r => {
      if (r.type === 'member-profile' && r.authorUid && r.authorName) {
        memberNames[r.authorUid] = String(r.authorName).trim();
      }
    });
    records = data.filter(r => r.type !== 'member-profile');
    render();
  }, e => alert(errText(e)));

  renderCouplePeople();
  render();
}

async function loginGoogleAction() {
  try {
    qs('#loginStatus').textContent = 'Google 로그인 창을 여는 중...';
    const result = await loginGoogle();
    qs('#loginStatus').textContent = '로그인 완료. 우리 공간을 불러오는 중...';
    if (result?.user) await bootstrapUser(result.user);
  } catch (e) {
    qs('#loginStatus').textContent = errText(e);
    alert(errText(e));
  }
}

async function logoutAction() {
  try {
    await logout();
    location.href = location.pathname;
  } catch (e) {
    alert(errText(e));
  }
}

async function createSpaceAction() {
  try {
    const result = await createCoupleSpace();
    myProfile = await getMyProfile();
    connectCouple(result.coupleId);
    setTimeout(() => inviteAction(), 400);
  } catch (e) {
    alert(errText(e));
  }
}

async function joinSpaceAction() {
  const prefill = inviteFromUrl();
  const code = prompt('초대 코드를 입력해 주세요', prefill);
  if (!code) return;
  try {
    const id = await joinCoupleSpace(code);
    myProfile = await getMyProfile();
    history.replaceState({}, '', location.pathname);
    connectCouple(id);
  } catch (e) {
    alert(errText(e));
  }
}

async function inviteAction() {
  if (!couple) return;
  if ((couple.members || []).length >= 2) {
    alert('이미 두 사람이 연결된 공간이야 ♡');
    return;
  }
  const code = couple.inviteCode;
  if (!code) {
    alert('초대 코드를 찾을 수 없어.');
    return;
  }
  const url = location.origin + location.pathname + '?invite=' + encodeURIComponent(code);
  try { await navigator.clipboard.writeText(url); } catch {}
  alert(`초대 링크를 복사했어 ♡\n\n초대코드: ${code}\n${url}`);
}

function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tabview').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav button').forEach(v => v.classList.remove('active'));
  qs('#'+name+'View').classList.add('active');
  qs('#nav-'+name).classList.add('active');
  if (name === 'calendar') renderCalendar();
  if (name === 'record') renderRecordList();
  if (name === 'memory') renderGallery();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shortName(value, fallback='상대방') {
  const v = String(value || '').trim();
  if (!v) return fallback;
  return v.length > 12 ? v.slice(0,12) : v;
}

function partnerUid() {
  return (couple?.members || []).find(uid => uid !== user?.uid) || '';
}

function partnerName() {
  const uid = partnerUid();
  if (!uid) return '상대방';
  if (memberNames[uid]) return shortName(memberNames[uid]);
  const fromRecord = records.find(r => r.authorUid === uid && r.authorName)?.authorName;
  return shortName(fromRecord, '상대방');
}

function authorName(r) {
  if (!r) return '상대방';
  if (r.authorUid && r.authorUid === user?.uid) return shortName(myProfile?.nickname, '나');
  return shortName(memberNames[r.authorUid] || r.authorName, '상대방');
}

function renderCouplePeople() {
  const box = qs('#couplePeople');
  if (!box || !user) return;
  const myName = shortName(myProfile?.nickname, '나');
  const otherName = partnerName();
  const partnerConnected = !!partnerUid();
  box.innerHTML = `
    <div class="person-card"><div class="person-avatar">${esc(myName.slice(0,1))}</div><div class="person-name">${esc(myName)} <span class="me-badge">나</span></div><div class="person-sub">내 이름</div></div>
    <div class="couple-heart">♡</div>
    <div class="person-card"><div class="person-avatar">${partnerConnected ? esc(otherName.slice(0,1)) : '♡'}</div><div class="person-name">${esc(otherName)}</div><div class="person-sub">${partnerConnected ? '연결됨' : '초대 대기 중'}</div></div>`;
}

function render() {
  renderCouplePeople();
  renderRelationship();
  renderHome();
  renderCalendar();
  renderRecordList();
  renderGallery();
}

function renderHome() {
  const sorted = records.slice().sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
  qs('#homeRecords').innerHTML = sorted.length
    ? sorted.slice(0,3).map(recordHTML).join('')
    : '<div class="empty">첫 기록을 남겨보세요 ♡</div>';

  const now = new Date();
  const lastYear = new Date(now.getFullYear()-1, now.getMonth(), now.getDate());
  const ds = dateISO(lastYear);
  const old = records.filter(r => r.date === ds);
  qs('#todayMemory').innerHTML = old.length
    ? old.map(r => `<b>${esc(r.title||'우리의 하루')}</b><div class="author-tag">${esc(authorName(r))}의 기록</div><p>${esc(r.text||'')}</p>`).join('<hr>')
    : '1년 전 오늘의 추억이 쌓이면 여기에서 다시 보여줄게 ♡';

  const activity = records.slice(0,5).map(r => {
    const name = authorName(r);
    const photos = (r.photos || []).length;
    const text = photos ? `${name}님이 기록과 사진 ${photos}장을 올렸어요 ♡` : `${name}님이 새 기록을 남겼어요 ♡`;
    return `<div class="activity-item"><b>${esc(name)}</b>님 · ${esc(r.date||'')}<br>${esc(text)}</div>`;
  });
  qs('#recentActivity').innerHTML = activity.length ? activity.join('') : '<div class="empty">둘의 활동이 여기에 표시돼.</div>';
}

function recordHTML(r) {
  const p = (r.photos && r.photos[0]) ? `<img class="record-photo" src="${r.photos[0]}" alt="">` : '';
  const who = authorName(r);
  const when = formatTimestamp(r.createdAt);
  return `<div class="memory">${p}<div><span class="pill">${r.date||''}</span><span class="pill">${esc(r.mood||'♡')}</span></div><div class="author-tag">✍ ${esc(who)}${when?' · '+esc(when):''}</div><h4>${esc(r.title||'우리의 하루')}</h4><p>${esc(r.text||'')}</p>${r.location?'<small>📍 '+esc(r.location)+'</small>':''}<div style="clear:both"></div></div>`;
}

function renderRecordList() {
  const sorted = records.slice().sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
  qs('#recordList').innerHTML = sorted.length
    ? sorted.map(recordHTML).join('')
    : '<div class="empty">아직 기록이 없어요.<br>+ 버튼으로 첫 이야기를 남겨봐.</div>';
}

function renderGallery() {
  const items = [];
  records.slice().sort((a,b) => String(b.date||'').localeCompare(String(a.date||''))).forEach(r => {
    (r.photos || []).forEach((p, pi) => items.push({ r, p, pi }));
  });
  qs('#gallery').innerHTML = items.length
    ? items.map(x => `<button class="photo-card" onclick="openMemory('${escAttr(x.r.id)}',${x.pi})"><img src="${x.p}" alt="${escAttr(x.r.title||'추억')}"><div class="photo-meta"><b>${esc(x.r.title||'우리의 하루')}</b><span>${x.r.date||''} · ${esc(authorName(x.r))}</span></div></button>`).join('')
    : '<div class="empty" style="grid-column:1/-1">사진을 넣어 기록하면<br>여기에 앨범처럼 모여 ♡</div>';
}

function openMemory(id, photoIndex) {
  const r = records.find(x => String(x.id) === String(id));
  if (!r) return;
  const photo = (r.photos || [])[photoIndex] || (r.photos || [])[0];
  const who = authorName(r);
  const when = formatTimestamp(r.createdAt);
  qs('#memoryDetail').innerHTML = `${photo?`<img class="detail-photo" src="${photo}" alt="">`:''}<h3>${esc(r.title||'우리의 하루')}</h3><div><span class="pill">${r.date||''}</span><span class="pill">${esc(r.mood||'♡')}</span><span class="pill">${esc(who)}님이 올림</span></div>${when?`<p class="small">업로드 ${esc(when)}</p>`:''}<p style="line-height:1.7">${esc(r.text||'')}</p>${r.location?'<p class="small">📍 '+esc(r.location)+'</p>':''}`;
  qs('#memoryModal').style.display = 'flex';
}

function shiftMonth(n) {
  calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth()+n, 1);
  renderCalendar();
}

function renderCalendar() {
  const box = qs('#calendar');
  box.innerHTML = '';
  const y = calendarMonth.getFullYear();
  const m = calendarMonth.getMonth();
  const first = new Date(y,m,1).getDay();
  const last = new Date(y,m+1,0).getDate();
  qs('#monthLabel').textContent = `${y}년 ${m+1}월`;

  for (let i=0;i<first;i++) box.append(document.createElement('div'));
  for (let d=1; d<=last; d++) {
    const dt = new Date(y,m,d);
    const ds = dateISO(dt);
    const b = document.createElement('button');
    b.className = 'day' + (records.some(r => r.date===ds) ? ' mark' : '') + (selectedDate===ds ? ' selected' : '');
    b.textContent = d;
    b.onclick = () => selectCalendarDate(ds);
    box.append(b);
  }
  renderSelectedDate();
}

function selectCalendarDate(ds) {
  selectedDate = ds;
  qs('#date').value = ds;
  renderCalendar();
}

function renderSelectedDate() {
  if (!selectedDate) {
    qs('#selectedTitle').textContent = '선택한 날짜';
    qs('#selectedInfo').innerHTML = '날짜를 눌러 기록을 확인해봐.';
    qs('#selectedAddBtn').classList.add('hidden');
    return;
  }
  qs('#selectedTitle').textContent = selectedDate.replaceAll('-','.');
  const found = records.filter(r => r.date === selectedDate);
  qs('#selectedInfo').innerHTML = found.length
    ? found.map(r => `<b>${esc(r.title||'우리의 하루')}</b><div class="author-tag">✍ ${esc(authorName(r))}</div><p>${esc(r.text||'')}</p>${r.location?'<small>📍 '+esc(r.location)+'</small>':''}`).join('<hr>')
    : '이 날은 아직 기록이 없어.';
  qs('#selectedAddBtn').classList.remove('hidden');
}

function openEditor(dateValue) {
  pendingPhotos = [];
  qs('#photo').value = '';
  qs('#photoPreview').innerHTML = '';
  qs('#title').value = '';
  qs('#text').value = '';
  qs('#location').value = '';
  qs('#mood').value = '';
  qs('#date').value = dateValue || todayISO();
  qs('#editor').style.display = 'flex';
}

function closeEditor() {
  qs('#editor').style.display = 'none';
  pendingPhotos = [];
}

async function previewFiles() {
  const files = [...qs('#photo').files].slice(0,3);
  pendingPhotos = [];
  let total = 0;
  for (const f of files) {
    try {
      const data = await compressImage(f);
      if (total + data.length > 650000) {
        alert('사진 용량이 커서 일부 사진만 넣었어. 다른 사진을 선택하면 더 많이 넣을 수 있어.');
        break;
      }
      pendingPhotos.push(data);
      total += data.length;
    } catch {
      alert('사진을 압축하지 못했어. 다른 사진으로 다시 시도해줘.');
    }
  }
  qs('#photoPreview').innerHTML = pendingPhotos.map(p => `<img src="${p}" alt="미리보기">`).join('');
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const make = (max, quality) => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img,0,0,c.width,c.height);
          return c.toDataURL('image/jpeg', quality);
        };
        let data = make(700,.58);
        if (data.length > 220000) data = make(560,.50);
        if (data.length > 220000) data = make(430,.44);
        if (data.length > 240000) reject(new Error('image-too-large'));
        else resolve(data);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function saveRecordAction() {
  if (!coupleId) return;
  const date = qs('#date').value;
  if (!date) { alert('날짜를 선택해 주세요'); return; }
  const btn = qs('#saveRecordBtn');
  btn.disabled = true;
  btn.textContent = '저장 중...';
  try {
    if (qs('#photo').files.length && pendingPhotos.length === 0) await previewFiles();
    await saveRecord(coupleId, {
      date,
      title: qs('#title').value || '우리의 하루',
      text: qs('#text').value,
      location: qs('#location').value,
      mood: qs('#mood').value,
      photos: pendingPhotos
    });
    closeEditor();
    selectedDate = date;
    showTab('record');
  } catch (e) {
    alert(errText(e));
  } finally {
    btn.disabled = false;
    btn.textContent = '저장하기';
  }
}

function openRelationshipSettings() {
  qs('#relationshipDate').value = couple?.relationshipDate || '';
  qs('#relationshipModal').style.display = 'flex';
}

async function saveRelationshipDateAction() {
  const v = qs('#relationshipDate').value;
  if (!v) { alert('사귄 날짜를 선택해 주세요'); return; }
  try {
    await saveRelationshipDate(coupleId, v);
    qs('#relationshipModal').style.display = 'none';
  } catch (e) {
    alert(errText(e));
  }
}

function formatTimestamp(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    if (!d) return '';
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return ''; }
}

function localDate(s) {
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y,m-1,d);
}
function dateISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function fmt(d) {
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
function daysBetween(a,b) {
  return Math.floor((new Date(b.getFullYear(),b.getMonth(),b.getDate()) - new Date(a.getFullYear(),a.getMonth(),a.getDate())) / 86400000);
}

function renderRelationship() {
  const saved = couple?.relationshipDate;
  if (!saved) {
    qs('#dplus').textContent = 'D+ ?';
    qs('#sinceText').textContent = '사귄 날짜를 설정해 주세요';
    qs('#anniversaryList').innerHTML = '<div class="memory">사귄 날짜를 설정하면 100일, 200일, 1주년을 자동으로 계산해줘.</div>';
    return;
  }
  const start = localDate(saved);
  const today = new Date();
  const diff = daysBetween(start,today)+1;
  qs('#dplus').textContent = diff >= 1 ? 'D+ ' + diff : 'D- ' + Math.abs(diff-1);
  qs('#sinceText').textContent = fmt(start) + '부터';

  const milestones = [];
  [100,200,300,500,1000].forEach(n => {
    const d = new Date(start);
    d.setDate(d.getDate()+n-1);
    milestones.push({ label:n+'일', date:d });
  });
  for (let y=1;y<=5;y++) {
    const d = new Date(start);
    d.setFullYear(d.getFullYear()+y);
    milestones.push({ label:y+'주년', date:d });
  }
  milestones.sort((a,b) => a.date-b.date);
  const upcoming = milestones.filter(x => daysBetween(today,x.date)>=0).slice(0,4);
  qs('#anniversaryList').innerHTML = upcoming.length
    ? upcoming.map(x => {
        const left = daysBetween(today,x.date);
        return `<div class="anniv-item"><div><b>${x.label}</b><br><span>${fmt(x.date)}</span></div><span>${left===0?'오늘 ♡':'D-'+left}</span></div>`;
      }).join('')
    : '<div class="memory">가까운 기념일 정보가 없어요.</div>';
}

function esc(s='') {
  return String(s).replace(/[&<>'"]/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function escAttr(s='') { return esc(s).replace(/`/g,'&#96;'); }

Object.assign(window, {
  loginGoogleAction, logoutAction, saveNicknameAction, createSpaceAction, joinSpaceAction, inviteAction,
  showTab, shiftMonth, selectCalendarDate, openEditor, closeEditor, previewFiles,
  saveRecordAction, openMemory, openRelationshipSettings, saveRelationshipDateAction
});
Object.defineProperty(window, 'selectedDate', { get: () => selectedDate });
Object.defineProperty(window, 'currentTab', { get: () => currentTab });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

if (!firebaseReady) {
  qs('#loginStatus').textContent = 'Firebase 설정을 확인해야 해요.';
} else {
  finishRedirectLogin().catch(e => {
    qs('#loginStatus').textContent = errText(e);
    console.error(e);
  });
  watchAuth(authUser => bootstrapUser(authUser).catch(e => alert(errText(e))));
}
