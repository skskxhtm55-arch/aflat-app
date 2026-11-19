// =====================================================================
// [Booking.gs] 연습실 예약 (기능 C-2, 알림 H-8)
// ---------------------------------------------------------------------
// 처리 순서 (기능정의서 5-1)
//  1. 예약자 확인: 로그인한 계정에 연결된 수강생인지, '활성' 상태인지
//  2. 악기 확인: 그 수강생의 등록 악기 중 하나인지 (정확히 일치)
//  3. 날짜·시각 확인: 과거 / 예약 가능 기간 / 운영시간
//  4. ★ 잠금(LockService): 동시에 들어온 예약은 한 번에 하나씩 처리 → 중복 배정 방지
//  5. 캘린더를 직접 읽어 1일 한도(연습 일정만, 수강생 번호 정확 일치) 확인
//  6. 룸 자동 배정 (단일 룸 → 2개 룸 분할) — Logic.gs 의 allocateRooms_
//  7. 캘린더에 "(연습)방이름_수강생명_악기_수강생번호" 일정 등록
//  8. 잠금 해제 → 예약로그 기록 → 확정 알림톡 발송(H-8)
// 실패하면 현행과 같은 사유 문구를 화면에 즉시 보여줍니다(실패 알림톡은 보내지 않음).
// =====================================================================

function apiCreateBooking_(ctx, data) {
  const st = getSettings_();
  const studentNo = normStudentNo_(data.studentNo);
  const instrument = String(data.instrument || '').trim();
  const dateKey = String(data.date || '');
  const startMin = parseHHMM_(data.start);
  const duration = parseInt(data.duration, 10);

  // 1. 예약자 확인
  const member = ctx.members.filter(function (m) { return m.studentNo && m.studentNo === studentNo; })[0];
  if (!member) fail_('예약할 수강생을 선택해 주세요.', 'BOOKING');
  if (!member.canBook) fail_(member.cannotBookReason, 'BOOKING');

  const logBase = {
    '로그인ID': ctx.loginId, '회원ID': member.memberId, '수강생번호': studentNo, '악기': instrument,
    '날짜': dateKey, '시작': isNaN(startMin) ? String(data.start || '') : minToHHMM_(startMin),
    '종료': isNaN(startMin) || isNaN(duration) ? '' : minToHHMM_(Math.min(startMin + duration, 1440))
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
  if (!lock.tryLock(25000)) {
    fail_('지금 예약이 몰려 있어요. 잠시 후 다시 시도해 주세요.', 'BUSY');
  }
  let segments;
  try {
    // 5. 캘린더 직접 조회 (캐시 사용 안 함)
    const day = loadDayEvents_(dateKey, false);
    const used = sumDailyPracticeMinutes_(day.events, studentNo);
    if (used + duration > st.maxDailyMin) {
      const hours = st.maxDailyMin % 60 === 0 ? (st.maxDailyMin / 60) + '시간' : st.maxDailyMin + '분';
      rejectBooking_(logBase, '일일 예약 가능 시간 초과(최대 ' + hours + ')');
    }

    // 6. 룸 배정 (캘린더를 찾을 수 없는 룸은 제외)
    const rooms = getRooms_().filter(function (r) { return r.active && day.missing.indexOf(r.id) < 0; });
    const result = allocateRooms_({
      events: day.events, rooms: rooms, instrument: instrument, start: start, end: end, settings: st
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
    } catch (e) {
      created.forEach(function (ev) { try { ev.deleteEvent(); } catch (e2) { console.error(e2); } });
      throw e;
    }
    invalidateDayCache_(dateKey);
  } finally {
    lock.releaseLock();
  }

  // 8. 기록·알림 (잠금 밖에서 처리해 다른 사람이 덜 기다리게)
  const hhmm = function (ms) { return fmt_(new Date(ms), 'HH:mm'); };
  const endText = function (ms) { const t = hhmm(ms); return t === '00:00' ? '24:00' : t; };
  const bookingText = segments.map(function (seg) {
    return hhmm(seg.start) + '~' + endText(seg.end) + ' ' + seg.room.name;
  }).join(', ');
  const now = new Date();
  segments.forEach(function (seg) {
    appendRow_(SHEET.BOOKING_LOG, Object.assign({}, logBase, {
      '로그ID': newId_('B'), '룸': seg.room.name + (seg.part ? ' [' + seg.part + ']' : ''),
      '시작': hhmm(seg.start), '종료': endText(seg.end), '결과': '성공', '생성일시': now
    }));
  });

  const dateText = koreanDateText_(dateKey);
  sendAlimtalk_('H-8 연습실 예약 확정', member.phone,
    PropertiesService.getScriptProperties().getProperty('TEMPLATE_BOOKING_SUCCESS'),
    { '#{이름}': member.name, '#{날짜}': dateText, '#{예약내역}': bookingText });

  return {
    studentName: member.name,
    instrument: instrument,
    dateText: dateText,
    bookingText: bookingText,
    segments: segments.map(function (seg) {
      return { room: seg.room.name, start: hhmm(seg.start), end: endText(seg.end) };
    })
  };
}

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
