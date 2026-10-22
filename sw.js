/* ai-hub sw: HTML は常にネットワーク優先（古い画面が残らない）。同一オリジンの静的ファイルだけキャッシュ。API(別オリジン)は触らない */
const C='ah-cache-v1',FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(FILES.map(f=>c.add(f).catch(()=>{})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;
  const html=r.mode==='navigate'||u.pathname.endsWith('.html')||u.pathname.endsWith('/');
  if(html){e.respondWith(fetch(r).then(x=>{const cp=x.clone();caches.open(C).then(c=>c.put(r,cp));return x}).catch(()=>caches.match(r).then(x=>x||caches.match('index.html'))));return}
  e.respondWith(caches.match(r).then(x=>x||fetch(r).then(y=>{const cp=y.clone();caches.open(C).then(c=>c.put(r,cp));return y})))});
