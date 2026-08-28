// sw.js — offline support. Precaches the whole game so it runs with no
// network at all after the first visit (Safari 12 / iOS 11.3+ supports
// service workers). VERSION is stamped by scripts/deploy.sh with the git
// hash; a new deploy installs a fresh cache and retires the old one.
// ES2017-safe for the Safari 12 worker context.

var VERSION = '82f319b';
var CACHE = 'magnate-' + VERSION;

var ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'css/cards.css',
  'js/main.js',
  'js/engine/cards.js',
  'js/engine/game.js',
  'js/ai/bot.js',
  'js/ui/dom.js',
  'js/ui/cardview.js',
  'js/ui/render.js',
  'js/ui/sheets.js',
  'js/ui/rules.js',
  'js/ui/fx.js',
  'js/net.js',
  'js/p2p.js',
  'js/vendor/qrcode.js',
  'js/vendor/pako.js',
  'js/vendor/jsqr.js',
  'icons/apple-touch-icon.png',
  'icons/apple-touch-icon-152.png',
  'icons/favicon-32.png',
  'art/color-brown.jpg',
  'art/color-lightblue.jpg',
  'art/color-magenta.jpg',
  'art/color-orange.jpg',
  'art/color-red.jpg',
  'art/color-yellow.jpg',
  'art/color-green.jpg',
  'art/color-darkblue.jpg',
  'art/color-railroad.jpg',
  'art/color-utility.jpg',
  'art/action-dealBreaker.jpg',
  'art/action-justSayNo.jpg',
  'art/action-passGo.jpg',
  'art/action-forcedDeal.jpg',
  'art/action-slyDeal.jpg',
  'art/action-debtCollector.jpg',
  'art/action-birthday.jpg',
  'art/action-house.jpg',
  'art/action-hotel.jpg',
  'art/action-doubleRent.jpg',
  'art/card-back.jpg',
  'art/hero-banner.jpg',
  'art/logo-emblem.jpg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Cache-first: offline always works; updates arrive via a new VERSION.
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(event.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      });
    })
  );
});
