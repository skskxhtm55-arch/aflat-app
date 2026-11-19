// =====================================================================
// [config.js] 앱 설정 — 배포할 때 이 파일만 고치면 됩니다.
// =====================================================================
window.AFLAT_CONFIG = {
  // 실제로 사용하는 서버 주소 (Apps Script 웹앱 URL, /exec 로 끝남)
  // - 개발 중에는 테스트 주소를, 실운영 전환 시 실운영 주소를 넣습니다.
  API_URL: 'https://script.google.com/macros/s/AKfycbyaxVK5QPvz2poymrErYTTt6ZBJIvKF9o3tOxoLib_lyEc7xr7LLEOG2YHvfCm3zyeD/exec',

  // 테스트 서버 주소. 앱 주소 끝에 ?test=1 을 붙여 열면 이 주소로 연결됩니다.
  // (실운영 전환 후에도 테스트 시트·캘린더로 기능을 시험해 볼 수 있음)
  TEST_API_URL: 'https://script.google.com/macros/s/AKfycbyaxVK5QPvz2poymrErYTTt6ZBJIvKF9o3tOxoLib_lyEc7xr7LLEOG2YHvfCm3zyeD/exec',

  // 앱 버전 (더보기 화면에 표시. 수정할 때마다 올리면 문의 대응이 쉬움)
  VERSION: '1.0.1'
};

if (/[?&]test=1/.test(location.search) && window.AFLAT_CONFIG.TEST_API_URL) {
  window.AFLAT_CONFIG.API_URL = window.AFLAT_CONFIG.TEST_API_URL;
  window.AFLAT_CONFIG.VERSION += ' (테스트 서버)';
}
