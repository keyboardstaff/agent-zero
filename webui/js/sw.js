/**
 * Agent Zero PWA Service Worker
 * Security-hardened caching for remote PWA access
 */

// Version control - increment to force cache refresh
const SW_VERSION = 1;
const CACHE_NAME = `a0-cache-v${SW_VERSION}`;

// Cache TTL (Time-To-Live) in milliseconds
const CACHE_TTL = {
  vendor: 7 * 24 * 60 * 60 * 1000,  // 7 days for vendor libs
  assets: 24 * 60 * 60 * 1000,      // 1 day for app assets
  html: 60 * 60 * 1000              // 1 hour for HTML
};

// Metadata cache for TTL tracking
const META_CACHE = 'a0-meta-v1';

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

// Security: Check if response is same-origin or valid CORS
function isSafeToCache(req, res) {
  // Only cache same-origin responses
  if (new URL(req.url).origin !== self.location.origin) {
    return false;
  }
  // Only cache successful responses
  if (!res || !res.ok) {
    return false;
  }
  // Don't cache opaque responses (cross-origin without CORS)
  if (res.type === 'opaque') {
    return false;
  }
  return true;
}

// Get TTL category for a URL
function getTTL(url) {
  if (CACHE_FIRST_PATTERNS.some(p => p.test(url))) return CACHE_TTL.vendor;
  if (/\.html$/.test(url) || url.endsWith('/')) return CACHE_TTL.html;
  return CACHE_TTL.assets;
}

// Check if cached entry is expired
async function isExpired(req) {
  try {
    const metaCache = await caches.open(META_CACHE);
    const metaRes = await metaCache.match(req);
    if (!metaRes) return true;
    const meta = await metaRes.json();
    const ttl = getTTL(req.url);
    return Date.now() - meta.timestamp > ttl;
  } catch {
    return true;
  }
}

// Store cache metadata with timestamp
async function storeMeta(req) {
  const metaCache = await caches.open(META_CACHE);
  const meta = { timestamp: Date.now() };
  await metaCache.put(req, new Response(JSON.stringify(meta)));
}

// Install: precache core assets with forced activation
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()) // Force immediate activation
  );
});

// Activate: clean ALL old caches (security measure)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== META_CACHE)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim()) // Take control immediately
  );
});

// Fetch: apply cache strategies with security checks
self.addEventListener('fetch', event => {
  const url = event.request.url;
  const req = event.request;

  // Security: Skip non-GET requests
  if (req.method !== 'GET') return;

  // Security: Skip cross-origin requests
  if (new URL(url).origin !== self.location.origin) return;

  // Network only for API requests (never cache dynamic data)
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

// Cache First strategy (with TTL check)
async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  
  // Return cached if valid and not expired
  if (cached && !(await isExpired(req))) {
    return cached;
  }
  
  try {
    const res = await fetch(req);
    if (isSafeToCache(req, res)) {
      cache.put(req, res.clone());
      storeMeta(req);
    }
    return res;
  } catch {
    // Fallback to expired cache if offline
    if (cached) return cached;
    return new Response('Offline', { status: 503 });
  }
}

// Stale-While-Revalidate strategy (with security check)
async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  
  const fetchPromise = fetch(req).then(res => {
    if (isSafeToCache(req, res)) {
      cache.put(req, res.clone());
      storeMeta(req);
    }
    return res;
  }).catch(() => cached);
  
  return cached || fetchPromise;
}

// Network First strategy (with security check)
async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (isSafeToCache(req, res)) {
      cache.put(req, res.clone());
      storeMeta(req);
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response('Offline', { status: 503 });
  }
}