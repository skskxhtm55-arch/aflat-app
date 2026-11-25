// =====================================================================
// [app.js] 화면 로직
// ---------------------------------------------------------------------
// 화면은 주소의 # 뒤 이름으로 바뀝니다. (예: #home, #book, #my)
//   login     로그인               reset     비밀번호 재설정 요청
//   password  비밀번호 변경        home      홈 (B-1)
//   book      연습실 예약 (C-2)    my        내 예약 (C-4·C-5)
//   posts     소식 전체 (G-1)      post      소식 상세        postEdit  소식 쓰기·수정(원장)
//   more      더보기               admin     관리(원장 전용)
// 새 화면을 추가하려면 VIEWS 에 함수를 하나 추가하면 됩니다.
// =====================================================================
'use strict';

const S = {
  me: null,          // 로그인한 사람 정보 (서버 getMe 결과)
  ttDate: null,      // 마지막으로 본 날짜
  editing: null,     // 변경 중인 연습실 예약 (내 예약에서 '변경하기'를 누르면 채워짐)
  seq: 0,            // 화면 전환 번호 (늦게 도착한 응답이 다른 화면을 덮어쓰지 않게)
  installPrompt: null
};

const VIEWS = {
  login: viewLogin, reset: viewReset, password: viewChangePassword,
  home: viewHome, posts: viewPosts, post: viewPost, postEdit: viewPostEdit, book: viewBook, my: viewMy, more: viewMore, admin: viewAdmin
};
const PUBLIC_VIEWS = ['login', 'reset'];            // 로그인하지 않은 사람 전용 (로그인하면 홈으로)
const OPEN_VIEWS = ['home', 'posts', 'post'];        // 로그인 없이도 볼 수 있는 화면 (소식은 비회원 공개)
const TAB_OF = { posts: 'home', post: 'home', postEdit: 'home' };   // 하단 탭 표시용

// ---------------------------------------------------------------------
// 작은 도구들
// ---------------------------------------------------------------------
const $ = function (sel, root) { return (root || document).querySelector(sel); };
const $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

/** 글자를 화면에 안전하게 넣기 (이름 등에 < > 가 있어도 깨지지 않게) */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function minToHHMM(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function hhmmToMin(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : NaN;
}
function dateLabel(key) {
  const p = key.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return p[1] + '/' + p[2] + '(' + '일월화수목금토'.charAt(d.getDay()) + ')';
}
/** 룸 이름 표시: b → ♭ (현행과 동일) */
function roomLabel(name) { return String(name).replace(/b/g, '♭'); }
/** 한국 시간 기준 오늘 날짜·현재 분 */
function seoulNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const get = function (t) { return (parts.filter(function (p) { return p.type === t; })[0] || {}).value; };
  return { date: get('year') + '-' + get('month') + '-' + get('day'), min: (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10) };
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('show'); }, 2600);
}

function setView(html, opts) {
  const v = $('#view');
  v.innerHTML = html;
  v.classList.toggle('no-nav', !!(opts && opts.noNav));
  window.scrollTo(0, 0);
}

function showModal(html) {
  const m = $('#modal');
  m.innerHTML = '<div class="modal-box">' + html + '</div>';
  m.hidden = false;
  return m;
}
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(function () { toast('복사했습니다.'); });
  }
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('복사했습니다.'); } catch (e) { toast('복사하지 못했습니다. 직접 선택해 주세요.'); }
  ta.remove();
  return Promise.resolve();
}

/** 버튼을 누르는 동안 비활성화 + 문구 바꾸기 */
async function withBusy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); } finally { btn.disabled = false; btn.textContent = old; }
}

/** 내 정보를 바꾸고 휴대폰에 보관 */
function setMe(me) {
  S.me = me;
  if (me && !me.mustChangePassword) Api.store.set('me', me);
}

/** 화면 모양에 영향을 주는 내 정보만 비교 (바뀌었으면 화면을 다시 그림) */
function meShape(me) {
  return me ? JSON.stringify([me.displayName, me.isAdmin, me.mustChangePassword, me.students, me.settings, me.dates]) : '';
}

/**
 * [속도 개선 P2] 보관해 둔 내 정보로 먼저 화면을 띄운 뒤, 뒤에서 최신 내 정보를 받아 확인
 * - 로그인이 풀렸으면 call() 이 로그인 화면으로 보냄
 * - 회원 정보(휴원 전환 등)가 바뀌었으면 지금 화면을 다시 그림
 */
async function refreshMeInBackground() {
  try {
    const before = meShape(S.me);
    const me = await call('getMe');
    setMe(me);
    if (meShape(me) !== before) render();
  } catch (e) {
    /* 통신 오류면 보관본으로 계속 사용 (각 화면의 요청이 따로 오류를 보여줌) */
  }
}

/**
 * 서버 호출 (로그인 만료 등 공통 처리 포함)
 * 로그인이 풀렸으면 로그인 화면으로 보내고, 호출한 쪽에는 handled 표시가 된 오류를 던집니다.
 */
async function call(action, data) {
  try {
    return await Api.call(action, data);
  } catch (e) {
    if (e.code === 'AUTH') {
      Api.setToken(''); S.me = null;
      toast(e.message); go('login');
      e.handled = true;
    } else if (e.code === 'MUST_CHANGE_PASSWORD') {
      if (S.me) S.me.mustChangePassword = true;
      go('password');
      e.handled = true;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------
// 화면 전환
// ---------------------------------------------------------------------
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const i = h.indexOf('?');
  return { name: i >= 0 ? h.slice(0, i) : h, params: new URLSearchParams(i >= 0 ? h.slice(i + 1) : '') };
}

function go(hash) {
  if (location.hash === '#' + hash) render();
  else location.hash = hash;
}

function render() {
  const r = parseRoute();
  let name = r.name;
  if (!S.me) {
    if (PUBLIC_VIEWS.indexOf(name) < 0 && OPEN_VIEWS.indexOf(name) < 0) return go('login');
  } else {
    if (S.me.mustChangePassword && name !== 'password') return go('password');
    if (PUBLIC_VIEWS.indexOf(name) >= 0 || !VIEWS[name]) return go('home');
    if ((name === 'admin' || name === 'postEdit') && !S.me.isAdmin) return go('home');
  }
  closeModal();
  const showNav = !!S.me && !S.me.mustChangePassword;
  $('#nav').hidden = !showNav;
  $('#navAdmin').hidden = !(S.me && S.me.isAdmin);
  $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === (TAB_OF[name] || name)); });
  S.seq++;
  VIEWS[name](r.params, S.seq);
}

/** 화면이 바뀌었는지 확인 (응답이 늦게 왔을 때 사용) */
function stale(seq) { return seq !== S.seq; }

function errorBox(e) {
  return '<div class="msg err">' + esc(e && e.message ? e.message : '오류가 발생했습니다.') + '</div>';
}

// ---------------------------------------------------------------------
// 로그인 (A-1)
// ---------------------------------------------------------------------
function viewLogin() {
  setView(
    '<div class="auth">' +
    '<div class="page-head"><h2>♫ AFLAT 연습실 ♪</h2><p>에이플랫 뮤직 스튜디오</p></div>' +
    '<form id="f" class="card" autocomplete="on">' +
    '<label class="field"><span>아이디 (휴대폰 번호)</span>' +
    '<input class="input" id="loginId" name="username" type="tel" inputmode="numeric" autocomplete="username" placeholder="01012345678" required></label>' +
    '<label class="field"><span>비밀번호</span>' +
    '<input class="input" id="pw" name="password" type="password" autocomplete="current-password" required></label>' +
    '<div class="msg err" id="err"></div>' +
    '<button class="btn primary" type="submit">로그인</button>' +
    '</form>' +
    '<a class="link" href="#reset">비밀번호를 잊으셨나요?</a>' +
    '<a class="link" href="#home">로그인 없이 학원 소식 보기</a>' +
    '</div>', { noNav: true });

  $('#f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    const btn = $('#f button');
    $('#err').textContent = '';
    withBusy(btn, '확인 중...', async function () {
      try {
        const r = await Api.call('login', {
          loginId: $('#loginId').value, password: $('#pw').value, device: navigator.userAgent.slice(0, 120)
        });
        Api.setToken(r.token);
        setMe(r.me);
        go(r.me.mustChangePassword ? 'password' : 'home');
      } catch (e) {
        $('#err').textContent = e.message;
      }
    });
  });
}

// ---------------------------------------------------------------------
// 비밀번호 재설정 요청 (A-5)
// ---------------------------------------------------------------------
function viewReset() {
  setView(
    '<div class="auth">' +
    '<div class="page-head"><h2>비밀번호 재설정 요청</h2><p>학원에서 확인 후 임시 비밀번호를 알려드려요</p></div>' +
    '<form id="f" class="card">' +
    '<label class="field"><span>아이디 (휴대폰 번호)</span>' +
    '<input class="input" id="loginId" type="tel" inputmode="numeric" placeholder="01012345678" required></label>' +
    '<div class="msg err" id="err"></div><div class="msg ok" id="ok"></div>' +
    '<button class="btn primary" type="submit">요청하기</button>' +
    '</form>' +
    '<a class="link" href="#login">로그인 화면으로</a>' +
    '</div>', { noNav: true });

  $('#f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('#err').textContent = ''; $('#ok').textContent = '';
    withBusy($('#f button'), '요청 중...', async function () {
      try {
        const r = await Api.call('requestPasswordReset', { loginId: $('#loginId').value });
        $('#ok').textContent = r.message;
      } catch (e) {
        $('#err').textContent = e.message;
      }
    });
  });
}

// ---------------------------------------------------------------------
// 비밀번호 변경 (A-4, 첫 로그인 시 강제)
// ---------------------------------------------------------------------
function viewChangePassword() {
  const must = S.me.mustChangePassword;
  const minLen = S.me.passwordMinLength || 8;
  setView(
    '<div class="auth">' +
    '<div class="page-head"><h2>' + (must ? '새 비밀번호 설정' : '비밀번호 변경') + '</h2>' +
    '<p>' + (must ? '처음 로그인하셨어요. 사용할 비밀번호를 정해 주세요.' : esc(S.me.loginIdText)) + '</p></div>' +
    '<form id="f" class="card" autocomplete="on">' +
    '<input type="text" name="username" autocomplete="username" value="' + esc(S.me.loginId) + '" hidden>' +
    '<label class="field"><span>' + (must ? '임시 비밀번호' : '현재 비밀번호') + '</span>' +
    '<input class="input" id="cur" type="password" autocomplete="current-password" required></label>' +
    '<label class="field"><span>새 비밀번호</span>' +
    '<input class="input" id="new1" type="password" autocomplete="new-password" required>' +
    '<small>' + minLen + '자 이상, 영문과 숫자를 모두 넣어 주세요.</small></label>' +
    '<label class="field"><span>새 비밀번호 확인</span>' +
    '<input class="input" id="new2" type="password" autocomplete="new-password" required></label>' +
    '<div class="msg err" id="err"></div>' +
    '<button class="btn primary" type="submit">변경하기</button>' +
    '</form>' +
    (must ? '<a class="link" href="javascript:void(0)" id="out">로그아웃</a>' : '<a class="link" href="#more">취소</a>') +
    '</div>', { noNav: must });

  if (must) $('#out').addEventListener('click', logout);
  $('#f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    const err = $('#err');
    err.textContent = '';
    const n1 = $('#new1').value, n2 = $('#new2').value;
    if (n1.length < minLen) { err.textContent = '새 비밀번호는 ' + minLen + '자 이상이어야 합니다.'; return; }
    if (!/[A-Za-z]/.test(n1) || !/[0-9]/.test(n1)) { err.textContent = '영문과 숫자를 모두 넣어 주세요.'; return; }
    if (n1 !== n2) { err.textContent = '새 비밀번호가 서로 다릅니다.'; return; }
    withBusy($('#f button'), '변경 중...', async function () {
      try {
        const r = await call('changePassword', { currentPassword: $('#cur').value, newPassword: n1 });
        setMe(r.me);
        toast('비밀번호를 변경했습니다.');
        go('home');
      } catch (e) {
        if (!e.handled) err.textContent = e.message;
      }
    });
  });
}

async function logout() {
  try { await Api.call('logout'); } catch (e) { /* 이미 만료되었어도 기기에서는 지움 */ }
  Api.setToken('');
  S.me = null;
  go('login');
}

// ---------------------------------------------------------------------
// 연습실 시간표 (C-1) — 현행 Index.html 과 같은 표
// ---------------------------------------------------------------------
/** 시간표 표 HTML. pick = { start, end } 를 주면 그 구간을 노랗게 표시(예약 화면용) */
function timetableHtml(tt, pick, inline) {
  if (!tt.rooms.length) return '<div class="msg info">조회 가능한 연습실이 없습니다. 🌱</div>';
  let html = '<div class="tt-wrap' + (inline ? ' inline' : '') + '"><table class="timetable"><thead><tr><th class="time-col">시간</th>';
  tt.rooms.forEach(function (r) { html += '<th>' + esc(roomLabel(r.name)) + '</th>'; });
  html += '</tr></thead><tbody>';
  for (let m = tt.openMin; m + 30 <= tt.closeMin; m += 30) {
    const picked = pick && pick.start < m + 30 && pick.end > m;
    html += '<tr><td class="time-col' + (picked ? ' cell-pick' : '') + '">' + minToHHMM(m) + '</td>';
    tt.rooms.forEach(function (r) {
      const booked = r.busy.some(function (b) { return b[0] < m + 30 && b[1] > m; });
      html += booked ? '<td class="cell-booked">마감</td>' : '<td class="cell-available"></td>';
    });
    html += '</tr>';
  }
  return html + '</tbody></table></div>';
}

function dateChipsHtml(dates, selected) {
  return '<div class="chips" id="dates">' + dates.map(function (d) {
    return '<button type="button" class="chip' + (d === selected ? ' on' : '') + '" data-date="' + d + '">' + dateLabel(d) + '</button>';
  }).join('') + '</div>';
}

function pickDate(params) {
  const dates = S.me.dates;
  let d = params.get('date') || S.ttDate || dates[0];
  if (dates.indexOf(d) < 0) d = dates[0];
  S.ttDate = d;
  return d;
}

// ---------------------------------------------------------------------
// 홈 (B-1) — 소식 게시판은 다음 단계에서 추가
// ---------------------------------------------------------------------
async function viewHome(params, seq) {
  const guest = !S.me;
  const isAdmin = !!(S.me && S.me.isAdmin);
  setView(
    '<div class="page-head"><h2>♫ AFLAT MUSIC STUDIO ♪</h2><p>' +
      (guest ? '에이플랫 뮤직 스튜디오' : esc(S.me.displayName || '') + '님, 반가워요!') + '</p></div>' +
    '<div class="section-row"><h3 class="section-title">소식</h3>' +
      (isAdmin ? '<a class="btn small" href="#postEdit">+ 소식 쓰기</a>' : '') + '</div>' +
    '<div id="posts"><div class="loading">불러오는 중...</div></div>' +
    (guest
      ? '<a class="btn primary" href="#login">로그인</a>'
      : '<h3 class="section-title">내 다음 일정</h3><div id="next"><div class="loading">불러오는 중...</div></div>'),
    { noNav: guest });

  loadPostList(seq, HOME_POSTS);
  if (guest) return;
  // 다가오는 일정(연습실 예약 + 레슨) 중 가장 가까운 2건
  const drawNext = function (r, isOld) {
    const next = r.upcoming.slice(0, 2);
    $('#next').innerHTML = '<div class="card' + (isOld ? ' stale' : '') + '">' +
      (next.length ? next.map(function (b) { return bookingRowHtml(b, r.multipleStudents); }).join('')
                   : '<div class="sub">다가오는 일정이 없어요.</div>') + '</div>' +
      (isOld ? '<div class="updating">최신 일정 확인 중...</div>' : '');
  };
  const saved = Api.store.get('myBookings');
  if (saved) drawNext(saved, true);   // 보관본 먼저
  try {
    const r = await call('getMyBookings');
    if (stale(seq)) return;
    Api.store.set('myBookings', r);
    drawNext(r, false);
    if (Api.perf) Perf.mark('홈 - 내 다음 일정 표시 완료');
  } catch (e) {
    if (!e.handled && !stale(seq)) $('#next').innerHTML = errorBox(e);
  }
}

// ---------------------------------------------------------------------
// 소식 (G-1) — 누구나 보기, 원장만 쓰기·수정·삭제. 글과 링크만.
// ---------------------------------------------------------------------
const HOME_POSTS = 5;   // 홈에 보여줄 소식 수 (넘으면 '소식 전체 보기')

/** 소식 목록을 #posts 칸에 그립니다. limit 이 있으면 그 수만큼만 (보관본이 있으면 먼저 보여줌) */
async function loadPostList(seq, limit) {
  const saved = Api.store.get('posts');
  if (saved) drawPostList(saved, limit, true);
  try {
    const list = await call('listPosts');
    if (stale(seq)) return;
    Api.store.set('posts', list);
    drawPostList(list, limit, false);
    if (Api.perf) Perf.mark('소식 목록 표시 완료');
  } catch (e) {
    if (!e.handled && !stale(seq)) $('#posts').innerHTML = errorBox(e);
  }
}

function drawPostList(list, limit, isOld) {
    const shown = limit ? list.slice(0, limit) : list;
    $('#posts').innerHTML = '<div class="card' + (isOld ? ' stale' : '') + '">' +
      (shown.length ? shown.map(function (p) {
        return '<a class="item post-item" href="#post?id=' + encodeURIComponent(p.id) + '"><div>' +
          '<div class="main">' + (p.pinned ? '<span class="badge pin">고정</span>' : '') + esc(p.title) + '</div>' +
          '<div class="sub">' + esc(p.dateText) + '</div></div><span class="chev">›</span></a>';
      }).join('') : '<div class="sub">아직 소식이 없어요.</div>') + '</div>' +
      (limit && list.length > limit ? '<a class="link" href="#posts">소식 전체 보기 (' + list.length + '건)</a>' : '') +
      (isOld ? '<div class="updating">최신 소식 확인 중...</div>' : '');
}

function viewPosts(params, seq) {
  const isAdmin = !!(S.me && S.me.isAdmin);
  setView(
    '<div class="page-head"><h2>소식</h2><p>에이플랫 뮤직 스튜디오 소식이에요</p></div>' +
    (isAdmin ? '<a class="btn small" href="#postEdit">+ 소식 쓰기</a>' : '') +
    '<div id="posts"><div class="loading">불러오는 중...</div></div>' +
    '<a class="link" href="#home">← 홈으로</a>',
    { noNav: !S.me });
  loadPostList(seq, 0);
}

/** 글 내용 → 화면: 특수문자는 그대로 보이게 바꾸고, 줄바꿈 유지, http(s) 주소는 누르면 열리는 링크로 */
function postBodyHtml(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, function (url) {
    const tail = url.match(/[.,!?)\]]+$/);                 // 문장 끝 마침표·괄호는 링크에서 제외
    const clean = tail ? url.slice(0, -tail[0].length) : url;
    return '<a href="' + clean + '" target="_blank" rel="noopener noreferrer">' + clean + '</a>' + (tail ? tail[0] : '');
  }).replace(/\n/g, '<br>');
}

async function viewPost(params, seq) {
  const id = params.get('id') || '';
  const isAdmin = !!(S.me && S.me.isAdmin);
  setView('<div id="post"><div class="loading">불러오는 중...</div></div><a class="link" href="#home">← 홈으로</a>', { noNav: !S.me });
  try {
    const p = await call('getPost', { id: id });
    if (stale(seq)) return;
    $('#post').innerHTML =
      '<div class="card post">' +
      '<h2 class="post-title">' + (p.pinned ? '<span class="badge pin">고정</span>' : '') + esc(p.title) + '</h2>' +
      '<div class="sub">' + esc(p.dateText) + '</div>' +
      '<div class="post-body">' + postBodyHtml(p.body) + '</div></div>' +
      (isAdmin ? '<div class="btn-row"><a class="btn" href="#postEdit?id=' + encodeURIComponent(p.id) + '">수정</a>' +
                 '<button class="btn danger" id="del" type="button">삭제</button></div>' : '');
    if (isAdmin) {
      $('#del').addEventListener('click', function () {
        if (!confirm('이 소식을 삭제할까요?\n(소식 시트에서 삭제여부를 비우면 되살릴 수 있어요)')) return;
        withBusy($('#del'), '삭제 중...', async function () {
          try {
            await call('adminDeletePost', { id: p.id });
            Api.store.set('posts', null);
            toast('삭제했어요.');
            go('home');
          } catch (e) { if (!e.handled) toast(e.message); }
        });
      });
    }
  } catch (e) {
    if (!e.handled && !stale(seq)) $('#post').innerHTML = errorBox(e);
  }
}

async function viewPostEdit(params, seq) {
  const id = params.get('id') || '';
  setView(
    '<div class="page-head"><h2>' + (id ? '소식 수정' : '소식 쓰기') + '</h2><p>글과 링크(https://…)를 쓸 수 있어요</p></div>' +
    '<form id="f" class="card">' +
    '<label class="field"><span>제목</span><input class="input" id="title" maxlength="100" required></label>' +
    '<label class="field"><span>내용</span><textarea class="input" id="body" rows="10" maxlength="5000" required></textarea></label>' +
    '<label class="check"><input type="checkbox" id="pinned"> 상단 고정 (목록 맨 위에 보이기)</label>' +
    '<div class="msg err" id="err"></div>' +
    '<button class="btn primary" type="submit">' + (id ? '수정하기' : '올리기') + '</button>' +
    '</form>' +
    '<a class="link" href="' + (id ? '#post?id=' + encodeURIComponent(id) : '#home') + '">취소</a>');

  if (id) {
    try {
      const p = await call('getPost', { id: id });
      if (stale(seq)) return;
      $('#title').value = p.title; $('#body').value = p.body; $('#pinned').checked = p.pinned;
    } catch (e) {
      if (!e.handled && !stale(seq)) $('#err').textContent = e.message;
      return;
    }
  }
  $('#f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('#err').textContent = '';
    withBusy($('#f button'), '저장 중...', async function () {
      try {
        await call('adminSavePost', { id: id, title: $('#title').value, body: $('#body').value, pinned: $('#pinned').checked });
        Api.store.set('posts', null);
        toast(id ? '수정했어요.' : '소식을 올렸어요.');
        go(id ? 'post?id=' + encodeURIComponent(id) : 'home');
      } catch (e) { if (!e.handled) $('#err').textContent = e.message; }
    });
  });
}

/**
 * 예약할 수 없는 계정(휴원·원장 등)의 예약하기 탭: 이유를 안내하고 시간표만 보여줍니다.
 * (시간표 탭이 없어졌으므로 이 계정들도 여기서 연습실 현황을 볼 수 있어야 합니다)
 */
function viewTimetableOnly(params, seq, reasonsHtml) {
  const date = pickDate(params);
  setView(
    '<div class="page-head"><h2>♫ AFLAT 연습실 현황 ♪</h2><p>빈자리를 확인할 수 있어요</p></div>' +
    '<div class="msg err">' + reasonsHtml + '</div>' +
    dateChipsHtml(S.me.dates, date) +
    '<div id="tt"></div>');

  const load = async function (d) {
    S.ttDate = d;
    $$('#dates .chip').forEach(function (c) { c.classList.toggle('on', c.dataset.date === d); });
    $('#tt').innerHTML = '<div class="loading">시간표를 그리고 있어요... ⏳✨</div>';
    try {
      const tt = await call('getTimetable', { date: d });
      if (stale(seq) || S.ttDate !== d) return;
      S.me.dates = tt.dates;
      $('#tt').innerHTML = timetableHtml(tt, null, true);
    } catch (e) {
      if (!e.handled && !stale(seq)) $('#tt').innerHTML = errorBox(e);
    }
  };
  $('#dates').addEventListener('click', function (ev) {
    const b = ev.target.closest('.chip');
    if (b) load(b.dataset.date);
  });
  load(date);
}

// ---------------------------------------------------------------------
// 연습실 예약 (C-2)
// ---------------------------------------------------------------------
function viewBook(params, seq) {
  // 변경 모드: 내 예약에서 '변경하기'로 들어온 경우 (#book?edit=1)
  const edit = params.get('edit') && S.editing ? S.editing : null;
  if (!edit) S.editing = null;
  let students = S.me.students.filter(function (s) { return s.canBook; });
  if (edit) {
    students = students.filter(function (s) { return s.studentNo === edit.studentNo; });
    if (!students.length) {
      setView('<div class="page-head"><h2>예약 변경</h2></div><div class="msg err">지금은 이 수강생의 예약을 변경할 수 없어요. 취소만 가능해요.</div>' +
        '<a class="link" href="#my">← 내 예약으로</a>');
      return;
    }
  }
  if (!students.length) {
    const reasons = S.me.students.map(function (s) { return esc(s.name) + ': ' + esc(s.cannotBookReason); }).join('<br>');
    viewTimetableOnly(params, seq, reasons || '예약할 수 없는 계정입니다.');
    return;
  }
  const st = S.me.settings;
  const f = {
    student: students[0],
    instrument: students[0].instruments.length === 1 ? students[0].instruments[0] : '',
    date: pickDate(params),
    start: '',
    duration: 0
  };
  if (edit) {   // 기존 예약 내용으로 미리 채우기
    if (students[0].instruments.indexOf(edit.instrument) >= 0) f.instrument = edit.instrument;
    if (S.me.dates.indexOf(edit.date) >= 0) { f.date = edit.date; S.ttDate = edit.date; }
    f.start = edit.start;
    if (st.durations.indexOf(edit.duration) >= 0) f.duration = edit.duration;
  }
  let tt = null;   // 선택한 날짜의 시간표 + 내 사용량
  let submitErr = '';   // 서버가 예약을 거절한 사유. 선택을 바꾸기 전까지 계속 보여줌

  setView(
    (edit
      ? '<div class="page-head"><h2>예약 변경</h2><p>새 조건으로 다시 배정해요. 실패하면 기존 예약은 그대로예요</p></div>' +
        '<div class="msg info">변경 전: ' + esc(edit.dateText + ' ' + edit.timeText + ' ' + roomLabel(edit.roomText)) + '</div>'
      : '<div class="page-head"><h2>연습실 예약</h2><p>룸은 자동으로 배정돼요</p></div>') +
    '<form id="f" class="card">' +
    (students.length > 1
      ? '<div class="field"><span>수강생</span><div class="chips wrap" id="stuChips">' + students.map(function (s, i) {
          return '<button type="button" class="chip' + (i === 0 ? ' on' : '') + '" data-i="' + i + '">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>'
      : '<div class="field"><span>수강생</span>' + esc(students[0].name) + '</div>') +
    '<label class="field"><span>악기</span><select class="input" id="inst"></select></label>' +
    '<div class="field"><span>날짜</span>' + dateChipsHtml(S.me.dates, f.date) + '</div>' +
    '<label class="field"><span>시작 시각</span><input class="input" id="start" type="time" step="60" required>' +
    '<small>운영시간 ' + minToHHMM(st.openMin) + ' ~ ' + minToHHMM(st.closeMin) + ' · 분 단위로 입력할 수 있어요</small></label>' +
    '<div class="field"><span>이용 시간</span><div class="chips wrap" id="durs"></div></div>' +
    '<div class="msg info" id="usage"></div>' +
    '<div class="msg info" id="summary"></div>' +
    '<div class="msg err" id="err"></div>' +
    '<button class="btn primary" id="submit" type="submit" disabled>' + (edit ? '이대로 변경하기' : '예약하기') + '</button>' +
    '</form>' +
    (edit ? '<a class="link" href="#my">변경하지 않고 돌아가기</a>' : '') +
    '<h3 class="section-title">이 날의 연습실 현황</h3><div id="tt"></div>');
  if (edit) $('#start').value = f.start;

  function fillInstruments() {
    const sel = $('#inst');
    const list = f.student.instruments;
    sel.innerHTML = (list.length > 1 ? '<option value="">악기를 선택하세요</option>' : '') +
      list.map(function (x) { return '<option' + (x === f.instrument ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
    if (list.length === 1) f.instrument = list[0];
  }

  function usedMin() {
    if (!tt) return 0;
    const u = tt.myUsage.filter(function (x) { return x.studentNo === f.student.studentNo; })[0];
    let used = u ? u.usedMin : 0;
    // 변경 중이면 기존 예약 시간은 빼고 계산 (서버도 기존 예약은 없는 것으로 보고 검사)
    if (edit && f.date === edit.date && f.student.studentNo === edit.studentNo) used = Math.max(0, used - edit.duration);
    return used;
  }

  /** 선택 상태를 검사해 버튼·안내를 갱신 (불가능한 선택은 미리 막기) */
  function refresh() {
    const startMin = hhmmToMin(f.start);
    const remaining = Math.max(0, st.maxDailyMin - usedMin());
    const now = seoulNow();

    // 이용 시간 버튼: 남은 한도 초과 또는 운영 종료 시각을 넘으면 선택 불가
    $('#durs').innerHTML = st.durations.map(function (d) {
      const overLimit = d > remaining;
      const overClose = !isNaN(startMin) && startMin + d > st.closeMin;
      const disabled = overLimit || overClose;
      if (disabled && f.duration === d) f.duration = 0;
      return '<button type="button" class="chip' + (f.duration === d ? ' on' : '') + '" data-d="' + d + '"' +
        (disabled ? ' disabled title="' + (overLimit ? '하루 한도 초과' : '운영시간 초과') + '"' : '') + '>' + d + '분</button>';
    }).join('');

    $('#usage').textContent = tt
      ? f.student.name + ' · ' + dateLabel(f.date) + ' 남은 예약 가능 시간: ' + remaining + '분 (하루 최대 ' + st.maxDailyMin + '분)'
      : '';

    let err = '';
    if (!isNaN(startMin)) {
      // 오늘은 현재 시각에서 '지난시각허용분'(운영설정)만큼 이전 시각까지 예약 가능
      const grace = st.pastGraceMin || 0;
      if (f.date === now.date && startMin < now.min - grace) {
        err = grace > 0 ? '현재 시각 ' + grace + '분 전까지만 예약할 수 있어요.' : '이미 지난 시각이에요.';
      }
      else if (startMin < st.openMin || startMin >= st.closeMin) err = '운영시간(' + minToHHMM(st.openMin) + '~' + minToHHMM(st.closeMin) + ') 안에서 선택해 주세요.';
    }
    if (tt && remaining < Math.min.apply(null, st.durations)) err = '이 날은 하루 예약 한도(' + st.maxDailyMin + '분)를 모두 사용했어요.';
    $('#err').textContent = err || submitErr;

    const ready = f.instrument && !isNaN(startMin) && f.duration && !err && tt;
    $('#summary').textContent = ready
      ? '선택: ' + dateLabel(f.date) + ' ' + minToHHMM(startMin) + '~' + minToHHMM(startMin + f.duration) + ' (' + f.duration + '분) · ' + f.instrument
      : '';
    $('#submit').disabled = !ready;
    if (tt) $('#tt').innerHTML = timetableHtml(tt, ready ? { start: startMin, end: startMin + f.duration } : null, true);
  }

  async function loadDay() {
    tt = null;
    $('#tt').innerHTML = '<div class="loading">불러오는 중...</div>';
    refresh();
    const d = f.date;
    try {
      const r = await call('getTimetable', { date: d });
      if (stale(seq) || f.date !== d) return;
      tt = r;
      S.me.dates = r.dates;
      refresh();
    } catch (e) {
      if (!e.handled && !stale(seq)) $('#tt').innerHTML = errorBox(e);
    }
  }

  fillInstruments();
  // 수강생·악기·날짜·시각·이용시간 중 무엇이든 바꾸면 이전 거절 사유는 지웁니다.
  ['click', 'input', 'change'].forEach(function (type) {
    $('#f').addEventListener(type, function (ev) {
      if (ev.target.closest('.chip, input, select, button')) submitErr = '';
    }, true);
  });
  if ($('#stuChips')) {
    $('#stuChips').addEventListener('click', function (ev) {
      const b = ev.target.closest('.chip'); if (!b) return;
      f.student = students[Number(b.dataset.i)];
      f.instrument = '';
      $$('#stuChips .chip').forEach(function (c) { c.classList.toggle('on', c === b); });
      fillInstruments(); refresh();
    });
  }
  $('#inst').addEventListener('change', function () { f.instrument = this.value; refresh(); });
  $('#dates').addEventListener('click', function (ev) {
    const b = ev.target.closest('.chip'); if (!b) return;
    f.date = b.dataset.date; S.ttDate = f.date;
    $$('#dates .chip').forEach(function (c) { c.classList.toggle('on', c === b); });
    loadDay();
  });
  $('#start').addEventListener('input', function () { f.start = this.value; refresh(); });
  $('#durs').addEventListener('click', function (ev) {
    const b = ev.target.closest('.chip'); if (!b || b.disabled) return;
    f.duration = Number(b.dataset.d); refresh();
  });

  $('#f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    const startMin = hhmmToMin(f.start);
    const text = f.student.name + ' · ' + f.instrument + '\n' + dateLabel(f.date) + ' ' + minToHHMM(startMin) + '~' +
      minToHHMM(startMin + f.duration) + ' (' + f.duration + '분)\n\n' + (edit ? '이대로 변경할까요?' : '이대로 예약할까요?');
    if (!confirm(text)) return;
    withBusy($('#submit'), (edit ? '변경 중' : '예약 중') + '... (몇 초 걸려요)', async function () {
      try {
        const req = {
          studentNo: f.student.studentNo, instrument: f.instrument, date: f.date,
          start: minToHHMM(startMin), duration: f.duration
        };
        if (edit) req.ref = edit.ref;
        const r = await call(edit ? 'modifyBooking' : 'createBooking', req);
        Api.store.set('myBookings', null);
        if (stale(seq)) return;
        S.editing = null;
        showBookingDone(r);
      } catch (e) {
        if (e.handled || stale(seq)) return;
        // 시간표를 다시 불러오면 안내 칸이 새로 그려지므로, 사유를 따로 보관해 두고 계속 보여줍니다.
        submitErr = (edit ? '변경하지 못했어요(기존 예약은 그대로예요): ' : '예약하지 못했어요: ') + e.message;
        toast(submitErr);
        loadDay();   // 그 사이 바뀐 현황 다시 보여주기
      }
    });
  });

  loadDay();
}

function showBookingDone(r) {
  setView(
    '<div class="page-head"><h2>' + (r.changed ? '예약이 변경되었어요! 🎉' : '예약이 확정되었어요! 🎉') + '</h2><p>확정 알림톡도 보내드려요</p></div>' +
    (r.changed && r.oldText ? '<div class="msg info">변경 전: ' + esc(r.oldText) + '</div>' : '') +
    '<div class="card"><dl class="kv">' +
    '<dt>수강생</dt><dd>' + esc(r.studentName) + '</dd>' +
    '<dt>악기</dt><dd>' + esc(r.instrument) + '</dd>' +
    '<dt>날짜</dt><dd>' + esc(r.dateText) + '</dd>' +
    '<dt>예약 내역</dt><dd>' + r.segments.map(function (s) {
      return esc(s.start + '~' + s.end + ' ' + roomLabel(s.room));
    }).join('<br>') + '</dd>' +
    '</dl>' +
    (r.segments.length > 1 ? '<div class="msg info">빈 룸이 없어 중간에 룸을 한 번 옮기도록 배정했어요.</div>' : '') +
    '</div>' +
    '<div class="btn-row"><a class="btn" href="#my">내 예약 보기</a><a class="btn" href="#home">홈으로</a></div>');
}

// ---------------------------------------------------------------------
// 내 예약 (C-4)
// ---------------------------------------------------------------------
/** 내 예약에서 연습실 예약을 눌렀을 때: 변경하기 / 예약 취소 */
function openBookingActions(b, showName, onDone) {
  const m = showModal(
    '<h3>연습실 예약</h3>' +
    '<div class="card">' + bookingRowHtml(b, showName) + '</div>' +
    '<div class="sub">예약이 끝나기 전까지 변경·취소할 수 있어요.</div>' +
    '<div class="msg err" id="mErr"></div>' +
    '<div class="btn-col">' +
    '<button class="btn primary" id="mEdit" type="button">변경하기</button>' +
    '<button class="btn danger" id="mCancel" type="button">예약 취소</button>' +
    '<button class="btn" id="mClose" type="button">닫기</button></div>');
  $('#mClose', m).addEventListener('click', closeModal);
  $('#mEdit', m).addEventListener('click', function () {
    S.editing = b;
    closeModal();
    go('book?edit=1');
  });
  $('#mCancel', m).addEventListener('click', async function () {
    if (!confirm(b.dateText + ' ' + b.timeText + ' 연습실 예약을 취소할까요?\n취소하면 되돌릴 수 없어요.')) return;
    let gone = false;   // 이미 취소·변경되어 더 이상 처리할 수 없는 예약인지
    await withBusy($('#mCancel', m), '취소 중...', async function () {
      try {
        await call('cancelBooking', { ref: b.ref });
        Api.store.set('myBookings', null);
        closeModal();
        toast('예약을 취소했어요.');
        onDone();
      } catch (e) {
        if (e.handled) return;
        $('#mErr', m).textContent = e.message;   // 창 안에 바로 보이게
        gone = e.code === 'BOOKING' || e.code === 'FORBIDDEN';
      }
    });
    // 이미 취소·변경된 예약이면 버튼을 막고, 뒤의 목록을 새로 불러옴 (버튼 원상복구 뒤에 막아야 함)
    if (gone) {
      $('#mEdit', m).disabled = true; $('#mCancel', m).disabled = true;
      onDone();
    }
  });
}

/** 내 예약 한 줄 (홈 '내 다음 일정'과 '내 예약' 탭에서 함께 사용) */
function bookingRowHtml(b, showName) {
  const lesson = b.type === '레슨';
  return '<div class="item"><div><div class="main">' +
    '<span class="badge ' + (lesson ? 'lesson' : 'practice') + '">' + (lesson ? '레슨' : '연습') + '</span>' +
    esc(b.dateText) + ' ' + esc(b.timeText) +
    (b.isSplit ? '<span class="badge">룸 이동</span>' : '') + '</div>' +
    '<div class="sub">' + esc(roomLabel(b.roomText)) + ' · ' + esc(b.instrument) +
    (showName ? ' · ' + esc(b.studentName) : '') + '</div></div></div>';
}

async function viewMy(params, seq) {
  setView('<div class="page-head"><h2>내 예약</h2><p>연습실 예약을 누르면 변경·취소할 수 있어요 · 레슨 변경은 학원에 문의해 주세요</p></div><div id="list"><div class="loading">불러오는 중...</div></div>');
  try {
    const r = await call('getMyBookings');
    if (stale(seq)) return;
    const row = function (b) { return bookingRowHtml(b, r.multipleStudents); };
    // 변경·취소 가능한 연습실 예약은 누를 수 있게
    const upRow = function (b, i) {
      return b.canChange
        ? '<button type="button" class="item-btn" data-i="' + i + '">' + row(b).replace('</div></div></div>', '</div></div><span class="chev">›</span></div>') + '</button>'
        : row(b);
    };
    $('#list').innerHTML =
      '<div class="card">' + (r.upcoming.length ? r.upcoming.map(upRow).join('') : '<div class="sub">다가오는 일정이 없어요.</div>') + '</div>' +
      (r.past.length ? '<details><summary>지난 일정 (최근 30일, ' + r.past.length + '건)</summary><div class="card">' + r.past.map(row).join('') + '</div></details>' : '');
    $('#list').addEventListener('click', function (ev) {
      const btn = ev.target.closest('.item-btn');
      if (btn) openBookingActions(r.upcoming[Number(btn.dataset.i)], r.multipleStudents, function () { viewMy(params, S.seq); });
    });
  } catch (e) {
    if (!e.handled && !stale(seq)) $('#list').innerHTML = errorBox(e);
  }
}

// ---------------------------------------------------------------------
// 더보기
// ---------------------------------------------------------------------
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function viewMore() {
  const me = S.me;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let install = '';
  if (!isStandalone()) {
    install = '<h3 class="section-title">홈 화면에 앱 추가</h3><div class="card">' +
      (S.installPrompt
        ? '<button class="btn primary" id="install">홈 화면에 추가하기</button>'
        : ios
          ? '<div class="sub">사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르면 앱처럼 쓸 수 있어요.<br>홈 화면 앱에서는 처음 한 번 다시 로그인해 주세요.</div>'
          : '<div class="sub">브라우저 메뉴(⋮) → <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누르면 앱처럼 쓸 수 있어요.</div>') +
      '</div>';
  }
  setView(
    '<div class="page-head"><h2>더보기</h2></div>' +
    '<div class="card"><dl class="kv">' +
    '<dt>아이디</dt><dd>' + esc(me.loginIdText) + '</dd>' +
    me.students.map(function (s) {
      return '<dt>' + esc(s.role) + '</dt><dd>' + esc(s.name) + (s.studentNo ? ' (' + esc(s.studentNo) + ')' : '') +
        ' <span class="badge' + (s.status === '활성' ? '' : ' gray') + '">' + esc(s.status) + '</span>' +
        (s.instruments.length ? '<br><span class="sub">' + esc(s.instruments.join(', ')) + '</span>' : '') + '</dd>';
    }).join('') +
    '</dl></div>' +
    '<div class="card"><div class="btn-row">' +
    '<a class="btn" href="#password">비밀번호 변경</a>' +
    '<button class="btn danger" id="logout">로그아웃</button>' +
    '</div></div>' +
    install +
    '<p class="sub" style="text-align:center;color:var(--muted)">에이플랫 뮤직 스튜디오 · v' + esc(window.AFLAT_CONFIG.VERSION) + '</p>');

  $('#logout').addEventListener('click', function () { if (confirm('로그아웃할까요?')) logout(); });
  if ($('#install')) {
    $('#install').addEventListener('click', async function () {
      S.installPrompt.prompt();
      await S.installPrompt.userChoice;
      S.installPrompt = null;
      render();
    });
  }
}

// ---------------------------------------------------------------------
// 관리 (원장 전용): 회원·계정 / 재설정 요청 / 회원 등록
// ---------------------------------------------------------------------
function viewAdmin(params, seq) {
  const tab = params.get('t') || 'members';
  setView(
    '<div class="page-head"><h2>관리</h2><p>회원 정보 수정은 회원 시트에서 직접 할 수 있어요</p></div>' +
    '<div class="tabs">' +
    '<a class="chip' + (tab === 'members' ? ' on' : '') + '" href="#admin?t=members">회원·계정</a>' +
    '<a class="chip' + (tab === 'requests' ? ' on' : '') + '" href="#admin?t=requests">재설정 요청</a>' +
    '<a class="chip' + (tab === 'new' ? ' on' : '') + '" href="#admin?t=new">회원 등록</a>' +
    '</div><div id="adm"></div>');
  $$('.tabs .chip').forEach(function (a) { a.style.textAlign = 'center'; a.style.textDecoration = 'none'; });
  if (tab === 'requests') adminRequests(seq);
  else if (tab === 'new') adminNew();
  else adminMembers(seq);
}

function tempPasswordModal(list, title, onClose) {
  const appUrl = location.origin + location.pathname;
  const text = list.map(function (r) {
    return '[에이플랫 앱 안내] ' + r.names + '\n아이디: ' + r.loginIdText + '\n임시 비밀번호: ' + r.tempPassword +
      '\n접속 주소: ' + appUrl + '\n첫 로그인 후 새 비밀번호로 바꿔 주세요. (임시 비밀번호는 ' + r.expiresAt + '까지 유효)';
  }).join('\n\n');
  const m = showModal(
    '<h3>' + esc(title) + '</h3>' +
    (list.length === 1 ? '<div class="sub">' + esc(list[0].names) + ' · ' + esc(list[0].loginIdText) + '</div><div class="big-pw">' + esc(list[0].tempPassword) + '</div>' : '') +
    '<div class="msg err">이 창을 닫으면 임시 비밀번호를 다시 볼 수 없어요. 아래 안내문을 복사해 카톡으로 보내 주세요.</div>' +
    '<textarea class="copy-box" readonly>' + esc(text) + '</textarea>' +
    '<div class="btn-row" style="margin-top:12px"><button class="btn" id="mCopy">안내문 복사</button><button class="btn" id="mClose">닫기</button></div>');
  $('#mCopy', m).addEventListener('click', function () { copyText(text); });
  $('#mClose', m).addEventListener('click', function () {
    if (!confirm('임시 비밀번호를 전달할 준비가 되었나요? 닫으면 다시 볼 수 없어요.')) return;
    closeModal();
    if (onClose) onClose();
  });
}

async function adminMembers(seq) {
  const box = $('#adm');
  box.innerHTML = '<div class="loading">불러오는 중...</div>';
  let groups;
  try {
    groups = await call('adminListMembers');
  } catch (e) {
    if (!e.handled && !stale(seq)) box.innerHTML = errorBox(e);
    return;
  }
  if (stale(seq)) return;
  const noAccount = groups.filter(function (g) {
    return g.validLoginId && !g.hasAccount && g.members.some(function (m) { return m.status !== '종료'; });
  }).length;

  box.innerHTML =
    '<input class="input search" id="q" placeholder="이름·번호·수강생번호 검색">' +
    (noAccount ? '<button class="btn primary" id="bulk" style="margin-bottom:12px">계정 없는 회원 ' + noAccount + '명 일괄 발급</button>' : '') +
    '<div class="card" id="glist"></div>';

  const draw = function () {
    const q = $('#q').value.trim().toLowerCase();
    const shown = groups.filter(function (g) {
      if (!q) return true;
      return (g.loginId + g.loginIdText + g.members.map(function (m) { return m.name + m.studentNo; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    $('#glist').innerHTML = shown.length ? shown.map(function (g) {
      const badges =
        (!g.validLoginId ? '<span class="badge red">로그인ID 확인 필요</span>' :
          !g.hasAccount ? '<span class="badge gray">계정 없음</span>' :
          g.isTemp ? '<span class="badge' + (g.tempExpired ? ' red' : '') + '">임시 비밀번호' + (g.tempExpired ? ' 만료' : '') + '</span>' : '') +
        (g.lockedUntil ? '<span class="badge red">잠김 ~' + esc(g.lockedUntil) + '</span>' : '');
      const isSelf = g.loginId === S.me.loginId;
      return '<div class="item"><div><div class="main">' + esc(g.loginIdText) + badges + '</div>' +
        '<div class="sub">' + g.members.map(function (m) {
          return esc(m.name) + ' · ' + esc(m.role) + (m.studentNo ? ' · ' + esc(m.studentNo) : '') +
            (m.instruments.length ? ' · ' + esc(m.instruments.join(', ')) : '') + ' · ' + esc(m.status);
        }).join('<br>') + (g.lastLogin ? '<br>최근 로그인 ' + esc(g.lastLogin) : '') + '</div></div>' +
        '<div class="btn-row" style="flex-direction:column;flex:0 0 auto">' +
        (g.validLoginId && !isSelf ? '<button class="btn small" data-issue="' + esc(g.loginId) + '">' + (g.hasAccount ? '임시 비번 재발급' : '계정 발급') + '</button>' : '') +
        (g.lockedUntil ? '<button class="btn small" data-unlock="' + esc(g.loginId) + '">잠금 해제</button>' : '') +
        '</div></div>';
    }).join('') : '<div class="sub">검색 결과가 없어요.</div>';
  };
  draw();
  $('#q').addEventListener('input', draw);

  $('#glist').addEventListener('click', async function (ev) {
    const issue = ev.target.closest('[data-issue]');
    const unlock = ev.target.closest('[data-unlock]');
    if (issue) {
      if (!confirm(issue.dataset.issue + ' 의 임시 비밀번호를 발급할까요?\n그 번호의 모든 기기 로그인이 해제됩니다.')) return;
      await withBusy(issue, '발급 중...', async function () {
        try {
          const r = await call('adminIssueTempPassword', { loginId: issue.dataset.issue });
          tempPasswordModal([r], '임시 비밀번호 발급');
          const g = groups.filter(function (x) { return x.loginId === issue.dataset.issue; })[0];
          if (g) { g.hasAccount = true; g.isTemp = true; g.tempExpired = false; g.lockedUntil = ''; }
        } catch (e) { if (!e.handled) toast(e.message); }
      });
      draw();
    } else if (unlock) {
      await withBusy(unlock, '해제 중...', async function () {
        try {
          await call('adminUnlock', { loginId: unlock.dataset.unlock });
          const g = groups.filter(function (x) { return x.loginId === unlock.dataset.unlock; })[0];
          if (g) g.lockedUntil = '';
          toast('잠금을 해제했어요.');
        } catch (e) { if (!e.handled) toast(e.message); }
      });
      draw();
    }
  });

  if ($('#bulk')) {
    $('#bulk').addEventListener('click', function () {
      if (!confirm('계정이 없는 회원 ' + noAccount + '명에게 임시 비밀번호를 발급할까요?\n(한 번에 최대 30명, 1~2분 걸릴 수 있어요)')) return;
      withBusy($('#bulk'), '발급 중... 창을 닫지 마세요', async function () {
        try {
          const r = await call('adminBulkIssue');
          tempPasswordModal(r.issued, '일괄 발급 ' + r.issued.length + '명' + (r.remaining ? ' (남은 ' + r.remaining + '명은 다시 눌러 발급)' : ''),
            function () { if (!stale(seq)) adminMembers(seq); });
        } catch (e) { if (!e.handled) toast(e.message); }
      });
    });
  }
}

async function adminRequests(seq) {
  const box = $('#adm');
  box.innerHTML = '<div class="loading">불러오는 중...</div>';
  let list;
  try {
    list = await call('adminListResetRequests');
  } catch (e) {
    if (!e.handled && !stale(seq)) box.innerHTML = errorBox(e);
    return;
  }
  if (stale(seq)) return;
  if (!list.length) { box.innerHTML = '<div class="card"><div class="sub">처리할 요청이 없어요.</div></div>'; return; }
  box.innerHTML = '<div class="msg info">본인 확인(전화·카톡 등) 후 발급해 주세요.</div><div class="card">' + list.map(function (r) {
    return '<div class="item" data-id="' + esc(r.requestId) + '"><div><div class="main">' + esc(r.loginIdText) +
      (r.note ? '<span class="badge gray">' + esc(r.note) + '</span>' : '') + '</div>' +
      '<div class="sub">' + esc(r.names) + '<br>' + esc(r.requestedAt) + '</div></div>' +
      '<div class="btn-row" style="flex-direction:column;flex:0 0 auto">' +
      (r.note ? '' : '<button class="btn small" data-issue="' + esc(r.loginId) + '">임시 비번 발급</button>') +
      '<button class="btn small danger" data-ignore="' + esc(r.requestId) + '">무시</button></div></div>';
  }).join('') + '</div>';

  box.addEventListener('click', async function (ev) {
    const issue = ev.target.closest('[data-issue]');
    const ignore = ev.target.closest('[data-ignore]');
    if (issue) {
      if (!confirm('본인 확인을 마쳤나요? 임시 비밀번호를 발급합니다.')) return;
      await withBusy(issue, '발급 중...', async function () {
        try {
          const r = await call('adminIssueTempPassword', { loginId: issue.dataset.issue });
          tempPasswordModal([r], '임시 비밀번호 발급');
          issue.closest('.item').remove();
        } catch (e) { if (!e.handled) toast(e.message); }
      });
    } else if (ignore) {
      if (!confirm('이 요청을 무시 처리할까요?')) return;
      await withBusy(ignore, '처리 중...', async function () {
        try {
          await call('adminResolveResetRequest', { requestId: ignore.dataset.ignore, status: '무시' });
          ignore.closest('.item').remove();
        } catch (e) { if (!e.handled) toast(e.message); }
      });
    }
  });
}

function adminNew() {
  $('#adm').innerHTML =
    '<form id="nf" class="card">' +
    '<label class="field"><span>이름</span><input class="input" id="n_name" required></label>' +
    '<label class="field"><span>로그인ID (휴대폰 번호)</span><input class="input" id="n_login" type="tel" inputmode="numeric" placeholder="01012345678" required>' +
    '<small>형제가 학부모 번호를 함께 쓰면 같은 번호를 넣으세요. 기존 계정에 자동으로 연결돼요.</small></label>' +
    '<label class="field"><span>알림톡 받을 연락처 (비우면 로그인ID와 같음)</span><input class="input" id="n_phone" type="tel" inputmode="numeric"></label>' +
    '<label class="field"><span>역할</span><select class="input" id="n_role"><option>수강생</option><option>강사</option><option>원장</option></select></label>' +
    '<label class="field"><span>수강생 번호</span><input class="input" id="n_no" placeholder="예: PAM004" style="text-transform:uppercase">' +
    '<small>캘린더 일정 제목에 쓰는 번호예요. 강사도 연습실을 예약하려면 넣어 주세요.</small></label>' +
    '<label class="field"><span>등록 악기</span><input class="input" id="n_inst" placeholder="예: 피아노;보컬">' +
    '<small>여러 개면 세미콜론(;)으로 구분. 룸 시트의 허용악기와 글자가 똑같아야 해요.</small></label>' +
    '<label class="field"><span>상태</span><select class="input" id="n_status"><option>활성</option><option>휴원</option><option>종료</option></select></label>' +
    '<div class="msg err" id="nerr"></div>' +
    '<button class="btn primary" type="submit">등록하기</button></form>';

  $('#nf').addEventListener('submit', function (ev) {
    ev.preventDefault();
    $('#nerr').textContent = '';
    withBusy($('#nf button'), '등록 중...', async function () {
      try {
        const r = await call('adminCreateMember', {
          name: $('#n_name').value, loginId: $('#n_login').value, phone: $('#n_phone').value,
          role: $('#n_role').value, studentNo: $('#n_no').value, instruments: $('#n_inst').value, status: $('#n_status').value
        });
        if (r.linked) {
          toast(r.message);
          showModal('<h3>등록 완료</h3><div class="msg ok">' + esc(r.message) + '</div><button class="btn" id="mClose">닫기</button>');
          $('#mClose').addEventListener('click', closeModal);
        } else {
          tempPasswordModal([{ names: $('#n_name').value.trim(), loginIdText: r.loginIdText, tempPassword: r.tempPassword, expiresAt: r.expiresAt }], '등록 완료 · 계정 발급');
        }
        $('#nf').reset();
      } catch (e) {
        if (!e.handled) $('#nerr').textContent = e.message;
      }
    });
  });
}

// ---------------------------------------------------------------------
// 시작
// ---------------------------------------------------------------------
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  S.installPrompt = e;
});

async function boot() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('서비스워커 등록 실패', e); });
  }
  const savedMe = Api.getToken() ? Api.store.get('me') : null;
  if (savedMe) {
    // [속도 개선 P2] 보관해 둔 내 정보로 바로 시작하고, 최신 내 정보는 화면 요청과 "동시에" 받음
    S.me = savedMe;
    setTimeout(refreshMeInBackground, 0);
  } else if (Api.getToken()) {
    setView('<div class="loading">불러오는 중... ⏳</div>', { noNav: true });
    try {
      setMe(await Api.call('getMe'));
    } catch (e) {
      if (e.code === 'AUTH') {
        Api.setToken('');
      } else if (e.code === 'MUST_CHANGE_PASSWORD') {
        Api.setToken('');
      } else {
        setView('<div class="auth">' + errorBox(e) + '<button class="btn primary" onclick="location.reload()">다시 시도</button></div>', { noNav: true });
        return;
      }
    }
  }
  if (Api.perf) Perf.mark('로그인 확인 끝, 첫 화면 그리기 시작');
  window.addEventListener('hashchange', render);
  // 지금 보고 있는 탭을 다시 누르면(예: 예약 완료 화면에서 '예약하기') 주소가 그대로라
  // 화면이 바뀌지 않으므로, 그 탭의 처음 화면을 다시 그립니다.
  $('#nav').addEventListener('click', function (ev) {
    const a = ev.target.closest('a');
    if (a && location.hash === a.getAttribute('href')) { ev.preventDefault(); render(); }
  });
  render();
}

boot();
