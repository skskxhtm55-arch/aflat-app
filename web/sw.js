// =====================================================================
// [sw.js] 서비스워커 — 홈 화면 앱(PWA) 동작용
// ---------------------------------------------------------------------
// - 화면 파일(html/css/js/아이콘)은 "인터넷 먼저, 안 되면 저장본" 방식으로 가져옵니다.
//   그래서 파일을 고쳐 배포하면 다음 접속 때 바로 새 화면이 보입니다.
// - 서버(Apps Script) 요청과 다른 사이트 파일은 건드리지 않습니다.
// - 웹 푸시는 2차에서 이 파일에 추가합니다.
// =====================================================================
const CACHE = 'aflat-shell-v1';
const SHELL = ['./', './index.html', './style.css', './config.js', './api.js', './app.js', './manifest.webmanifest', './icons/icon-192.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
