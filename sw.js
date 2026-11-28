/* AI-HUB offline-first service worker */
const CACHE_NAME = 'ai-hub-offline-v2';
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './knowledge-packs/it-operations.json',
  './knowledge-packs/master-practice-questions.json',
  './docs/AI-HUB-INTEGRATION-NOTES.md',
  './docs/IT-OPERATIONS-HANDBOOK.md',
  './docs/JAVA-PRACTICAL-MASTER.md',
  './docs/MASTER-TRAINING-CURRICULUM.md',
  './docs/NETWORK-COMMAND-MASTER.md',
  './docs/POWERSHELL-PRACTICAL-MASTER.md',
  './docs/WORKFLOW-PRACTICAL-PLAYBOOK.md'
];
const APP_BASE = new URL('./', self.registration.scope);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map(path => new URL(path, APP_BASE).href));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('ai-hub-offline-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'AI_HUB_PRECACHE') {
    event.waitUntil(caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_FILES.map(path => new URL(path, APP_BASE).href))
    ));
  }
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isAppDocument = request.mode === 'navigate' || url.pathname.endsWith('.json') || url.pathname.endsWith('.md');
  if (isAppDocument) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const cached = await cache.match(request) || await cache.match(new URL('./index.html', APP_BASE).href);
        if (cached) return cached;
        return new Response('オフラインです。オンライン時にAI-HUBを一度開いて教材を保存してください。', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    const network = fetch(request).then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    return cached || await network || new Response('', { status: 504 });
  })());
});
