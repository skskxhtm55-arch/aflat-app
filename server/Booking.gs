// =====================================================================
// [Booking.gs] 연습실 예약·변경·취소 (기능 C-2, C-3, 알림 H-8)
// ---------------------------------------------------------------------
// 예약 처리 순서 (기능정의서 5-1)
//  1. 예약자 확인: 로그인한 계정에 연결된 수강생인지, '활성' 상태인지
//  2. 악기 확인: 그 수강생의 등록 악기 중 하나인지 (정확히 일치)
//  3. 날짜·시각 확인: 지난 시각(운영설정 지난시각허용분) / 예약 가능 기간 / 운영시간
//  4. ★ 잠금(LockService): 동시에 들어온 예약은 한 번에 하나씩 처리 → 중복 배정 방지
//  5. 캘린더를 직접 읽어 1일 한도(연습 일정만, 수강생 번호 정확 일치) 확인
//  6. 룸 자동 배정 (단일 룸 → 2개 룸 분할) — Logic.gs 의 allocateRooms_
//  7. 캘린더에 "(연습)방이름_수강생명_악기_수강생번호" 일정 등록
//  8. 잠금 해제 → 예약로그 기록 → 확정 알림톡 발송(H-8)
// 실패하면 현행과 같은 사유 문구를 화면에 즉시 보여줍니다(실패 알림톡은 보내지 않음).
//
// 예약 변경 (2026-11-25 추가)
//  - 내 예약에서 연습실 예약을 고르고 새 조건(악기·날짜·시각·이용시간)을 보내면,
//    "기존 예약은 없는 것으로 보고" 위 1~6 검사를 똑같이 합니다.
//  - 통과하면 새 일정을 먼저 만들고 → 기존 일정을 지웁니다. 실패하면 기존 예약은 그대로입니다.
//  - 확정 알림톡을 새 내역으로 다시 보냅니다(현행 성공 템플릿 재사용).
// 예약 취소 (2026-11-25 추가)
//  - 기존 일정을 캘린더에서 지웁니다. 알림톡은 보내지 않습니다(화면 안내만).
// 변경·취소 가능 시한: 예약이 끝나는 시각 전까지 (운영설정 '변경취소마감분'으로 앞당길 수 있음)
// 분할 예약([1/2]·[2/2])은 한 건으로 함께 변경·취소됩니다.
// =====================================================================

/** [API] 새 예약. data = { studentNo, instrument, date, start: 'HH:MM', duration } */
function apiCreateBooking_(ctx, data) {
  return placeBooking_(ctx, data, null);
}

/** [API] 예약 변경. data = { ref: [...], studentNo, instrument, date, start, duration } */
function apiModifyBooking_(ctx, data) {
  if (!Array.isArray(data.ref) || !data.ref.length) fail_('변경할 예약을 다시 선택해 주세요.', 'BOOKING');
  return placeBooking_(ctx, data, data.ref);
}

/**
 * 예약 등록 공통 처리. oldRef 가 있으면 "변경": 그 예약을 빼고 검사한 뒤, 새 일정 등록 → 기존 일정 삭제.
 */
function placeBooking_(ctx, data, oldRef) {
  const st = getSettings_();
  const studentNo = normStudentNo_(data.studentNo);
  const instrument = String(data.instrument || '').trim();
  const dateKey = String(data.date || '');
  const startMin = parseHHMM_(data.start);
  const duration = parseInt(data.duration, 10);
  const isChange = !!oldRef;

  // 1. 예약자 확인
  const member = ctx.members.filter(function (m) { return m.studentNo && m.studentNo === studentNo; })[0];
  if (!member) fail_('예약할 수강생을 선택해 주세요.', 'BOOKING');
  if (!member.canBook) fail_(member.cannotBookReason, 'BOOKING');

  const logBase = {
    '로그인ID': ctx.loginId, '회원ID': member.memberId, '수강생번호': studentNo, '악기': instrument,
    '날짜': dateKey, '시작': isNaN(startMin) ? String(data.start || '') : minToHHMM_(startMin),
    '종료': isNaN(startMin) || isNaN(duration) ? '' : minToHHMM_(Math.min(startMin + duration, 1440)),
    '비고': isChange ? '예약 변경 시도' : ''
  };

  // 2. 악기 확인 (등록 악기 목록에서만 선택 가능)
  if (member.instruments.indexOf(instrument) < 0) {
    rejectBooking_(logBase, '등록된 수강 과목과 일치하지 않음');
  }

  // 3. 날짜·시각 확인
  if (!dateFromKey_(dateKey)) rejectBooking_(logBase, '날짜를 확인해 주세요');
  const timingError = checkBookingTiming_({
    dateKey: dateKey, startMin: startMin, duration: duration,
    todayKey: todayKey_(), nowMin: nowMinutes_(), dates: bookableDates_(st), settings: st
  });
  if (timingError) rejectBooking_(logBase, timingError);

  const dayStart = dateFromKey_(dateKey);
  const start = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 0, startMin).getTime();
  const end = start + duration * 60000;

  // 4. 잠금
  const lock = LockService.getScriptLock();
  const tLock = Date.now();
  if (!lock.tryLock(25000)) {
    fail_('지금 예약이 몰려 있어요. 잠시 후 다시 시도해 주세요.', 'BUSY');
  }
  perfAdd_('lock', tLock);
  let segments;
  let old = null;
  try {
    // (변경) 기존 예약이 정말 이 계정의 것인지, 아직 변경 가능한지 캘린더에서 다시 확인
    if (isChange) {
      old = loadOwnedBooking_(ctx, oldRef, st);
      if (old.studentNo !== studentNo) fail_('예약한 수강생은 바꿀 수 없어요. 취소 후 새로 예약해 주세요.', 'BOOKING');
      logBase['비고'] = '변경 전: ' + old.text;
    }
    const oldIds = old ? old.segments.map(function (s) { return s.eventId; }) : [];

    // 5. 캘린더 직접 조회 (캐시 사용 안 함). 변경이면 기존 예약은 없는 것으로 봄
    const day = loadDayEvents_(dateKey, false);
    const events = day.events.filter(function (ev) { return oldIds.indexOf(ev.id) < 0; });
    const used = sumDailyPracticeMinutes_(events, studentNo);
    if (used + duration > st.maxDailyMin) {
      const hours = st.maxDailyMin % 60 === 0 ? (st.maxDailyMin / 60) + '시간' : st.maxDailyMin + '분';
      rejectBooking_(logBase, '일일 예약 가능 시간 초과(최대 ' + hours + ')');
    }

    // 6. 룸 배정 (캘린더를 찾을 수 없는 룸은 제외)
    const rooms = getRooms_().filter(function (r) { return r.active && day.missing.indexOf(r.id) < 0; });
    const result = allocateRooms_({
      events: events, rooms: rooms, instrument: instrument, start: start, end: end, settings: st
    });
    if (!result.ok) rejectBooking_(logBase, result.reason);
    segments = result.segments;

    // 7. 캘린더 등록 (분할 시 두 번째가 실패하면 첫 번째를 지워 되돌림)
    const created = [];
    try {
      segments.forEach(function (seg) {
        const cal = CalendarApp.getCalendarById(seg.room.calendarId);
        const title = buildPracticeTitle_(seg.room.name, member.name, instrument, studentNo, seg.part);
        created.push(cal.createEvent(title, new Date(seg.start), new Date(seg.end)));
      });
      // (변경) 새 일정이 모두 만들어진 뒤에 기존 일정 삭제
      if (old) old.segments.forEach(function (s) { s.event.deleteEvent(); });
    } catch (e) {
      created.forEach(function (ev) { try { ev.deleteEvent(); } catch (e2) { console.error(e2); } });
      throw e;
    }
    invalidateDayCache_(dateKey);
    if (old && old.dateKey !== dateKey) invalidateDayCache_(old.dateKey);
  } finally {
    lock.releaseLock();
  }

  // 8. 기록·알림 (잠금 밖에서 처리해 다른 사람이 덜 기다리게)
  const bookingText = segments.map(function (seg) {
    return hhmm_(seg.start) + '~' + endText_(seg.end) + ' ' + seg.room.name;
  }).join(', ');
  const now = new Date();
  segments.forEach(function (seg) {
    appendRow_(SHEET.BOOKING_LOG, Object.assign({}, logBase, {
      '로그ID': newId_('B'), '룸': seg.room.name + (seg.part ? ' [' + seg.part + ']' : ''),
      '시작': hhmm_(seg.start), '종료': endText_(seg.end), '결과': isChange ? '변경' : '성공', '생성일시': now
    }));
  });

  const dateText = koreanDateText_(dateKey);
  sendAlimtalk_(isChange ? 'H-8 연습실 예약 변경' : 'H-8 연습실 예약 확정', member.phone,
    PropertiesService.getScriptProperties().getProperty('TEMPLATE_BOOKING_SUCCESS'),
    { '#{이름}': member.name, '#{날짜}': dateText, '#{예약내역}': bookingText });

  return {
    changed: isChange,
    oldText: old ? old.text : '',
    studentName: member.name,
    instrument: instrument,
    dateText: dateText,
    bookingText: bookingText,
    segments: segments.map(function (seg) {
      return { room: seg.room.name, start: hhmm_(seg.start), end: endText_(seg.end) };
    })
  };
}

/** [API] 예약 취소. data = { ref: [...] } */
function apiCancelBooking_(ctx, data) {
  if (!Array.isArray(data.ref) || !data.ref.length) fail_('취소할 예약을 다시 선택해 주세요.', 'BOOKING');
  const st = getSettings_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) fail_('지금 예약이 몰려 있어요. 잠시 후 다시 시도해 주세요.', 'BUSY');
  let old;
  try {
    old = loadOwnedBooking_(ctx, data.ref, st);
    old.segments.forEach(function (s) { s.event.deleteEvent(); });
    invalidateDayCache_(old.dateKey);
  } finally {
    lock.releaseLock();
  }
  const member = ctx.members.filter(function (m) { return m.studentNo === old.studentNo; })[0] || {};
  const now = new Date();
  old.segments.forEach(function (s) {
    appendRow_(SHEET.BOOKING_LOG, {
      '로그ID': newId_('B'), '로그인ID': ctx.loginId, '회원ID': member.memberId || '', '수강생번호': old.studentNo,
      '악기': old.instrument, '룸': s.roomName + (s.part ? ' [' + s.part + ']' : ''), '날짜': old.dateKey,
      '시작': hhmm_(s.start), '종료': endText_(s.end), '결과': '취소', '생성일시': now, '비고': '수강생 앱에서 취소'
    });
  });
  return { cancelled: true, text: old.text, studentName: member.name || '' };
}

/**
 * 내 예약 화면이 보낸 예약 표시(ref)로 캘린더 일정을 다시 찾아, 이 계정의 연습실 예약인지 확인합니다.
 * ref = [{ r: 룸ID, e: 캘린더 일정ID }, ...]  (분할 예약이면 2개)
 * 통과하면 { studentNo, instrument, dateKey, text, segments: [{ event, eventId, roomName, start, end, part }] }
 */
function loadOwnedBooking_(ctx, ref, st) {
  const notFound = function () { fail_('이미 취소되었거나 바뀐 예약이에요. 내 예약을 새로 불러와 주세요.', 'BOOKING'); };
  if (!Array.isArray(ref) || !ref.length || ref.length > 2) notFound();
  const myNos = ctx.members.map(function (m) { return m.studentNo; }).filter(String);
  const rooms = getRooms_();
  const segs = ref.map(function (x) {
    const room = rooms.filter(function (r) { return r.id === String(x && x.r); })[0];
    if (!room) notFound();
    const cal = CalendarApp.getCalendarById(room.calendarId);
    const eventId = String(x.e || '');
    // ※ 캘린더는 방금 지운 일정도 ID로는 찾아지는 경우가 있어, 그 시간대 일정 목록에 실제로 있는지까지 확인
    let ev = null;
    try {
      ev = cal ? cal.getEventById(eventId) : null;
      if (ev) {
        const alive = cal.getEvents(ev.getStartTime(), ev.getEndTime())
          .some(function (e) { return e.getId() === eventId; });
        if (!alive) ev = null;
      }
    } catch (e) {
      console.warn('예약 일정 확인 실패(지워진 일정으로 처리): ' + e);
      ev = null;
    }
    if (!ev) notFound();
    const info = parseEventTitle_(ev.getTitle());
    if (!info || info.type !== '연습' || myNos.indexOf(info.studentNo) < 0) {
      fail_('내 연습실 예약만 변경·취소할 수 있어요.', 'FORBIDDEN');
    }
    return { event: ev, eventId: ev.getId(), roomName: room.name, start: ev.getStartTime().getTime(),
             end: ev.getEndTime().getTime(), part: info.part, studentNo: info.studentNo, instrument: info.instrument };
  }).sort(function (a, b) { return a.start - b.start; });

  if (segs.some(function (s) { return s.studentNo !== segs[0].studentNo; })) notFound();
  const endMs = segs[segs.length - 1].end;
  if (!canChangeBooking_(endMs, Date.now(), st.changeDeadlineMin)) {
    fail_(st.changeDeadlineMin > 0
      ? '예약이 끝나기 ' + st.changeDeadlineMin + '분 전까지만 변경·취소할 수 있어요.'
      : '이미 끝난 예약은 변경·취소할 수 없어요.', 'BOOKING');
  }
  const dateKey = fmt_(new Date(segs[0].start), 'yyyy-MM-dd');
  return {
    studentNo: segs[0].studentNo,
    instrument: segs[0].instrument,
    dateKey: dateKey,
    text: koreanDateText_(dateKey) + ' ' + segs.map(function (s) {
      return hhmm_(s.start) + '~' + endText_(s.end) + ' ' + s.roomName;
    }).join(', '),
    segments: segs
  };
}

/** 시각 표시 도우미 (자정 종료는 24:00) */
function hhmm_(ms) { return fmt_(new Date(ms), 'HH:mm'); }
function endText_(ms) { const t = hhmm_(ms); return t === '00:00' ? '24:00' : t; }

/** 예약 거부: 예약로그에 실패로 남기고 화면에 사유를 보냅니다. */
function rejectBooking_(logBase, reason) {
  try {
    appendRow_(SHEET.BOOKING_LOG, Object.assign({}, logBase, {
      '로그ID': newId_('B'), '결과': '실패', '실패사유': reason, '생성일시': new Date()
    }));
  } catch (e) {
    console.error('예약로그 기록 실패: ' + e);
  }
  fail_(reason, 'BOOKING');
}
