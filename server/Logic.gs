// =====================================================================
// [Logic.gs] 순수 계산 로직 모음
// ---------------------------------------------------------------------
// 이 파일은 구글 서비스(시트·캘린더 등)를 전혀 사용하지 않습니다.
// 그래서 브라우저에서도 그대로 불러와 테스트할 수 있습니다.
// (tests/logic-test.html 참고)
// 예약 규칙(룸 배정, 분할, 1일 한도 집계, 일정 제목 해석)의 핵심이 모두 여기에 있습니다.
// =====================================================================

/**
 * "08:00", "8:00", "24:00" 같은 시각 글자를 "0시부터 몇 분째인지"로 바꿉니다.
 * 예) "08:30" → 510, "24:00" → 1440. 잘못된 값이면 NaN.
 */
function parseHHMM_(text) {
  const m = String(text == null ? '' : text).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return NaN;
  return h * 60 + mi;
}

/** 분(0~1440)을 "HH:MM" 글자로 바꿉니다. 1440 → "24:00" */
function minToHHMM_(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * 세미콜론(;)으로 구분된 목록을 배열로 바꿉니다. 앞뒤 공백은 지웁니다.
 * 예) "피아노; 보컬" → ["피아노", "보컬"]
 */
function splitList_(value) {
  return String(value == null ? '' : value)
    .split(';')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s !== ''; });
}

/** 수강생 번호 비교용 정리: 앞뒤 공백 제거 + 대문자 */
function normStudentNo_(v) {
  return String(v == null ? '' : v).trim().toUpperCase();
}

/**
 * 캘린더 일정 제목을 해석합니다. (기능정의서 4장 C-0-1)
 *   "(연습)Bb_조항빈_피아노_PAM004"        → 연습, 수강생번호 PAM004
 *   "(연습)Bb_조항빈_피아노_PAM004 [1/2]"  → 연습, 분할 1/2
 *   "(레슨)Bb_조항빈_피아노_PAM004"        → 레슨
 * 규칙을 벗어난 제목(예: "강사 개인연습")은 null을 돌려줍니다.
 * 수강생 번호는 "_"로 나눈 마지막 항목입니다(분할 표시 제외).
 */
function parseEventTitle_(title) {
  const t = String(title == null ? '' : title).trim();
  const head = t.match(/^\((연습|레슨)\)(.*)$/);
  if (!head) return null;
  let rest = head[2];
  let part = '';
  const partMatch = rest.match(/\s*\[(\d)\/(\d)\]\s*$/);
  if (partMatch) {
    part = partMatch[1] + '/' + partMatch[2];
    rest = rest.slice(0, partMatch.index);
  }
  const pieces = rest.split('_');
  if (pieces.length < 4) return null;
  return {
    type: head[1],                                   // '연습' 또는 '레슨'
    roomName: pieces[0].trim(),
    studentName: pieces.slice(1, pieces.length - 2).join('_').trim(),
    instrument: pieces[pieces.length - 2].trim(),
    studentNo: normStudentNo_(pieces[pieces.length - 1]),
    part: part                                       // '', '1/2', '2/2'
  };
}

/** 연습 일정 제목 만들기. part는 '', '1/2', '2/2' */
function buildPracticeTitle_(roomName, studentName, instrument, studentNo, part) {
  let title = '(연습)' + roomName + '_' + studentName + '_' + instrument + '_' + studentNo;
  if (part) title += ' [' + part + ']';
  return title;
}

/**
 * 하루 동안 특정 수강생의 "(연습)" 일정 합계(분)를 구합니다.
 * - 수강생 번호는 정확히 일치해야 합니다(PAM004 ≠ PAM0041).
 * - "(레슨)"이나 규칙 밖 일정은 세지 않습니다.
 * events: [{ start: 밀리초, end: 밀리초, title: '...' }]
 */
function sumDailyPracticeMinutes_(events, studentNo) {
  const target = normStudentNo_(studentNo);
  let total = 0;
  events.forEach(function (ev) {
    const info = parseEventTitle_(ev.title);
    if (info && info.type === '연습' && info.studentNo === target) {
      total += (ev.end - ev.start) / 60000;
    }
  });
  return total;
}

/** 해당 룸이 [start, end) 동안 비어 있는지. 앞뒤로 딱 붙는 일정은 겹침이 아님. */
function isRoomFree_(events, roomId, start, end) {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.roomId === roomId && ev.start < end && ev.end > start) return false;
  }
  return true;
}

/**
 * 룸 자동 배정 (현행 Code.gs 규칙 그대로 + 악기 정확 일치)
 * 1) 선택 악기를 허용하는 룸 중 우선순위(숫자 작은 순)로, 전체 시간이 빈 룸 1곳
 * 2) 없으면, 이용시간이 "분할가능최소이용분" 이상일 때 2개 룸으로 분할
 *    - 각 구간 최소 "최소분할분", 분할 지점은 시작 시각부터 "분할단위"분 간격
 * 3) 그래도 없으면 실패 사유를 현행과 같은 문구로 돌려줌
 *
 * p = {
 *   events:     [{ roomId, start, end }]   해당 날짜의 모든 캘린더 일정
 *   rooms:      [{ id, name, priority, instruments: [] }]  사용 가능한 룸
 *   instrument: '피아노',
 *   start, end: 밀리초,
 *   settings:   { minSegmentMin, splitStepMin, splitMinDuration }
 * }
 * 결과: { ok: true, segments: [{ room, start, end, part }] } 또는 { ok: false, reason }
 */
function allocateRooms_(p) {
  const st = p.settings;
  const candidates = p.rooms
    .filter(function (r) { return r.instruments.indexOf(p.instrument) >= 0; })
    .slice()
    .sort(function (a, b) { return a.priority - b.priority; });

  // 1) 단일 룸
  for (let i = 0; i < candidates.length; i++) {
    if (isRoomFree_(p.events, candidates[i].id, p.start, p.end)) {
      return { ok: true, segments: [{ room: candidates[i], start: p.start, end: p.end, part: '' }] };
    }
  }

  // 2) 2개 룸 분할
  const duration = (p.end - p.start) / 60000;
  if (duration >= st.splitMinDuration) {
    for (let first = st.minSegmentMin; first <= duration - st.minSegmentMin; first += st.splitStepMin) {
      const mid = p.start + first * 60000;
      let r1 = null;
      for (let i = 0; i < candidates.length; i++) {
        if (isRoomFree_(p.events, candidates[i].id, p.start, mid)) { r1 = candidates[i]; break; }
      }
      if (!r1) continue;
      let r2 = null;
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].id === r1.id) continue;
        if (isRoomFree_(p.events, candidates[i].id, mid, p.end)) { r2 = candidates[i]; break; }
      }
      if (r2) {
        return {
          ok: true,
          segments: [
            { room: r1, start: p.start, end: mid, part: '1/2' },
            { room: r2, start: mid, end: p.end, part: '2/2' }
          ]
        };
      }
    }
  }

  // 3) 실패 사유 (현행 문구 유지)
  let anyRoomFree = false;
  for (let i = 0; i < p.rooms.length; i++) {
    if (isRoomFree_(p.events, p.rooms[i].id, p.start, p.end)) { anyRoomFree = true; break; }
  }
  let reason;
  if (anyRoomFree) reason = '해당 시간·악기 기준 잔여 연습실 없음';
  else if (duration > st.splitMinDuration) reason = '2회 이상 방 이동 예약 불가';
  else reason = '해당 시간 잔여 연습실 없음';
  return { ok: false, reason: reason };
}

/**
 * 예약 요청의 날짜·시각 조건을 검사합니다(캘린더를 보지 않는 검사).
 * 통과하면 '' (빈 글자), 실패하면 현행과 같은 거부 사유를 돌려줍니다.
 * p = { dateKey:'2026-11-20', startMin, duration, todayKey, nowMin, dates:[허용 날짜들], settings }
 */
function checkBookingTiming_(p) {
  const st = p.settings;
  if (st.durations.indexOf(p.duration) < 0) return '선택할 수 없는 이용 시간입니다';
  if (isNaN(p.startMin)) return '시작 시각을 확인해 주세요';
  if (p.dateKey < p.todayKey) return '과거 시간 예약 불가';
  // 오늘 예약: 현재 시각에서 '지난시각허용분'만큼 이전 시각까지는 허용 (예: 30 → 15:20에 14:50 시작 가능)
  const grace = st.pastGraceMin || 0;
  if (p.dateKey === p.todayKey && p.startMin < p.nowMin - grace) {
    return grace > 0 ? '지난 시각 예약 불가 (현재 시각 ' + grace + '분 전까지만 가능)' : '과거 시간 예약 불가';
  }
  if (p.dates.indexOf(p.dateKey) < 0) return '현재로부터 ' + st.bookableDays + '일 이후 날짜 예약 불가';
  if (p.startMin < st.openMin || p.startMin + p.duration > st.closeMin) return '연습실 운영시간 외 예약 불가';
  return '';
}

/**
 * 연습실 예약을 지금 변경·취소할 수 있는지.
 * 예약이 끝나는 시각(endMs)에서 deadlineMin 분을 뺀 시각 전까지 가능 (0 = 끝나는 시각 전까지)
 */
function canChangeBooking_(endMs, nowMs, deadlineMin) {
  return nowMs < endMs - (deadlineMin || 0) * 60000;
}

/**
 * 캘린더 일정 중 "내 일정"만 고릅니다. (기능 C-4·C-5)
 * - "(연습)"·"(레슨)" 일정 중 수강생 번호가 정확히 일치하는 것만 (PAM004 ≠ PAM0041)
 * - 제목 규칙을 벗어난 일정(강사 개인연습 등)은 제외
 * events: [{ roomName, start, end, title }], myNos: { 수강생번호: { name } }
 * → [{ type: '연습'|'레슨', studentNo, studentName, instrument, roomName, start, end, part }]
 */
function pickMySchedule_(events, myNos) {
  const items = [];
  events.forEach(function (ev) {
    const info = parseEventTitle_(ev.title);
    if (!info || !myNos[info.studentNo]) return;
    items.push({
      type: info.type,
      studentNo: info.studentNo,
      studentName: myNos[info.studentNo].name,
      instrument: info.instrument,
      roomName: ev.roomName,          // 실제로 일정이 있는 룸 캘린더의 이름
      roomId: ev.roomId,
      id: ev.id,
      start: ev.start,
      end: ev.end,
      part: info.type === '연습' ? info.part : ''
    });
  });
  return items;
}

/**
 * 내 예약 목록에서 분할 예약([1/2]·[2/2])을 한 건으로 묶습니다.
 * 같은 수강생 번호, [1/2]의 종료 시각 = [2/2]의 시작 시각이면 한 건.
 * items: [{ studentNo, roomName, start, end, part, ... }] → [{ start, end, segments: [...] , ...첫 구간 정보 }]
 */
function groupSplitBookings_(items) {
  const sorted = items.slice().sort(function (a, b) { return a.start - b.start; });
  const used = {};
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (used[i]) continue;
    const a = sorted[i];
    let merged = null;
    if (a.part === '1/2') {
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (!used[j] && b.part === '2/2' && b.studentNo === a.studentNo && b.type === a.type && b.start === a.end) {
          used[j] = true;
          merged = Object.assign({}, a, { end: b.end, segments: [a, b] });
          break;
        }
      }
    }
    result.push(merged || Object.assign({}, a, { segments: [a] }));
  }
  return result;
}
