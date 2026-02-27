// 선택적 근무 트래커 — Scriptable 홈 화면 위젯
// 복사해서 Scriptable 앱에 붙여넣고 실행하세요.
// 앱 내 실행 시: 팔레트 선택 → 로그인 (최초 1회 OTP)
// 위젯 자동 갱신: 5분 간격

const SUPABASE_URL = 'https://osxyfdwmdbaorzomnbhq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1Ddi6JkAwadHTidc4JsrRQ_LyrFaGeF';
const WEEKLY_TARGET = 40;

const K_REFRESH = 'wt_refresh_token';
const K_EMAIL   = 'wt_email';
const K_PALETTE = 'wt_palette';

// ── 팔레트 정의 ────────────────────────────────────────────────────────────
// 각 팔레트는 이미지에서 추출한 색으로 구성됩니다.
//
// bg        위젯 배경
// header    날짜 텍스트
// label     '오늘', '주간' 레이블
// value     오늘 시간 숫자
// barFill   프로그레스 바 채워진 부분
// barEmpty  프로그레스 바 빈 부분
// remain    잔여 시간 (목표 미달)
// done      초과 달성 텍스트

const PALETTES = {
  // ① Lazy Days — 파스텔: 크림 배경 + 세이지 그린 + 살구·핑크 포인트
  'Lazy Days': {
    bg:       '#FFFDE8',
    header:   '#8BAE96',
    label:    '#BCA89E',
    value:    '#4A2E28',
    barFill:  '#B8D4BC',
    barEmpty: '#F4D8D0',
    remain:   '#D47B6A',
    done:     '#8BAE96',
  },
  // ② Nature — 내추럴: 따뜻한 오프화이트 + 세이지 + 앰버 포인트
  'Nature': {
    bg:       '#F0EDDE',
    header:   '#5F8250',
    label:    '#9AA08A',
    value:    '#28381E',
    barFill:  '#82AA6C',
    barEmpty: '#CEC5A8',
    remain:   '#C07E34',
    done:     '#5F8250',
  },
  // ③ Fresh — 어스 다크: 짙은 레드브라운 배경 + 세이지 그린 + 스틸블루 포인트
  'Fresh': {
    bg:       '#190E08',
    header:   '#6B8A69',
    label:    '#7C6A60',
    value:    '#EFEFE1',
    barFill:  '#6B8A69',
    barEmpty: '#3A2418',
    remain:   '#80B5CE',
    done:     '#6B8A69',
  },
  // ④ Mono — 모노크롬: 순수 흑백 그레이스케일
  'Mono': {
    bg:       '#0A0A0A',
    header:   '#B0B0B0',
    label:    '#686868',
    value:    '#FFFFFF',
    barFill:  '#D0D0D0',
    barEmpty: '#262626',
    remain:   '#A0A0A0',
    done:     '#F0F0F0',
  },
};

const PALETTE_NAMES = Object.keys(PALETTES);

function getPalette() {
  const saved = Keychain.contains(K_PALETTE) ? Keychain.get(K_PALETTE) : null;
  return PALETTES[saved] || PALETTES['Fresh'];
}

// ── 팔레트 선택 UI ─────────────────────────────────────────────────────────

async function pickPalette() {
  const current = Keychain.contains(K_PALETTE) ? Keychain.get(K_PALETTE) : '(없음)';
  const alert = new Alert();
  alert.title = '테마 선택';
  alert.message = `현재: ${current}\n\n원하는 색상 테마를 고르세요`;
  for (const name of PALETTE_NAMES) alert.addAction(name);
  alert.addCancelAction('변경 안 함');
  const idx = await alert.presentAlert();
  if (idx >= 0 && idx < PALETTE_NAMES.length) {
    Keychain.set(K_PALETTE, PALETTE_NAMES[idx]);
  }
}

// ── 인증 ───────────────────────────────────────────────────────────────────

async function getAccessToken() {
  if (Keychain.contains(K_REFRESH)) {
    const rt = Keychain.get(K_REFRESH);
    const at = await refreshSession(rt);
    if (at) return at;
    Keychain.remove(K_REFRESH);
  }
  return await login();
}

async function refreshSession(rt) {
  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
  req.body = JSON.stringify({ refresh_token: rt });
  try {
    const res = await req.loadJSON();
    if (res.access_token) {
      if (res.refresh_token) Keychain.set(K_REFRESH, res.refresh_token);
      return res.access_token;
    }
  } catch(e) {}
  return null;
}

async function login() {
  const emailAlert = new Alert();
  emailAlert.title = '근무 트래커 로그인';
  emailAlert.message = '가입한 이메일을 입력하세요';
  emailAlert.addTextField('이메일', Keychain.contains(K_EMAIL) ? Keychain.get(K_EMAIL) : '');
  emailAlert.addAction('인증코드 전송');
  emailAlert.addCancelAction('취소');
  if ((await emailAlert.presentAlert()) === -1) return null;

  const email = emailAlert.textFieldValue(0).trim();
  if (!email) return null;
  Keychain.set(K_EMAIL, email);

  const sendReq = new Request(`${SUPABASE_URL}/auth/v1/otp`);
  sendReq.method = 'POST';
  sendReq.headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
  sendReq.body = JSON.stringify({ email });
  await sendReq.load();

  const otpAlert = new Alert();
  otpAlert.title = '이메일 인증';
  otpAlert.message = `${email}로 전송된 6자리 코드를 입력하세요`;
  otpAlert.addTextField('코드 입력', '');
  otpAlert.addAction('확인');
  otpAlert.addCancelAction('취소');
  if ((await otpAlert.presentAlert()) === -1) return null;

  const otp = otpAlert.textFieldValue(0).trim();

  const verifyReq = new Request(`${SUPABASE_URL}/auth/v1/verify`);
  verifyReq.method = 'POST';
  verifyReq.headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
  verifyReq.body = JSON.stringify({ email, token: otp, type: 'email' });
  try {
    const res = await verifyReq.loadJSON();
    if (res.access_token) {
      Keychain.set(K_REFRESH, res.refresh_token);
      return res.access_token;
    }
  } catch(e) {}

  const err = new Alert();
  err.title = '인증 실패';
  err.message = '코드가 올바르지 않습니다. 다시 실행해 주세요.';
  err.addAction('확인');
  await err.presentAlert();
  return null;
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDates(anchor) {
  const d = new Date(anchor);
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return Array.from({ length: 5 }, (_, i) => {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    return fmtDate(dd);
  });
}

async function fetchLogs(token, dates) {
  const url = `${SUPABASE_URL}/rest/v1/work_logs`
    + `?log_date=gte.${dates[0]}&log_date=lte.${dates[4]}`
    + `&select=log_date,type,start_time,end_time,ext_mins`;
  const req = new Request(url);
  req.headers = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}` };
  return await req.loadJSON();
}

// ── 시간 계산 ──────────────────────────────────────────────────────────────

function rawCalc(start, end, extMins) {
  const toMins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const s = toMins(start), e = toMins(end);
  if (e <= s) return 0;
  const ls = 12 * 60, le = 13 * 60;
  const lunch = (s < le && e > ls) ? Math.min(e, le) - Math.max(s, ls) : 0;
  return Math.max(0, e - s - lunch - (extMins || 0)) / 60;
}

function calcHours(log) {
  if (!log) return 0;
  if (log.type === '연차') return 8;
  if (!log.start_time) return 0;
  if (!log.end_time) {
    const now = new Date();
    const nowStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    return rawCalc(log.start_time, nowStr, log.ext_mins || 0);
  }
  return rawCalc(log.start_time, log.end_time, log.ext_mins || 0);
}

function fmtH(h) {
  if (h === 0) return '0h';
  const hh = Math.floor(Math.abs(h));
  const mm = Math.round((Math.abs(h) - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

// ── 위젯 UI ────────────────────────────────────────────────────────────────

function buildWidget(todayH, weekTotal, inProgress) {
  const p = getPalette();
  const remain = WEEKLY_TARGET - weekTotal;
  const pct = Math.min(1, weekTotal / WEEKLY_TARGET);

  const w = new ListWidget();
  w.backgroundColor = new Color(p.bg);
  w.setPadding(14, 16, 14, 16);

  // 날짜 헤더
  const now = new Date();
  const DAY = ['일','월','화','수','목','금','토'];
  const header = w.addText(`${now.getMonth()+1}/${now.getDate()}(${DAY[now.getDay()]})`);
  header.font = Font.mediumSystemFont(11);
  header.textColor = new Color(p.header);

  w.addSpacer(8);

  // 오늘 근무
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const dot = row.addText(inProgress ? '● ' : '○ ');
  dot.font = Font.systemFont(10);
  dot.textColor = inProgress ? new Color(p.done) : new Color(p.label);
  const lbl = row.addText('오늘  ');
  lbl.font = Font.systemFont(12);
  lbl.textColor = new Color(p.label);
  const val = row.addText(fmtH(todayH));
  val.font = Font.boldSystemFont(14);
  val.textColor = new Color(p.value);

  w.addSpacer(8);

  // 주간 진행률 레이블
  const wkLabel = w.addText(`주간  ${fmtH(weekTotal)} / 40h`);
  wkLabel.font = Font.systemFont(11);
  wkLabel.textColor = new Color(p.label);

  w.addSpacer(3);

  // 텍스트 프로그레스 바
  const BAR = 14;
  const filled = Math.round(pct * BAR);
  const barFilled = w.addText('█'.repeat(filled));
  barFilled.font = Font.monospacedSystemFont(9);
  barFilled.textColor = new Color(p.barFill);

  // 빈 부분을 같은 줄에 이어서 표현 (Stack으로 연결)
  // Scriptable은 인라인 스타일이 없으므로 Stack 사용
  // 단순하게 한 줄 텍스트로 구성 (색 분리 불가 → 빈 칸은 label 색)
  if (filled < BAR) {
    const barEmpty = w.addText('░'.repeat(BAR - filled));
    barEmpty.font = Font.monospacedSystemFont(9);
    barEmpty.textColor = new Color(p.barEmpty);
  }

  w.addSpacer(8);

  // 잔여 / 초과
  if (remain > 0) {
    const r = w.addText(`잔여  ${fmtH(remain)}`);
    r.font = Font.boldSystemFont(15);
    r.textColor = new Color(p.remain);
  } else {
    const r = w.addText(`초과  ${fmtH(-remain)} ✓`);
    r.font = Font.boldSystemFont(15);
    r.textColor = new Color(p.done);
  }

  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000);
  return w;
}

function buildMsgWidget(title, sub) {
  const p = getPalette();
  const w = new ListWidget();
  w.backgroundColor = new Color(p.bg);
  w.setPadding(14, 16, 14, 16);
  const t = w.addText(title);
  t.font = Font.boldSystemFont(13);
  t.textColor = new Color(p.remain);
  if (sub) {
    w.addSpacer(4);
    const s = w.addText(sub);
    s.font = Font.systemFont(11);
    s.textColor = new Color(p.label);
  }
  return w;
}

// ── 메인 ───────────────────────────────────────────────────────────────────

async function main() {
  // 앱 내 실행 시: 팔레트 선택 먼저
  if (config.runsInApp) {
    await pickPalette();
  }

  const token = await getAccessToken();
  if (!token) {
    const w = buildMsgWidget('로그인 필요', '위젯을 탭하세요');
    Script.setWidget(w);
    if (config.runsInApp) await w.presentSmall();
    Script.complete();
    return;
  }

  const today = fmtDate(new Date());
  const weekDates = getWeekDates(today);

  let logs;
  try {
    logs = await fetchLogs(token, weekDates);
    if (!Array.isArray(logs)) throw new Error('invalid');
  } catch(e) {
    Keychain.remove(K_REFRESH);
    const w = buildMsgWidget('불러오기 실패', '다시 탭하세요');
    Script.setWidget(w);
    if (config.runsInApp) await w.presentSmall();
    Script.complete();
    return;
  }

  const logMap = {};
  for (const l of logs) logMap[l.log_date] = l;

  let weekTotal = 0;
  for (const ds of weekDates) weekTotal += calcHours(logMap[ds]);

  const todayLog = logMap[today];
  const todayH   = calcHours(todayLog);
  const inProgress = !!(todayLog && todayLog.start_time && !todayLog.end_time);

  const w = buildWidget(todayH, weekTotal, inProgress);
  Script.setWidget(w);
  if (config.runsInApp) await w.presentSmall();
  Script.complete();
}

main();
