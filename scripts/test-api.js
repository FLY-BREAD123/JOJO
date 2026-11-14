/* 적야 인트라넷 API 통합 테스트
   임시 데이터 폴더로 서버를 띄워 전 기능을 확인한다.  실행: npm test */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jeokya-test-'));

let proc = null;
let fails = 0, passes = 0;
function chk(name, cond, extra) {
  if (cond) { passes++; console.log('  ok   ' + name); }
  else { fails++; console.log('  FAIL ' + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); }
}
async function j(p, { m = 'GET', b, t, raw } = {}) {
  const headers = {};
  if (t) headers.authorization = 'Bearer ' + t;
  if (b !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + '/api' + p, { method: m, headers, body: raw !== undefined ? raw : (b !== undefined ? JSON.stringify(b) : undefined) });
  let d = null;
  try { d = await res.json(); } catch (_) { /* no body */ }
  return { s: res.status, d };
}
function start() {
  return new Promise((resolve, reject) => {
    proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR, DISCORD_WEBHOOK_URL: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (c) => { out += c; if (out.includes('실행 중')) resolve(); });
    proc.stderr.on('data', (c) => process.stderr.write(c));
    proc.on('exit', (code) => reject(new Error('server exited ' + code)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}
function stop() {
  return new Promise((resolve) => {
    if (!proc) return resolve();
    proc.removeAllListeners('exit');
    proc.on('exit', () => resolve());
    proc.kill('SIGTERM');
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await start();
  console.log('server on ' + BASE + ' data=' + DATA_DIR);

  // ---- 1.x 데이터 이어받기 ----
  {
    const { migrate } = require('../lib/core');
    const old = {
      settings: { currency: '$' },
      members: [
        { id: 1, name: '첫가입', level: 1, status: 'active', pw: {} },
        { id: 2, name: '둘째', level: 1, status: 'active', pw: {} },
        { id: 3, name: '대기', level: 6, status: 'pending', pw: {} },
      ],
      activity: [{ id: 7, ts: 1, type: 'duty', uid: 1, text: 'x' }],
      reports: [
        { id: 1, type: 'store', result: 'success', participants: [1] },
        { id: 2, type: 'war', rival: '작두', result: 'win', land: 3000, participants: [1], title: '전쟁 vs 작두' },
      ],
    };
    migrate(old);
    chk('이전 전쟁 기록은 지상전쟁으로', old.reports[1].mode === 'ground' && old.reports[1].title === '지상전쟁 vs 작두' && old.reports[1].land === 3000 && old.version === 3, old.reports[1]);
    chk('이전 데이터: 첫 가입자가 개발자로', old.members[0].level === 0 && old.members[1].level === 1);
    chk('이전 데이터: 설정 화폐 유지, 가격표 추가', old.settings.currency === '$' && old.settings.guns.length === 6);
    const oldPrice = { settings: { guns: [{ id: 'rimpid', name: '림피드', group: '특총', price: 200000000 }, { id: 'amgusa', name: '암구사', group: '특총', price: 200000000 }] } };
    migrate(oldPrice);
    chk('저장돼 있던 옛 가격(2억)도 3억으로', oldPrice.settings.guns.find((g) => g.id === 'rimpid').price === 300000000 && oldPrice.settings.guns.find((g) => g.id === 'amgusa').price === 300000000 && oldPrice.settings.guns.length === 6, oldPrice.settings.guns);
    chk('이전 데이터: 로그 번호 이어감', old.seq.act === 7 && Array.isArray(old.warnings));
    migrate(old);
    chk('두 번 돌려도 개발자 한 명', old.members.filter((m) => m.level === 0).length === 1);
  }

  // ---- 가입 / 로그인 ----
  let r = await j('/auth/register', { m: 'POST', b: { username: 'Boss_1', name: '강도윤', password: 'crown' } });
  chk('첫 가입자 = 개발자, 바로 토큰', r.s === 200 && r.d.token && r.d.me.level === 0 && r.d.me.rank === '개발자' && r.d.me.perms.dev === true && r.d.me.perms.admin === true, r);
  chk('기본 화폐 원, 총기 가격표 (특총 3억)', r.d.settings.currency === '원' && r.d.settings.guns.length === 6 && r.d.settings.guns.find((g) => g.id === 'carbine').price === 40000000 && r.d.settings.guns.find((g) => g.id === 'rimpid').price === 300000000 && r.d.settings.guns.find((g) => g.id === 'amgusa').price === 300000000, r.d.settings);
  const tA = r.d.token;
  const bossId = r.d.me.id;
  chk('아이디 소문자 정규화', r.d.me.username === 'boss_1');
  chk('조직원 코드', r.d.me.code === 'JY-0001');

  r = await j('/auth/register', { m: 'POST', b: { username: 'hajin', name: '서하진', password: 'pass1' } });
  chk('두 번째 가입 = 승인 대기', r.s === 200 && r.d.pending === true && !r.d.token, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'hajin', password: 'pass1' } });
  chk('승인 전 로그인 거부 403', r.s === 403, r);
  r = await j('/auth/register', { m: 'POST', b: { username: 'hajin', name: 'x', password: 'pass1' } });
  chk('중복 아이디 409', r.s === 409, r);
  r = await j('/auth/register', { m: 'POST', b: { username: 'a!', name: 'x', password: 'pass1' } });
  chk('잘못된 아이디 400', r.s === 400, r);
  r = await j('/auth/register', { m: 'POST', b: { username: 'shortpw', name: 'x', password: '12' } });
  chk('짧은 비밀번호 400', r.s === 400, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'boss_1', password: 'nope' } });
  chk('틀린 비밀번호 401', r.s === 401, r);
  r = await j('/me');
  chk('토큰 없이 401', r.s === 401, r);

  r = await j('/admin/pending', { t: tA });
  chk('대기 목록 1명', r.s === 200 && r.d.pending.length === 1, r);
  const hajinId = r.d.pending[0].id;
  r = await j('/admin/approve', { m: 'POST', b: { id: hajinId }, t: tA });
  chk('승인', r.s === 200 && r.d.member.status === 'active', r);
  r = await j('/admin/approve', { m: 'POST', b: { id: hajinId }, t: tA });
  chk('중복 승인 409', r.s === 409, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'hajin', password: 'pass1' } });
  chk('승인 후 로그인', r.s === 200 && r.d.me.level === 6, r);
  const tB = r.d.token;

  r = await j('/admin/pending', { t: tB });
  chk('수습은 관리 403', r.s === 403, r);
  r = await j('/admin/rank', { m: 'POST', b: { id: hajinId, level: 3 }, t: tA });
  chk('간부로 승진', r.s === 200 && r.d.member.rank === '간부', r);
  r = await j('/admin/rank', { m: 'POST', b: { id: bossId, level: 2 }, t: tA });
  chk('자기 직급 변경 400', r.s === 400, r);
  r = await j('/admin/rank', { m: 'POST', b: { id: hajinId, level: 9 }, t: tA });
  chk('없는 직급 400', r.s === 400, r);
  r = await j('/admin/rank', { m: 'POST', b: { id: hajinId, level: 0 }, t: tA });
  chk('개발자 임명 불가 400', r.s === 400, r);

  // 세 번째 조직원
  await j('/auth/register', { m: 'POST', b: { username: 'taeo', name: '류태오', password: 'pass2' } });
  r = await j('/admin/pending', { t: tA });
  const taeoId = r.d.pending[0].id;
  await j('/admin/approve', { m: 'POST', b: { id: taeoId }, t: tA });
  r = await j('/auth/login', { m: 'POST', b: { username: 'taeo', password: 'pass2' } });
  const tC = r.d.token;
  chk('세 번째 로그인', r.s === 200 && !!tC, r);
  r = await j('/admin/rank', { m: 'POST', b: { id: taeoId, level: 5 }, t: tB });
  chk('간부는 인사 권한 없음 403', r.s === 403, r);
  r = await j('/admin/reject', { m: 'POST', b: { id: taeoId }, t: tA });
  chk('승인된 사람 거절 409', r.s === 409, r);

  // ---- 공지는 없어짐 ----
  r = await j('/notices', { t: tA });
  chk('공지 경로 없음 404', r.s === 404, r);

  // ---- 출근 ----
  r = await j('/duty/start', { m: 'POST', t: tC });
  chk('출근', r.s === 200 && !!r.d.me.onDutySince && !r.d.me.peakSince, r);
  r = await j('/duty/start', { m: 'POST', t: tC });
  chk('중복 출근 409', r.s === 409, r);
  r = await j('/duty/peak', { m: 'POST', t: tC });
  chk('피크 타임 시작', r.s === 200 && r.d.peak === true && r.d.started === false && !!r.d.me.peakSince, r);
  await sleep(700);
  r = await j('/duty/peak', { m: 'POST', t: tC });
  chk('피크 타임 끝', r.s === 200 && r.d.peak === false && r.d.ms >= 600 && !r.d.me.peakSince && r.d.me.sessPeakMs >= 600, r);
  await sleep(400);
  r = await j('/duty/stop', { m: 'POST', t: tC });
  chk('퇴근 + 근무/피크 기록', r.s === 200 && r.d.ms >= 1000 && r.d.peakMs >= 600 && r.d.peakMs <= r.d.ms && !r.d.me.onDutySince, r);
  r = await j('/duty/stop', { m: 'POST', t: tC });
  chk('중복 퇴근 409', r.s === 409, r);
  r = await j('/duty/me', { t: tC });
  chk('내 출퇴근 통계', r.s === 200 && r.d.sessions === 1 && r.d.days.length === 7 && r.d.weekMs >= 1000 && r.d.totalMs >= 1000 && r.d.weekPeakMs >= 600 && r.d.totalPeakMs >= 600, r);
  chk('오늘 막대에 피크 포함', r.d.days[6].peakMs >= 600, r.d.days[6]);
  r = await j('/duty/logs?mine=1', { t: tC });
  chk('내 기록 1건 + 피크', r.s === 200 && r.d.logs.length === 1 && r.d.logs[0].who === '류태오' && r.d.logs[0].peakMs >= 600, r);

  r = await j('/duty/peak', { m: 'POST', t: tC });
  chk('퇴근 상태에서 피크 = 출근과 동시에', r.s === 200 && r.d.started === true && !!r.d.me.onDutySince && !!r.d.me.peakSince, r);
  r = await j('/duty/force-stop', { m: 'POST', b: { id: taeoId }, t: tB });
  chk('간부가 수습 강제 퇴근 (피크 포함 종료)', r.s === 200 && r.d.ms >= 0, r);
  r = await j('/me', { t: tC });
  chk('강제 퇴근 후 피크도 꺼짐', !r.d.me.onDutySince && !r.d.me.peakSince, r.d.me);
  await j('/duty/start', { m: 'POST', t: tA });
  r = await j('/duty/force-stop', { m: 'POST', b: { id: bossId }, t: tB });
  chk('윗사람 강제 퇴근 403', r.s === 403, r);
  await j('/duty/peak', { m: 'POST', t: tA });
  r = await j('/overview', { t: tC });
  chk('대시보드: 근무 중 1명(보스, 피크)', r.s === 200 && r.d.onDuty.length === 1 && r.d.onDuty[0].id === bossId && r.d.stats.peakNow === 1, r && r.d && r.d.stats);
  chk('대시보드: 주간 순위', Array.isArray(r.d.top) && r.d.top.length >= 1 && 'weekPeakMs' in r.d.top[0]);
  await j('/duty/stop', { m: 'POST', t: tA });

  // ---- 전쟁 보고서 ----
  r = await j('/overview', { t: tC });
  chk('땅 번호 범위 (지상 5000~6000, 차량 3200~4000)', r.d.settings.warModes.ground.min === 5000 && r.d.settings.warModes.ground.max === 6000 && r.d.settings.warModes.vehicle.min === 3200 && r.d.settings.warModes.vehicle.max === 4000, r.d.settings.warModes);
  r = await j('/reports', { m: 'POST', b: { type: 'war', mode: 'ground', rival: '작두', result: 'win', land: 5432, participants: [hajinId, 999], body: '항만 교전' }, t: tC });
  chk('지상전쟁 승리 + 땅 5432', r.s === 200 && r.d.report.land === 5432 && r.d.report.mode === 'ground' && r.d.report.participants.length === 2 && r.d.report.title === '지상전쟁 vs 작두', r);
  const repId = r.d.report.id;
  r = await j('/reports', { m: 'POST', b: { type: 'store', rival: '작두', result: 'win' }, t: tC });
  chk('편의점 등 옛 유형 400', r.s === 400, r);
  r = await j('/reports', { m: 'POST', b: { type: 'war', rival: '작두', result: 'win', land: 5432 }, t: tC });
  chk('전쟁 방식 없음 400', r.s === 400 && r.d.error.includes('차량전쟁'), r);
  for (const [mode, land, ok] of [['ground', 5000, 1], ['ground', 6000, 1], ['ground', 4999, 0], ['ground', 6001, 0], ['ground', 3500, 0],
    ['vehicle', 3200, 1], ['vehicle', 4000, 1], ['vehicle', 3199, 0], ['vehicle', 4001, 0], ['vehicle', 5500, 0],
    ['ground', '5,432', 0], ['ground', 5432.5, 0], ['ground', '', 0], ['ground', null, 0], ['ground', '5432', 1]]) {
    r = await j('/reports', { m: 'POST', b: { type: 'war', mode, rival: '사쿠라', result: 'lose', land }, t: tC });
    chk('땅 번호 ' + mode + ' ' + JSON.stringify(land) + (ok ? ' 통과' : ' 거절'), ok ? r.s === 200 : (r.s === 400 && /땅 번호는 \d{4}~\d{4} 사이/.test(r.d.error)), r);
    if (ok) await j('/reports/' + r.d.report.id, { m: 'DELETE', t: tC });
  }
  r = await j('/reports', { m: 'POST', b: { type: 'vehicle', rival: '작두', result: 'lose', land: 3800 }, t: tC });
  chk('type=vehicle 줄임말도 받음', r.s === 200 && r.d.report.type === 'war' && r.d.report.mode === 'vehicle' && r.d.report.title === '차량전쟁 vs 작두', r);
  const vehId = r.d.report.id;
  r = await j('/reports', { m: 'POST', b: { type: 'war', mode: 'ground', rival: '없는조직', result: 'win', land: 5100 }, t: tC });
  chk('목록에 없는 상대 400', r.s === 400, r);
  r = await j('/reports', { m: 'POST', b: { type: 'war', mode: 'ground', rival: '작두', result: 'success', land: 5100 }, t: tC });
  chk('성공/실패 결과 400', r.s === 400, r);
  r = await j('/reports', { m: 'POST', b: { type: 'war', mode: 'ground', rival: '느와르', result: 'lose', land: 5999 }, t: tB });
  chk('지상전쟁 패배 땅 5999', r.s === 200, r);
  r = await j('/reports', { m: 'POST', b: { type: 'pvp', rival: '사쿠라', result: 'win' }, t: tC });
  chk('PVP 신청 방향 없음 400', r.s === 400 && r.d.error.includes('걸었는지'), r);
  r = await j('/reports', { m: 'POST', b: { type: 'pvp', mode: 'ground', rival: '사쿠라', result: 'win', challenger: 'us', participants: [hajinId], land: 5000 }, t: tC });
  chk('PVP 우리가 신청 + 승리 (땅·방식 무시)', r.s === 200 && r.d.report.challenger === 'us' && r.d.report.land === null && r.d.report.mode === null && r.d.report.title === 'PVP vs 사쿠라', r);
  r = await j('/reports', { m: 'POST', b: { type: 'pvp', rival: '작두', result: 'lose', challenger: 'them' }, t: tC });
  chk('PVP 상대가 신청 + 패배', r.s === 200, r);
  r = await j('/reports?type=pvp', { t: tA });
  chk('PVP 필터 2건', r.s === 200 && r.d.reports.length === 2 && r.d.reports.every((x) => x.type === 'pvp'), r.d.reports && r.d.reports.length);
  const T = r.d.total;
  chk('전체 집계', T.groundWin === 1 && T.groundLose === 1 && T.vehicleWin === 0 && T.vehicleLose === 1 && T.pvpWin === 1 && T.pvpLose === 1 && T.byUs === 1 && T.byThem === 1 && !('landWon' in T), T);
  const RV = r.d.rivals;
  chk('상대별 집계', RV['작두'].groundWin === 1 && RV['작두'].vehicleLose === 1 && RV['작두'].pvpLose === 1 && RV['작두'].byThem === 1 && RV['느와르'].groundLose === 1 && RV['사쿠라'].byUs === 1 && RV['사쿠라'].groundLose === 0, RV);
  r = await j('/reports?type=war', { t: tA });
  chk('전쟁 필터 3건 + 참여자 이름', r.d.reports.length === 3 && r.d.reports.some((x) => x.people.length === 2), r.d.reports.length);
  r = await j('/reports?type=ground', { t: tA });
  chk('지상전쟁 필터 2건', r.d.reports.length === 2 && r.d.reports.every((x) => x.mode === 'ground'), r.d.reports.length);
  r = await j('/reports?type=vehicle', { t: tA });
  chk('차량전쟁 필터 1건', r.d.reports.length === 1 && r.d.reports[0].id === vehId, r.d.reports.length);

  // ---- 조직 자금 ----
  r = await j('/ledger', { m: 'POST', b: { kind: 'in', amount: 5000, memo: '총기 판매: 카빈소총 1' }, t: tC });
  chk('입금 기록', r.s === 200 && r.d.balance === 5000, r);
  r = await j('/ledger', { t: tC });
  chk('잔액 5000', r.s === 200 && r.d.balance === 5000 && r.d.series.length === 14 && r.d.weekIn === 5000, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'out', amount: 100, memo: '탄약' }, t: tC });
  chk('수습 출금 403', r.s === 403, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'out', amount: 2000, memo: '차량 정비' }, t: tB });
  chk('간부 출금', r.s === 200 && r.d.balance === 3000, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'out', amount: 999999, memo: '과다' }, t: tB });
  chk('잔액 초과 출금 400', r.s === 400, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'in', amount: 0, memo: 'x' }, t: tC });
  chk('0원 입금 400', r.s === 400, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'in', amount: 700, memo: '' }, t: tC });
  chk('메모 없음 400', r.s === 400, r);
  r = await j('/ledger', { m: 'POST', b: { kind: 'in', amount: 700, memo: '구역 상납' }, t: tC });
  chk('수습 입금', r.s === 200 && r.d.balance === 3700, r);
  const entryId = r.d.entry.id;
  r = await j('/ledger/' + entryId, { m: 'DELETE', t: tB });
  chk('간부 장부 삭제 403', r.s === 403, r);
  r = await j('/ledger/' + entryId, { m: 'DELETE', t: tA });
  chk('보스 장부 삭제', r.s === 200 && r.d.balance === 3000, r);

  r = await j('/reports/' + repId, { m: 'DELETE', t: tA });
  chk('보스가 남의 보고서 삭제', r.s === 200, r);
  r = await j('/reports', { m: 'POST', b: { type: 'pvp', rival: '느와르', result: 'win', challenger: 'them' }, t: tB });
  const rep2 = r.d.report.id;
  r = await j('/reports/' + rep2, { m: 'DELETE', t: tC });
  chk('수습이 남의 보고서 삭제 403', r.s === 403, r);

  r = await j('/overview', { t: tA });
  chk('대시보드 통계', r.s === 200 && r.d.stats.balance === 3000 && r.d.stats.members === 3 && r.d.stats.pending === 0 && r.d.logs.length > 5 && r.d.lastLogId > 0 && !('notices' in r.d), r && r.d && r.d.stats);

  // ---- 로그 ----
  const lastId = r.d.lastLogId;
  r = await j('/logs?limit=5', { t: tC });
  chk('로그 목록 + 더 있음', r.s === 200 && r.d.logs.length === 5 && r.d.more === true && r.d.total > 10, r.d && r.d.logs && r.d.logs.length);
  r = await j('/logs?before=' + r.d.logs[4].id + '&limit=5', { t: tC });
  chk('로그 이어 보기', r.s === 200 && r.d.logs.every((x) => x.id < lastId), r.s);
  r = await j('/logs?group=duty&limit=200', { t: tC });
  chk('출퇴근 로그만', r.d.logs.length > 0 && r.d.logs.every((x) => x.type === 'duty') && r.d.logs.some((x) => x.ev === 'duty_on') && r.d.logs.some((x) => x.ev === 'peak_on'), r.d.logs.length);
  r = await j('/logs?group=report&limit=200', { t: tC });
  chk('보고서 로그 (땅 번호 쉼표 없음, 신청 방향)', r.d.logs.some((x) => x.ev === 'report_war' && x.text.startsWith('지상전쟁 결과: 적야 vs 작두, 승리 (땅 5432)')) && r.d.logs.some((x) => x.ev === 'report_war' && x.text.startsWith('차량전쟁 결과: 적야 vs 작두, 패배 (땅 3800)')) && !r.d.logs.some((x) => /땅 \d,\d/.test(x.text)) && r.d.logs.some((x) => x.ev === 'report_pvp' && x.text.includes('적야가 사쿠라에게 신청')), r.d.logs.map((x) => x.text));
  r = await j('/logs/since?after=' + lastId, { t: tC });
  chk('새 로그 없음', r.s === 200 && r.d.logs.length === 0 && r.d.lastId === lastId, r.d);
  await j('/duty/start', { m: 'POST', t: tB });
  r = await j('/logs/since?after=' + lastId, { t: tC });
  chk('새 로그 1건 (누가 했는지 포함)', r.d.logs.length === 1 && r.d.logs[0].ev === 'duty_on' && r.d.logs[0].by === hajinId && r.d.lastId === lastId + 1, r.d);
  await j('/duty/stop', { m: 'POST', t: tB });
  r = await j('/logs/export', { t: tC });
  chk('로그 저장(전체)', r.s === 200 && r.d.logs.length >= 20, r.d.logs && r.d.logs.length);

  // ---- 경고 ----
  r = await j('/admin/warn', { m: 'POST', b: { id: taeoId, reason: '피크 타임 무단 불참' }, t: tA });
  chk('경고 1회', r.s === 200 && r.d.count === 1 && r.d.warning.byName === '강도윤', r);
  const warnId = r.d.warning.id;
  r = await j('/admin/warn', { m: 'POST', b: { id: taeoId, reason: '' }, t: tA });
  chk('사유 없는 경고 400', r.s === 400, r);
  r = await j('/admin/warn', { m: 'POST', b: { id: taeoId, reason: '무전 수칙 위반' }, t: tA });
  chk('경고 2회 누적', r.s === 200 && r.d.count === 2, r);
  r = await j('/admin/warn', { m: 'POST', b: { id: taeoId, reason: 'x' }, t: tB });
  chk('간부는 경고 권한 없음 403', r.s === 403, r);
  r = await j('/admin/warn', { m: 'POST', b: { id: bossId, reason: 'x' }, t: tA });
  chk('자기 자신 경고 400', r.s === 400, r);
  r = await j('/warnings', { t: tC });
  chk('내 경고 내역', r.s === 200 && r.d.warnings.length === 2, r);
  r = await j('/warnings?uid=' + taeoId, { t: tB });
  chk('남의 경고 내역은 관리자만 403', r.s === 403, r);
  r = await j('/members', { t: tB });
  chk('명단에 경고 횟수', r.d.members.find((m) => m.id === taeoId).warnCount === 2);
  r = await j('/warnings/' + warnId, { m: 'DELETE', t: tA });
  chk('경고 취소', r.s === 200 && r.d.count === 1, r);
  r = await j('/me', { t: tC });
  chk('내 경고 횟수 1', r.d.me.warnCount === 1, r.d.me);

  // ---- 설정 ----
  r = await j('/admin/settings', { m: 'POST', b: { ranks: [{ name: '왕' }, { name: '재상' }, { name: '장군' }, { name: '기사' }, { name: '병사' }, { name: '견습' }], currency: '원' }, t: tA });
  chk('직급 이름 + 화폐 변경', r.s === 200 && r.d.settings.ranks[0].name === '왕' && r.d.settings.currency === '원', r);
  r = await j('/me', { t: tB });
  chk('바뀐 직급 이름 반영', r.d.me.rank === '장군', r);
  r = await j('/admin/settings', { m: 'POST', b: { ranks: [{ name: 'a' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }] }, t: tA });
  chk('중복 직급 이름 400', r.s === 400, r);
  r = await j('/admin/settings', { m: 'POST', b: { ranks: [{ name: '보스' }, { name: '부보스' }, { name: '간부' }, { name: '행동대장' }, { name: '조직원' }, { name: '수습' }], currency: '$' }, t: tA });
  chk('직급 원복', r.s === 200, r);
  r = await j('/admin/settings', { m: 'POST', b: { rivals: ['작두', '사쿠라', '느와르', '흑룡'] }, t: tA });
  chk('상대 조직 추가', r.s === 200 && r.d.settings.rivals.length === 4, r);
  r = await j('/admin/settings', { m: 'POST', b: { rivals: ['작두', '적야'] }, t: tA });
  chk('상대 목록에 적야 400', r.s === 400, r);
  r = await j('/admin/settings', { m: 'POST', b: { rivals: [] }, t: tA });
  chk('빈 상대 목록 400', r.s === 400, r);
  r = await j('/admin/settings', { m: 'POST', b: { rivals: ['작두', '사쿠라', '느와르'] }, t: tA });
  chk('상대 목록 원복', r.s === 200 && r.d.settings.rivals.join() === '작두,사쿠라,느와르', r);

  // ---- 비밀번호 ----
  r = await j('/admin/reset-password', { m: 'POST', b: { id: taeoId }, t: tA });
  chk('비밀번호 초기화', r.s === 200 && /^[0-9a-f]{8}$/.test(r.d.temp), r);
  const temp = r.d.temp;
  r = await j('/me', { t: tC });
  chk('초기화 후 기존 세션 만료', r.s === 401, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'taeo', password: temp } });
  chk('임시 비밀번호 로그인', r.s === 200, r);
  let tC2 = r.d.token;
  r = await j('/me/password', { m: 'POST', b: { current: 'wrong', next: 'abcd' }, t: tC2 });
  chk('현재 비밀번호 틀림 400', r.s === 400, r);
  r = await j('/me/password', { m: 'POST', b: { current: temp, next: 'newpass' }, t: tC2 });
  chk('비밀번호 변경', r.s === 200, r);
  r = await j('/me', { t: tC2 });
  chk('변경한 세션은 유지', r.s === 200, r);

  // ---- 백업 / 복원 ----
  r = await j('/admin/export', { t: tA });
  chk('백업 받기 (세션 제외)', r.s === 200 && r.d.backup.members.length === 3 && Object.keys(r.d.backup.sessions).length === 0, r && r.s);
  const backup = r.d.backup;
  r = await j('/admin/import', { m: 'POST', b: { backup: { members: 'x' } }, t: tA });
  chk('잘못된 백업 400', r.s === 400, r);
  r = await j('/admin/import', { m: 'POST', b: { backup }, t: tA });
  chk('복원', r.s === 200 && r.d.relogin === true, r);
  r = await j('/me', { t: tA });
  chk('복원 후 재로그인 필요', r.s === 401, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'boss_1', password: 'crown' } });
  const tA2 = r.d && r.d.token;
  chk('복원 후 로그인', r.s === 200 && !!tA2, r);
  r = await j('/ledger', { t: tA2 });
  chk('복원 후 데이터 유지', r.s === 200 && r.d.balance === 3000, r);

  // ---- 퇴장 ----
  r = await j('/auth/login', { m: 'POST', b: { username: 'taeo', password: 'newpass' } });
  tC2 = r.d.token;
  await j('/duty/start', { m: 'POST', t: tC2 });
  r = await j('/admin/kick', { m: 'POST', b: { id: taeoId, reason: '경고 누적' }, t: tA2 });
  chk('퇴장 (근무 중이면 자동 퇴근)', r.s === 200, r);
  r = await j('/me', { t: tC2 });
  chk('퇴장자 세션 만료', r.s === 401, r);
  r = await j('/auth/login', { m: 'POST', b: { username: 'taeo', password: 'newpass' } });
  chk('퇴장자 로그인 불가', r.s === 401, r);
  r = await j('/members', { t: tA2 });
  chk('명단에서 제외', r.s === 200 && r.d.members.length === 2, r);
  r = await j('/overview', { t: tA2 });
  chk('퇴장 로그 기록', r.d.logs.some((a) => a.type === 'kick' && a.ev === 'kick' && a.text.includes('경고 누적')), r.d.logs.slice(0, 3));
  r = await j('/reports', { t: tA2 });
  chk('퇴장자 이름은 기록에 남음', r.s === 200 && r.d.reports.some((x) => x.who === '류태오'));
  r = await j('/auth/login', { m: 'POST', b: { username: 'hajin', password: 'pass1' } });
  const tB2 = r.d.token;
  r = await j('/admin/kick', { m: 'POST', b: { id: bossId }, t: tB2 });
  chk('간부는 퇴장 권한 없음 403', r.s === 403, r);
  r = await j('/auth/register', { m: 'POST', b: { username: 'taeo', name: '류태오', password: 'again' } });
  chk('퇴장된 아이디 재가입 신청 가능', r.s === 200 && r.d.pending === true, r);

  // ---- 직급표 ----
  const FENCE = '`'.repeat(3);
  const I2 = '⁨⁨', I3 = '⁨⁨⁨';
  // 디스코드에서 그대로 복사한 글 (코드 칸, 보이지 않는 글자, 빈 칸 포함)
  const DISCORD = [
    '👑 ── 최고위직 ── 👑 [3]', I2, '', FENCE, '👑 두목: 삥땅(655) ', '👑 부두목 : 유지환(186) , 개미(232)', I3, FENCE, '', '',
    FENCE, '👑 ── 고위직 ── 👑 [3]', FENCE, '', I2, '', FENCE, '👑어퍼문원: 삐땅(985)', '', '⚜️고문: 탁강만(723)', '', '👑여심 저격: 수빈리아버거(4892)', I3, FENCE, '', '',
    FENCE, '👑 ── 일반직 ── 👑 [20]', FENCE, '', I2, '', FENCE, ' ',
    '👑 트리오 : 예성(13586) , 코코(12488) , 혜준(11089)', '', '👑 맹구 : 이아연(808)', '',
    '👑 아기천사 : 낚시왕(8733) , 닭고기투(11251) , 둥이(10095) , 에몽(8709), 옹삼이투(1773), 메시(8528)', '',
    '👑 외쳐 : 예엄줴줴이야(4508)', '', '👑 큰형님 :  파이브엠정우(270)', '', '👑 세아창규 : 신세아(162) , 신창규(161)', '',
    '👑 천연다연 : 다연(2419) , 천연 (1001)', '', '👑 여심저격 : 천빙(11872)', '', '👑 유지환  : 파인애플쿵야(909)', '',
    '👑 진진 : 진진(193)', '', '👑 :  짱아(10425) , 소연(6414) , 대차(1000) ', I3, FENCE, '', '',
    FENCE, '👑 ── 수습직 ── 👑 [7]', FENCE, '', I2, '', FENCE, '👑 수습직: 채유은(14504) , 굿땡(134) , 김강철(954) ,  , 반꾸(1471) ,  , 우와(13783) ', I3, FENCE, '', '',
    FENCE, '👑 ── 특수직 ── 👑 [0]', FENCE, '', I2, '', FENCE, I3, FENCE,
  ].join('\n');
  r = await j('/roster', { t: tB2 });
  let RO = r.d.roster;
  chk('직급표: 처음엔 적야 직급표로 채워짐', r.s === 200 && RO.tiers.map((t) => t.name + t.count).join(',') === '최고위직3,고위직3,일반직22,수습직5,특수직0' && RO.total === 33 && RO.titleCount === 17, RO.tiers && RO.tiers.map((t) => t.name + t.count));
  chk('직급표: 간부는 보기만', RO.canEdit === false);
  chk('직급표: 이름 없는 직급, 아이콘, 고유번호', RO.tiers[2].titles[10].name === '' && RO.tiers[2].titles[10].people.map((p) => p.name).join() === '짱아,소연,대차' && RO.tiers[1].titles[1].icon === '⚜️' && RO.tiers[0].titles[0].people[0].gid === '655', RO.tiers[2].titles[10]);
  chk('직급표: 디스코드 글 (인원 자동)', RO.text.includes('👑 ── 일반직 ── 👑 [22]') && RO.text.includes('⚜️ 고문 : 탁강만(723)') && RO.text.includes('👑 : 짱아(10425) , 소연(6414) , 대차(1000)') && RO.text.startsWith(FENCE), RO.text.slice(0, 120));
  r = await j('/roster', { m: 'POST', b: { op: 'tier.add', name: '특공대' }, t: tB2 });
  chk('직급표: 간부 편집 403', r.s === 403, r);
  r = await j('/roster', { m: 'POST', b: { op: 'import', text: DISCORD, dry: true }, t: tA2 });
  chk('디스코드 원문 미리보기 (빈 칸 무시)', r.s === 200 && r.d.preview.tiers === 5 && r.d.preview.titles === 17 && r.d.preview.people === 33 && r.d.preview.names.join() === '최고위직,고위직,일반직,수습직,특수직', r.d);
  r = await j('/roster', { t: tA2 });
  chk('미리보기는 바꾸지 않음', r.d.roster.updatedAt === null && r.d.roster.canEdit === true, r.d.roster.updatedAt);
  r = await j('/roster', { m: 'POST', b: { op: 'tier.add', name: '특공대' }, t: tA2 });
  chk('구분 추가', r.s === 200 && r.d.roster.tiers.length === 6 && r.d.roster.tiers[5].name === '특공대' && r.d.roster.byName === '강도윤', r);
  const spId = r.d.roster.tiers[5].id;
  r = await j('/roster', { m: 'POST', b: { op: 'tier.rename', id: spId, name: '특공' }, t: tA2 });
  chk('구분 이름 바꾸기', r.d.roster.tiers[5].name === '특공', r.d.roster.tiers[5]);
  r = await j('/roster', { m: 'POST', b: { op: 'tier.move', id: spId, dir: -1 }, t: tA2 });
  chk('구분 위로', r.d.roster.tiers.map((t) => t.name).join() === '최고위직,고위직,일반직,수습직,특공,특수직', r.d.roster.tiers.map((t) => t.name));
  r = await j('/roster', { m: 'POST', b: { op: 'title.add', tierId: spId, name: '행동대장', icon: ' 🔱 ' }, t: tA2 });
  chk('직급 추가 (아이콘 공백 제거)', r.s === 200 && r.d.roster.tiers[4].titles[0].name === '행동대장' && r.d.roster.tiers[4].titles[0].icon === '🔱', r.d.roster.tiers[4]);
  const hdId = r.d.roster.tiers[4].titles[0].id;
  r = await j('/roster', { m: 'POST', b: { op: 'title.add', tierId: spId, name: '', icon: '' }, t: tA2 });
  chk('이름·아이콘 둘 다 없으면 400', r.s === 400, r);
  r = await j('/roster', { m: 'POST', b: { op: 'person.add', titleId: hdId, name: '서하진', gid: '4321' }, t: tA2 });
  chk('사람 추가 + 인트라넷 계정 연결', r.s === 200 && r.d.roster.tiers[4].titles[0].people[0].uid === hajinId && r.d.roster.tiers[4].titles[0].people[0].onDuty === false && r.d.roster.total === 34, r.d.roster.tiers[4].titles[0]);
  const pId = r.d.roster.tiers[4].titles[0].people[0].id;
  await j('/duty/start', { m: 'POST', t: tB2 });
  r = await j('/roster', { t: tB2 });
  chk('근무 중 표시', r.d.roster.tiers[4].titles[0].people[0].onDuty === true);
  await j('/duty/stop', { m: 'POST', t: tB2 });
  for (const [b, name] of [[{ name: '', gid: '1' }, '이름 없음'], [{ name: '가', gid: '12a' }, '고유번호 숫자 아님'], [{ name: '가'.repeat(21) }, '이름 21자']]) {
    r = await j('/roster', { m: 'POST', b: { op: 'person.add', titleId: hdId, ...b }, t: tA2 });
    chk('사람 추가 거절: ' + name, r.s === 400, r);
  }
  r = await j('/roster', { m: 'POST', b: { op: 'person.add', titleId: 99999, name: '가' }, t: tA2 });
  chk('없는 직급 404', r.s === 404, r);
  r = await j('/roster', { m: 'POST', b: { op: 'nope' }, t: tA2 });
  chk('모르는 요청 400', r.s === 400, r);
  const doomokId = RO.tiers[0].titles[0].id;
  r = await j('/roster', { m: 'POST', b: { op: 'person.edit', id: pId, name: '서하진', gid: '4322', titleId: doomokId }, t: tA2 });
  chk('사람 수정 + 다른 직급으로 옮기기', r.s === 200 && r.d.roster.tiers[0].titles[0].people.map((p) => p.name + p.gid).join() === '삥땅655,서하진4322' && r.d.roster.tiers[4].titles[0].people.length === 0 && r.d.roster.tiers[0].count === 4, r.d.roster.tiers[0].titles[0]);
  r = await j('/roster', { m: 'POST', b: { op: 'title.edit', id: hdId, name: '행동대', icon: '⭐', tierId: RO.tiers[1].id }, t: tA2 });
  chk('직급 수정 + 다른 구분으로 옮기기', r.s === 200 && r.d.roster.tiers[1].titles.map((x) => x.icon + x.name).join() === '👑어퍼문원,⚜️고문,👑여심 저격,⭐행동대' && r.d.roster.tiers[4].titles.length === 0, r.d.roster.tiers[1].titles.map((x) => x.name));
  r = await j('/roster', { m: 'POST', b: { op: 'title.move', id: hdId, dir: -1 }, t: tA2 });
  chk('직급 위로', r.d.roster.tiers[1].titles.map((x) => x.name).join() === '어퍼문원,고문,행동대,여심 저격', r.d.roster.tiers[1].titles.map((x) => x.name));
  r = await j('/roster', { m: 'POST', b: { op: 'title.move', id: RO.tiers[1].titles[0].id, dir: -1 }, t: tA2 });
  chk('맨 위에서 위로는 그대로', r.s === 200 && r.d.roster.tiers[1].titles[0].name === '어퍼문원');
  r = await j('/roster', { m: 'POST', b: { op: 'person.remove', id: pId }, t: tA2 });
  chk('사람 빼기', r.s === 200 && r.d.roster.tiers[0].count === 3, r.d.roster.tiers[0]);
  r = await j('/roster', { m: 'POST', b: { op: 'title.remove', id: hdId }, t: tA2 });
  chk('직급 삭제', r.d.roster.tiers[1].titles.length === 3);
  r = await j('/roster', { m: 'POST', b: { op: 'tier.remove', id: spId }, t: tA2 });
  chk('구분 삭제', r.d.roster.tiers.length === 5 && r.d.roster.total === 33, r.d.roster.tiers.map((t) => t.name));
  const { parseRoster } = require('../lib/core');
  const back = parseRoster(r.d.roster.text);
  chk('내보낸 글을 다시 읽으면 같음', JSON.stringify(back.tiers.map((t) => [t.name, t.titles.map((x) => [x.icon, x.name, x.people.map((p) => p.name + '/' + p.gid)])])) === JSON.stringify(r.d.roster.tiers.map((t) => [t.name, t.titles.map((x) => [x.icon, x.name, x.people.map((p) => p.name + '/' + p.gid)])])));
  r = await j('/roster', { m: 'POST', b: { op: 'import', text: '아무 글' }, t: tA2 });
  chk('직급 없는 글 불러오기 400', r.s === 400 && r.d.error.includes('두목'), r);
  r = await j('/roster', { m: 'POST', b: { op: 'import', text: '두목 : 가(1)\n부두목 : 나(2) , 다' }, t: tA2 });
  chk('구분 없는 글은 기타로', r.s === 200 && r.d.roster.tiers.length === 1 && r.d.roster.tiers[0].name === '기타' && r.d.roster.total === 3 && r.d.roster.tiers[0].titles[1].people[1].gid === '', r.d.roster.tiers);
  r = await j('/roster', { m: 'POST', b: { op: 'import', text: DISCORD }, t: tA2 });
  chk('디스코드 원문으로 다시 불러오기', r.s === 200 && r.d.roster.total === 33 && r.d.roster.tiers[1].titles.map((x) => x.icon + x.name).join() === '👑어퍼문원,⚜️고문,👑여심 저격' && r.d.roster.tiers[2].titles[6].people[1].name === '천연', r.d.roster.tiers[1]);
  r = await j('/logs?group=people', { t: tA2 });
  chk('직급표 로그 (인사 분류)', r.d.logs.some((a) => a.type === 'roster' && a.text === '직급표: 행동대장에 서하진(4321) 추가 - 강도윤') && r.d.logs.some((a) => a.text.startsWith('직급표: 디스코드 글로 새로 불러옴 (구분 5개, 직급 17개, 33명)')), r.d.logs.filter((a) => a.type === 'roster').map((a) => a.text).slice(0, 6));

  // ---- 기타 ----
  r = await j('/nope', { t: tA2 });
  chk('없는 경로 404', r.s === 404, r);
  r = await j('/auth/login', { m: 'POST', raw: '{bad json' });
  chk('깨진 JSON 400', r.s === 400, r);
  for (let i = 0; i < 8; i++) await j('/auth/login', { m: 'POST', b: { username: 'hajin', password: 'bad' } });
  r = await j('/auth/login', { m: 'POST', b: { username: 'hajin', password: 'pass1' } });
  chk('로그인 연속 실패 잠금 429', r.s === 429, r);
  const page = await fetch(BASE + '/');
  const html = await page.text();
  chk('정적 index.html 제공', page.status === 200 && html.includes('적야'), page.status);
  const health = await fetch(BASE + '/healthz');
  chk('healthz', health.status === 200);

  // ---- 재시작 후 영속성 ----
  await stop();
  chk('data.json 저장됨', fs.existsSync(path.join(DATA_DIR, 'data.json')));
  await start();
  r = await j('/me', { t: tA2 });
  chk('재시작 후 세션 유지', r.s === 200 && r.d.me.name === '강도윤', r);
  r = await j('/ledger', { t: tA2 });
  chk('재시작 후 잔액 유지', r.s === 200 && r.d.balance === 3000, r);
  r = await j('/roster', { t: tA2 });
  chk('재시작 후 직급표 유지', r.s === 200 && r.d.roster.total === 33 && r.d.roster.byName === '강도윤', r.d && r.d.roster && r.d.roster.total);
  await stop();

  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  console.log(fails === 0 ? 'ALL_TESTS_PASSED' : 'TESTS_FAILED');
  process.exit(fails === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('TEST_CRASH', e);
  await stop();
  process.exit(1);
});
