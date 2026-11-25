// =====================================================================
// [Config.gs] 시트 이름, 열 이름, 보안 기준값, 운영설정 읽기
// ---------------------------------------------------------------------
// ※ 예약 규칙 수치(운영시간, 예약 가능 일수, 1일 최대 분 등)는 여기가 아니라
//    스프레드시트의 '운영설정' 시트에서 바꿉니다.
// ※ 시트의 첫 줄(열 이름)은 바꾸지 마세요. 열 순서는 바꿔도 괜찮습니다.
//    (코드는 열 "이름"으로 값을 찾습니다)
// =====================================================================

/** 프로젝트 시간대. appsscript.json 의 timeZone 과 같아야 합니다. */
const TZ = 'Asia/Seoul';

/** 시트 이름 */
const SHEET = {
  MEMBERS: '회원',
  ACCOUNTS: '계정',
  SESSIONS: '세션',
  ROOMS: '룸',
  SETTINGS: '운영설정',
  BOOKING_LOG: '예약로그',
  RESET_REQ: '재설정요청',
  NOTI_LOG: '알림로그',
  POSTS: '소식'
};

/** 시트별 첫 줄(열 이름). '시트 구조 만들기' 메뉴가 이 내용으로 시트를 만듭니다. */
const HEADERS = {
  '회원': ['회원ID', '이름', '로그인ID', '연락처', '역할', '수강생번호', '담당강사', '수강클래스', '등록악기', '상태', '가입일', '메모'],
  '계정': ['로그인ID', '비밀번호해시', '솔트', '반복횟수', '임시비밀번호여부', '임시비밀번호만료일', '로그인실패횟수', '잠금해제시각', '최근로그인일시', '발급일시'],
  '세션': ['토큰해시', '로그인ID', '발급일시', '만료일시', '기기정보'],
  '룸': ['룸ID', '이름', '표시순서', '캘린더ID', '허용악기', '배정우선순위', '사용가능여부'],
  '운영설정': ['항목', '값', '설명'],
  '예약로그': ['로그ID', '로그인ID', '회원ID', '수강생번호', '악기', '룸', '날짜', '시작', '종료', '결과', '실패사유', '생성일시', '리마인드발송일시', '비고'],
  '재설정요청': ['요청ID', '입력ID', '해당회원', '요청일시', '상태', '처리일시', '비고'],
  '알림로그': ['로그ID', '유형', '대상', '발송일시', '결과'],
  '소식': ['소식ID', '제목', '내용', '상단고정', '작성일시', '수정일시', '작성자', '삭제여부']
};

/**
 * 반드시 "글자"로 저장해야 하는 열.
 * 휴대폰 번호(010...)가 숫자로 바뀌면 맨 앞 0이 사라지기 때문입니다.
 */
const TEXT_COLUMNS = {
  '회원': ['회원ID', '로그인ID', '연락처', '수강생번호', '등록악기'],
  '계정': ['로그인ID', '비밀번호해시', '솔트'],
  '세션': ['토큰해시', '로그인ID'],
  '룸': ['룸ID', '이름', '캘린더ID', '허용악기'],
  '운영설정': ['항목', '값'],
  '예약로그': ['로그ID', '로그인ID', '회원ID', '수강생번호', '날짜', '시작', '종료'],
  '재설정요청': ['요청ID', '입력ID'],
  '알림로그': ['로그ID', '대상'],
  '소식': ['소식ID', '제목', '내용', '작성일시', '수정일시', '작성자']
};

/** 회원 역할·상태에 쓰는 글자 */
const ROLE = { ADMIN: '원장', TEACHER: '강사', STUDENT: '수강생' };
const STATUS = { ACTIVE: '활성', PAUSED: '휴원', ENDED: '종료' };

/**
 * 보안 기준값 (기능정의서 4장 A, 9장).
 * 보안 수준을 낮추는 실수를 막기 위해 시트가 아니라 코드에 둡니다.
 */
const SECURITY = {
  HASH_ITERATIONS: 800,            // 비밀번호 해시 반복 횟수. '해시 속도 측정' 메뉴로 확인 후 조정
                                   // (2026-11-19 테스트 실측: 1,000회 ≈ 1.1초 → 로그인 1초 이내가 되도록 800회)
  MAX_LOGIN_FAIL: 5,               // 연속 실패 허용 횟수
  LOCK_MINUTES: 10,                // 잠금 시간(분)
  SESSION_DAYS: 90,                // 로그인 유지 기간(일)
  TEMP_PASSWORD_DAYS: 7,           // 임시 비밀번호 유효기간(일)
  TEMP_PASSWORD_LENGTH: 6,         // 임시 비밀번호 자릿수(숫자)
  MIN_PASSWORD_LENGTH: 8,          // 새 비밀번호 최소 길이
  ADMIN_MIN_PASSWORD_LENGTH: 10,   // 원장 계정 새 비밀번호 최소 길이
  SESSION_CACHE_SEC: 600,          // 로그인 확인 결과를 잠시 기억하는 시간(초)
  RESET_COOLDOWN_SEC: 3600,        // 같은 ID의 재설정 요청 알림 간격(초)
  RESET_DAILY_ALIMTALK_CAP: 30     // 재설정 요청 알림톡 하루 최대 발송 수(비용 보호)
};

/**
 * '운영설정' 시트 기본값.
 * 시트에 값이 비어 있으면 이 값을 씁니다. '시트 구조 만들기' 메뉴가 이 값으로 시트를 채웁니다.
 * [항목 이름, 기본값, 설명]
 */
const DEFAULT_SETTINGS = [
  ['운영시작', '08:00', '이 시각 이후에 시작하는 예약만 가능 (HH:MM)'],
  ['운영종료', '24:00', '이 시각까지 끝나는 예약만 가능 (자정은 24:00)'],
  ['예약가능일수', '7', '오늘 포함 며칠까지 예약 가능한지 (7 = 오늘 ~ 6일 후)'],
  ['1일최대분', '120', '한 수강생이 하루에 예약할 수 있는 최대 시간(분). 모든 룸 합산'],
  ['이용시간선택지', '30;60;90;120', '예약 화면에 보이는 이용 시간(분). 세미콜론(;)으로 구분'],
  ['최소분할분', '30', '2개 룸으로 나눌 때 각 구간의 최소 길이(분)'],
  ['분할단위', '15', '2개 룸으로 나눌 때 나누는 지점의 간격(분). 시작 시각 기준'],
  ['분할가능최소이용분', '60', '이용 시간이 이 값 이상일 때만 2개 룸 분할 시도'],
  ['지난시각허용분', '30', '오늘 예약에서, 현재 시각보다 이 분(分)만큼 이전에 시작하는 시각까지 예약 허용 (0 = 지난 시각 예약 불가)'],
  ['변경취소마감분', '0', '연습실 예약을 앱에서 변경·취소할 수 있는 시한. 예약이 끝나기 이 분(分) 전까지 (0 = 끝나는 시각 전까지)'],
  ['레슨조회일수', '30', '내 예약에서 레슨 일정을 오늘부터 며칠 뒤까지 보여줄지 (30 = 오늘 ~ 30일 뒤)'],
  ['시간표캐시초', '60', '시간표를 잠시 기억하는 시간(초). 캘린더 직접 수정은 최대 이 시간만큼 늦게 보임. 0이면 사용 안 함']
];

/**
 * 운영설정을 읽어 계산하기 쉬운 형태로 돌려줍니다. (5분간 기억)
 * 시트를 고친 뒤 바로 반영하려면 시트 메뉴 '에이플랫 관리 → 설정 즉시 반영'을 누르세요.
 */
function getSettings_() {
  const cached = cacheGetJson_('settings');
  if (cached) return cached;

  const raw = {};
  DEFAULT_SETTINGS.forEach(function (row) { raw[row[0]] = row[1]; });
  const sh = ss_().getSheetByName(SHEET.SETTINGS);
  if (sh) {
    readTable_(SHEET.SETTINGS).rows.forEach(function (r) {
      const key = String(r['항목']).trim();
      const val = r['값'];
      if (key && val !== '' && val !== null) raw[key] = settingValueToText_(val);
    });
  }

  const st = {
    openMin: parseHHMM_(raw['운영시작']),
    closeMin: parseHHMM_(raw['운영종료']),
    bookableDays: parseInt(raw['예약가능일수'], 10),
    maxDailyMin: parseInt(raw['1일최대분'], 10),
    durations: splitList_(raw['이용시간선택지']).map(function (s) { return parseInt(s, 10); })
      .filter(function (n) { return n > 0; }).sort(function (a, b) { return a - b; }),
    minSegmentMin: parseInt(raw['최소분할분'], 10),
    splitStepMin: parseInt(raw['분할단위'], 10),
    splitMinDuration: parseInt(raw['분할가능최소이용분'], 10),
    pastGraceMin: parseInt(raw['지난시각허용분'], 10),
    lessonDays: parseInt(raw['레슨조회일수'], 10),
    changeDeadlineMin: parseInt(raw['변경취소마감분'], 10),
    timetableCacheSec: parseInt(raw['시간표캐시초'], 10)
  };

  // 값이 잘못되었으면 원장님이 바로 알 수 있게 오류를 냅니다.
  const problems = [];
  if (isNaN(st.openMin)) problems.push('운영시작');
  if (isNaN(st.closeMin) || st.closeMin <= st.openMin) problems.push('운영종료');
  if (!(st.bookableDays >= 1)) problems.push('예약가능일수');
  if (!(st.maxDailyMin > 0)) problems.push('1일최대분');
  if (!st.durations.length) problems.push('이용시간선택지');
  if (!(st.minSegmentMin > 0)) problems.push('최소분할분');
  if (!(st.splitStepMin > 0)) problems.push('분할단위');
  if (!(st.splitMinDuration > 0)) problems.push('분할가능최소이용분');
  if (isNaN(st.pastGraceMin) || st.pastGraceMin < 0) problems.push('지난시각허용분');
  if (!(st.lessonDays >= 0)) problems.push('레슨조회일수');
  if (!(st.changeDeadlineMin >= 0)) problems.push('변경취소마감분');
  if (isNaN(st.timetableCacheSec) || st.timetableCacheSec < 0) st.timetableCacheSec = 0;
  if (problems.length) {
    fail_('운영설정 값이 올바르지 않습니다: ' + problems.join(', ') + '. 학원에 문의해 주세요.', 'CONFIG');
  }

  cachePutJson_('settings', st, 300);
  return st;
}

/**
 * 시트 셀 값을 글자로 바꿉니다.
 * '값' 열이 글자 서식이 아니어서 "08:00"이 시각으로 바뀐 경우도 처리합니다.
 */
function settingValueToText_(val) {
  if (val instanceof Date) {
    // 시트가 "24:00"을 1899-12-31 00:00 으로 바꾸는 경우 대비
    let min = val.getHours() * 60 + val.getMinutes();
    if (val.getFullYear() === 1899 && val.getMonth() === 11 && val.getDate() === 31) min += 1440;
    return minToHHMM_(min);
  }
  return String(val).trim();
}
