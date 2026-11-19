// =====================================================================
// [Util.gs] 공통 도구: 오류 처리, 시트 읽기/쓰기, 날짜, 캐시
// =====================================================================

/**
 * 사용자에게 그대로 보여줘도 되는 오류.
 * code 예시: 'AUTH'(로그인 필요), 'LOCKED', 'FORBIDDEN', 'MUST_CHANGE_PASSWORD', 'BOOKING', 'CONFIG'
 */
class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || 'ERROR';
  }
}

/** 사용자에게 보여줄 오류를 냅니다. */
function fail_(message, code) {
  throw new AppError(message, code);
}

// ---------------------------------------------------------------------
// 스프레드시트
// ---------------------------------------------------------------------

/**
 * 사용할 스프레드시트.
 * 기본은 이 스크립트가 연결된(컨테이너) 스프레드시트입니다.
 * 스크립트 속성 SPREADSHEET_ID 가 있으면 그 시트를 씁니다(특별한 경우에만).
 */
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) fail_("'" + name + "' 시트가 없습니다. 관리자에게 문의해 주세요.", 'CONFIG');
  return sh;
}

/**
 * 시트 전체를 읽어 [{열이름: 값, _row: 행번호}] 형태로 돌려줍니다.
 * 빈 줄은 건너뜁니다.
 */
function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(function (v) { return v === '' || v === null; })) continue;
    const obj = { _row: i + 1 };
    headers.forEach(function (h, j) { if (h) obj[h] = r[j]; });
    rows.push(obj);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

/** 시트 맨 아래에 한 줄 추가. obj 의 키는 열 이름입니다. */
function appendRow_(name, obj) {
  const sh = sheet_(name);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const row = sh.getLastRow() + 1;
  const textCols = TEXT_COLUMNS[name] || [];
  headers.forEach(function (h, j) {
    if (textCols.indexOf(h) >= 0) sh.getRange(row, j + 1).setNumberFormat('@');
  });
  const values = headers.map(function (h) {
    const v = obj[h];
    return v === undefined || v === null ? '' : v;
  });
  sh.getRange(row, 1, 1, headers.length).setValues([values]);
  return row;
}

/** readTable_ 로 읽은 한 줄의 일부 열만 고칩니다. changes = {열이름: 새값} */
function updateRow_(table, rowObj, changes) {
  const textCols = TEXT_COLUMNS[table.sheet.getName()] || [];
  Object.keys(changes).forEach(function (key) {
    const col = table.headers.indexOf(key) + 1;
    if (col <= 0) throw new Error("'" + table.sheet.getName() + "' 시트에 '" + key + "' 열이 없습니다.");
    const cell = table.sheet.getRange(rowObj._row, col);
    if (textCols.indexOf(key) >= 0) cell.setNumberFormat('@');
    cell.setValue(changes[key] === null || changes[key] === undefined ? '' : changes[key]);
    rowObj[key] = changes[key];
  });
}

/** 여러 줄 삭제 (아래 줄부터 지워야 행 번호가 꼬이지 않습니다) */
function deleteRows_(table, rowObjs) {
  rowObjs.map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (rowNum) { table.sheet.deleteRow(rowNum); });
}

// ---------------------------------------------------------------------
// 값 정리
// ---------------------------------------------------------------------

/**
 * 휴대폰 번호(로그인ID)를 숫자만 남긴 형태로 정리합니다.
 * 시트에서 숫자로 바뀌어 앞의 0이 빠진 경우(1012345678)도 되살립니다.
 */
function normalizeLoginId_(v) {
  let s = String(v == null ? '' : v).replace(/[^0-9]/g, '');
  if (s.length === 10 && s.charAt(0) === '1') s = '0' + s;
  return s;
}

function isValidLoginId_(s) {
  return /^01\d{8,9}$/.test(s);
}

/** 01012345678 → 010-1234-5678 (화면 표시용) */
function formatPhone_(s) {
  s = normalizeLoginId_(s);
  if (s.length === 11) return s.slice(0, 3) + '-' + s.slice(3, 7) + '-' + s.slice(7);
  if (s.length === 10) return s.slice(0, 3) + '-' + s.slice(3, 6) + '-' + s.slice(6);
  return s;
}

/** '예', 'Y', 체크박스 TRUE 등을 참으로 봅니다. */
function isYes_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return ['Y', 'YES', '예', 'O', 'TRUE', '1'].indexOf(s) >= 0;
}

/** '아니오', 'N', 체크박스 FALSE 등을 거짓으로 봅니다. (빈칸은 거짓이 아님) */
function isNo_(v) {
  if (v === false) return true;
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return ['N', 'NO', '아니오', 'X', 'FALSE', '0', '미사용'].indexOf(s) >= 0;
}

// ---------------------------------------------------------------------
// 날짜 (모든 계산은 한국 시간 기준)
// ---------------------------------------------------------------------

function fmt_(date, pattern) {
  return Utilities.formatDate(date, TZ, pattern);
}

/** 오늘 날짜 글자 'yyyy-MM-dd' */
function todayKey_() {
  return fmt_(new Date(), 'yyyy-MM-dd');
}

/** 지금 시각을 0시부터의 분으로 */
function nowMinutes_() {
  const hm = fmt_(new Date(), 'HH:mm').split(':');
  return parseInt(hm[0], 10) * 60 + parseInt(hm[1], 10);
}

/** 'yyyy-MM-dd' → 그날 0시 Date. 형식이 틀리면 null */
function dateFromKey_(key) {
  const m = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return fmt_(d, 'yyyy-MM-dd') === key ? d : null;
}

/** 'yyyy-MM-dd' 에 n일 더하기 */
function addDaysKey_(key, n) {
  const d = dateFromKey_(key);
  d.setDate(d.getDate() + n);
  return fmt_(d, 'yyyy-MM-dd');
}

/** 예약 가능한 날짜 목록 (오늘 ~ 오늘+예약가능일수-1) */
function bookableDates_(settings) {
  const today = todayKey_();
  const list = [];
  for (let i = 0; i < settings.bookableDays; i++) list.push(addDaysKey_(today, i));
  return list;
}

/** 알림톡용 날짜 글자. 예) 2026년 11월 20일 (금) — 현행 형식과 동일 */
function koreanDateText_(key) {
  const d = dateFromKey_(key);
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return fmt_(d, 'yyyy년 MM월 dd일') + ' (' + days[d.getDay()] + ')';
}

// ---------------------------------------------------------------------
// 캐시 (잠시 기억해 두어 속도를 높임. 최대 6시간)
// ---------------------------------------------------------------------

function cacheGetJson_(key) {
  try {
    const v = CacheService.getScriptCache().get(key);
    return v ? JSON.parse(v) : null;
  } catch (e) {
    return null;
  }
}

function cachePutJson_(key, obj, seconds) {
  if (!(seconds > 0)) return;
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(obj), Math.min(seconds, 21600));
  } catch (e) {
    console.warn('캐시 저장 실패(무시해도 됨): ' + e);
  }
}

function cacheRemove_(keys) {
  try {
    CacheService.getScriptCache().removeAll([].concat(keys));
  } catch (e) {
    console.warn('캐시 삭제 실패: ' + e);
  }
}

// ---------------------------------------------------------------------
// 암호·무작위 값
// ---------------------------------------------------------------------

/** 글자를 SHA-256 으로 바꾼 16진수 글자 */
function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytesToHex_(bytes);
}

function bytesToHex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

/** 예측 불가능한 무작위 글자 (구글의 보안 난수 기반 UUID 사용) */
function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

/** 예측 불가능한 숫자 n자리 */
function randomDigits_(n) {
  let out = '';
  while (out.length < n) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    for (let i = 0; i < hex.length && out.length < n; i++) {
      const v = parseInt(hex.charAt(i), 16);
      if (v < 10) out += String(v);   // 10~15는 버려서 0~9가 고르게 나오게 함
    }
  }
  return out;
}

/** 시간 순서대로 정렬되는 ID. 예) L20261119153012345 */
function newId_(prefix) {
  return prefix + fmt_(new Date(), 'yyyyMMddHHmmss') + randomDigits_(3);
}
