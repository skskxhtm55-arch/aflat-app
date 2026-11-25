// =====================================================================
// [Alimtalk.gs] 솔라피 알림톡 발송
// ---------------------------------------------------------------------
// 비밀값은 코드에 쓰지 않고 "스크립트 속성"에서 읽습니다.
// (Apps Script 편집기 → 프로젝트 설정(톱니바퀴) → 스크립트 속성)
//
//   SOLAPI_API_KEY            솔라피 API 키
//   SOLAPI_API_SECRET         솔라피 API 시크릿
//   SOLAPI_PFID               카카오 채널 연동 ID (현행 코드의 PFID)
//   SOLAPI_SENDER             발신 번호 (현행 코드의 SENDER_NUMBER)
//   TEMPLATE_BOOKING_SUCCESS  예약 확정 템플릿 ID (현행 TEMPLATE_SUCCESS 와 동일)
//   TEMPLATE_RESET_REQUEST    비밀번호 재설정 요청 알림 템플릿 ID (신규 승인 필요)
//   ADMIN_PHONE               재설정 요청 알림을 받을 원장님 휴대폰 번호
//   ALIMTALK_MODE             off  = 보내지 않고 기록만 (기본값)
//                             test = ALIMTALK_TEST_PHONE 으로만 보냄
//                             live = 실제 대상에게 보냄 (실운영)
//   ALIMTALK_TEST_PHONE       test 모드에서 받을 번호
//
// 발송 결과는 '알림로그' 시트에 남습니다.
// =====================================================================

/**
 * 알림톡 1건 발송. 실패해도 예약 등 본 처리는 멈추지 않습니다(기록만 남김).
 * kind: 기록용 이름, toPhone: 받는 번호, templateId: 템플릿 ID, variables: {'#{이름}': '...'}
 */
function sendAlimtalk_(kind, toPhone, templateId, variables, opts) {
  opts = opts || {};
  const props = PropertiesService.getScriptProperties();
  const mode = String(props.getProperty('ALIMTALK_MODE') || 'off').trim().toLowerCase();
  let to = normalizeLoginId_(toPhone);
  let result;

  try {
    if (mode === 'test') to = normalizeLoginId_(props.getProperty('ALIMTALK_TEST_PHONE'));
    if (mode !== 'test' && mode !== 'live') {
      result = '미발송(off 모드) ' + JSON.stringify(variables);
    } else if (!to) {
      result = '미발송(받는 번호 없음)';
    } else if (!templateId) {
      result = '미발송(템플릿 ID 미설정)';
    } else {
      const payload = {
        message: {
          to: to,
          from: props.getProperty('SOLAPI_SENDER'),
          kakaoOptions: {
            pfId: props.getProperty('SOLAPI_PFID'),
            templateId: templateId,
            variables: variables
          }
        }
      };
      const tHttp = Date.now();
      const res = UrlFetchApp.fetch('https://api.solapi.com/messages/v4/send', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: getSolapiAuth(props.getProperty('SOLAPI_API_KEY'), props.getProperty('SOLAPI_API_SECRET')) },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      perfAdd_('http', tHttp);
      const code = res.getResponseCode();
      result = (code >= 200 && code < 300 ? '성공' : '실패 ' + code + ' ' + res.getContentText().slice(0, 200)) +
        (mode === 'test' ? ' (test 모드)' : '');
    }
  } catch (e) {
    result = '오류 ' + e;
  }

  try {
    appendRow_(SHEET.NOTI_LOG, {
      '로그ID': newId_('N'), '유형': kind, '대상': to || String(toPhone || ''), '발송일시': new Date(), '결과': result
    });
  } catch (e) {
    console.error('알림로그 기록 실패: ' + e);
  }
  return result;
}

// [솔라피 전용] API 인증 서명 함수 (현행 코드 그대로, 수정 금지)
function getSolapiAuth(apiKey, apiSecret) {
  const date = new Date().toISOString();
  const salt = Utilities.getUuid();
  const data = date + salt;
  const signature = Utilities.computeHmacSha256Signature(data, apiSecret);
  const hexSignature = signature.map(function (byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
  return 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date + ', salt=' + salt + ', signature=' + hexSignature;
}
