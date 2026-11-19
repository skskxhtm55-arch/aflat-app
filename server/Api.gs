// =====================================================================
// [Api.gs] 앱(화면)이 서버를 부르는 입구
// ---------------------------------------------------------------------
// 화면은 이 웹앱 주소로 POST 요청을 보냅니다.
//   보내는 내용: { "action": "기능이름", "token": "로그인 토큰", "data": { ... } }
//   돌려주는 내용: { "ok": true, "data": {...} }  또는  { "ok": false, "code": "...", "error": "안내 문구" }
//
// ※ CORS(다른 주소에서의 호출) 문제를 피하려고 화면은 Content-Type 을 text/plain 으로 보냅니다.
// ※ 새 기능을 추가할 때는 아래 routes_() 목록에 한 줄을 추가하면 됩니다.
//    auth: 'none'(로그인 불필요) / 'user'(로그인 필요) / 'admin'(원장만)
//    allowTemp: true 이면 "첫 로그인 비밀번호 변경 전"에도 허용
// =====================================================================

// ※ 함수로 감싼 이유: Apps Script 는 파일을 차례로 읽기 때문에, 파일 맨 위에서 다른 파일의
//   함수를 바로 가리키면 아직 읽히지 않아 오류가 날 수 있습니다. 요청이 올 때 목록을 만듭니다.
function routes_() { return {
  // --- 로그인 없이 사용 ---
  ping:                 { auth: 'none',  fn: function () { return { pong: true, serverTime: fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') }; } },
  login:                { auth: 'none',  fn: apiLogin_ },
  requestPasswordReset: { auth: 'none',  fn: apiRequestPasswordReset_ },

  // --- 로그인 필요 ---
  logout:               { auth: 'user',  allowTemp: true, fn: apiLogout_ },
  getMe:                { auth: 'user',  allowTemp: true, fn: apiGetMe_ },
  changePassword:       { auth: 'user',  allowTemp: true, fn: apiChangePassword_ },
  getTimetable:         { auth: 'user',  fn: apiGetTimetable_ },
  createBooking:        { auth: 'user',  fn: apiCreateBooking_ },
  getMyBookings:        { auth: 'user',  fn: apiGetMyBookings_ },

  // --- 원장(관리자) 전용 ---
  adminListMembers:         { auth: 'admin', fn: apiAdminListMembers_ },
  adminCreateMember:        { auth: 'admin', fn: apiAdminCreateMember_ },
  adminIssueTempPassword:   { auth: 'admin', fn: apiAdminIssueTempPassword_ },
  adminBulkIssue:           { auth: 'admin', fn: apiAdminBulkIssue_ },
  adminUnlock:              { auth: 'admin', fn: apiAdminUnlock_ },
  adminListResetRequests:   { auth: 'admin', fn: apiAdminListResetRequests_ },
  adminResolveResetRequest: { auth: 'admin', fn: apiAdminResolveResetRequest_ }
}; }

/** 앱(화면)의 모든 요청이 들어오는 곳 */
function doPost(e) {
  let out;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    // 점검 모드: 스크립트 속성 MAINTENANCE_MESSAGE 에 문구를 넣으면 모든 요청에 그 문구를 보여줍니다.
    // (실운영 전환 후 문제가 생겨 기존 구글폼으로 되돌릴 때 사용. 문구를 지우면 해제)
    const maintenance = PropertiesService.getScriptProperties().getProperty('MAINTENANCE_MESSAGE');
    if (maintenance) fail_(maintenance, 'MAINTENANCE');

    const route = Object.prototype.hasOwnProperty.call(routes_(), body.action) ? routes_()[body.action] : null;
    if (!route) fail_('알 수 없는 요청입니다.', 'BAD_REQUEST');

    let ctx = null;
    if (route.auth !== 'none') {
      ctx = authenticate_(body.token);
      if (ctx.mustChangePassword && !route.allowTemp) {
        fail_('비밀번호를 먼저 변경해 주세요.', 'MUST_CHANGE_PASSWORD');
      }
      if (route.auth === 'admin' && !ctx.isAdmin) fail_('원장만 사용할 수 있는 기능입니다.', 'FORBIDDEN');
    }
    out = { ok: true, data: route.fn(ctx, body.data || {}) };
  } catch (err) {
    if (err instanceof AppError) {
      out = { ok: false, code: err.code, error: err.message };
    } else {
      // 예상하지 못한 오류: 상세 내용은 로그에만 남기고 화면에는 일반 문구만 보냅니다.
      console.error('서버 오류: ' + (err && err.stack ? err.stack : err));
      out = { ok: false, code: 'SERVER', error: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** 브라우저로 웹앱 주소를 직접 열었을 때 (동작 확인용) */
function doGet() {
  const out = { ok: true, data: { app: 'aflat', message: '에이플랫 API 서버가 동작 중입니다.', serverTime: fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') } };
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
