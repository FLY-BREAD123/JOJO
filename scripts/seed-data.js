/* 데모/미리보기용 예시 데이터.
   실제 서버는 이 파일을 쓰지 않는다 (build-demo.js와 화면 점검용). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JeokyaSeed = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function seed(D, opt) {
    const now = opt.now;
    const H = 3600000, M = 60000, DAY = 86400000, TZ = 9 * H;
    let s = 20261113;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const kstMidnight = (t) => Math.floor((t + TZ) / DAY) * DAY - TZ;
    const today0 = kstMidnight(now);
    const events = [];

    // [아이디, 이름, 직급, 합류(일 전)]
    const people = [
      ['dev', '한서율', 0, 44], ['boss', '강도윤', 1, 41], ['hajin', '서하진', 2, 39], ['taeo', '류태오', 3, 33],
      ['seojun', '민서준', 3, 28], ['jiho', '한지호', 4, 22], ['siwoo', '백시우', 5, 17],
      ['dogyeom', '윤도겸', 5, 12], ['ian', '차이안', 5, 8], ['serin', '오세린', 6, 3],
    ];
    const byName = {};
    people.forEach(([username, name, level, ago], i) => {
      const id = i + 1;
      const m = {
        id, code: 'JY-' + String(id).padStart(4, '0'), username, name, pw: opt.pw,
        level, status: 'active', joinedAt: today0 - ago * DAY + 21 * H, lastSeen: now - ri(1, 300) * M,
        onDutySince: null, peakSince: null, sessPeakMs: 0, totalMs: 0, totalPeakMs: 0,
      };
      D.members.push(m);
      byName[name] = m;
    });
    D.members.push({
      id: people.length + 1, code: 'JY-' + String(people.length + 1).padStart(4, '0'), username: 'mujin', name: '정무진', pw: opt.pw,
      level: 6, status: 'pending', joinedAt: now - 47 * M, lastSeen: null, onDutySince: null, peakSince: null, sessPeakMs: 0, totalMs: 0, totalPeakMs: 0,
    });
    D.seq.member = people.length + 1;
    const byId = (id) => D.members.find((m) => m.id === id);

    // 지난 8일치 출퇴근 (저녁~새벽 위주, 밤 9시 이후 구간 일부는 피크 타임)
    const logs = [];
    const busy = { 0: 0.3, 1: 0.55, 2: 0.8, 3: 0.75, 4: 0.7, 5: 0.65, 6: 0.5 };
    for (let d = 8; d >= 0; d--) {
      for (const m of D.members) {
        if (m.status !== 'active') continue;
        if (today0 - d * DAY < m.joinedAt - DAY) continue;
        const sessions = rnd() < busy[m.level] ? (rnd() < 0.3 ? 2 : 1) : 0;
        let cursor = today0 - d * DAY + ri(18, 22) * H + ri(0, 50) * M;
        for (let k = 0; k < sessions; k++) {
          const len = ri(35, 230) * M;
          const start = cursor, end = start + len;
          if (end > now - 20 * M) break;
          const peakMs = rnd() < 0.6 ? Math.round(len * (0.25 + rnd() * 0.55) / M) * M : 0;
          logs.push({ uid: m.id, start, end, ms: len, peakMs });
          cursor = end + ri(30, 120) * M;
        }
      }
    }
    logs.sort((a, b) => b.start - a.start);
    logs.forEach((l, i) => { l.id = logs.length - i; });
    D.duty = logs;
    D.seq.duty = logs.length;
    for (const l of logs) {
      const m = byId(l.uid);
      m.totalMs += l.ms;
      m.totalPeakMs += l.peakMs;
      events.push({ ts: l.start, type: 'duty', ev: 'duty_on', uid: l.uid, by: l.uid, text: m.name + '님이 출근했습니다' });
      events.push({ ts: l.end, type: 'duty', ev: 'duty_off', uid: l.uid, by: l.uid, text: m.name + '님이 퇴근했습니다 (' + dur(l.ms) + (l.peakMs ? ', 피크 ' + dur(l.peakMs) : '') + ')' });
    }

    // 지금 근무 중 (서하진, 백시우는 피크 타임 중)
    [['서하진', 72, 31], ['한지호', 25, 0], ['백시우', 123, 48]].forEach(([n, ago, peakAgo]) => {
      const m = byName[n];
      m.onDutySince = now - ago * M;
      events.push({ ts: m.onDutySince, type: 'duty', ev: 'duty_on', uid: m.id, by: m.id, text: n + '님이 출근했습니다' });
      if (peakAgo) {
        m.peakSince = now - peakAgo * M;
        events.push({ ts: m.peakSince, type: 'duty', ev: 'peak_on', uid: m.id, by: m.id, text: n + '님이 피크 타임에 들어갔습니다' });
      }
    });

    // 전쟁 보고서: [작성, 유형(ground/vehicle/pvp), 상대, 결과, 땅 번호 또는 신청(us/them), 함께, 메모, 며칠 전]
    const reps = [
      ['한지호', 'pvp', '작두', 'win', 'them', ['백시우', '윤도겸'], '작두 쪽에서 먼저 신청. 카빈 3:3.', 7.3],
      ['민서준', 'ground', '작두', 'lose', 5214, ['한지호', '백시우', '윤도겸'], '상대 증원으로 철수. 부상 1명.', 5.9],
      ['서하진', 'pvp', '사쿠라', 'win', 'us', ['류태오', '차이안'], '', 5.0],
      ['한지호', 'vehicle', '사쿠라', 'win', 3471, ['류태오', '백시우', '차이안'], '항만 도로 추격전. 전원 복귀.', 3.6],
      ['백시우', 'pvp', '느와르', 'lose', 'them', ['오세린'], '수습 동행. 다음엔 인원 보강.', 2.7],
      ['류태오', 'ground', '느와르', 'win', 5862, ['서하진', '민서준', '한지호', '윤도겸'], '선제 공격으로 거점 확보.', 1.4],
      ['차이안', 'pvp', '작두', 'win', 'us', ['윤도겸', '백시우'], '', 0.8],
      ['민서준', 'vehicle', '작두', 'win', 3906, ['한지호', '백시우', '차이안'], '설욕전. 피해 없음.', 0.35],
    ];
    const resultLabel = { win: '승리', lose: '패배' };
    let ledId = 0;
    const ledger = [];
    const modeName = { ground: '지상전쟁', vehicle: '차량전쟁' };
    reps.forEach(([who, kind, rival, result, extra, with_, body, daysAgo], i) => {
      const author = byName[who];
      const createdAt = now - Math.round(daysAgo * DAY);
      const type = kind === 'pvp' ? 'pvp' : 'war';
      const r = {
        id: i + 1, uid: author.id, type, mode: type === 'war' ? kind : null, rival, result, body,
        land: type === 'war' ? extra : null, challenger: type === 'pvp' ? extra : null,
        participants: [author.id].concat(with_.map((n) => byName[n].id)), createdAt, profit: 0, ledgerId: null,
        title: (type === 'war' ? modeName[kind] : 'PVP') + ' vs ' + rival,
      };
      D.reports.push(r);
      events.push(type === 'war'
        ? { ts: createdAt, type: 'report', ev: 'report_war', uid: author.id, by: author.id, text: modeName[kind] + ' 결과: 적야 vs ' + rival + ', ' + resultLabel[result] + ' (땅 ' + extra + ') - 보고 ' + author.name }
        : { ts: createdAt, type: 'report', ev: 'report_pvp', uid: author.id, by: author.id, text: 'PVP 결과: 적야 vs ' + rival + ', ' + resultLabel[result] + ' (' + (extra === 'us' ? '적야가 ' + rival + '에게 신청' : rival + (/[가-힣]/.test(rival) && (rival.charCodeAt(rival.length - 1) - 0xac00) % 28 ? '이' : '가') + ' 적야에게 신청') + ') - 보고 ' + author.name });
    });
    D.reports.sort((a, b) => b.createdAt - a.createdAt);
    D.seq.report = reps.length;

    // 장부 (직접 기록, 금액은 원)
    [
      ['서하진', 'in', 330000000, '총기 판매: 림피드 1, 카빈소총 1, 총알 6묶음', 6.8],
      ['류태오', 'out', 12000000, '차량 정비', 4.6],
      ['차이안', 'in', 85000000, '총기 판매: 카빈소총 2, 총알 1묶음', 3.4],
      ['서하진', 'out', 30000000, '장비 보급', 2.9],
      ['강도윤', 'out', 40000000, '전쟁 참여자 보너스', 2.0],
      ['한지호', 'in', 345000000, '총기 판매: 암구사 1, SMG 1, 총알 3묶음', 0.9],
      ['윤도겸', 'in', 30000000, '총기 판매: 권총 2', 0.2],
    ].forEach(([who, kind, amount, memo, daysAgo]) => {
      const m = byName[who];
      const e = { id: ++ledId, uid: m.id, kind, amount, memo, reportId: null, createdAt: now - Math.round(daysAgo * DAY) };
      ledger.push(e);
      events.push({ ts: e.createdAt, type: 'ledger', ev: kind === 'in' ? 'ledger_in' : 'ledger_out', uid: m.id, by: m.id, text: m.name + '님이 ' + comma(amount) + '원 ' + (kind === 'in' ? '입금' : '출금') + '을 기록했습니다: ' + memo });
    });
    ledger.sort((a, b) => b.createdAt - a.createdAt);
    D.ledger = ledger;
    D.seq.ledger = ledId;

    // 경고
    [
      ['윤도겸', '서하진', '정기 회의 무단 불참', 4.9],
      ['차이안', '서하진', '피크 타임 무단 불참', 3.2],
      ['차이안', '강도윤', '무전 수칙 위반', 1.1],
    ].forEach(([who, by, reason, daysAgo], i) => {
      const m = byName[who];
      const w = { id: i + 1, uid: m.id, by: byName[by].id, reason, createdAt: now - Math.round(daysAgo * DAY) };
      D.warnings.push(w);
      const count = D.warnings.filter((x) => x.uid === m.id).length;
      events.push({ ts: w.createdAt, type: 'warn', ev: 'warn', uid: m.id, by: byName[by].id, text: m.name + '님이 경고를 받았습니다 (누적 ' + count + '회): ' + reason });
    });
    D.warnings.sort((a, b) => b.createdAt - a.createdAt);
    D.seq.warning = 3;

    events.push({ ts: byName['오세린'].joinedAt, type: 'join', ev: 'join', uid: byName['오세린'].id, by: byName['서하진'].id, text: '오세린님이 수습으로 합류했습니다' });
    events.push({ ts: now - 1.6 * DAY, type: 'rank', ev: 'rank_up', uid: byName['한지호'].id, by: byName['강도윤'].id, text: '한지호님이 행동대장으로 승진했습니다' });

    events.sort((a, b) => b.ts - a.ts);
    D.activity = events.slice(0, 300).map((e, i) => ({ id: events.length - i, ...e }));
    D.seq.act = events.length;
    return D;
  }

  function comma(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function dur(ms) {
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + '분';
    return r ? h + '시간 ' + r + '분' : h + '시간';
  }

  return { seed };
});
