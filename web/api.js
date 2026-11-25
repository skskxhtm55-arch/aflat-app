// =====================================================================
// [api.js] 서버(Apps Script) 호출 도구
// ---------------------------------------------------------------------
// - 모든 요청은 POST + Content-Type: text/plain 으로 보냅니다.
//   (이렇게 해야 브라우저의 CORS 사전 확인 요청이 생기지 않아 Apps Script 와 통신됩니다)
// - 로그인 토큰은 이 기기의 브라우저 저장소(localStorage)에 보관합니다.
// =====================================================================

class ApiError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'ERROR';
  }
}

const Api = (function () {
  // 테스트 서버(?test=1)와 실운영 서버의 로그인을 따로 보관
  const cfg = window.AFLAT_CONFIG;
  const TOKEN_KEY = cfg.TEST_API_URL && cfg.API_URL === cfg.TEST_API_URL ? 'aflat_token_test' : 'aflat_token';

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* 저장소를 못 쓰는 환경(사생활 보호 모드 등)은 무시 */ }
  }

  // [성능 측정] 주소 끝에 ?perf=1 을 붙이면 요청별 시간을 화면 아래에 표시 (진단용)
  const PERF = /[?&]perf=1/.test(location.search);

  async function call(action, data) {
    // 개발용 가짜 서버 (주소 끝에 ?mock=1 을 붙였을 때만)
    if (window.AFLAT_MOCK) return window.AFLAT_MOCK(action, data || {}, getToken());
    const t0 = performance.now();

    const url = window.AFLAT_CONFIG.API_URL;
    if (!url || url.indexOf('여기에_') >= 0) {
      throw new ApiError('config.js 에 서버 주소(API_URL)가 설정되지 않았습니다.', 'CONFIG');
    }
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: getToken(), data: data || {}, perf: PERF || undefined }),
        redirect: 'follow'
      });
    } catch (e) {
      throw new ApiError('인터넷 연결을 확인해 주세요.', 'NETWORK');
    }
    let json;
    try {
      json = await res.json();
    } catch (e) {
      throw new ApiError('서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.', 'SERVER');
    }
    if (PERF) Perf.api(action, Math.round(performance.now() - t0), json.perf, t0);
    if (!json.ok) throw new ApiError(json.error || '오류가 발생했습니다.', json.code);
    return json.data;
  }

  return { call: call, getToken: getToken, setToken: setToken, perf: PERF };
})();

// ---------------------------------------------------------------------
// [성능 측정 표시] ?perf=1 일 때만 동작. 화면 아래 작은 표 + '복사' 버튼
//   전체 = 휴대폰에서 버튼을 누르고 응답을 받기까지 / 서버 = Apps Script 안에서 처리한 시간
//   전체 - 서버 = 통신 + 구글 서버가 스크립트를 깨우는 시간
// ---------------------------------------------------------------------
const Perf = (function () {
  const rows = [];
  let box = null;
  function ensureBox() {
    if (box || !document.body) return box;
    box = document.createElement('div');
    box.id = 'perfBox';
    box.style.cssText = 'position:fixed;left:4px;right:4px;top:4px;z-index:500;max-height:40vh;overflow:auto;' +
      'background:rgba(0,0,0,.82);color:#fff;font:11px/1.4 monospace;padding:6px;border-radius:8px;';
    document.body.appendChild(box);
    return box;
  }
  function render() {
    if (!ensureBox()) return;
    box.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:4px">' +
      '<b style="flex:1">성능 측정 ' + ((navigator.connection && navigator.connection.effectiveType) || '') + '</b>' +
      '<button id="perfCopy">복사</button><button id="perfClear">지우기</button><button id="perfHide">접기</button></div>' +
      rows.map(function (r) { return '<div>' + r.text.replace(/</g, '&lt;') + '</div>'; }).join('');
    box.querySelector('#perfCopy').onclick = function () {
      const text = rows.map(function (r) { return r.text; }).join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
        function () { alert('복사했어요. 대화창에 붙여 넣어 주세요.'); },
        function () { prompt('아래 내용을 길게 눌러 복사해 주세요.', text); });
    };
    box.querySelector('#perfClear').onclick = function () { rows.length = 0; render(); };
    box.querySelector('#perfHide').onclick = function () { box.style.maxHeight = box.style.maxHeight === '24px' ? '40vh' : '24px'; };
  }
  function add(text) { rows.push({ text: text }); render(); }
  return {
    api: function (action, clientMs, p, startAt) {
      add('[' + Math.round(startAt) + 'ms~] ' + action + ' 전체 ' + clientMs + 'ms' + (p
        ? ' | 서버 ' + p.total + ' (로그인확인 ' + p.auth + ', 시트 ' + p.sheetN + '회 ' + p.sheet +
          ', 캘린더 ' + p.calN + '회 ' + p.cal + (p.lock ? ', 잠금대기 ' + p.lock : '') + (p.httpN ? ', 알림톡 ' + p.http : '') + ')'
        : ''));
    },
    mark: function (label) { add('★ ' + label + ': 앱 시작 후 ' + Math.round(performance.now()) + 'ms'); }
  };
})();
