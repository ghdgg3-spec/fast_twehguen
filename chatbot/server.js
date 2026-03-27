const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { getLogs, saveLog, deleteLog } = require('./db');

const app = express();
app.use(express.json());

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── 날짜 유틸 ────────────────────────────────────────────────
function getKSTDate() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return {
    date: kst.toISOString().slice(0, 10),            // 'YYYY-MM-DD'
    time: kst.toISOString().slice(11, 16),           // 'HH:MM'
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

// ─── 로그 → AI 컨텍스트 ──────────────────────────────────────
function logsToText(logs) {
  if (!logs.length) return '기록 없음';
  return logs.map(l =>
    `${l.log_date}(${['일','월','화','수','목','금','토'][new Date(l.log_date).getUTCDay()]}): ` +
    `유형=${l.type}, 출근=${l.start_time || '-'}, 퇴근=${l.end_time || '진행중'}, 외출=${l.ext_mins}분`
  ).join('\n');
}

// ─── 카카오 응답 포맷 ────────────────────────────────────────
function kakaoReply(text) {
  return {
    version: '2.0',
    template: { outputs: [{ simpleText: { text } }] },
  };
}

// ─── 메인 웹훅 ───────────────────────────────────────────────
app.post('/kakao', async (req, res) => {
  const userId    = req.body?.userRequest?.user?.id || 'anonymous';
  const utterance = req.body?.userRequest?.utterance || '';

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

  try {
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 512,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: utterance }],
    });

    const raw = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // JSON 액션 파싱 시도
    try {
      const action = JSON.parse(raw);

      if (action.action === 'save') {
        saveLog(userId, action.date, action.type, action.start, action.end, action.extMins || 0);
        const lines = [
          `✅ 기록 저장 완료`,
          `날짜: ${action.date}`,
          `유형: ${action.type}`,
        ];
        if (action.start) lines.push(`출근: ${action.start}`);
        if (action.end)   lines.push(`퇴근: ${action.end}`);
        if (action.extMins) lines.push(`외출: ${action.extMins}분`);
        return res.json(kakaoReply(lines.join('\n')));
      }

      if (action.action === 'delete') {
        deleteLog(userId, action.date);
        return res.json(kakaoReply(`🗑 ${action.date} 기록이 삭제됐어요.`));
      }
    } catch {
      // JSON 아님 → 그대로 텍스트 응답
    }

    res.json(kakaoReply(raw));

  } catch (err) {
    console.error('Claude API error:', err);
    res.json(kakaoReply('잠시 오류가 발생했어요. 다시 시도해주세요.'));
  }
});

// ─── 헬스체크 ────────────────────────────────────────────────
app.get('/', (_, res) => res.send('Work Tracker Chatbot 🟢'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
