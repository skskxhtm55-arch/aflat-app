// =====================================================================
// [MyBookings.gs] 내 예약 리스트 (기능 C-4 연습실 + C-5 레슨)
// ---------------------------------------------------------------------
// - 룸 캘린더에서 "(연습)"·"(레슨)" 일정 중 내 수강생 번호와 "정확히" 일치하는 것만 보여줍니다.
// - 분할 예약([1/2]·[2/2])은 한 건으로 묶습니다.
// - 기간: 지난 30일 ~ 오늘부터 운영설정 '레슨조회일수'(기본 30일) 뒤까지
//   (연습실 예약은 원래 '예약가능일수' 안에만 있으므로 같은 기간 안에 모두 들어옵니다)
// - 캘린더에서 지우거나 옮긴 일정(취소·변경)은 자동으로 반영됩니다.
// =====================================================================

const MY_BOOKINGS_PAST_DAYS = 30;

function apiGetMyBookings_(ctx) {
  const st = getSettings_();
  const myNos = {};
  ctx.members.forEach(function (m) { if (m.studentNo) myNos[m.studentNo] = m; });
  if (!Object.keys(myNos).length) return { upcoming: [], past: [] };

  const today = todayKey_();
  const from = dateFromKey_(addDaysKey_(today, -MY_BOOKINGS_PAST_DAYS));
  const aheadDays = Math.max(st.bookableDays, st.lessonDays + 1);   // 오늘 + N일 뒤의 다음날 0시까지
  const to = dateFromKey_(addDaysKey_(today, aheadDays));
  const loaded = loadEventsInRange_(getRooms_(), from, to);

  const items = pickMySchedule_(loaded.events, myNos);

  const now = Date.now();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const hhmm = function (ms) { return fmt_(new Date(ms), 'HH:mm'); };
  const endText = function (ms) { const t = hhmm(ms); return t === '00:00' ? '24:00' : t; };

  const list = groupSplitBookings_(items).map(function (b) {
    const d = new Date(b.start);
    return {
      type: b.type,                     // '연습' 또는 '레슨'
      date: fmt_(d, 'yyyy-MM-dd'),
      dateText: fmt_(d, 'M월 d일') + ' (' + days[d.getDay()] + ')',
      timeText: hhmm(b.start) + '~' + endText(b.end),
      roomText: b.segments.map(function (s) {
        return b.segments.length > 1 ? s.roomName + '(' + hhmm(s.start) + '~' + endText(s.end) + ')' : s.roomName;
      }).join(' → '),
      instrument: b.instrument,
      studentName: b.studentName,
      isSplit: b.segments.length > 1,
      isPast: b.end <= now,
      startMs: b.start
    };
  });

  return {
    upcoming: list.filter(function (b) { return !b.isPast; }).sort(function (a, b) { return a.startMs - b.startMs; }),
    past: list.filter(function (b) { return b.isPast; }).sort(function (a, b) { return b.startMs - a.startMs; }),
    multipleStudents: Object.keys(myNos).length > 1
  };
}
