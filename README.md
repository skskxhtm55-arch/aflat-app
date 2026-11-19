# 에이플랫 뮤직 스튜디오 앱 (1차)

수강생용 연습실 예약 웹앱(PWA). 비용 0원 구조: 화면은 GitHub Pages, 서버는 Google Apps Script, 데이터는 구글 스프레드시트, 룸 점유 원본은 구글 캘린더, 알림은 솔라피 알림톡.

## 1차 구현 범위
| ID | 기능 | 위치 |
|---|---|---|
| A-1 | 로그인/로그아웃 (휴대폰 번호 + 비밀번호, 5회 실패 10분 잠금, 90일 유지) | server/Auth.gs, web/app.js `viewLogin` |
| A-2 | 회원 등록·계정 발급 (관리자) | server/Admin.gs, web/app.js `adminNew` |
| A-4 | 비밀번호 변경 (첫 로그인 강제) | server/Auth.gs `apiChangePassword_` |
| A-5 / I-7 / H-6 | 재설정 요청 → 원장 알림톡 → 임시 비밀번호 재발급·잠금 해제 | Auth.gs `apiRequestPasswordReset_`, Admin.gs |
| C-1 | 연습실 시간표 (가능/마감만, 시작·종료 시각만 전송) | server/Rooms.gs, web/app.js `viewTimetable` |
| C-2 | 연습실 예약 (현행 규칙·자동 배정·2개 룸 분할 + 잠금) | server/Booking.gs, server/Logic.gs |
| C-4 | 내 예약 (연습실, 분할 예약 묶음) | server/MyBookings.gs |
| H-8 | 예약 확정 알림톡 (현행 성공 템플릿) | server/Alimtalk.gs |
| I-3 | 운영설정 시트에서 규칙 수치 읽기 | server/Config.gs `getSettings_` |

## 폴더
```
server/   Apps Script 코드 (clasp 로 업로드)
  Logic.gs       예약 계산 핵심(룸 배정·분할·1일 한도·제목 해석) — 구글 기능 없이 순수 계산
  Booking.gs     예약 처리 순서(검사 → 잠금 → 캘린더 조회 → 배정 → 등록 → 알림)
  Rooms.gs       룸·캘린더 읽기, 시간표
  MyBookings.gs  내 예약
  Auth.gs        로그인·비밀번호·세션
  Admin.gs       관리자 기능
  Alimtalk.gs    솔라피
  Api.gs         앱 요청 입구(기능 목록 ROUTES)
  Config.gs      시트 이름·보안 기준값·운영설정 읽기
  Util.gs        공통 도구
  Menu.gs        스프레드시트 '에이플랫 관리' 메뉴
  Setup.gs       시트 생성·테스트 환경·기존 데이터 가져오기
web/      앱 화면 (GitHub Pages 로 배포) — config.js 에 서버 주소
  dev/mock-api.js  화면 확인용 가짜 서버 (?mock=1)
tests/    logic-test.html — 예약 로직 자동 검사 (브라우저로 열기)
docs/     01 시트 구조 · 02 설치·배포 · 03 테스트 시나리오 · 04 실운영 전환 · 05 알림톡 템플릿
```

## 처음 시작
`docs/02_설치배포가이드.md` 를 순서대로 따라 하세요.

## 코드 수정 흐름
1. 서버(server/) 수정 → `clasp push` → Apps Script **배포 관리 → 새 버전**
2. 화면(web/) 수정 → `git push` → 1~2분 뒤 자동 반영
3. 예약 규칙 로직(Logic.gs)을 고쳤다면 `tests/logic-test.html` 로 검사
4. `git commit` 으로 이력 남기기
