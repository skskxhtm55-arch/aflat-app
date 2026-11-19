// =====================================================================
// [Menu.gs] 스프레드시트 상단 메뉴 '에이플랫 관리'
// ---------------------------------------------------------------------
// 스프레드시트를 열면 자동으로 메뉴가 생깁니다.
// 메뉴 기능은 시트를 열 수 있는 사람(원장·관리자)만 실행할 수 있습니다.
// =====================================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('에이플랫 관리')
    .addItem('설정 즉시 반영 (캐시 비우기)', 'menuClearCache')
    .addItem('임시 비밀번호 발급', 'menuIssueTempPassword')
    .addItem('로그인 잠금 해제', 'menuUnlock')
    .addSeparator()
    .addItem('알림톡 시험 발송', 'menuTestAlimtalk')
    .addItem('만료 세션 지금 정리', 'menuCleanupSessions')
    .addItem('매일 자동 정리 켜기 (트리거 설치)', 'menuInstallTriggers')
    .addSeparator()
    .addSubMenu(ui.createMenu('설치·테스트 도구')
      .addItem('① 시트 구조 만들기/점검', 'menuSetupSheets')
      .addItem('② 테스트 환경 만들기 (테스트 전용)', 'menuSetupTestEnv')
      .addItem('비밀번호 해시 속도 측정', 'menuBenchmarkHash')
      .addItem('기존 Key 시트에서 데이터 가져오기', 'menuImportLegacy'))
    .addToUi();
}

function alert_(msg) {
  SpreadsheetApp.getUi().alert(msg);
}

/** 사용자에게 글자를 입력받습니다. 취소하면 null */
function prompt_(title, msg) {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(title, msg, ui.ButtonSet.OK_CANCEL);
  return res.getSelectedButton() === ui.Button.OK ? res.getResponseText().trim() : null;
}

/** 메뉴 실행 중 오류를 알림창으로 보여줍니다. */
function runMenu_(fn) {
  try {
    fn();
  } catch (e) {
    alert_('오류: ' + (e && e.message ? e.message : e));
  }
}

/** 운영설정·룸 시트를 고친 뒤 바로 반영 */
function menuClearCache() {
  runMenu_(function () {
    const keys = ['settings', 'rooms'];
    const today = todayKey_();
    for (let i = -1; i <= 31; i++) keys.push('ev_' + addDaysKey_(today, i));
    cacheRemove_(keys);
    alert_('반영했습니다. 운영설정·룸 시트의 변경 내용이 지금부터 적용됩니다.');
  });
}

/**
 * 임시 비밀번호 발급 (시트 메뉴용)
 * - 최초 원장 계정 발급, 또는 원장 본인 비밀번호 분실 시 사용
 * - 먼저 '회원' 시트에 그 번호의 회원 줄이 있어야 합니다.
 */
function menuIssueTempPassword() {
  runMenu_(function () {
    const id = prompt_('임시 비밀번호 발급', '로그인ID(휴대폰 번호, 숫자만)를 입력하세요.\n그 번호의 다른 기기 로그인은 모두 해제됩니다.');
    if (!id) return;
    const r = issueTempPassword_(id);
    alert_('발급 완료\n\n회원: ' + r.names + '\n아이디: ' + r.loginIdText + '\n임시 비밀번호: ' + r.tempPassword +
      '\n유효기간: ' + r.expiresAt + '까지\n\n이 창을 닫으면 다시 볼 수 없습니다. 카톡·대면으로 전달해 주세요.');
  });
}

function menuUnlock() {
  runMenu_(function () {
    const id = prompt_('로그인 잠금 해제', '로그인ID(휴대폰 번호, 숫자만)를 입력하세요.');
    if (!id) return;
    apiAdminUnlock_(null, { loginId: id });
    alert_('잠금을 해제했습니다.');
  });
}

function menuTestAlimtalk() {
  runMenu_(function () {
    const props = PropertiesService.getScriptProperties();
    const mode = props.getProperty('ALIMTALK_MODE') || 'off';
    const to = prompt_('알림톡 시험 발송 (현재 모드: ' + mode + ')',
      '받을 번호를 입력하세요. (test 모드면 ALIMTALK_TEST_PHONE 으로 바뀌어 발송됩니다)\n예약 확정 템플릿으로 견본 내용을 보냅니다.');
    if (!to) return;
    const result = sendAlimtalk_('시험 발송', to, props.getProperty('TEMPLATE_BOOKING_SUCCESS'), {
      '#{이름}': '테스트', '#{날짜}': koreanDateText_(todayKey_()), '#{예약내역}': '10:00~11:00 Eb'
    });
    alert_('결과: ' + result + '\n(알림로그 시트에도 기록됨)');
  });
}

function menuCleanupSessions() {
  runMenu_(function () {
    alert_('만료된 로그인 ' + cleanupExpiredSessions() + '건을 정리했습니다.');
  });
}

function menuInstallTriggers() {
  runMenu_(function () {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'cleanupExpiredSessions') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('cleanupExpiredSessions').timeBased().everyDays(1).atHour(4).create();
    alert_('매일 새벽 4시경 만료된 로그인을 자동으로 정리합니다.');
  });
}

function menuSetupSheets() {
  runMenu_(function () {
    const report = setupSheets_();
    alert_('시트 구조 점검 완료\n\n' + (report.length ? report.join('\n') : '변경 사항 없음'));
  });
}

function menuSetupTestEnv() {
  runMenu_(setupTestEnv_);
}

function menuBenchmarkHash() {
  runMenu_(function () {
    const t0 = Date.now();
    hashPassword_('test1234', 'salt', 1000);
    const t1 = Date.now();
    hashPassword_('test1234', 'salt', SECURITY.HASH_ITERATIONS);
    const t2 = Date.now();
    alert_('비밀번호 해시 속도\n\n1,000회: ' + (t1 - t0) + 'ms\n' + SECURITY.HASH_ITERATIONS.toLocaleString() + '회(현재 설정): ' + (t2 - t1) +
      'ms\n\n로그인 1회에 이 시간이 더해집니다. 500~1,000ms 정도가 적당합니다.\n조정하려면 Config.gs 의 SECURITY.HASH_ITERATIONS 를 바꾸세요.\n(이미 만든 계정은 계정 시트의 반복횟수 값으로 계속 동작합니다)');
  });
}

function menuImportLegacy() {
  runMenu_(importLegacy_);
}
