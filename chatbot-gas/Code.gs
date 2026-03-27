// ─── Google Sheets DB ────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('work_logs');
  if (!sheet) {
    sheet = ss.insertSheet('work_logs');
    sheet.appendRow(['user_id', 'log_date', 'type', 'start_time', 'end_time', 'ext_mins']);
  }
  return sheet;
}

function getLogs(userId, fromDate, toDate) {
  const data = getSheet().getDataRange().getValues();
  const result = [];
  for (let i = 1; i < data.length; i++) {
    const [uid, log_date, type, start_time, end_time, ext_mins] = data[i];
    if (uid === userId && log_date >= fromDate && log_date <= toDate) {
      result.push({ log_date, type, start_time, end_time, ext_mins });
    }
  }
  return result.sort((a, b) => a.log_date.localeCompare(b.log_date));
}

function saveLog(userId, logDate, type, startTime, endTime, extMins) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === userId && data[i][1] === logDate) {
      sheet.getRange(i + 1, 1, 1, 6).setValues(
        [[userId, logDate, type, startTime || '', endTime || '', extMins || 0]]
      );
      return;
    }
  }
  sheet.appendRow([userId, logDate, type, startTime || '', endTime || '', extMins || 0]);
}

function deleteLog(userId, logDate) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === userId && data[i][1] === logDate) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────
function getKSTDate() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    date: kst.toISOString().slice(0, 10),
    time: kst.toISOString().slice(11, 16),
    dayOfWeek: ['일', '월', '화', '수', '목', '금', '토'][kst.getUTCDay()],
  };
}

function getWeekDates(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() + diff);
  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(mon);
    x.setUTCDate(mon.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

function logsToText(logs) {
  if (!logs.length) return '기록 없음';
  return logs.map(l =>
    `${l.log_date}(${['일','월','화','수','목','금','토'][new Date(l.log_date).getUTCDay()]}): ` +
    `유형=${l.type}, 출근=${l.start_time || '-'}, 퇴근=${l.end_time || '진행중'}, 외출=${l.ext_mins}분`
  ).join('\n');
}

// ─── 카카오 응답 포맷 ─────────────────────────────────────────────
function kakaoReply(text) {
  return {
    version: '2.0',
    template: { outputs: [{ simpleText: { text } }] },
  };
}

// ─── 메인 웹훅 ────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const userId = body?.userRequest?.user?.id || 'anonymous';
    const utterance = body?.userRequest?.utterance || '';

    const { date: today, time: now, dayOfWeek } = getKSTDate();
    const weekDates = getWeekDates(today);
    const logs = getLogs(userId, weekDates[0], weekDates[4]);

    const systemPrompt = `당신은 선택적 근무제 트래커 카카오톡 챗봇입니다.

현재: ${today}(${dayOfWeek}) ${now} KST
이번 주: ${weekDates[0]} ~ ${weekDates[4]}

근무 규칙:
- 주 40시간 목표
- 점심시간 12:00~13:00 자동 제외 (출퇴근 시간이 걸치면)
- 연차 = 8시간으로 계산
- 코어타임: 10:00~15:00

이번 주 기록:
${logsToText(logs)}

─────────────────────────────
사용자 메시지를 분석하고 다음 중 하나만 하세요:

[A] 기록 저장/수정이 필요하면 JSON 한 줄만 출력:
{"action":"save","date":"YYYY-MM-DD","type":"일반|연차|조퇴|외출","start":"HH:MM","end":"HH:MM","extMins":0}

[B] 기록 삭제가 필요하면:
{"action":"delete","date":"YYYY-MM-DD"}

[C] 조회/계산/질문이면 친절한 텍스트로 답변 (계산은 구체적 숫자 포함)

주의: JSON 응답 시 JSON만, 텍스트 응답 시 텍스트만 출력하세요.`;

    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: utterance }],
      }),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    const raw = result.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    try {
      const action = JSON.parse(raw);
      if (action.action === 'save') {
        saveLog(userId, action.date, action.type, action.start, action.end, action.extMins || 0);
        const lines = ['✅ 기록 저장 완료', `날짜: ${action.date}`, `유형: ${action.type}`];
        if (action.start) lines.push(`출근: ${action.start}`);
        if (action.end)   lines.push(`퇴근: ${action.end}`);
        if (action.extMins) lines.push(`외출: ${action.extMins}분`);
        return ContentService
          .createTextOutput(JSON.stringify(kakaoReply(lines.join('\n'))))
          .setMimeType(ContentService.MimeType.JSON);
      }
      if (action.action === 'delete') {
        deleteLog(userId, action.date);
        return ContentService
          .createTextOutput(JSON.stringify(kakaoReply(`🗑 ${action.date} 기록이 삭제됐어요.`)))
          .setMimeType(ContentService.MimeType.JSON);
      }
    } catch (_) {}

    return ContentService
      .createTextOutput(JSON.stringify(kakaoReply(raw)))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify(kakaoReply('잠시 오류가 발생했어요. 다시 시도해주세요.')))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
