// =====================================================================
// [dev/mock-api.js] 개발용 가짜 서버 — 화면 모양만 확인할 때 사용
// ---------------------------------------------------------------------
// 사용법: 앱 주소 끝에 ?mock=1 을 붙여 엽니다. (예: index.html?mock=1)
// 실제 시트·캘린더에는 전혀 접근하지 않습니다. 데이터는 새로고침하면 초기화됩니다.
// 로그인: 01000000001 / 아무 비밀번호 (000000 이면 첫 로그인 비밀번호 변경 화면)
// =====================================================================
(function () {
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const pad = function (n) { return String(n).padStart(2, '0'); };
  const keyOf = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const today = new Date();
  const dates = [];
  for (let i = 0; i < 7; i++) { const d = new Date(today); d.setDate(d.getDate() + i); dates.push(keyOf(d)); }

  const rooms = ['Eb', 'Bb', 'F', 'Db'];
  // 날짜별 일정: { room, s(분), e(분), studentNo }
  const events = {};
  dates.forEach(function (k, i) {
    events[k] = [
      { room: 'Eb', s: 600 + i * 30, e: 720 + i * 30, studentNo: 'X' },
      { room: 'Bb', s: 840, e: 900, studentNo: 'X' },
      { room: 'Db', s: 1080, e: 1200, studentNo: 'X' }
    ];
  });
  events[dates[1]].push({ room: 'Bb', s: 1140, e: 1200, studentNo: 'TST001' });

  let me = {
    loginId: '01000000001', loginIdText: '010-0000-0001', displayName: '김테스트·김동생',
    isAdmin: true, isTeacher: false, mustChangePassword: false, passwordMinLength: 10,
    students: [
      { memberId: 'M0002', name: '김테스트', role: '수강생', status: '활성', studentNo: 'TST001', instruments: ['피아노', '보컬'], canBook: true, cannotBookReason: '' },
      { memberId: 'M0009', name: '김동생', role: '수강생', status: '휴원', studentNo: 'TST009', instruments: ['드럼'], canBook: false, cannotBookReason: '휴원 상태에서는 예약할 수 없습니다.' }
    ],
    settings: { openMin: 480, closeMin: 1440, bookableDays: 7, maxDailyMin: 120, durations: [30, 60, 90, 120], pastGraceMin: 30 },
    today: dates[0], dates: dates
  };
  const posts = [
    { id: 'P1', title: '12월 정기공연 안내', body: '12월 20일(토) 오후 3시 정기공연이 열립니다.\n신청은 아래 링크에서 해 주세요.\nhttps://example.com/apply.', pinned: true, dateText: '2026.11.24' },
    { id: 'P2', title: '연말 휴원 안내 <b>테스트</b>', body: '12월 31일 ~ 1월 1일은 휴원합니다.', pinned: false, dateText: '2026.11.20' }
  ];
  const resetReqs = [{ requestId: 'R1', loginId: '01000000004', loginIdText: '010-0000-0004', names: '최휴원', requestedAt: '2026-11-19 10:12', note: '' }];

  function fail(msg, code) { const e = new ApiError(msg, code || 'ERROR'); throw e; }
  const free = function (k, room, s, e) { return !events[k].some(function (x) { return x.room === room && x.s < e && x.e > s; }); };
  const hhmm = function (m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); };

  window.AFLAT_MOCK = async function (action, data, token) {
    await sleep(350);
    switch (action) {
      case 'login':
        if (!data.loginId || !data.password) fail('아이디(휴대폰 번호)와 비밀번호를 입력해 주세요.');
        me.mustChangePassword = data.password === '000000';
        return { token: 'mock-token-1234567890abcdef', me: me };
      case 'getMe':
        if (!token) fail('로그인이 필요합니다.', 'AUTH');
        return me;
      case 'logout': return { done: true };
      case 'changePassword': me.mustChangePassword = false; return { done: true, me: me };
      case 'listPosts': return posts.map(function (p) { return { id: p.id, title: p.title, pinned: p.pinned, dateText: p.dateText }; });
      case 'getPost': { const p = posts.filter(function (x) { return x.id === data.id; })[0]; if (!p) fail('삭제되었거나 없는 소식입니다.', 'NOT_FOUND'); return p; }
      case 'adminSavePost': {
        if (!data.title || !data.body) fail('제목과 내용을 입력해 주세요.');
        const p = data.id ? posts.filter(function (x) { return x.id === data.id; })[0] : null;
        if (p) Object.assign(p, { title: data.title, body: data.body, pinned: data.pinned });
        else posts.unshift({ id: 'P' + Date.now(), title: data.title, body: data.body, pinned: data.pinned, dateText: '2026.11.25' });
        return { saved: true };
      }
      case 'adminDeletePost': { const k = posts.findIndex(function (x) { return x.id === data.id; }); if (k >= 0) posts.splice(k, 1); return { deleted: true }; }
      case 'requestPasswordReset': return { message: '요청이 접수되었습니다. 학원에서 확인 후 임시 비밀번호를 안내해 드릴게요.' };
      case 'getTimetable': {
        const k = data.date;
        return {
          date: k, dates: dates, today: dates[0], nowMin: today.getHours() * 60 + today.getMinutes(),
          openMin: 480, closeMin: 1440,
          rooms: rooms.map(function (r) { return { name: r, busy: events[k].filter(function (x) { return x.room === r; }).map(function (x) { return [x.s, x.e]; }) }; }),
          myUsage: [{ studentNo: 'TST001', usedMin: events[k].filter(function (x) { return x.studentNo === 'TST001'; }).reduce(function (a, x) { return a + x.e - x.s; }, 0) }]
        };
      }
      case 'createBooking': {
        const k = data.date;
        const s = parseInt(data.start.slice(0, 2), 10) * 60 + parseInt(data.start.slice(3), 10);
        const e = s + data.duration;
        const room = rooms.filter(function (r) { return free(k, r, s, e); })[0];
        if (!room) fail('해당 시간 잔여 연습실 없음', 'BOOKING');
        events[k].push({ room: room, s: s, e: e, studentNo: data.studentNo });
        return { studentName: '김테스트', instrument: data.instrument, dateText: k, bookingText: hhmm(s) + '~' + hhmm(e) + ' ' + room,
                 segments: [{ room: room, start: hhmm(s), end: hhmm(e) }] };
      }
      case 'getMyBookings':
        return {
          upcoming: [
            { type: '레슨', dateText: '11월 20일 (금)', timeText: '14:00~15:00', roomText: 'Bb', instrument: '피아노', studentName: '김테스트', isSplit: false },
            { type: '연습', dateText: '11월 20일 (금)', timeText: '19:00~20:00', roomText: 'Bb', instrument: '피아노', studentName: '김테스트', isSplit: false, canChange: true, ref: [{ r: 'R2', e: 'ev1' }], studentNo: 'TST001', date: dates[1], start: '19:00', duration: 60 },
            { type: '연습', canChange: true, ref: [{ r: 'R1', e: 'ev2' }, { r: 'R2', e: 'ev3' }], studentNo: 'TST001', date: dates[3], start: '18:00', duration: 120, dateText: '11월 22일 (일)', timeText: '18:00~20:00', roomText: 'Eb(18:00~19:00) → Bb(19:00~20:00)', instrument: '피아노', studentName: '김테스트', isSplit: true }
          ],
          past: [{ type: '연습', dateText: '11월 15일 (일)', timeText: '10:00~11:00', roomText: 'Db', instrument: '보컬', studentName: '김테스트', isSplit: false }],
          multipleStudents: true
        };
      case 'cancelBooking': if (!data.ref) fail('취소할 예약을 다시 선택해 주세요.'); return { cancelled: true };
      case 'modifyBooking': {
        if (!data.ref) fail('변경할 예약을 다시 선택해 주세요.');
        if (data.start === '03:00') fail('해당 시간 잔여 연습실 없음', 'BOOKING');
        return { changed: true, oldText: '11월 20일 (금) 19:00~20:00 Bb', studentName: '김테스트', instrument: data.instrument, dateText: data.date,
                 bookingText: data.start + ' Eb', segments: [{ room: 'Eb', start: data.start, end: '--:--' }] };
      }
      case 'adminListMembers':
        return [
          { loginId: '01000000000', loginIdText: '010-0000-0000', validLoginId: true, hasAccount: true, isTemp: false, tempExpired: false, lockedUntil: '', lastLogin: '2026-11-19 09:00',
            members: [{ name: '테스트원장', role: '원장', status: '활성', studentNo: '', instruments: [] }] },
          { loginId: '01000000003', loginIdText: '010-0000-0003', validLoginId: true, hasAccount: true, isTemp: true, tempExpired: false, lockedUntil: '11-19 15:20', lastLogin: '',
            members: [{ name: '박형', role: '수강생', status: '활성', studentNo: 'TST002', instruments: ['피아노'] }, { name: '박동생', role: '수강생', status: '휴원', studentNo: 'TST003', instruments: ['드럼'] }] },
          { loginId: '01000000007', loginIdText: '010-0000-0007', validLoginId: true, hasAccount: false, isTemp: false, tempExpired: false, lockedUntil: '', lastLogin: '',
            members: [{ name: '신규생', role: '수강생', status: '활성', studentNo: 'TST007', instruments: ['보컬'] }] }
        ];
      case 'adminIssueTempPassword':
        return { loginIdText: data.loginId, names: '테스트', tempPassword: '482913', expiresAt: '2026-11-26 15:00' };
      case 'adminBulkIssue':
        return { issued: [{ loginIdText: '010-0000-0007', names: '신규생', tempPassword: '120394', expiresAt: '2026-11-26 15:00' }], remaining: 0 };
      case 'adminUnlock': return { done: true };
      case 'adminListResetRequests': return resetReqs;
      case 'adminResolveResetRequest': return { done: true };
      case 'adminCreateMember':
        return { memberId: 'M0010', linked: false, loginIdText: data.loginId, tempPassword: '555123', expiresAt: '2026-11-26 15:00' };
      default: fail('알 수 없는 요청입니다.');
    }
  };
})();
