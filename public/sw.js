// Cache public code and the empty offline workspace only. Never cache authenticated
// pages, API replies or Supabase responses. Private drafts remain scoped to their owner.
const PUBLIC_CACHE='bro-public-v2';
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(PUBLIC_CACHE);
  const response=await fetch('/offline',{cache:'reload'});
  if(!response.ok)throw new Error('Offline workspace is not available');
  await cache.put('/offline',response.clone());
  const html=await response.text();
  const assets=[...html.matchAll(/(?:src|href)="([^"\s]+)"/g)].map(m=>m[1]).filter(p=>p.startsWith('/_next/static/')||p.startsWith('/icons/'));
  await cache.addAll([...new Set([...assets,'/icons/icon-192.png','/icons/icon-512.png'])]);
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const name of await caches.keys())if(name.startsWith('bro-public-')&&name!==PUBLIC_CACHE)await caches.delete(name);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
 const request=event.request;const url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith('/_next/static/')||url.pathname.startsWith('/icons/')){
  event.respondWith((async()=>{const cache=await caches.open(PUBLIC_CACHE);const cached=await cache.match(request);if(cached)return cached;const response=await fetch(request);if(response.ok)await cache.put(request,response.clone());return response;})());return;
 }
 if(request.mode==='navigate')event.respondWith(fetch(request).catch(async()=>{const cached=await caches.match('/offline');return cached||new Response('Reconnect to open your workspace.',{status:503,headers:{'Content-Type':'text/plain'}});}));
});
