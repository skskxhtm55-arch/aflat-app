// =====================================================================
// [Rooms.gs] 룸 정보, 캘린더 일정 읽기, 시간표 조회 (기능 C-1)
// ---------------------------------------------------------------------
// ■ 캘린더가 룸 점유의 원본입니다. 시트에는 예약 현황을 저장하지 않습니다.
// ■ 개인정보 보호: 시간표 응답에는 일정의 시작·종료 "분"만 담습니다.
//   일정 제목·이름·악기는 서버 밖으로 나가지 않습니다.
// ■ 속도: 날짜별 일정을 '시간표캐시초'(기본 60초) 동안 서버 캐시에 기억합니다.
//   (서버 캐시는 화면으로 전달되지 않음) 앱에서 예약이 생기면 그 날짜 캐시를 즉시 지웁니다.
//   예약 확정 검사는 캐시를 쓰지 않고 항상 캘린더를 직접 읽습니다.
// =====================================================================

/**
 * '룸' 시트 읽기 (5분간 기억)
 * 결과: [{ id, name, order, calendarId, instruments:[], priority, active }]
 */
function getRooms_() {
  const cached = cacheGetJson_('rooms');
  if (cached) return cached;
  const rooms = readTable_(SHEET.ROOMS).rows
    .filter(function (r) { return String(r['이름'] || '').trim() && String(r['캘린더ID'] || '').trim(); })
    .map(function (r) {
      const name = String(r['이름']).trim();
      return {
        id: String(r['룸ID'] || '').trim() || name,
        name: name,
        order: Number(r['표시순서']) || 99,
        calendarId: String(r['캘린더ID']).trim(),
        instruments: splitList_(r['허용악기']),
        priority: Number(r['배정우선순위']) || 99,
        active: !isNo_(r['사용가능여부'])
      };
    })
    .sort(function (a, b) { return a.order - b.order; });
  cachePutJson_('rooms', rooms, 300);
  return rooms;
}

/**
 * 여러 룸 캘린더에서 기간 내 일정을 읽습니다.
 * 결과: { events: [{ roomId, roomName, start, end, title }], missing: [캘린더를 못 찾은 룸ID] }
 */
function loadEventsInRange_(rooms, from, to) {
  const events = [];
  const missing = [];
  rooms.forEach(function (room) {
    const cal = CalendarApp.getCalendarById(room.calendarId);
    if (!cal) {
      console.error('캘린더를 찾을 수 없음(룸 ' + room.name + '): ' + room.calendarId);
      missing.push(room.id);
      return;
    }
    cal.getEvents(from, to).forEach(function (ev) {
      events.push({
        roomId: room.id,
        roomName: room.name,
        start: ev.getStartTime().getTime(),
        end: ev.getEndTime().getTime(),
        title: ev.getTitle()
      });
    });
  });
  return { events: events, missing: missing };
}

/**
 * 하루치 일정 (모든 룸, 사용 중지 룸 포함 — 1일 한도 집계에 필요)
 * useCache = true 면 서버 캐시 사용(시간표 화면용), false 면 캘린더 직접 조회(예약 확정용)
 */
function loadDayEvents_(dateKey, useCache) {
  const key = 'ev_' + dateKey;
  if (useCache) {
    const cached = cacheGetJson_(key);
    if (cached) return cached;
  }
  const dayStart = dateFromKey_(dateKey);
  const dayEnd = new Date(dayStart.getTime());
  dayEnd.setDate(dayEnd.getDate() + 1);
  const result = loadEventsInRange_(getRooms_(), dayStart, dayEnd);
  cachePutJson_(key, result, getSettings_().timetableCacheSec);
  return result;
}

function invalidateDayCache_(dateKey) {
  cacheRemove_(['ev_' + dateKey]);
}

/**
 * [API] 시간표 조회
 * data = { date: 'yyyy-MM-dd' }
 * 응답: { date, dates, openMin, closeMin, nowMin, rooms: [{ name, busy: [[시작분, 종료분], ...] }],
 *         myUsage: [{ studentNo, usedMin }] }
 */
function apiGetTimetable_(ctx, data) {
  const st = getSettings_();
  const dates = bookableDates_(st);
  const dateKey = String(data.date || '');
  if (dates.indexOf(dateKey) < 0) fail_('조회할 수 없는 날짜입니다. (오늘부터 ' + st.bookableDays + '일 이내)', 'BAD_DATE');

  const day = loadDayEvents_(dateKey, true);
  const dayStart = dateFromKey_(dateKey).getTime();
  const toMin = function (ms) { return Math.max(0, Math.min(1440, Math.round((ms - dayStart) / 60000))); };

  const rooms = getRooms_()
    .filter(function (r) { return r.active && day.missing.indexOf(r.id) < 0; })
    .map(function (r) {
      return {
        name: r.name,
        busy: day.events
          .filter(function (ev) { return ev.roomId === r.id; })
          .map(function (ev) { return [toMin(ev.start), toMin(ev.end)]; })   // 시각만! 제목·이름 없음
      };
    });

  // 본인(연결된 수강생)의 그날 연습 예약 합계 — 화면에서 남은 시간 표시용
  const myUsage = ctx.members
    .filter(function (m) { return m.studentNo; })
    .map(function (m) { return { studentNo: m.studentNo, usedMin: sumDailyPracticeMinutes_(day.events, m.studentNo) }; });

  return {
    date: dateKey,
    dates: dates,
    today: todayKey_(),
    nowMin: nowMinutes_(),
    openMin: st.openMin,
    closeMin: st.closeMin,
    rooms: rooms,
    myUsage: myUsage
  };
}
