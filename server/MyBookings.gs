// =====================================================================
// [MyBookings.gs] 내 예약 리스트 (기능 C-4, 1차는 연습실만)
// ---------------------------------------------------------------------
// - 룸 캘린더에서 "(연습)" 일정 중 내 수강생 번호와 "정확히" 일치하는 것만 보여줍니다.
// - 분할 예약([1/2]·[2/2])은 한 건으로 묶습니다.
// - 기간: 지난 30일 ~ 예약 가능 마지막 날
// - 캘린더에서 은솔 원장님이 지운 예약(취소)은 자동으로 사라집니다.
// - 레슨 일정 조회(C-5)는 2차에서 추가합니다.
// =====================================================================

const MY_BOOKINGS_PAST_DAYS = 30;

function apiGetMyBookings_(ctx) {
  const st = getSettings_();
  const myNos = {};
  ctx.members.forEach(function (m) { if (m.studentNo) myNos[m.studentNo] = m; });
  if (!Object.keys(myNos).length) return { upcoming: [], past: [] };

  const today = todayKey_();
  const from = dateFromKey_(addDaysKey_(today, -MY_BOOKINGS_PAST_DAYS));
  const to = dateFromKey_(addDaysKey_(today, st.bookableDays));   // 마지막 예약 가능일 다음날 0시
  const loaded = loadEventsInRange_(getRooms_(), from, to);

  const items = [];
  loaded.events.forEach(function (ev) {
    const info = parseEventTitle_(ev.title);
    if (!info || info.type !== '연습' || !myNos[info.studentNo]) return;
    items.push({
      studentNo: info.studentNo,
      studentName: myNos[info.studentNo].name,
      instrument: info.instrument,
      roomName: ev.roomName,
      start: ev.start,
      end: ev.end,
      part: info.part
    });
  });

  const now = Date.now();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const hhmm = function (ms) { return fmt_(new Date(ms), 'HH:mm'); };
  const endText = function (ms) { const t = hhmm(ms); return t === '00:00' ? '24:00' : t; };

  const list = groupSplitBookings_(items).map(function (b) {
    const d = new Date(b.start);
    return {
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
