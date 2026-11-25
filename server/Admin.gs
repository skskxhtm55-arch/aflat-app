// =====================================================================
// [Admin.gs] 원장(관리자) 기능 — 최소 기능 (A-2, I-7, H-6 처리)
// ---------------------------------------------------------------------
// - 회원 등록 + 계정 발급(임시 비밀번호)
// - 임시 비밀번호 재발급, 잠금 해제
// - 계정 없는 회원 일괄 발급 (실운영 전환 시 사용)
// - 비밀번호 재설정 요청 목록·처리
// ※ 회원 정보 수정(이름·악기·상태 등)은 '회원' 시트에서 직접 고치면 됩니다.
//   단, 비밀번호는 해시로 저장되므로 시트에서 바꿀 수 없고 이 기능으로만 처리합니다.
// =====================================================================

/** 회원·계정 현황 (로그인ID별로 묶음) */
function apiAdminListMembers_() {
  const accounts = readTable_(SHEET.ACCOUNTS).rows;
  const accMap = {};
  accounts.forEach(function (a) { accMap[normalizeLoginId_(a['로그인ID'])] = a; });
  const now = new Date();

  const groups = {};
  const order = [];
  readTable_(SHEET.MEMBERS).rows.forEach(function (r) {
    const m = memberFromRow_(r);
    const key = m.loginId || '(로그인ID 없음)';
    if (!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(m);
  });

  return order.map(function (loginId) {
    const acc = accMap[loginId];
    const lockedUntil = acc && acc['잠금해제시각'] instanceof Date && acc['잠금해제시각'] > now ? acc['잠금해제시각'] : null;
    const tempExp = acc && acc['임시비밀번호만료일'] instanceof Date ? acc['임시비밀번호만료일'] : null;
    return {
      loginId: loginId,
      loginIdText: isValidLoginId_(loginId) ? formatPhone_(loginId) : loginId,
      validLoginId: isValidLoginId_(loginId),
      hasAccount: !!(acc && acc['비밀번호해시']),
      isTemp: !!(acc && isYes_(acc['임시비밀번호여부'])),
      tempExpired: !!(tempExp && tempExp < now),
      lockedUntil: lockedUntil ? fmt_(lockedUntil, 'MM-dd HH:mm') : '',
      lastLogin: acc && acc['최근로그인일시'] instanceof Date ? fmt_(acc['최근로그인일시'], 'yyyy-MM-dd HH:mm') : '',
      members: groups[loginId].map(function (m) {
        return { memberId: m.memberId, name: m.name, role: m.role, status: m.status, studentNo: m.studentNo, instruments: m.instruments };
      })
    };
  });
}

/**
 * 회원 등록 (+ 계정이 없으면 계정 발급)
 * data = { name, loginId, phone(선택), role, studentNo, instruments: '피아노;보컬', status }
 * - 같은 로그인ID의 계정이 이미 있으면 새 계정을 만들지 않고 그 계정에 연결만 합니다.
 *   (형제가 학부모 번호를 함께 쓰는 경우)
 */
function apiAdminCreateMember_(ctx, data) {
  const name = String(data.name || '').trim();
  const loginId = normalizeLoginId_(data.loginId);
  const phone = normalizeLoginId_(data.phone) || loginId;
  const role = String(data.role || ROLE.STUDENT).trim();
  const studentNo = normStudentNo_(data.studentNo);
  const instruments = splitList_(data.instruments);
  const status = String(data.status || STATUS.ACTIVE).trim();

  if (!name) fail_('이름을 입력해 주세요.');
  if (name.indexOf('_') >= 0) fail_('이름에 밑줄(_)을 넣을 수 없습니다. (캘린더 일정 제목 규칙)');
  if (!isValidLoginId_(loginId)) fail_('로그인ID(휴대폰 번호)를 숫자만 정확히 입력해 주세요.');
  if (!isValidLoginId_(phone)) fail_('알림톡 받을 연락처를 정확히 입력해 주세요.');
  if ([ROLE.ADMIN, ROLE.TEACHER, ROLE.STUDENT].indexOf(role) < 0) fail_('역할을 확인해 주세요.');
  if ([STATUS.ACTIVE, STATUS.PAUSED, STATUS.ENDED].indexOf(status) < 0) fail_('상태를 확인해 주세요.');
  if (role === ROLE.STUDENT && !studentNo) fail_('수강생 번호를 입력해 주세요.');
  if (studentNo && !/^[A-Z0-9-]+$/.test(studentNo)) fail_('수강생 번호는 영문·숫자·하이픈(-)만 쓸 수 있습니다.');
  if (role === ROLE.STUDENT && !instruments.length) fail_('등록 악기를 입력해 주세요. 여러 개면 세미콜론(;)으로 구분합니다.');
  instruments.forEach(function (ins) {
    if (ins.indexOf('_') >= 0) fail_('악기 이름에 밑줄(_)을 넣을 수 없습니다.');
  });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) fail_('다른 작업이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    const members = readTable_(SHEET.MEMBERS).rows;
    if (studentNo && members.some(function (r) { return normStudentNo_(r['수강생번호']) === studentNo; })) {
      fail_('이미 등록된 수강생 번호입니다: ' + studentNo);
    }
    // 회원ID: M0001 형식, 가장 큰 번호 + 1
    let maxNo = 0;
    members.forEach(function (r) {
      const m = String(r['회원ID'] || '').match(/^M(\d+)$/);
      if (m) maxNo = Math.max(maxNo, parseInt(m[1], 10));
    });
    const memberId = 'M' + String(maxNo + 1).padStart(4, '0');

    appendRow_(SHEET.MEMBERS, {
      '회원ID': memberId, '이름': name, '로그인ID': loginId, '연락처': phone, '역할': role,
      '수강생번호': studentNo, '등록악기': instruments.join(';'), '상태': status, '가입일': new Date()
    });

    invalidateCtx_(loginId);   // 같은 번호 계정에 회원이 하나 늘었으므로 기억 지우기
    const account = findAccountRow_(readTable_(SHEET.ACCOUNTS), loginId);
    if (account && account['비밀번호해시']) {
      return { memberId: memberId, linked: true, message: '기존 계정(' + formatPhone_(loginId) + ')에 연결했습니다. 기존 비밀번호로 로그인하면 됩니다.' };
    }
    const tempPassword = randomDigits_(SECURITY.TEMP_PASSWORD_LENGTH);
    const r = setAccountPassword_(loginId, tempPassword, true);
    return { memberId: memberId, linked: false, loginIdText: formatPhone_(loginId), tempPassword: tempPassword,
             expiresAt: fmt_(r.expiresAt, 'yyyy-MM-dd HH:mm') };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 임시 비밀번호 발급/재발급 (계정이 없으면 새로 만듦)
 * - 그 ID의 모든 기기 로그인이 해제됩니다.
 * - 같은 ID의 '접수' 상태 재설정 요청은 자동으로 '처리완료'가 됩니다.
 */
function issueTempPassword_(loginId) {
  loginId = normalizeLoginId_(loginId);
  if (!isValidLoginId_(loginId)) fail_('로그인ID(휴대폰 번호)를 확인해 주세요.');
  const members = linkedMembers_(loginId);
  if (!members.length) fail_('이 번호로 등록된(종료 아닌) 회원이 없습니다. 먼저 회원 시트를 확인해 주세요.');

  const tempPassword = randomDigits_(SECURITY.TEMP_PASSWORD_LENGTH);
  const r = setAccountPassword_(loginId, tempPassword, true);
  deleteSessions_(loginId, {});

  const req = readTable_(SHEET.RESET_REQ);
  req.rows.forEach(function (row) {
    if (normalizeLoginId_(row['입력ID']) === loginId && row['상태'] === '접수') {
      updateRow_(req, row, { '상태': '처리완료', '처리일시': new Date() });
    }
  });
  return {
    loginIdText: formatPhone_(loginId),
    names: members.map(function (m) { return m.name; }).join('·'),
    tempPassword: tempPassword,
    expiresAt: fmt_(r.expiresAt, 'yyyy-MM-dd HH:mm')
  };
}

function apiAdminIssueTempPassword_(ctx, data) {
  const loginId = normalizeLoginId_(data.loginId);
  if (loginId === ctx.loginId) fail_('본인 계정은 여기서 재발급할 수 없습니다. 시트 메뉴의 "임시 비밀번호 발급"을 이용해 주세요.');
  return issueTempPassword_(loginId);
}

/** 계정이 없는 회원(종료 제외)에게 한꺼번에 임시 비밀번호 발급. 결과는 화면에만 표시(저장 안 함) */
function apiAdminBulkIssue_() {
  const accounts = readTable_(SHEET.ACCOUNTS);
  const ids = [];
  readTable_(SHEET.MEMBERS).rows.map(memberFromRow_).forEach(function (m) {
    if (m.status === STATUS.ENDED || !isValidLoginId_(m.loginId)) return;
    const acc = findAccountRow_(accounts, m.loginId);
    if (acc && acc['비밀번호해시']) return;
    if (ids.indexOf(m.loginId) < 0) ids.push(m.loginId);
  });
  // 실행 시간 제한(6분) 때문에 한 번에 30개까지만. 다시 누르면 나머지를 발급합니다.
  const batch = ids.slice(0, 30);
  return { issued: batch.map(issueTempPassword_), remaining: ids.length - batch.length };
}

function apiAdminUnlock_(ctx, data) {
  const loginId = normalizeLoginId_(data.loginId);
  const table = readTable_(SHEET.ACCOUNTS);
  const row = findAccountRow_(table, loginId);
  if (!row) fail_('계정이 없습니다.');
  updateRow_(table, row, { '로그인실패횟수': 0, '잠금해제시각': '' });
  return { done: true };
}

/** 처리 대기 중인 비밀번호 재설정 요청 */
function apiAdminListResetRequests_() {
  return readTable_(SHEET.RESET_REQ).rows
    .filter(function (r) { return r['상태'] === '접수'; })
    .map(function (r) {
      const id = normalizeLoginId_(r['입력ID']);
      return {
        requestId: r['요청ID'],
        loginId: id,
        loginIdText: formatPhone_(id),
        names: r['해당회원'],
        requestedAt: r['요청일시'] instanceof Date ? fmt_(r['요청일시'], 'yyyy-MM-dd HH:mm') : String(r['요청일시']),
        note: r['비고']
      };
    })
    .reverse();
}

/** 재설정 요청을 '무시'(본인 아님 등) 또는 '처리완료'로 표시 */
function apiAdminResolveResetRequest_(ctx, data) {
  const status = data.status === '무시' ? '무시' : '처리완료';
  const table = readTable_(SHEET.RESET_REQ);
  const row = table.rows.filter(function (r) { return r['요청ID'] === data.requestId; })[0];
  if (!row) fail_('요청을 찾을 수 없습니다.');
  updateRow_(table, row, { '상태': status, '처리일시': new Date() });
  return { done: true };
}
