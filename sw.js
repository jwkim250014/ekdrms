const CACHE='ourday-v11';
const ASSETS=['./','./index.html','./manifest.json','./icon.svg','./firebase-config.js','./firebase-client.js','./app.js','./badge.js'];

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  const isAppNavigation=e.request.mode==='navigate' && url.origin===self.location.origin;

  if(isAppNavigation){
    e.respondWith(
      fetch(e.request)
        .then(async r=>{
          const text=await r.text();
          const injected=text.includes('./badge.js')?text:text.replace('</body>','<script type="module" src="./badge.js"></script></body>');
          const headers=new Headers(r.headers);
          headers.set('content-type','text/html; charset=utf-8');
          const response=new Response(injected,{status:r.status,statusText:r.statusText,headers});
          caches.open(CACHE).then(c=>c.put(e.request,response.clone()));
          return response;
        })
        .catch(()=>caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      })
      .catch(()=>caches.match(e.request))
  );
});

self.addEventListener('push',event=>{
  let data={};
  try{ data=event.data?event.data.json():{}; }catch{}
  const count=Math.max(0,Number(data.badge)||0);
  const title=data.title||'우리의 하루 ♡';
  const body=data.body||(count?`오늘은 D+${count}일 ♡`:'오늘도 함께라서 행복해요 ♡');
  const work=[];

  if('setAppBadge' in self.navigator){
    work.push(count>0?self.navigator.setAppBadge(count):self.navigator.clearAppBadge());
  }

  work.push(self.registration.showNotification(title,{
    body,
    icon:'./icon.svg',
    tag:'daily-dplus',
    renotify:false,
    data:{url:'./'}
  }));

  event.waitUntil(Promise.all(work));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if('focus' in client){ await client.focus(); return; }
    }
    if(clients.openWindow) await clients.openWindow('./');
  })());
});
