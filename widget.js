// 선택적 근무 트래커 — Scriptable 홈 화면 위젯
// 복사해서 Scriptable 앱에 붙여넣고 실행하세요.
// 첫 실행 시 이메일로 OTP 로그인, 이후엔 자동 갱신됩니다.

const SUPABASE_URL = 'https://osxyfdwmdbaorzomnbhq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1Ddi6JkAwadHTidc4JsrRQ_LyrFaGeF';
const WEEKLY_TARGET = 40;

const K_REFRESH = 'wt_refresh_token';
const K_EMAIL   = 'wt_email';

// ── 인증 ───────────────────────────────────────────────────────────────────

async function getAccessToken() {
  if (Keychain.contains(K_REFRESH)) {
    const rt = Keychain.get(K_REFRESH);
    const at = await refreshSession(rt);
    if (at) return at;
    Keychain.remove(K_REFRESH); // 만료 → 재로그인
  }
  return await login();
}

async function refreshSession(refreshToken) {
  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
  req.body = JSON.stringify({ refresh_token: refreshToken });
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
  // 이메일 입력
  const emailAlert = new Alert();
  emailAlert.title = '근무 트래커 로그인';
  emailAlert.message = '가입한 이메일을 입력하세요';
  const savedEmail = Keychain.contains(K_EMAIL) ? Keychain.get(K_EMAIL) : '';
  emailAlert.addTextField('이메일', savedEmail);
  emailAlert.addAction('인증코드 전송');
  emailAlert.addCancelAction('취소');
  const idx = await emailAlert.presentAlert();
  if (idx === -1) return null;

  const email = emailAlert.textFieldValue(0).trim();
  if (!email) return null;
  Keychain.set(K_EMAIL, email);

  // OTP 전송
  const sendReq = new Request(`${SUPABASE_URL}/auth/v1/otp`);
  sendReq.method = 'POST';
  sendReq.headers = { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY };
  sendReq.body = JSON.stringify({ email });
  await sendReq.load();

  // OTP 코드 입력
  const otpAlert = new Alert();
  otpAlert.title = '이메일 인증';
  otpAlert.message = `${email}로 전송된 6자리 코드를 입력하세요`;
  otpAlert.addTextField('코드 입력', '');
  otpAlert.addAction('확인');
  otpAlert.addCancelAction('취소');
  const otpIdx = await otpAlert.presentAlert();
  if (otpIdx === -1) return null;

  const otp = otpAlert.textFieldValue(0).trim();

  // OTP 검증
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

  const errAlert = new Alert();
  errAlert.title = '인증 실패';
  errAlert.message = '코드가 올바르지 않습니다. 다시 실행해 주세요.';
  errAlert.addAction('확인');
  await errAlert.presentAlert();
  return null;
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getWeekDates(anchor) {
  const d = new Date(anchor);
  const day = d.getDay(); // 0=일
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
  const remain = WEEKLY_TARGET - weekTotal;
  const pct = Math.min(1, weekTotal / WEEKLY_TARGET);

  const w = new ListWidget();
  w.backgroundColor = new Color('#111f18');
  w.setPadding(14, 16, 14, 16);

  // 날짜 헤더
  const now = new Date();
  const DAY = ['일','월','화','수','목','금','토'];
  const header = w.addText(`${now.getMonth()+1}/${now.getDate()}(${DAY[now.getDay()]})`);
  header.font = Font.mediumSystemFont(11);
  header.textColor = new Color('#7dd3a8');

  w.addSpacer(8);

  // 오늘 근무
  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const dot = row.addText(inProgress ? '🟢 ' : '  ');
  dot.font = Font.systemFont(11);
  const lbl = row.addText('오늘  ');
  lbl.font = Font.systemFont(12);
  lbl.textColor = new Color('#9ca3af');
  const val = row.addText(fmtH(todayH));
  val.font = Font.boldSystemFont(14);
  val.textColor = Color.white();

  w.addSpacer(8);

  // 주간 진행률
  const wkLabel = w.addText(`주간  ${fmtH(weekTotal)} / 40h`);
  wkLabel.font = Font.systemFont(11);
  wkLabel.textColor = new Color('#9ca3af');

  w.addSpacer(3);

  // 텍스트 프로그레스 바
  const BAR = 14;
  const filled = Math.round(pct * BAR);
  const bar = w.addText('█'.repeat(filled) + '░'.repeat(BAR - filled));
  bar.font = Font.monospacedSystemFont(9);
  bar.textColor = new Color('#4ade80');

  w.addSpacer(8);

  // 잔여 / 초과
  if (remain > 0) {
    const r = w.addText(`잔여  ${fmtH(remain)}`);
    r.font = Font.boldSystemFont(15);
    r.textColor = new Color('#fbbf24');
  } else {
    const r = w.addText(`초과  ${fmtH(-remain)} ✓`);
    r.font = Font.boldSystemFont(15);
    r.textColor = new Color('#4ade80');
  }

  w.refreshAfterDate = new Date(Date.now() + 5 * 60 * 1000); // 5분마다 갱신
  return w;
}

function buildMsgWidget(title, sub, color) {
  const w = new ListWidget();
  w.backgroundColor = new Color('#111f18');
  w.setPadding(14, 16, 14, 16);
  const t = w.addText(title);
  t.font = Font.boldSystemFont(13);
  t.textColor = new Color(color || '#ffffff');
  if (sub) {
    w.addSpacer(4);
    const s = w.addText(sub);
    s.font = Font.systemFont(11);
    s.textColor = new Color('#9ca3af');
  }
  return w;
}

// ── 메인 ───────────────────────────────────────────────────────────────────

async function main() {
  const token = await getAccessToken();
  if (!token) {
    const w = buildMsgWidget('로그인 필요', '위젯을 탭하세요', '#ef4444');
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
    const w = buildMsgWidget('불러오기 실패', '다시 탭하세요', '#ef4444');
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
