// =====================================================================
// [Setup.gs] 설치·테스트·데이터 이관 도구
// ---------------------------------------------------------------------
// ① setupSheets_     : 필요한 시트와 첫 줄(열 이름)을 만들고 서식을 맞춤 (여러 번 실행해도 안전)
// ② setupTestEnv_    : 테스트용 캘린더 4개·샘플 회원·샘플 일정·테스트 계정 생성
//                      ※ 스크립트 속성 ENV = test 인 프로젝트에서만 실행됩니다(실운영 보호)
// ③ importLegacy_    : 현행 스프레드시트의 'Key' 시트에서 룸·수강생을 "읽기만" 해서 가져옴
//                      (현행 시트는 전혀 수정하지 않음)
// =====================================================================

const TEST_SAMPLE_TAG = 'AFLAT_TEST_SAMPLE';

// ---------------------------------------------------------------------
// ① 시트 구조
// ---------------------------------------------------------------------
function setupSheets_() {
  const ss = ss_();
  const report = [];

  Object.keys(HEADERS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      report.push("'" + name + "' 시트 생성");
    }
    const want = HEADERS[name];
    const lastCol = Math.max(sh.getLastColumn(), 1);
    let have = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });

    if (have.every(function (h) { return h === ''; })) {
      sh.getRange(1, 1, 1, want.length).setValues([want]);
      have = want.slice();
    } else {
      const missing = want.filter(function (h) { return have.indexOf(h) < 0; });
      if (missing.length) {
        sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
        have = have.concat(missing);
        report.push("'" + name + "' 시트에 열 추가: " + missing.join(', '));
      }
    }

    // 첫 줄 꾸미기·고정
    sh.getRange(1, 1, 1, have.length).setFontWeight('bold').setBackground('#F7EE95').setFontColor('#035A17');
    sh.setFrozenRows(1);

    // 글자로 저장할 열(휴대폰 번호 앞자리 0 보존 등)
    (TEXT_COLUMNS[name] || []).forEach(function (col) {
      const idx = have.indexOf(col);
      if (idx >= 0 && sh.getMaxRows() > 1) sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  // 운영설정 기본값 채우기 (비어 있을 때만)
  const settings = ss.getSheetByName(SHEET.SETTINGS);
  if (settings.getLastRow() < 2) {
    settings.getRange(2, 1, DEFAULT_SETTINGS.length, 3).setNumberFormat('@').setValues(DEFAULT_SETTINGS);
    settings.setColumnWidth(3, 520);
    report.push('운영설정 기본값 입력');
  }

  // 드롭다운(데이터 확인) 설정
  setDropdown_(SHEET.MEMBERS, '역할', [ROLE.ADMIN, ROLE.TEACHER, ROLE.STUDENT]);
  setDropdown_(SHEET.MEMBERS, '상태', [STATUS.ACTIVE, STATUS.PAUSED, STATUS.ENDED]);
  setDropdown_(SHEET.ROOMS, '사용가능여부', ['Y', 'N']);
  setDropdown_(SHEET.RESET_REQ, '상태', ['접수', '처리완료', '무시']);

  // 계정·세션 시트 보호 (수정하려 하면 경고창이 뜸)
  [SHEET.ACCOUNTS, SHEET.SESSIONS].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) {
      sh.protect().setDescription('앱이 관리하는 시트입니다. 직접 수정하지 마세요.').setWarningOnly(true);
      report.push("'" + name + "' 시트 보호(경고) 설정");
    }
  });

  cacheRemove_(['settings', 'rooms']);
  return report;
}

function setDropdown_(sheetName, header, options) {
  const sh = ss_().getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const idx = headers.indexOf(header);
  if (idx < 0 || sh.getMaxRows() < 2) return;
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build();
  sh.getRange(2, idx + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

// ---------------------------------------------------------------------
// ② 테스트 환경
// ---------------------------------------------------------------------
function setupTestEnv_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ENV') !== 'test') {
    alert_('실운영 보호: 스크립트 속성 ENV 가 test 인 프로젝트에서만 실행됩니다.\n(프로젝트 설정 → 스크립트 속성에서 ENV = test 추가)');
    return;
  }
  setupSheets_();
  const report = [];

  // 1) 테스트 캘린더 4개 + 룸 시트
  if (!readTable_(SHEET.ROOMS).rows.length) {
    [
      ['R1', 'Eb', 1, '피아노;보컬;기타', 1],
      ['R2', 'Bb', 2, '피아노;드럼', 2],
      ['R3', 'F', 3, '보컬;기타;베이스기타', 3],
      ['R4', 'Db', 4, '피아노', 4]
    ].forEach(function (d) {
      const cal = CalendarApp.createCalendar('[에이플랫 테스트] ' + d[1], { timeZone: TZ });
      appendRow_(SHEET.ROOMS, { '룸ID': d[0], '이름': d[1], '표시순서': d[2], '캘린더ID': cal.getId(),
                                '허용악기': d[3], '배정우선순위': d[4], '사용가능여부': 'Y' });
    });
    cacheRemove_(['rooms']);
    report.push('테스트 캘린더 4개 생성 (구글 캘린더 왼쪽 목록에 "[에이플랫 테스트]"로 보임)');
  }

  // 2) 샘플 회원
  if (!readTable_(SHEET.MEMBERS).rows.length) {
    [
      ['M0001', '테스트원장', '01000000000', ROLE.ADMIN, '', '', STATUS.ACTIVE],
      ['M0002', '김테스트', '01000000001', ROLE.STUDENT, 'TST001', '피아노;보컬', STATUS.ACTIVE],
      ['M0003', '이테스트', '01000000002', ROLE.STUDENT, 'TST0011', '기타', STATUS.ACTIVE],
      ['M0004', '박형', '01000000003', ROLE.STUDENT, 'TST002', '피아노', STATUS.ACTIVE],
      ['M0005', '박동생', '01000000003', ROLE.STUDENT, 'TST003', '드럼', STATUS.PAUSED],
      ['M0006', '최휴원', '01000000004', ROLE.STUDENT, 'TST004', '피아노', STATUS.PAUSED],
      ['M0007', '정종료', '01000000005', ROLE.STUDENT, 'TST005', '피아노', STATUS.ENDED],
      ['M0008', '한강사', '01000000009', ROLE.TEACHER, 'TCH001', '피아노', STATUS.ACTIVE]
    ].forEach(function (m) {
      appendRow_(SHEET.MEMBERS, { '회원ID': m[0], '이름': m[1], '로그인ID': m[2], '연락처': m[2], '역할': m[3],
                                  '수강생번호': m[4], '등록악기': m[5], '상태': m[6], '가입일': new Date(), '메모': '테스트 샘플' });
    });
    report.push('샘플 회원 8명 입력');
  }

  // 3) 샘플 일정 (오늘+1 ~ 오늘+3). 이전 샘플은 지우고 다시 만듦
  const rooms = getRooms_();
  const byName = {};
  rooms.forEach(function (r) { byName[r.name] = r; });
  const today = todayKey_();
  const from = dateFromKey_(today);
  const to = dateFromKey_(addDaysKey_(today, 8));
  rooms.forEach(function (r) {
    const cal = CalendarApp.getCalendarById(r.calendarId);
    if (!cal) return;
    cal.getEvents(from, to).forEach(function (ev) {
      if (ev.getDescription() === TEST_SAMPLE_TAG) ev.deleteEvent();
    });
  });
  const add = function (roomName, dayOffset, s, e, title) {
    const room = byName[roomName];
    if (!room) return;
    const d = dateFromKey_(addDaysKey_(today, dayOffset));
    const sm = parseHHMM_(s), em = parseHHMM_(e);
    CalendarApp.getCalendarById(room.calendarId).createEvent(title,
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, sm),
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, em),
      { description: TEST_SAMPLE_TAG });
  };
  // 내일: 1일 한도·정확 일치 테스트
  add('Bb', 1, '14:00', '15:00', '(레슨)Bb_김테스트_피아노_TST001');
  add('Eb', 1, '14:00', '15:00', '강사 개인연습');
  add('Eb', 1, '10:00', '12:00', '(연습)Eb_이테스트_기타_TST0011');
  add('Db', 1, '10:00', '11:00', '(연습)Db_김테스트_피아노_TST001');
  // 모레: 2개 룸 분할 테스트
  add('Eb', 2, '19:00', '20:00', '기타 일정');
  add('Bb', 2, '18:00', '19:00', '(레슨)Bb_박형_피아노_TST002');
  add('Db', 2, '18:00', '20:00', '(레슨)Db_김테스트_피아노_TST001');
  // 글피: 잔여 없음 사유 테스트
  add('Eb', 3, '10:00', '12:00', '(레슨)Eb_박형_피아노_TST002');
  add('Bb', 3, '10:00', '12:00', '강사 개인연습');
  add('Db', 3, '10:00', '12:00', '(레슨)Db_이테스트_기타_TST0011');
  ['Eb', 'Bb', 'F', 'Db'].forEach(function (n) { add(n, 3, '15:00', '16:00', '단체 수업'); });
  const keys = [];
  for (let i = 0; i <= 8; i++) keys.push('ev_' + addDaysKey_(today, i));
  cacheRemove_(keys);
  report.push('샘플 일정 생성 (내일·모레·글피)');

  // 4) 테스트 계정 발급 (종료 회원 제외)
  const ids = [];
  readTable_(SHEET.MEMBERS).rows.map(memberFromRow_).forEach(function (m) {
    if (m.status !== STATUS.ENDED && isValidLoginId_(m.loginId) && ids.indexOf(m.loginId) < 0) ids.push(m.loginId);
  });
  const issued = ids.map(issueTempPassword_);
  report.push('\n[테스트 계정] (첫 로그인 시 비밀번호 변경 필요)');
  issued.forEach(function (r) { report.push(r.loginIdText + ' / ' + r.tempPassword + '  (' + r.names + ')'); });

  alert_('테스트 환경 준비 완료\n\n' + report.join('\n') + '\n\n※ 이 창을 닫으면 임시 비밀번호를 다시 볼 수 없습니다. 필요하면 메뉴의 "임시 비밀번호 발급"으로 재발급하세요.');
}

// ---------------------------------------------------------------------
// ③ 현행 'Key' 시트에서 가져오기 (읽기 전용)
// ---------------------------------------------------------------------
// 현행 Key 시트 구조 (Code.gs 기준)
//   A 룸 이름 / B 캘린더 ID / C 허용 악기 / D 우선순위
//   F 이름 / G 수강생 번호 / H 악기 / K 연락처
function importLegacy_() {
  const props = PropertiesService.getScriptProperties();
  const isTest = props.getProperty('ENV') === 'test';
  const input = prompt_('기존 Key 시트에서 가져오기',
    '현행 연습실 예약 스프레드시트의 주소(URL)를 붙여넣으세요.\n현행 시트는 읽기만 하고 수정하지 않습니다.' +
    (isTest ? '\n\n※ 테스트 환경(ENV=test)에서는 회원만 가져오고, 룸(실제 캘린더 ID)은 가져오지 않습니다.' : ''));
  if (!input) return;
  const m = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const id = m ? m[1] : input;

  const src = SpreadsheetApp.openById(id).getSheetByName('Key');
  if (!src) fail_("그 스프레드시트에 'Key' 시트가 없습니다.");
  const last = src.getLastRow();
  if (last < 2) fail_('Key 시트에 데이터가 없습니다.');
  const rows = src.getRange(2, 1, last - 1, 11).getValues();
  const report = [];
  const warnings = [];

  // --- 룸 ---
  if (isTest) {
    report.push('룸: 테스트 환경이라 건너뜀');
  } else if (readTable_(SHEET.ROOMS).rows.length) {
    report.push('룸: 룸 시트에 이미 데이터가 있어 건너뜀');
  } else {
    const order = ['Eb', 'Bb', 'F', 'Db'];   // 현행 Index.html 의 표시 순서
    let n = 0;
    rows.forEach(function (r) {
      const name = String(r[0]).trim(), calId = String(r[1]).trim();
      if (!name || !calId) return;
      n++;
      const idx = order.indexOf(name);
      appendRow_(SHEET.ROOMS, { '룸ID': 'R' + n, '이름': name, '표시순서': idx >= 0 ? idx + 1 : 10 + n, '캘린더ID': calId,
                                '허용악기': String(r[2]).trim(), '배정우선순위': Number(r[3]) || 99, '사용가능여부': 'Y' });
    });
    report.push('룸: ' + n + '개 가져옴');
  }

  // --- 수강생 ---
  const members = readTable_(SHEET.MEMBERS).rows;
  const existing = {};
  members.forEach(function (r) { const no = normStudentNo_(r['수강생번호']); if (no) existing[no] = true; });
  let maxNo = 0;
  members.forEach(function (r) { const mm = String(r['회원ID'] || '').match(/^M(\d+)$/); if (mm) maxNo = Math.max(maxNo, parseInt(mm[1], 10)); });

  const pending = {};   // 수강생번호 → 회원 정보
  const orderNos = [];
  let skipped = 0;
  rows.forEach(function (r, i) {
    const no = normStudentNo_(r[6]);
    if (!no) return;
    const rowNum = i + 2;
    if (existing[no]) { skipped++; return; }
    const name = String(r[5]).trim();
    const phone = normalizeLoginId_(r[10]);
    const inst = splitList_(r[7]);
    if (pending[no]) {
      // 같은 번호가 두 줄 이상이면 악기를 합칩니다.
      inst.forEach(function (x) { if (pending[no].inst.indexOf(x) < 0) pending[no].inst.push(x); });
      warnings.push(rowNum + '행: 수강생 번호 ' + no + ' 중복 → 악기를 합쳐서 1명으로 등록');
      return;
    }
    if (!isValidLoginId_(phone)) warnings.push(rowNum + '행 ' + name + '(' + no + '): 연락처 확인 필요 → 로그인 불가 상태로 등록');
    if (name.indexOf('_') >= 0) warnings.push(rowNum + '행 ' + name + ': 이름에 밑줄(_) 있음 → 수정 필요');
    if (/[,\/]/.test(String(r[7]))) warnings.push(rowNum + '행 ' + name + ': 악기 구분자가 세미콜론(;)이 아닌 것 같음 → 확인 필요');
    pending[no] = { name: name, phone: phone, inst: inst };
    orderNos.push(no);
  });

  if (orderNos.length) {
    const sh = sheet_(SHEET.MEMBERS);
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    const values = orderNos.map(function (no) {
      maxNo++;
      const p = pending[no];
      const obj = { '회원ID': 'M' + String(maxNo).padStart(4, '0'), '이름': p.name, '로그인ID': p.phone, '연락처': p.phone,
                    '역할': ROLE.STUDENT, '수강생번호': no, '등록악기': p.inst.join(';'), '상태': STATUS.ACTIVE,
                    '가입일': new Date(), '메모': '기존 Key 시트에서 이관' };
      return headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
    });
    const startRow = sh.getLastRow() + 1;
    (TEXT_COLUMNS[SHEET.MEMBERS] || []).forEach(function (col) {
      const idx = headers.indexOf(col);
      if (idx >= 0) sh.getRange(startRow, idx + 1, values.length, 1).setNumberFormat('@');
    });
    sh.getRange(startRow, 1, values.length, headers.length).setValues(values);
  }
  report.push('수강생: ' + orderNos.length + '명 가져옴' + (skipped ? ', 이미 있는 번호 ' + skipped + '명 건너뜀' : ''));

  // 같은 휴대폰 번호를 쓰는 회원 안내 (계정 1개로 묶임)
  const phoneCount = {};
  readTable_(SHEET.MEMBERS).rows.forEach(function (r) {
    const p = normalizeLoginId_(r['로그인ID']);
    if (p) phoneCount[p] = (phoneCount[p] || []).concat(String(r['이름']));
  });
  Object.keys(phoneCount).forEach(function (p) {
    if (phoneCount[p].length > 1) warnings.push('같은 번호 ' + formatPhone_(p) + ': ' + phoneCount[p].join(', ') + ' → 계정 1개로 연결됨');
  });

  cacheRemove_(['rooms']);
  alert_('가져오기 완료\n\n' + report.join('\n') + (warnings.length ? '\n\n[확인 필요]\n' + warnings.slice(0, 40).join('\n') +
    (warnings.length > 40 ? '\n... 외 ' + (warnings.length - 40) + '건' : '') : '') +
    '\n\n역할(원장·강사)과 상태(휴원·종료)는 회원 시트에서 직접 고쳐 주세요.');
}
