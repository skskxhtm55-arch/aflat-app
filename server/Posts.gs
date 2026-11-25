// =====================================================================
// [Posts.gs] 소식 게시판 (기능 G-1 공지사항 / B-1 홈)
// ---------------------------------------------------------------------
// - 누구나(로그인 없이도) 볼 수 있고, 원장(관리자)만 쓰기·수정·삭제할 수 있습니다.
// - 분류는 '소식' 하나입니다. 글과 링크만 지원합니다(이미지는 추후).
// - 글은 '소식' 시트에 한 줄씩 저장됩니다. 시트에서 직접 고쳐도 됩니다.
//   · 상단고정 = Y 이면 목록 맨 위에 보입니다.
//   · 삭제하면 줄을 지우지 않고 삭제여부 = Y 로 표시합니다(실수 복구용).
//     되살리려면 시트에서 삭제여부를 비우면 됩니다.
// - 목록은 1분간 기억합니다. 시트를 직접 고쳤다면 최대 1분 뒤 앱에 보입니다.
// =====================================================================

const POSTS_LIST_LIMIT = 50;        // 목록에 보여줄 최대 글 수 (고정 글 제외)
const POST_TITLE_MAX = 100;         // 제목 최대 글자 수
const POST_BODY_MAX = 5000;         // 내용 최대 글자 수
const POSTS_CACHE_KEY = 'posts_list';

/** 소식 시트를 읽어 화면용 형태로 (삭제된 글 제외, 고정 글 먼저 → 최신순) */
function loadPosts_() {
  const sh = ss_().getSheetByName(SHEET.POSTS);
  if (!sh) return [];   // 아직 '시트 구조 만들기'를 안 했으면 빈 목록
  return readTable_(SHEET.POSTS).rows
    .filter(function (r) { return String(r['소식ID']).trim() && !isYes_(r['삭제여부']); })
    .map(function (r) {
      const created = postTime_(r['작성일시']);
      return {
        id: String(r['소식ID']).trim(),
        title: unsafeText_(String(r['제목'] || '').trim()),
        body: unsafeText_(String(r['내용'] || '')),
        pinned: isYes_(r['상단고정']),
        createdMs: isNaN(created.getTime()) ? 0 : created.getTime(),
        dateText: isNaN(created.getTime()) ? '' : fmt_(created, 'yyyy.MM.dd'),
        _row: r
      };
    })
    .sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdMs - a.createdMs;
    });
}

/** 작성일시 칸 읽기: 'yyyy-MM-dd HH:mm(:ss)' 글자 또는 시트가 바꾼 날짜 값 모두 처리 */
function postTime_(v) {
  if (v instanceof Date) return v;
  const m = String(v || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return new Date(NaN);
  const p = function (x) { return ('0' + (x || '0')).slice(-2); };
  return Utilities.parseDate(m[1] + '-' + p(m[2]) + '-' + p(m[3]) + ' ' + p(m[4]) + ':' + p(m[5]) + ':' + p(m[6]), TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** 목록: 제목·날짜·고정 여부만 (내용은 상세에서) */
function apiListPosts_() {
  const cached = cacheGetJson_(POSTS_CACHE_KEY);
  if (cached) return cached;
  const all = loadPosts_();
  const pinned = all.filter(function (p) { return p.pinned; });
  const others = all.filter(function (p) { return !p.pinned; }).slice(0, POSTS_LIST_LIMIT);
  const list = pinned.concat(others).map(function (p) {
    return { id: p.id, title: p.title, pinned: p.pinned, dateText: p.dateText };
  });
  cachePutJson_(POSTS_CACHE_KEY, list, 60);
  return list;
}

/** 상세 */
function apiGetPost_(ctx, data) {
  const id = String(data.id || '').trim();
  const p = loadPosts_().filter(function (x) { return x.id === id; })[0];
  if (!p) fail_('삭제되었거나 없는 소식입니다.', 'NOT_FOUND');
  return { id: p.id, title: p.title, body: p.body, pinned: p.pinned, dateText: p.dateText };
}

/** 입력 검사 */
function cleanPostInput_(data) {
  const title = String(data.title || '').trim();
  const body = String(data.body || '').replace(/\r\n/g, '\n').trim();
  if (!title) fail_('제목을 입력해 주세요.');
  if (!body) fail_('내용을 입력해 주세요.');
  if (title.length > POST_TITLE_MAX) fail_('제목은 ' + POST_TITLE_MAX + '자까지 쓸 수 있습니다.');
  if (body.length > POST_BODY_MAX) fail_('내용은 ' + POST_BODY_MAX + '자까지 쓸 수 있습니다.');
  // 시트가 '='로 시작하는 글을 수식으로 바꾸지 않도록 앞에 작은따옴표를 붙여 저장
  const safe = function (s) { return /^[=+\-@]/.test(s) ? "'" + s : s; };
  return { title: safe(title), body: safe(body), pinned: !!data.pinned };
}

/** 새 글 또는 수정 (원장 전용). data: { id?(수정 시), title, body, pinned } */
function apiAdminSavePost_(ctx, data) {
  const v = cleanPostInput_(data);
  const now = fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss');
  const id = String(data.id || '').trim();
  sheet_(SHEET.POSTS);   // 시트가 없으면 안내
  if (id) {
    const table = readTable_(SHEET.POSTS);
    const row = table.rows.filter(function (r) { return String(r['소식ID']).trim() === id && !isYes_(r['삭제여부']); })[0];
    if (!row) fail_('삭제되었거나 없는 소식입니다.', 'NOT_FOUND');
    updateRow_(table, row, { '제목': v.title, '내용': v.body, '상단고정': v.pinned ? 'Y' : 'N', '수정일시': now });
  } else {
    appendRow_(SHEET.POSTS, {
      '소식ID': newId_('P'), '제목': v.title, '내용': v.body, '상단고정': v.pinned ? 'Y' : 'N',
      '작성일시': now, '수정일시': '', '작성자': ctx.loginId, '삭제여부': ''
    });
  }
  cacheRemove_(POSTS_CACHE_KEY);
  return { saved: true };
}

/** 삭제 (원장 전용). 줄은 남기고 삭제여부 = Y */
function apiAdminDeletePost_(ctx, data) {
  const id = String(data.id || '').trim();
  const table = readTable_(SHEET.POSTS);
  const row = table.rows.filter(function (r) { return String(r['소식ID']).trim() === id && !isYes_(r['삭제여부']); })[0];
  if (!row) fail_('삭제되었거나 없는 소식입니다.', 'NOT_FOUND');
  updateRow_(table, row, { '삭제여부': 'Y', '수정일시': fmt_(new Date(), 'yyyy-MM-dd HH:mm:ss') });
  cacheRemove_(POSTS_CACHE_KEY);
  return { deleted: true };
}

/** 저장할 때 붙인 작은따옴표(수식 방지)가 남아 있으면 떼고 보여줍니다. */
function unsafeText_(s) {
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}
