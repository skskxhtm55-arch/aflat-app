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
 * 결과: { events: [{ id, roomId, roomName, start, end, title }], missing: [캘린더를 못 찾은 룸ID] }
 *
 * [속도 개선 P3] 룸 캘린더 4개를 "동시에" 읽습니다 (구글 캘린더 API를 한 번에 4건 요청).
 *   예전 방식은 캘린더를 하나씩 열고, 일정마다 제목·시각을 따로 꺼내 느렸습니다.
 * 되돌리기: 스크립트 속성 CAL_READ_MODE = legacy 를 넣으면 예전 방식으로 읽습니다(코드 수정 없이).
 * 두 방식이 같은 결과를 내는지는 시트 메뉴 '설치·테스트 도구 → 캘린더 읽기 비교'로 확인합니다.
 */
function loadEventsInRange_(rooms, from, to) {
  const mode = PropertiesService.getScriptProperties().getProperty('CAL_READ_MODE');
  return String(mode || '').trim().toLowerCase() === 'legacy'
    ? loadEventsInRangeLegacy_(rooms, from, to)
    : loadEventsInRangeFast_(rooms, from, to);
}

/** 빠른 방식: 캘린더 API를 룸 수만큼 동시에 호출 */
function loadEventsInRangeFast_(rooms, from, to) {
  const events = [];
  const missing = [];
  if (!rooms.length) return { events: events, missing: missing };
  const token = ScriptApp.getOAuthToken();
  const query = '?singleEvents=true&maxResults=2500' +
    '&timeMin=' + encodeURIComponent(from.toISOString()) +
    '&timeMax=' + encodeURIComponent(to.toISOString()) +
    '&fields=' + encodeURIComponent('nextPageToken,items(iCalUID,summary,start,end,status)');
  const requests = rooms.map(function (room) {
    return {
      url: 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(room.calendarId) + '/events' + query,
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true
    };
  });
  const t = Date.now();
  const responses = UrlFetchApp.fetchAll(requests);
  perfAdd_('cal', t);

  // 종일 일정('2026-11-26' 형태)은 그날 0시 기준 (서울 시간)
  const toMs = function (when) {
    if (!when) return NaN;
    if (when.dateTime) return new Date(when.dateTime).getTime();
    const d = dateFromKey_(when.date);
    return d ? d.getTime() : NaN;
  };

  const warnings = [];
  responses.forEach(function (res, i) {
    const room = rooms[i];
    const code = res.getResponseCode();
    if (code === 404 || code === 403 || code === 401) {
      // 거절되면(권한·API 꺼짐 등) "비어 있음"으로 보지 않고, 이 룸은 예전 방식으로 다시 읽음.
      // 캘린더가 정말 없으면 예전 방식이 '못 찾음'으로 판단합니다.
      const why = '룸 ' + room.name + ' 빠른 읽기 거절(' + code + '): ' + res.getContentText().slice(0, 300);
      console.warn(why);
      warnings.push(why);
      const one = loadEventsInRangeLegacy_([room], from, to);
      Array.prototype.push.apply(events, one.events);
      Array.prototype.push.apply(missing, one.missing);
      return;
    }
    if (code !== 200) {
      // 일시 오류(429·500 등)에서 "비어 있다"고 잘못 판단하지 않도록 요청 자체를 실패시킴
      throw new Error('캘린더 읽기 실패(룸 ' + room.name + ', ' + code + '): ' + res.getContentText().slice(0, 200));
    }
    const body = JSON.parse(res.getContentText());
    if (body.nextPageToken) {
      // 기간 안 일정이 2,500개를 넘는 경우(사실상 없음) — 이 룸만 예전 방식으로 다시 읽음
      const one = loadEventsInRangeLegacy_([room], from, to);
      Array.prototype.push.apply(events, one.events);
      Array.prototype.push.apply(missing, one.missing);
      return;
    }
    (body.items || []).forEach(function (it) {
      if (it.status === 'cancelled') return;
      const start = toMs(it.start), end = toMs(it.end);
      if (isNaN(start) || isNaN(end)) return;
      events.push({ id: it.iCalUID, roomId: room.id, roomName: room.name, start: start, end: end, title: it.summary || '' });
    });
  });
  // warnings 는 비교 메뉴에서만 보여줌 (서버 캐시에 저장되는 결과에는 넣지 않음)
  const result = { events: events, missing: missing };
  Object.defineProperty(result, 'warnings', { value: warnings, enumerable: false });
  return result;
}

/** 예전 방식: CalendarApp 으로 캘린더를 하나씩 읽기 (되돌리기·비교용) */
function loadEventsInRangeLegacy_(rooms, from, to) {
  const events = [];
  const missing = [];
  rooms.forEach(function (room) {
    const cal = CalendarApp.getCalendarById(room.calendarId);
    if (!cal) {
      console.error('캘린더를 찾을 수 없음(룸 ' + room.name + '): ' + room.calendarId);
      missing.push(room.id);
      return;
    }
    const t = Date.now();
    const list = cal.getEvents(from, to);
    perfAdd_('cal', t);
    list.forEach(function (ev) {
      events.push({
        id: ev.getId(),          // 일정 ID (예약 변경·취소 때 본인 일정을 다시 찾는 데 사용)
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
