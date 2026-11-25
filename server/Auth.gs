// =====================================================================
// [Auth.gs] 로그인·로그아웃·비밀번호·세션 (기능 A-1, A-4, A-5)
// ---------------------------------------------------------------------
// ■ 계정 구조
//   - 로그인 ID = 휴대폰 번호(숫자만). '계정' 시트에 ID당 한 줄.
//   - '회원' 시트의 '로그인ID'가 같은 회원들은 모두 그 계정에 연결됩니다.
//     예) 형제가 학부모 번호를 함께 쓰면 → 계정 1개에 수강생 2명 연결
//
// ■ 비밀번호 저장 방식 (원문은 어디에도 저장하지 않음)
//   PBKDF2-HMAC-SHA256: 비밀번호를 SHA-256 기반으로 수천 번 반복 변환한 결과만 저장
//   - 솔트: 계정마다 다른 무작위 값 (같은 비밀번호라도 저장값이 달라짐)
//   - 페퍼: 스크립트 속성 PASSWORD_PEPPER 에만 있는 비밀값
//           (시트가 유출되어도 페퍼 없이는 비밀번호를 맞춰볼 수 없음)
//   ※ PASSWORD_PEPPER 를 지우거나 바꾸면 모든 비밀번호가 무효가 됩니다. 절대 변경 금지.
//
// ■ 세션(로그인 유지)
//   로그인하면 무작위 토큰을 발급해 화면(기기)에 저장합니다.
//   시트에는 토큰 자체가 아니라 토큰의 해시만 저장합니다.
// =====================================================================

// ---------------------------------------------------------------------
// 비밀번호 해시
// ---------------------------------------------------------------------

/** 페퍼(비밀값). 없으면 처음 한 번 자동으로 만들어 스크립트 속성에 저장합니다. */
function getPepper_() {
  const props = PropertiesService.getScriptProperties();
  let pepper = props.getProperty('PASSWORD_PEPPER');
  if (pepper) return pepper;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    pepper = props.getProperty('PASSWORD_PEPPER');
    if (!pepper) {
      pepper = randomToken_();
      props.setProperty('PASSWORD_PEPPER', pepper);
    }
    return pepper;
  } finally {
    lock.releaseLock();
  }
}

/** PBKDF2-HMAC-SHA256 (결과 32바이트를 base64 글자로) */
function hashPassword_(password, salt, iterations) {
  const pepperBytes = Utilities.newBlob(getPepper_()).getBytes();
  // 1) 비밀번호 + 페퍼로 HMAC 키를 만듭니다.
  const key = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(password)).getBytes(), pepperBytes);
  // 2) PBKDF2: U1 = HMAC(키, 솔트 + 블록번호1), Ui = HMAC(키, Ui-1), 결과 = U1 xor U2 xor ...
  let u = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(salt)).getBytes().concat([0, 0, 0, 1]), key);
  const t = u.slice();
  for (let i = 1; i < iterations; i++) {
    u = Utilities.computeHmacSha256Signature(u, key);
    for (let j = 0; j < t.length; j++) t[j] = t[j] ^ u[j];
  }
  return Utilities.base64Encode(t);
}

/** 두 글자를 처음부터 끝까지 비교 (비교 시간으로 정답을 추측하지 못하게) */
function safeEquals_(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function verifyPassword_(accountRow, password) {
  const iterations = Number(accountRow['반복횟수']) || SECURITY.HASH_ITERATIONS;
  const hash = hashPassword_(password, accountRow['솔트'], iterations);
  return safeEquals_(hash, accountRow['비밀번호해시']);
}

/**
 * 계정의 비밀번호를 설정합니다. 계정이 없으면 새로 만듭니다.
 * isTemp = true 이면 임시 비밀번호(첫 로그인 시 변경 강제, 7일 유효).
 * 로그인 실패 횟수·잠금도 함께 초기화합니다.
 */
function setAccountPassword_(loginId, password, isTemp) {
  const salt = Utilities.getUuid();
  const iterations = SECURITY.HASH_ITERATIONS;
  const hash = hashPassword_(password, salt, iterations);
  const now = new Date();
  const expires = isTemp ? new Date(now.getTime() + SECURITY.TEMP_PASSWORD_DAYS * 86400000) : '';
  const values = {
    '비밀번호해시': hash,
    '솔트': salt,
    '반복횟수': iterations,
    '임시비밀번호여부': isTemp ? 'Y' : 'N',
    '임시비밀번호만료일': expires,
    '로그인실패횟수': 0,
    '잠금해제시각': ''
  };
  const table = readTable_(SHEET.ACCOUNTS);
  const row = findAccountRow_(table, loginId);
  if (row) {
    updateRow_(table, row, values);
  } else {
    values['로그인ID'] = loginId;
    values['발급일시'] = now;
    appendRow_(SHEET.ACCOUNTS, values);
  }
  invalidateCtx_(loginId);   // 임시비밀번호 여부가 바뀌었으므로 기억 지우기
  return { expiresAt: expires };
}

function findAccountRow_(table, loginId) {
  for (let i = 0; i < table.rows.length; i++) {
    if (normalizeLoginId_(table.rows[i]['로그인ID']) === loginId) return table.rows[i];
  }
  return null;
}

/** 새 비밀번호 규칙 검사: 8자 이상(원장 10자 이상), 영문+숫자 포함 */
function checkPasswordRule_(pw, isAdmin) {
  const minLen = isAdmin ? SECURITY.ADMIN_MIN_PASSWORD_LENGTH : SECURITY.MIN_PASSWORD_LENGTH;
  if (pw.length < minLen) fail_('비밀번호는 ' + minLen + '자 이상이어야 합니다.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail_('비밀번호에 영문과 숫자를 모두 넣어 주세요.');
  if (pw.length > 64) fail_('비밀번호가 너무 깁니다(64자 이하).');
}

// ---------------------------------------------------------------------
// 회원 ↔ 계정 연결
// ---------------------------------------------------------------------

/** 회원 시트의 한 줄을 화면·로직에서 쓰기 쉬운 형태로 바꿉니다. */
function memberFromRow_(r) {
  const status = String(r['상태'] || '').trim() || STATUS.ACTIVE;   // 빈칸은 '활성'으로 봄
  const studentNo = normStudentNo_(r['수강생번호']);
  const instruments = splitList_(r['등록악기']);
  const role = String(r['역할'] || '').trim() || ROLE.STUDENT;
  let cannotBookReason = '';
  // 원장(관리자) 줄에 수강생번호가 없으면: 예약 기능이 없는 관리자 계정이라고 안내
  // (원장 계정에 예약용 회원을 연결하려면 같은 로그인ID로 수강생번호·악기가 있는 줄을 따로 추가)
  if (role === ROLE.ADMIN && !studentNo) cannotBookReason = '원장(관리자) 계정은 연습실 예약 기능이 없습니다. 시간표 조회와 관리 기능을 이용해 주세요.';
  else if (status !== STATUS.ACTIVE) cannotBookReason = status + ' 상태에서는 예약할 수 없습니다.';
  else if (!studentNo) cannotBookReason = '수강생 번호가 등록되지 않아 예약할 수 없습니다. 학원에 문의해 주세요.';
  else if (!instruments.length) cannotBookReason = '등록된 악기가 없어 예약할 수 없습니다. 학원에 문의해 주세요.';
  return {
    memberId: String(r['회원ID'] || '').trim(),
    name: String(r['이름'] || '').trim(),
    loginId: normalizeLoginId_(r['로그인ID']),
    phone: normalizeLoginId_(r['연락처']) || normalizeLoginId_(r['로그인ID']),
    role: role,
    status: status,
    studentNo: studentNo,
    instruments: instruments,
    canBook: !cannotBookReason,
    cannotBookReason: cannotBookReason
  };
}

/** 로그인 ID에 연결된 회원 중 '종료'가 아닌 회원 목록 */
function linkedMembers_(loginId) {
  return readTable_(SHEET.MEMBERS).rows
    .filter(function (r) { return normalizeLoginId_(r['로그인ID']) === loginId; })
    .map(memberFromRow_)
    .filter(function (m) { return m.status !== STATUS.ENDED; });
}

/** 요청한 사람의 정보 묶음(ctx) 만들기 */
function buildContext_(loginId, accountRow, accountTable, tokenHash) {
  const members = linkedMembers_(loginId);
  if (!members.length) fail_('사용이 중지된 계정입니다. 학원에 문의해 주세요.', 'AUTH');
  return contextFromSnapshot_(loginId, tokenHash, { mustChangePassword: isYes_(accountRow['임시비밀번호여부']), members: members });
}

function contextFromSnapshot_(loginId, tokenHash, snap) {
  return {
    loginId: loginId,
    tokenHash: tokenHash || '',
    members: snap.members,
    isAdmin: snap.members.some(function (m) { return m.role === ROLE.ADMIN; }),
    isTeacher: snap.members.some(function (m) { return m.role === ROLE.TEACHER; }),
    mustChangePassword: !!snap.mustChangePassword
  };
}

// ---------------------------------------------------------------------
// [속도 개선 P1] 로그인한 사람의 정보(계정의 임시비밀번호 여부 + 연결된 회원)를 10분간 기억
// - 기억해 두면 시간표·내 예약 같은 조회 요청이 시트를 열지 않아 1~2초 빨라집니다.
// - 다음 경우에는 기억을 지워 바로 반영합니다:
//   · 회원·계정 시트를 손으로 고칠 때 (onEdit, Menu.gs)
//   · 시트 메뉴 '설정 즉시 반영'
//   · 비밀번호 변경·임시 비밀번호 발급·관리 화면 회원 등록
// - 예약 확정·변경은 기억을 쓰지 않고 회원 시트를 직접 다시 확인합니다(휴원 전환 등 정확성).
// ---------------------------------------------------------------------
const CTX_CACHE_SEC = 600;
let CTX_GEN_ = null;

/** 기억 세대 번호: 바꾸면 모든 사람의 기억이 한꺼번에 무효가 됨 */
function ctxGen_() {
  if (CTX_GEN_ === null) CTX_GEN_ = PropertiesService.getScriptProperties().getProperty('CTX_GEN') || '0';
  return CTX_GEN_;
}
function ctxCacheKey_(loginId) { return 'ctx_' + ctxGen_() + '_' + loginId; }

/** 한 사람의 기억 지우기 */
function invalidateCtx_(loginId) { cacheRemove_(ctxCacheKey_(normalizeLoginId_(loginId))); }

/** 모든 사람의 기억 지우기 (세대 번호 바꾸기) */
function invalidateAllCtx_() {
  CTX_GEN_ = String(Date.now());
  PropertiesService.getScriptProperties().setProperty('CTX_GEN', CTX_GEN_);
}

/** 기억해 둔 정보가 있으면 쓰고, 없으면 시트에서 읽어 기억 */
function loadContextSnapshot_(loginId) {
  const key = ctxCacheKey_(loginId);
  const cached = cacheGetJson_(key);
  if (cached && cached.members) return cached;
  const account = findAccountRow_(readTable_(SHEET.ACCOUNTS), loginId);
  if (!account) fail_('로그인이 필요합니다.', 'AUTH');
  const members = linkedMembers_(loginId);
  if (!members.length) fail_('사용이 중지된 계정입니다. 학원에 문의해 주세요.', 'AUTH');
  const snap = { mustChangePassword: isYes_(account['임시비밀번호여부']), members: members };
  cachePutJson_(key, snap, CTX_CACHE_SEC);
  return snap;
}

/** 예약 확정·변경용: 회원 시트를 직접 다시 읽은 최신 회원 목록 */
function freshMembers_(ctx) {
  const members = linkedMembers_(ctx.loginId);
  if (!members.length) fail_('사용이 중지된 계정입니다. 학원에 문의해 주세요.', 'AUTH');
  return members;
}

/** 화면에 돌려줄 "내 정보" */
function buildMe_(ctx) {
  const st = getSettings_();
  return {
    loginId: ctx.loginId,
    loginIdText: formatPhone_(ctx.loginId),
    displayName: ctx.members.map(function (m) { return m.name; }).join('·'),
    isAdmin: ctx.isAdmin,
    isTeacher: ctx.isTeacher,
    mustChangePassword: ctx.mustChangePassword,
    passwordMinLength: ctx.isAdmin ? SECURITY.ADMIN_MIN_PASSWORD_LENGTH : SECURITY.MIN_PASSWORD_LENGTH,
    students: ctx.members.map(function (m) {
      return { memberId: m.memberId, name: m.name, role: m.role, status: m.status, studentNo: m.studentNo,
               instruments: m.instruments, canBook: m.canBook, cannotBookReason: m.cannotBookReason };
    }),
    settings: {
      openMin: st.openMin, closeMin: st.closeMin, bookableDays: st.bookableDays,
      maxDailyMin: st.maxDailyMin, durations: st.durations, pastGraceMin: st.pastGraceMin
    },
    today: todayKey_(),
    dates: bookableDates_(st)
  };
}

// ---------------------------------------------------------------------
// 세션(로그인 유지)
// ---------------------------------------------------------------------

/** 토큰을 확인하고 ctx 를 돌려줍니다. 실패하면 'AUTH' 오류 */
function authenticate_(token) {
  if (!token || typeof token !== 'string' || token.length < 20) fail_('로그인이 필요합니다.', 'AUTH');
  const tokenHash = sha256Hex_(token);
  const now = Date.now();

  let loginId = null;
  const cached = cacheGetJson_('sess_' + tokenHash);
  if (cached && cached.exp > now) {
    loginId = cached.id;
  } else {
    const sessions = readTable_(SHEET.SESSIONS);
    for (let i = 0; i < sessions.rows.length; i++) {
      const s = sessions.rows[i];
      if (s['토큰해시'] === tokenHash) {
        const exp = s['만료일시'] instanceof Date ? s['만료일시'].getTime() : 0;
        if (exp > now) {
          loginId = normalizeLoginId_(s['로그인ID']);
          cachePutJson_('sess_' + tokenHash, { id: loginId, exp: exp },
            Math.min(SECURITY.SESSION_CACHE_SEC, Math.floor((exp - now) / 1000)));
        }
        break;
      }
    }
  }
  if (!loginId) fail_('로그인이 만료되었습니다. 다시 로그인해 주세요.', 'AUTH');

  return contextFromSnapshot_(loginId, tokenHash, loadContextSnapshot_(loginId));
}

function createSession_(loginId, deviceInfo) {
  const token = randomToken_();
  const now = new Date();
  appendRow_(SHEET.SESSIONS, {
    '토큰해시': sha256Hex_(token),
    '로그인ID': loginId,
    '발급일시': now,
    '만료일시': new Date(now.getTime() + SECURITY.SESSION_DAYS * 86400000),
    '기기정보': String(deviceInfo || '').slice(0, 120)
  });
  return token;
}

/**
 * 세션 삭제.
 * - keepTokenHash 를 주면 그 세션만 남기고 해당 ID의 나머지를 지웁니다(비밀번호 변경 시).
 * - onlyTokenHash 를 주면 그 세션 하나만 지웁니다(로그아웃).
 */
function deleteSessions_(loginId, opts) {
  opts = opts || {};
  const table = readTable_(SHEET.SESSIONS);
  const targets = table.rows.filter(function (s) {
    if (opts.onlyTokenHash) return s['토큰해시'] === opts.onlyTokenHash;
    return normalizeLoginId_(s['로그인ID']) === loginId && s['토큰해시'] !== opts.keepTokenHash;
  });
  cacheRemove_(targets.map(function (s) { return 'sess_' + s['토큰해시']; }));
  deleteRows_(table, targets);
}

/** 만료된 세션 정리 (매일 자동 실행 트리거로 설치 가능) */
function cleanupExpiredSessions() {
  const table = readTable_(SHEET.SESSIONS);
  const now = Date.now();
  const expired = table.rows.filter(function (s) {
    return !(s['만료일시'] instanceof Date) || s['만료일시'].getTime() <= now;
  });
  deleteRows_(table, expired);
  console.log('만료 세션 ' + expired.length + '건 정리');
  return expired.length;
}

// ---------------------------------------------------------------------
// API: 로그인 / 로그아웃 / 내 정보 / 비밀번호 변경 / 재설정 요청
// ---------------------------------------------------------------------

function apiLogin_(ctx, data) {
  const loginId = normalizeLoginId_(data.loginId);
  const password = String(data.password || '');
  if (!loginId || !password) fail_('아이디(휴대폰 번호)와 비밀번호를 입력해 주세요.');

  const GENERIC = '아이디 또는 비밀번호가 올바르지 않습니다.';
  const accounts = readTable_(SHEET.ACCOUNTS);
  const account = findAccountRow_(accounts, loginId);
  if (!account || !account['비밀번호해시']) fail_(GENERIC);

  const now = new Date();
  const lockedUntil = account['잠금해제시각'];
  if (lockedUntil instanceof Date && lockedUntil > now) {
    fail_('로그인을 ' + SECURITY.MAX_LOGIN_FAIL + '회 실패해 잠시 잠겼습니다. ' + fmt_(lockedUntil, 'HH:mm') + ' 이후에 다시 시도해 주세요.', 'LOCKED');
  }

  if (!verifyPassword_(account, password)) {
    const fails = (Number(account['로그인실패횟수']) || 0) + 1;
    if (fails >= SECURITY.MAX_LOGIN_FAIL) {
      const until = new Date(now.getTime() + SECURITY.LOCK_MINUTES * 60000);
      updateRow_(accounts, account, { '로그인실패횟수': 0, '잠금해제시각': until });
      fail_('로그인을 ' + SECURITY.MAX_LOGIN_FAIL + '회 실패해 ' + SECURITY.LOCK_MINUTES + '분간 잠겼습니다. ' + fmt_(until, 'HH:mm') + ' 이후에 다시 시도해 주세요.', 'LOCKED');
    }
    updateRow_(accounts, account, { '로그인실패횟수': fails });
    fail_(GENERIC);
  }

  // 비밀번호가 맞은 뒤에 상태 확인
  if (isYes_(account['임시비밀번호여부'])) {
    const exp = account['임시비밀번호만료일'];
    if (exp instanceof Date && exp < now) {
      fail_('임시 비밀번호의 유효기간(' + SECURITY.TEMP_PASSWORD_DAYS + '일)이 지났습니다. 학원에 재발급을 요청해 주세요.', 'TEMP_EXPIRED');
    }
  }
  const ctxNew = buildContext_(loginId, account, accounts, '');

  updateRow_(accounts, account, { '로그인실패횟수': 0, '잠금해제시각': '', '최근로그인일시': now });
  const token = createSession_(loginId, data.device);
  return { token: token, me: buildMe_(ctxNew) };
}

function apiLogout_(ctx) {
  deleteSessions_(ctx.loginId, { onlyTokenHash: ctx.tokenHash });
  return { done: true };
}

function apiGetMe_(ctx) {
  return buildMe_(ctx);
}

function apiChangePassword_(ctx, data) {
  const current = String(data.currentPassword || '');
  const next = String(data.newPassword || '');
  const account = findAccountRow_(readTable_(SHEET.ACCOUNTS), ctx.loginId);   // 비밀번호는 기억 말고 시트에서
  if (!account || !verifyPassword_(account, current)) fail_('현재 비밀번호가 올바르지 않습니다.');
  checkPasswordRule_(next, ctx.isAdmin);
  if (next === current) fail_('현재와 다른 비밀번호를 입력해 주세요.');
  if (next.indexOf(ctx.loginId) >= 0) fail_('비밀번호에 휴대폰 번호를 넣을 수 없습니다.');

  setAccountPassword_(ctx.loginId, next, false);
  // 다른 기기의 로그인은 모두 해제하고, 지금 기기만 유지
  deleteSessions_(ctx.loginId, { keepTokenHash: ctx.tokenHash });
  ctx.mustChangePassword = false;
  return { done: true, me: buildMe_(ctx) };
}

/**
 * 비밀번호 재설정 요청 (기능 A-5, 알림 H-6)
 * - ID가 있든 없든 같은 안내를 돌려줍니다(가입 여부 노출 방지).
 * - 같은 ID는 1시간에 한 번만 원장님께 알림톡을 보냅니다. 하루 발송 상한도 있습니다(비용 보호).
 */
function apiRequestPasswordReset_(ctx, data) {
  const loginId = normalizeLoginId_(data.loginId);
  if (!isValidLoginId_(loginId)) fail_('휴대폰 번호를 숫자만 정확히 입력해 주세요. (예: 01012345678)');
  const DONE = { message: '요청이 접수되었습니다. 학원에서 확인 후 임시 비밀번호를 안내해 드릴게요.' };

  const cache = CacheService.getScriptCache();
  if (cache.get('reset_' + loginId)) return DONE;   // 최근 1시간 내 이미 요청함
  cache.put('reset_' + loginId, '1', SECURITY.RESET_COOLDOWN_SEC);

  const members = readTable_(SHEET.MEMBERS).rows
    .filter(function (r) { return normalizeLoginId_(r['로그인ID']) === loginId; })
    .map(memberFromRow_);
  const hasAccount = !!findAccountRow_(readTable_(SHEET.ACCOUNTS), loginId);
  const names = members.map(function (m) { return m.name; }).join('·');

  appendRow_(SHEET.RESET_REQ, {
    '요청ID': newId_('R'),
    '입력ID': loginId,
    '해당회원': names || '(등록되지 않은 번호)',
    '요청일시': new Date(),
    '상태': '접수',
    '비고': hasAccount ? '' : '계정 없음'
  });

  // 등록된 회원 번호일 때만 원장님께 알림톡
  if (members.length) {
    const props = PropertiesService.getScriptProperties();
    const countKey = 'RESET_ALIMTALK_' + todayKey_();
    const count = Number(props.getProperty(countKey) || 0);
    if (count < SECURITY.RESET_DAILY_ALIMTALK_CAP) {
      props.setProperty(countKey, String(count + 1));
      const adminPhone = props.getProperty('ADMIN_PHONE');
      sendAlimtalk_('H-6 비밀번호 재설정 요청', adminPhone, props.getProperty('TEMPLATE_RESET_REQUEST'), {
        '#{이름}': names,
        '#{아이디}': formatPhone_(loginId),
        '#{요청일시}': fmt_(new Date(), 'yyyy-MM-dd HH:mm')
      }, { isAdminNotice: true });
    } else {
      console.warn('재설정 요청 알림톡 하루 상한 도달. 앱 관리 화면에서 요청을 확인하세요.');
    }
  }
  return DONE;
}
