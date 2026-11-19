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

  async function call(action, data) {
    // 개발용 가짜 서버 (주소 끝에 ?mock=1 을 붙였을 때만)
    if (window.AFLAT_MOCK) return window.AFLAT_MOCK(action, data || {}, getToken());

    const url = window.AFLAT_CONFIG.API_URL;
    if (!url || url.indexOf('여기에_') >= 0) {
      throw new ApiError('config.js 에 서버 주소(API_URL)가 설정되지 않았습니다.', 'CONFIG');
    }
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: getToken(), data: data || {} }),
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
    if (!json.ok) throw new ApiError(json.error || '오류가 발생했습니다.', json.code);
    return json.data;
  }

  return { call: call, getToken: getToken, setToken: setToken };
})();
