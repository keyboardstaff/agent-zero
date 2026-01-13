const CACHE_NAME = 'a0-cache-v1';

// Static assets to precache
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/index.css',
  '/index.js',
  '/js/manifest.json'
];

// Patterns for cache strategies
const CACHE_FIRST_PATTERNS = [
  /\/vendor\//,           // Third-party libs (Alpine, ACE, KaTeX, etc.)
  /\/public\//,           // Static icons/images
  /\.woff2?$|\.ttf$/      // Font files
];

const STALE_REVALIDATE_PATTERNS = [
  /\.css$/,               // CSS files
  /\.js$/,                // JS files  
  /\/components\//        // Component HTML/JS
];

const NETWORK_ONLY_PATTERNS = [
  /\/message/,            // Chat API
  /\/settings/,           // Settings API
  /\/chat/,               // Chat API
  /\/task/,               // Task API
  /\/agent/,              // Agent API
  /\/file/,               // File API
  /\/log/,                // Log API
  /\/poll/,               // Polling
  /\/csrf/,               // CSRF token
  /\/login/,              // Auth
  /\/logout/              // Auth
];

// Install: precache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: apply cache strategies
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const req = event.request;

  // Skip non-GET requests
  if (req.method !== 'GET') return;

  // Network only for API requests
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(url))) return;

  // Cache first for static vendor/public assets
  if (CACHE_FIRST_PATTERNS.some(p => p.test(url))) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Stale-while-revalidate for app assets
  if (STALE_REVALIDATE_PATTERNS.some(p => p.test(url))) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Default: network first for HTML pages
  event.respondWith(networkFirst(req));
});

// Cache First strategy
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

// Stale-While-Revalidate strategy
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

// Network First strategy
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}