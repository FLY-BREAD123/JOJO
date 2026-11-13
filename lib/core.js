/* ============================================================
   적야 인트라넷 - 코어 로직
   서버(server.js)와 브라우저 데모(demo.html)가 같이 쓰는 순수 JS.
   Node 전용 API는 쓰지 않는다. 암호화/저장/알림은 env로 주입한다.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JeokyaCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TZ = 9 * 3600000;          // '오늘', '이번 주'는 한국 시간 기준
  const DAY = 86400000;
  const SESSION_TTL = 14 * DAY;
  const LOG_CAP = 20000;           // 로그는 최근 2만 건까지 보관

  // 직급: 0 = 개발자(최고 권한, 한 명), 1~6 = 조직 직급
  const DEV_LEVEL = 0;
  const DEFAULT_RANKS = [
    { name: '보스',     desc: '조직의 모든 결정을 내린다' },
    { name: '부보스',   desc: '보스를 보좌하고 조직 운영을 맡는다' },
    { name: '간부',     desc: '자금과 인원을 관리하고 부대를 이끈다' },
    { name: '행동대장', desc: '현장에서 작전을 지휘한다' },
    { name: '조직원',   desc: '작전을 수행하고 구역을 지킨다' },
    { name: '수습',     desc: '간부의 감독 아래 일을 배운다' },
  ];
  // 전쟁 보고서: 전쟁(지상전쟁·차량전쟁, 땅 번호) + PVP(지상전, 카빈 전용)
  const REPORT_TYPES = { war: '전쟁', pvp: 'PVP' };
  // 땅 번호는 쉼표 없이 네 자리 숫자로 적는다. 전쟁 방식마다 쓸 수 있는 범위가 다르다.
  const WAR_MODES = {
    ground:  { name: '지상전쟁', min: 5000, max: 6000 },
    vehicle: { name: '차량전쟁', min: 3200, max: 4000 },
  };
  const LEGACY_TYPES = { store: '편의점', atm: 'ATM', bank: '은행', jewelry: '보석상', op: '작전', deal: '거래', turf: '구역', meet: '회의', etc: '기타' };
  const RESULTS = { win: '승리', lose: '패배', success: '성공', fail: '실패', ongoing: '진행 중' };
  const DEFAULT_RIVALS = ['작두', '사쿠라', '느와르'];
  // 총기 가격 (원)
  const DEFAULT_GUNS = [
    { id: 'rimpid', name: '림피드', group: '특총', price: 200000000 },
    { id: 'amgusa', name: '암구사', group: '특총', price: 200000000 },
    { id: 'carbine', name: '카빈소총', group: '일반 총', price: 40000000 },
    { id: 'smg', name: 'SMG', group: '일반 총', price: 30000000 },
    { id: 'pistol', name: '권총', group: '일반 총', price: 15000000 },
    { id: 'ammo', name: '총알', group: '총알', price: 5000000, unit: '300발' },
  ];
  const LOG_GROUPS = { duty: ['duty'], report: ['report'], ledger: ['ledger'], people: ['join', 'rank', 'warn', 'kick', 'roster'] };

  /* ---------------- 직급표 ----------------
     구분(최고위직·고위직·…) > 직급(두목·부두목·…) > 사람(이름 + 고유번호).
     디스코드에 올리던 글 형식 그대로 불러오고 내보낸다. 인원 수는 자동으로 센다. */
  const ROSTER_LIMIT = { tiers: 20, titles: 40, people: 500, tier: 12, title: 16, icon: 12, name: 20 };
  // 처음 켤 때 한 번만 쓰는 적야 직급표 (2026-11-13 디스코드 기준)
  const ROSTER_SEED = [
    '👑 ── 최고위직 ── 👑',
    '👑 두목 : 삥땅(655)',
    '👑 부두목 : 유지환(186) , 개미(232)',
    '👑 ── 고위직 ── 👑',
    '👑 어퍼문원 : 삐땅(985)',
    '⚜️ 고문 : 탁강만(723)',
    '👑 여심 저격 : 수빈리아버거(4892)',
    '👑 ── 일반직 ── 👑',
    '👑 트리오 : 예성(13586) , 코코(12488) , 혜준(11089)',
    '👑 맹구 : 이아연(808)',
    '👑 아기천사 : 낚시왕(8733) , 닭고기투(11251) , 둥이(10095) , 에몽(8709) , 옹삼이투(1773) , 메시(8528)',
    '👑 외쳐 : 예엄줴줴이야(4508)',
    '👑 큰형님 : 파이브엠정우(270)',
    '👑 세아창규 : 신세아(162) , 신창규(161)',
    '👑 천연다연 : 다연(2419) , 천연(1001)',
    '👑 여심저격 : 천빙(11872)',
    '👑 유지환 : 파인애플쿵야(909)',
    '👑 진진 : 진진(193)',
    '👑 : 짱아(10425) , 소연(6414) , 대차(1000)',
    '👑 ── 수습직 ── 👑',
    '👑 수습직 : 채유은(14504) , 굿땡(134) , 김강철(954) , 반꾸(1471) , 우와(13783)',
    '👑 ── 특수직 ── 👑',
  ].join('\n');
  // 디스코드에서 복사하면 끼어드는 보이지 않는 글자 (이모지를 잇는 U+200D 는 남긴다)
  const INVISIBLE = /[\u200B\u200C\u200E\u200F\u2060-\u2069\uFEFF]/g;
  const LETTER = /[\p{L}\p{N}]/u;

  function trimDeco(v) {
    const a = Array.from(String(v || '').trim());
    while (a.length && !LETTER.test(a[0])) a.shift();
    while (a.length && !LETTER.test(a[a.length - 1])) a.pop();
    return a.join('');
  }
  function parsePerson(part) {
    const t = String(part || '').trim();
    if (!t) return null;
    const m = t.match(/^(.*?)\s*[(（]\s*(\d{1,10})\s*[)）]\s*$/);
    const name = (m ? m[1] : t).trim().slice(0, ROSTER_LIMIT.name);
    return name ? { name, gid: m ? m[2] : '' } : null;
  }
  // 디스코드 글 -> { tiers: [{ name, titles: [{ name, icon, people: [{ name, gid }] }] }] }
  function parseRoster(text) {
    const tiers = [];
    let tier = null;
    const lines = String(text == null ? '' : text).replace(INVISIBLE, '').replace(/\r\n?/g, '\n').split('\n');
    for (const raw of lines) {
      const line = raw.replace(/```[a-z]*/gi, '').trim();
      if (!line) continue;
      const h = line.match(/[─━—–=-]{2,}\s*(.*?)\s*[─━—–=-]{2,}/);
      if (h) {
        const name = trimDeco(h[1]).slice(0, ROSTER_LIMIT.tier);
        if (name) { tier = { name, titles: [] }; tiers.push(tier); }
        continue;
      }
      const ci = line.search(/[:：]/);
      if (ci < 0) continue;
      const left = Array.from(line.slice(0, ci));
      let k = 0;
      while (k < left.length && !LETTER.test(left[k])) k++;
      const icon = left.slice(0, k).join('').replace(/\s+/g, '').slice(0, ROSTER_LIMIT.icon);
      const name = left.slice(k).join('').trim().slice(0, ROSTER_LIMIT.title);
      const people = line.slice(ci + 1).split(/[,，、]/).map(parsePerson).filter(Boolean);
      if (!tier) { tier = { name: '기타', titles: [] }; tiers.push(tier); }
      tier.titles.push({ name, icon, people });
    }
    return { tiers };
  }
  const personLabel = (p) => p.name + (p.gid ? '(' + p.gid + ')' : '');
  // 직급표 -> 디스코드에 붙여넣을 글 (구분마다 제목 칸 + 직급 칸)
  function formatRoster(R) {
    const out = [];
    for (const t of R.tiers) {
      const n = t.titles.reduce((sum, x) => sum + x.people.length, 0);
      out.push('```\n👑 ── ' + t.name + ' ── 👑 [' + n + ']\n```');
      if (t.titles.length) {
        out.push('```\n' + t.titles.map((x) => [x.icon, x.name].filter(Boolean).join(' ') + ' : ' + x.people.map(personLabel).join(' , ')).join('\n\n') + '\n```');
      }
    }
    return out.join('\n');
  }
  // 저장된 직급표를 깨끗한 모양으로 맞춘다 (깨진 항목은 버린다)
  function normalizeRoster(R) {
    const ok = R && typeof R === 'object' && Array.isArray(R.tiers);
    const tiers = (ok ? R.tiers : []).filter((t) => t && typeof t.name === 'string' && Array.isArray(t.titles)).map((t) => ({
      id: Number(t.id) || 0, name: t.name,
      titles: t.titles.filter((x) => x && Array.isArray(x.people)).map((x) => ({
        id: Number(x.id) || 0, name: typeof x.name === 'string' ? x.name : '', icon: typeof x.icon === 'string' ? x.icon : '',
        people: x.people.filter((p) => p && typeof p.name === 'string' && p.name).map((p) => ({ id: Number(p.id) || 0, name: p.name, gid: /^\d{1,10}$/.test(String(p.gid || '')) ? String(p.gid) : '' })),
      })),
    }));
    return { tiers, updatedAt: ok && R.updatedAt ? R.updatedAt : null, by: ok && R.by ? R.by : null };
  }
  // 번호가 없거나 겹치는 항목에 새 번호를 준다
  function numberRoster(D) {
    const seen = new Set();
    let max = Number(D.seq.roster) || 0;
    const all = [];
    for (const t of D.roster.tiers) { all.push(t); for (const x of t.titles) { all.push(x); for (const p of x.people) all.push(p); } }
    for (const n of all) if (n.id > max) max = n.id;
    for (const n of all) {
      if (!n.id || seen.has(n.id)) n.id = ++max;
      seen.add(n.id);
    }
    D.seq.roster = max;
  }
  // 불러온 글로 직급표를 통째로 바꾼다
  function fillRoster(D, parsed) {
    D.roster.tiers = parsed.tiers.map((t) => ({ id: 0, name: t.name, titles: t.titles.map((x) => ({ id: 0, name: x.name, icon: x.icon, people: x.people.map((p) => ({ id: 0, name: p.name, gid: p.gid })) })) }));
    numberRoster(D);
  }
  const COLLECTIONS = ['members', 'duty', 'reports', 'ledger', 'notices', 'activity', 'warnings'];
  const SEQ_KEYS = { member: 'members', duty: 'duty', report: 'reports', ledger: 'ledger', notice: 'notices', act: 'activity', warning: 'warnings' };

  /* ---------------- 공용 유틸 ---------------- */
  function josa(word, pair) {
    const w = String(word);
    const c = w.charCodeAt(w.length - 1);
    const [withB, withoutB] = pair.split('/');
    if (c < 0xac00 || c > 0xd7a3) return w + withoutB;
    const jong = (c - 0xac00) % 28;
    if (pair === '으로/로') return w + (jong === 0 || jong === 8 ? '로' : '으로');
    return w + (jong ? withB : withoutB);
  }
  function fmtDur(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return '1분 미만';
    const h = Math.floor(m / 60), r = m % 60;
    if (!h) return r + '분';
    return r ? h + '시간 ' + r + '분' : h + '시간';
  }
  const comma = (n) => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function fmtMoney(n, cur) {
    const sign = n < 0 ? '-' : '';
    return /^[가-힣]/.test(cur || '') ? sign + comma(n) + cur : sign + (cur || '') + comma(n);
  }
  function dayStart(t) { return Math.floor((t + TZ) / DAY) * DAY - TZ; }
  function weekStart(t) {
    const d = new Date(t + TZ);
    const dow = (d.getUTCDay() + 6) % 7; // 월요일 = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - dow * DAY - TZ;
  }
  function overlap(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }

  const kindOf = (r) => (r.type === 'war' ? (WAR_MODES[r.mode] ? r.mode : 'ground') : r.type);
  const kindName = (r) => (r.type === 'war' ? WAR_MODES[kindOf(r)].name : REPORT_TYPES[r.type] || '');
  function warTitle(r) { return kindName(r) + (r.rival ? ' vs ' + r.rival : ''); }

  function migrate(D) {
    D = D && typeof D === 'object' ? D : {};
    D.version = 3;
    D.settings = D.settings && typeof D.settings === 'object' ? D.settings : {};
    const r = D.settings.ranks;
    if (!Array.isArray(r) || r.length !== 6 || r.some((x) => !x || typeof x.name !== 'string')) {
      D.settings.ranks = DEFAULT_RANKS.map((x) => ({ ...x }));
    }
    if (typeof D.settings.currency !== 'string' || !D.settings.currency.trim()) D.settings.currency = '원';
    const rv = D.settings.rivals;
    if (!Array.isArray(rv) || !rv.length || rv.some((x) => typeof x !== 'string' || !x.trim())) D.settings.rivals = DEFAULT_RIVALS.slice();
    const g = D.settings.guns;
    if (!Array.isArray(g) || !g.length || g.some((x) => !x || typeof x.name !== 'string' || !(x.price > 0))) D.settings.guns = DEFAULT_GUNS.map((x) => ({ ...x }));
    for (const k of COLLECTIONS) if (!Array.isArray(D[k])) D[k] = [];
    // 2.x 전쟁 기록은 지상전쟁으로 본다
    for (const r of D.reports) {
      if (r && r.type === 'war' && !WAR_MODES[r.mode]) { r.mode = 'ground'; r.title = warTitle(r); }
    }
    if (!D.sessions || typeof D.sessions !== 'object') D.sessions = {};
    D.seq = D.seq && typeof D.seq === 'object' ? D.seq : {};
    for (const [key, col] of Object.entries(SEQ_KEYS)) {
      const maxId = D[col].reduce((mx, x) => Math.max(mx, Number(x && x.id) || 0), 0);
      D.seq[key] = Math.max(Number(D.seq[key]) || 0, maxId);
    }
    // 직급표: 처음이면 적야 직급표로 채운다
    const firstRoster = !D.roster || !Array.isArray(D.roster.tiers);
    D.roster = normalizeRoster(D.roster);
    if (firstRoster) fillRoster(D, parseRoster(ROSTER_SEED));
    else numberRoster(D);
    // 개발자가 없으면 가장 먼저 가입한 조직원이 개발자가 된다 (1.x 데이터 포함)
    const active = D.members.filter((m) => m && m.status === 'active');
    if (active.length && !active.some((m) => m.level === DEV_LEVEL)) {
      active.reduce((a, b) => (a.id <= b.id ? a : b)).level = DEV_LEVEL;
    }
    return D;
  }
  function freshData() { return migrate({}); }

  /* ============================================================
     createCore(env)
       env.data            : 데이터 객체 (그대로 수정됨)
       env.save()          : 변경 후 호출 (저장)
       env.hashPassword(pw)        -> Promise<record>
       env.verifyPassword(pw, rec) -> Promise<boolean>
       env.token(bytes)    : 무작위 hex 문자열
       env.notify({title,text})    : 디스코드 등 외부 알림 (선택)
       env.now()           : 현재 시각 ms (선택, 테스트용)
     ============================================================ */
  function createCore(env) {
    const D = migrate(env.data);
    const now = () => (env.now ? env.now() : Date.now());
    const save = () => { if (env.save) env.save(); };
    const notify = (title, text) => {
      if (!env.notify) return;
      try { env.notify({ title, text }); } catch (_) { /* 알림 실패는 무시 */ }
    };
    const throttle = new Map();

    class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
    const fail = (status, message) => { throw new HttpError(status, message); };

    const rankName = (lv) => (lv === DEV_LEVEL ? '개발자' : (D.settings.ranks[lv - 1] || {}).name || '?');
    const isAdmin = (m) => m.level <= 2;
    const isOfficer = (m) => m.level <= 3;
    const byId = (id) => D.members.find((m) => m.id === Number(id));
    const nameOf = (id) => { const m = byId(id); return m ? m.name : '알 수 없음'; };
    const money = (n) => fmtMoney(n, D.settings.currency);
    const adminLabel = () => rankName(1) + '·' + rankName(2);
    const officerLabel = () => rankName(3) + ' 이상';

    function text(v, max, emptyMsg, longMsg) {
      const s = v == null ? '' : String(v).trim();
      if (!s && emptyMsg) fail(400, emptyMsg);
      if (s.length > max) fail(400, longMsg);
      return s;
    }
    function amount(v) {
      const n = Math.floor(Number(v));
      if (!Number.isFinite(n) || n < 1) fail(400, '금액은 1 이상으로 입력해 주세요');
      if (n > 1e12) fail(400, '금액이 너무 큽니다');
      return n;
    }

    /* 로그: type = 큰 분류(필터용), ev = 세부 사건(알림 소리용), by = 일으킨 사람 */
    function log(type, ev, uid, by, msg) {
      D.activity.unshift({ id: ++D.seq.act, ts: now(), type, ev, uid, by: by || null, text: msg });
      if (D.activity.length > LOG_CAP) D.activity.length = LOG_CAP;
    }

    function dutyMs(uid, a, b) {
      let sum = 0;
      for (const l of D.duty) if (l.uid === uid) sum += overlap(l.start, l.end, a, b);
      const m = byId(uid);
      if (m && m.onDutySince) sum += overlap(m.onDutySince, now(), a, b);
      return sum;
    }
    function balance() {
      return D.ledger.reduce((s, e) => s + (e.kind === 'in' ? e.amount : -e.amount), 0);
    }

    function pub(m) {
      return {
        id: m.id, code: m.code, username: m.username, name: m.name,
        level: m.level, rank: rankName(m.level), dev: m.level === DEV_LEVEL, status: m.status,
        joinedAt: m.joinedAt, lastSeen: m.lastSeen || null,
        onDutySince: m.onDutySince || null,
        peakSince: m.peakSince || null,
        sessPeakMs: m.onDutySince ? m.sessPeakMs || 0 : 0,
        totalMs: (m.totalMs || 0) + (m.onDutySince ? now() - m.onDutySince : 0),
        totalPeakMs: (m.totalPeakMs || 0) + curPeak(m),
        warnCount: D.warnings.reduce((n, w) => n + (w.uid === m.id ? 1 : 0), 0),
      };
    }
    function curPeak(m) {
      if (!m.onDutySince) return 0;
      return (m.sessPeakMs || 0) + (m.peakSince ? now() - m.peakSince : 0);
    }
    function peakSince(uid, a) {
      let sum = 0;
      for (const l of D.duty) if (l.uid === uid && l.peakMs && l.end >= a) sum += l.peakMs;
      const m = byId(uid);
      if (m) sum += curPeak(m);
      return sum;
    }
    function warnPub(w) { return { ...w, who: nameOf(w.uid), byName: nameOf(w.by) }; }
    function reportLabel(r) {
      if (REPORT_TYPES[r.type]) return warTitle(r);
      return r.title || LEGACY_TYPES[r.type] || '기타';
    }
    function mePayload(m) {
      return { ...pub(m), perms: { admin: isAdmin(m), officer: isOfficer(m), dev: m.level === DEV_LEVEL } };
    }
    function publicSettings() {
      return {
        orgName: '적야',
        currency: D.settings.currency,
        rivals: D.settings.rivals.slice(),
        warModes: JSON.parse(JSON.stringify(WAR_MODES)),
        guns: D.settings.guns.map((x) => ({ ...x })),
        ranks: D.settings.ranks.map((r, i) => ({ level: i + 1, name: r.name, desc: r.desc || '' })),
      };
    }
    function reportPub(r) {
      return {
        ...r, who: nameOf(r.uid),
        people: (r.participants || []).map((id) => ({ id, name: nameOf(id) })),
      };
    }

    /* ---------------- 세션 ---------------- */
    function newSession(m) {
      const t = now();
      for (const [k, s] of Object.entries(D.sessions)) if (s.exp < t) delete D.sessions[k];
      const token = env.token(32);
      D.sessions[token] = { uid: m.id, exp: t + SESSION_TTL };
      return token;
    }
    function revokeSessions(uid, keep) {
      for (const [k, s] of Object.entries(D.sessions)) if (s.uid === uid && k !== keep) delete D.sessions[k];
    }
    function authed(token) {
      const s = token ? D.sessions[token] : null;
      if (!s || s.exp < now()) {
        if (s) delete D.sessions[token];
        fail(401, '다시 로그인해 주세요');
      }
      const m = byId(s.uid);
      if (!m || m.status !== 'active') { delete D.sessions[token]; fail(401, '다시 로그인해 주세요'); }
      m.lastSeen = now();
      return m;
    }
    function checkThrottle(u) {
      const f = throttle.get(u);
      if (f && f.until > now()) fail(429, '로그인 시도가 너무 많습니다. 5분 뒤에 다시 시도하세요');
    }
    function noteFail(u) {
      const t = now();
      const f = throttle.get(u) || { n: 0, first: t, until: 0 };
      if (t - f.first > 10 * 60000) { f.n = 0; f.first = t; }
      f.n += 1;
      if (f.n >= 8) { f.until = t + 5 * 60000; f.n = 0; f.first = t; }
      throttle.set(u, f);
    }

    /* ---------------- 라우터 ---------------- */
    const routes = [];
    function on(method, pattern, opts, fn) {
      const keys = [];
      const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
      routes.push({ method, re, keys, opts, fn });
    }
    function target(id) {
      const m = byId(id);
      if (!m || m.status === 'removed') fail(404, '해당 조직원을 찾을 수 없습니다');
      return m;
    }

    /* ---------- 인증 ---------- */
    on('POST', '/auth/register', { auth: false }, async ({ body }) => {
      const username = String(body.username || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(username)) fail(400, '아이디는 영문 소문자, 숫자, 밑줄로 3~20자여야 합니다');
      const name = text(body.name, 16, '이름을 입력해 주세요', '이름은 16자까지 쓸 수 있습니다');
      const pw = String(body.password || '');
      if (pw.length < 4 || pw.length > 64) fail(400, '비밀번호는 4~64자로 정해 주세요');
      if (D.members.some((m) => m.username === username && m.status !== 'removed')) fail(409, '이미 쓰이는 아이디입니다');
      const first = !D.members.some((m) => m.status === 'active');
      const id = ++D.seq.member;
      const m = {
        id, code: 'JY-' + String(id).padStart(4, '0'), username, name,
        pw: await env.hashPassword(pw),
        level: first ? DEV_LEVEL : 6, status: first ? 'active' : 'pending',
        joinedAt: now(), lastSeen: null, onDutySince: null, totalMs: 0,
      };
      D.members.push(m);
      if (first) {
        log('rank', 'join', m.id, m.id, '개발자 ' + m.name + '님이 적야 인트라넷을 열었습니다');
        return { token: newSession(m), me: mePayload(m), settings: publicSettings() };
      }
      notify('가입 신청', m.name + ' (' + username + ') 님이 가입을 신청했습니다');
      return { pending: true };
    });

    on('POST', '/auth/login', { auth: false }, async ({ body }) => {
      const username = String(body.username || '').trim().toLowerCase();
      checkThrottle(username);
      const m = D.members.find((x) => x.username === username && x.status !== 'removed');
      const ok = m ? await env.verifyPassword(String(body.password || ''), m.pw) : false;
      if (!ok) { noteFail(username); fail(401, '아이디 또는 비밀번호가 맞지 않습니다'); }
      throttle.delete(username);
      if (m.status === 'pending') fail(403, '아직 가입 승인 전입니다. ' + adminLabel() + '에게 승인을 요청하세요');
      m.lastSeen = now();
      return { token: newSession(m), me: mePayload(m), settings: publicSettings() };
    });

    on('POST', '/auth/logout', {}, ({ token }) => { delete D.sessions[token]; });

    on('GET', '/me', {}, ({ me }) => ({ me: mePayload(me), settings: publicSettings() }));

    on('POST', '/me/password', {}, async ({ me, body, token }) => {
      if (!(await env.verifyPassword(String(body.current || ''), me.pw))) fail(400, '현재 비밀번호가 맞지 않습니다');
      const pw = String(body.next || '');
      if (pw.length < 4 || pw.length > 64) fail(400, '새 비밀번호는 4~64자로 정해 주세요');
      me.pw = await env.hashPassword(pw);
      revokeSessions(me.id, token);
    });

    /* ---------- 본부(대시보드) ---------- */
    on('GET', '/overview', {}, ({ me }) => {
      const t = now(), ws = weekStart(t);
      const active = D.members.filter((m) => m.status === 'active');
      const onDuty = active.filter((m) => m.onDutySince).sort((a, b) => a.onDutySince - b.onDutySince).map(pub);
      const top = active
        .map((m) => ({ ...pub(m), weekMs: dutyMs(m.id, ws, t + 1), weekPeakMs: peakSince(m.id, ws) }))
        .filter((x) => x.weekMs > 0)
        .sort((a, b) => b.weekMs - a.weekMs)
        .slice(0, 5);
      return {
        me: mePayload(me),
        settings: publicSettings(),
        stats: {
          members: active.length,
          onDuty: onDuty.length,
          peakNow: onDuty.filter((m) => m.peakSince).length,
          myWeekMs: dutyMs(me.id, ws, t + 1),
          balance: balance(),
          reportsWeek: D.reports.filter((r) => REPORT_TYPES[r.type] && r.createdAt >= ws).length,
          pending: isAdmin(me) ? D.members.filter((m) => m.status === 'pending').length : 0,
        },
        onDuty,
        top,
        logs: D.activity.slice(0, 12),
        lastLogId: D.activity.length ? D.activity[0].id : 0,
        serverTime: t,
      };
    });

    /* ---------- 로그 ---------- */
    on('GET', '/logs', {}, ({ query }) => {
      const types = LOG_GROUPS[query.group];
      const before = Number(query.before) || Infinity;
      const limit = Math.min(200, Math.max(1, Number(query.limit) || 60));
      const out = [];
      for (const a of D.activity) {
        if (a.id >= before) continue;
        if (types && !types.includes(a.type)) continue;
        out.push(a);
        if (out.length > limit) break;
      }
      return { logs: out.slice(0, limit), more: out.length > limit, total: D.activity.length };
    });

    // 새로 생긴 로그만 (실시간 알림용). 오래된 것부터 돌려준다.
    on('GET', '/logs/since', {}, ({ query }) => {
      const after = Number(query.after) || 0;
      const fresh = [];
      for (const a of D.activity) {
        if (a.id <= after) break;
        fresh.push(a);
        if (fresh.length >= 30) break;
      }
      return { logs: fresh.reverse(), lastId: D.activity.length ? D.activity[0].id : 0, serverTime: now() };
    });

    on('GET', '/logs/export', {}, () => ({ logs: D.activity, exportedAt: now() }));

    /* ---------- 출근 / 퇴근 / 피크 타임 ---------- */
    on('POST', '/duty/start', {}, ({ me }) => {
      if (me.onDutySince) fail(409, '이미 출근한 상태입니다');
      me.onDutySince = now();
      me.sessPeakMs = 0;
      me.peakSince = null;
      log('duty', 'duty_on', me.id, me.id, me.name + '님이 출근했습니다');
      notify('출근', rankName(me.level) + ' ' + me.name);
      return { me: mePayload(me) };
    });

    // 피크 타임: 출근 중에 켜고 끄는 구간. 퇴근 상태에서 누르면 출근과 동시에 시작한다.
    on('POST', '/duty/peak', {}, ({ me }) => {
      const t = now();
      if (me.peakSince) {
        const ms = Math.max(0, t - me.peakSince);
        me.sessPeakMs = (me.sessPeakMs || 0) + ms;
        me.peakSince = null;
        log('duty', 'peak_off', me.id, me.id, me.name + '님이 피크 타임을 마쳤습니다 (' + fmtDur(ms) + ')');
        notify('피크 타임 끝', rankName(me.level) + ' ' + me.name + ' / ' + fmtDur(ms));
        return { me: mePayload(me), peak: false, ms };
      }
      const started = !me.onDutySince;
      if (started) { me.onDutySince = t; me.sessPeakMs = 0; }
      me.peakSince = t;
      log('duty', 'peak_on', me.id, me.id, me.name + (started ? '님이 피크 타임으로 출근했습니다' : '님이 피크 타임에 들어갔습니다'));
      notify('피크 타임', rankName(me.level) + ' ' + me.name + (started ? ' (출근과 동시에)' : ''));
      return { me: mePayload(me), peak: true, started };
    });

    function stopDuty(m, by) {
      const end = now();
      const ms = Math.max(0, end - m.onDutySince);
      if (m.peakSince) { m.sessPeakMs = (m.sessPeakMs || 0) + Math.max(0, end - m.peakSince); m.peakSince = null; }
      const peakMs = Math.min(ms, m.sessPeakMs || 0);
      D.duty.unshift({ id: ++D.seq.duty, uid: m.id, start: m.onDutySince, end, ms, peakMs });
      if (D.duty.length > 8000) D.duty.length = 8000;
      m.totalMs = (m.totalMs || 0) + ms;
      m.totalPeakMs = (m.totalPeakMs || 0) + peakMs;
      m.onDutySince = null;
      m.sessPeakMs = 0;
      const detail = fmtDur(ms) + (peakMs ? ', 피크 ' + fmtDur(peakMs) : '');
      if (by && by.id !== m.id) log('duty', 'duty_off', m.id, by.id, by.name + '님이 ' + m.name + '님을 퇴근 처리했습니다 (' + detail + ')');
      else log('duty', 'duty_off', m.id, m.id, m.name + '님이 퇴근했습니다 (' + detail + ')');
      notify('퇴근', rankName(m.level) + ' ' + m.name + ' / ' + detail + (by && by.id !== m.id ? ' / 처리 ' + by.name : ''));
      return { ms, peakMs };
    }

    on('POST', '/duty/stop', {}, ({ me }) => {
      if (!me.onDutySince) fail(409, '출근한 상태가 아닙니다');
      const r = stopDuty(me);
      return { me: mePayload(me), ms: r.ms, peakMs: r.peakMs };
    });

    on('POST', '/duty/force-stop', { perm: 'officer' }, ({ me, body }) => {
      const m = target(body.id);
      if (!m.onDutySince) fail(409, m.name + '님은 출근한 상태가 아닙니다');
      if (m.id !== me.id && m.level <= me.level) fail(403, '자신보다 높거나 같은 직급은 퇴근 처리할 수 없습니다');
      return stopDuty(m, me);
    });

    on('GET', '/duty/me', {}, ({ me }) => {
      const t = now(), ds = dayStart(t), ws = weekStart(t);
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const a = ds - i * DAY, b = a + DAY;
        let peak = 0;
        for (const l of D.duty) if (l.uid === me.id && l.peakMs && l.start >= a && l.start < b) peak += l.peakMs;
        if (me.onDutySince && me.onDutySince >= a && me.onDutySince < b) peak += curPeak(me);
        days.push({ day: a, ms: dutyMs(me.id, a, b), peakMs: peak });
      }
      const p = pub(me);
      return {
        me: mePayload(me),
        weekMs: dutyMs(me.id, ws, t + 1),
        weekPeakMs: peakSince(me.id, ws),
        totalMs: p.totalMs,
        totalPeakMs: p.totalPeakMs,
        sessions: D.duty.filter((l) => l.uid === me.id).length,
        days,
        serverTime: t,
      };
    });

    on('GET', '/duty/logs', {}, ({ me, query }) => {
      const mine = query.mine === '1';
      const list = mine ? D.duty.filter((l) => l.uid === me.id) : D.duty;
      return {
        logs: list.slice(0, 120).map((l) => {
          const m = byId(l.uid);
          return { ...l, peakMs: l.peakMs || 0, who: m ? m.name : '알 수 없음', rank: m ? rankName(m.level) : '' };
        }),
      };
    });

    /* ---------- 전쟁 보고서 ---------- */
    on('GET', '/reports', {}, ({ query }) => {
      const all = D.reports.filter((r) => REPORT_TYPES[r.type]);
      const q = query.type;
      const list = q === 'war' || q === 'pvp' ? all.filter((r) => r.type === q)
        : WAR_MODES[q] ? all.filter((r) => r.type === 'war' && kindOf(r) === q) : all;
      const blank = () => ({ groundWin: 0, groundLose: 0, vehicleWin: 0, vehicleLose: 0, pvpWin: 0, pvpLose: 0, byUs: 0, byThem: 0 });
      const total = blank();
      const rivals = {};
      for (const name of D.settings.rivals) rivals[name] = blank();
      for (const r of all) {
        if (r.result !== 'win' && r.result !== 'lose') continue;
        const row = r.rival ? (rivals[r.rival] = rivals[r.rival] || blank()) : null;
        for (const s of row ? [total, row] : [total]) {
          if (r.type === 'war') {
            s[kindOf(r) + (r.result === 'win' ? 'Win' : 'Lose')] += 1;
          } else {
            if (r.result === 'win') s.pvpWin += 1; else s.pvpLose += 1;
            if (r.challenger === 'us') s.byUs += 1; else if (r.challenger === 'them') s.byThem += 1;
          }
        }
      }
      return { reports: list.slice(0, 200).map(reportPub), total, rivals, rivalList: D.settings.rivals.slice() };
    });

    on('POST', '/reports', {}, ({ me, body }) => {
      let type = body.type, mode = body.mode;
      if (WAR_MODES[type]) { mode = type; type = 'war'; }
      if (!REPORT_TYPES[type]) fail(400, '지상전쟁, 차량전쟁, PVP 중에서 골라 주세요');
      if (type === 'war' && !WAR_MODES[mode]) fail(400, '지상전쟁인지 차량전쟁인지 골라 주세요');
      const rival = String(body.rival || '').trim();
      if (!rival) fail(400, '상대 조직을 골라 주세요');
      if (!D.settings.rivals.includes(rival)) fail(400, '상대 조직을 다시 골라 주세요');
      const result = body.result;
      if (result !== 'win' && result !== 'lose') fail(400, '승리인지 패배인지 골라 주세요');
      let land = null, challenger = null;
      if (type === 'war') {
        const w = WAR_MODES[mode];
        const raw = String(body.land == null ? '' : body.land).trim();
        land = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
        if (!(land >= w.min && land <= w.max)) fail(400, w.name + ' 땅 번호는 ' + w.min + '~' + w.max + ' 사이로 적어 주세요');
      } else {
        mode = undefined;
        challenger = body.challenger;
        if (challenger !== 'us' && challenger !== 'them') fail(400, '누가 PVP를 걸었는지 골라 주세요');
      }
      const memo = text(body.body, 2000, '', '메모는 2000자까지 쓸 수 있습니다');
      const ids = Array.isArray(body.participants) ? body.participants.map(Number) : [];
      const participants = [me.id];
      for (const id of ids) {
        const m = byId(id);
        if (m && m.status === 'active' && !participants.includes(id)) participants.push(id);
        if (participants.length >= 40) break;
      }
      const r = {
        id: ++D.seq.report, uid: me.id, type, mode: mode || null, rival, result, land, challenger, body: memo,
        participants, createdAt: now(), profit: 0, ledgerId: null,
      };
      r.title = reportLabel(r);
      D.reports.unshift(r);
      const who = participants.map(nameOf).join(', ');
      if (type === 'war') {
        const wn = WAR_MODES[mode].name;
        log('report', 'report_war', me.id, me.id, wn + ' 결과: 적야 vs ' + rival + ', ' + RESULTS[result] + ' (땅 ' + land + ') - 보고 ' + me.name);
        notify(wn + ' ' + RESULTS[result], '적야 vs ' + rival + ' / 땅 ' + land + ' / 참여 ' + who);
      } else {
        const by = challenger === 'us' ? '적야가 ' + josa(rival, '에게/에게') + ' 신청' : josa(rival, '이/가') + ' 적야에게 신청';
        log('report', 'report_pvp', me.id, me.id, 'PVP 결과: 적야 vs ' + rival + ', ' + RESULTS[result] + ' (' + by + ') - 보고 ' + me.name);
        notify('PVP ' + RESULTS[result], '적야 vs ' + rival + ' / ' + by + ' / 지상전 카빈 / 참여 ' + who);
      }
      return { report: reportPub(r) };
    });

    on('DELETE', '/reports/:id', {}, ({ me, params }) => {
      const r = D.reports.find((x) => x.id === Number(params.id));
      if (!r) fail(404, '보고서를 찾을 수 없습니다');
      if (r.uid !== me.id && !isOfficer(me)) fail(403, '작성자나 ' + officerLabel() + '만 지울 수 있습니다');
      D.reports = D.reports.filter((x) => x !== r);
    });

    /* ---------- 조직 자금 ---------- */
    function addLedger(me, kind, amt, memo, reportId) {
      const e = { id: ++D.seq.ledger, uid: me.id, kind, amount: amt, memo, reportId: reportId || null, createdAt: now() };
      D.ledger.unshift(e);
      if (D.ledger.length > 5000) D.ledger.length = 5000;
      log('ledger', kind === 'in' ? 'ledger_in' : 'ledger_out', me.id, me.id,
        me.name + '님이 ' + money(amt) + ' ' + (kind === 'in' ? '입금' : '출금') + '을 기록했습니다: ' + memo);
      notify(kind === 'in' ? '입금' : '출금', money(amt) + ' / ' + memo + ' / 기록 ' + me.name + ' / 잔액 ' + money(balance()));
      return e;
    }

    on('GET', '/ledger', {}, () => {
      const t = now(), ds = dayStart(t), ws = weekStart(t);
      const series = [];
      for (let i = 13; i >= 0; i--) {
        const a = ds - i * DAY, b = a + DAY;
        let inn = 0, out = 0;
        for (const e of D.ledger) if (e.createdAt >= a && e.createdAt < b) { if (e.kind === 'in') inn += e.amount; else out += e.amount; }
        series.push({ day: a, in: inn, out });
      }
      let weekIn = 0, weekOut = 0;
      for (const e of D.ledger) if (e.createdAt >= ws) { if (e.kind === 'in') weekIn += e.amount; else weekOut += e.amount; }
      return {
        balance: balance(), weekIn, weekOut, series,
        entries: D.ledger.slice(0, 200).map((e) => ({ ...e, who: nameOf(e.uid) })),
      };
    });

    on('POST', '/ledger', {}, ({ me, body }) => {
      const kind = body.kind === 'out' ? 'out' : 'in';
      if (kind === 'out' && !isOfficer(me)) fail(403, '출금은 ' + officerLabel() + '만 기록할 수 있습니다');
      const amt = amount(body.amount);
      const memo = text(body.memo, 80, '메모를 입력해 주세요', '메모는 80자까지 쓸 수 있습니다');
      if (kind === 'out' && amt > balance()) fail(400, '잔액보다 많이 출금할 수 없습니다');
      const e = addLedger(me, kind, amt, memo);
      return { entry: { ...e, who: me.name }, balance: balance() };
    });

    on('DELETE', '/ledger/:id', { perm: 'admin' }, ({ params }) => {
      const e = D.ledger.find((x) => x.id === Number(params.id));
      if (!e) fail(404, '기록을 찾을 수 없습니다');
      D.ledger = D.ledger.filter((x) => x !== e);
      return { balance: balance() };
    });

    /* ---------- 조직원 ---------- */
    on('GET', '/members', {}, () => {
      const t = now(), ws = weekStart(t);
      const members = D.members
        .filter((m) => m.status === 'active')
        .map((m) => ({ ...pub(m), weekMs: dutyMs(m.id, ws, t + 1), weekPeakMs: peakSince(m.id, ws) }))
        .sort((a, b) => a.level - b.level || a.id - b.id);
      return { members, settings: publicSettings() };
    });

    /* ---------- 관리 ---------- */
    on('GET', '/admin/pending', { perm: 'admin' }, () => ({
      pending: D.members.filter((m) => m.status === 'pending').map(pub),
    }));

    on('POST', '/admin/approve', { perm: 'admin' }, ({ me, body }) => {
      const m = target(body.id);
      if (m.status !== 'pending') fail(409, '이미 처리된 신청입니다');
      m.status = 'active';
      m.joinedAt = now();
      log('join', 'join', m.id, me.id, m.name + '님이 ' + josa(rankName(m.level), '으로/로') + ' 합류했습니다');
      notify('합류', rankName(m.level) + ' ' + m.name);
      return { member: pub(m) };
    });

    on('POST', '/admin/reject', { perm: 'admin' }, ({ body }) => {
      const m = target(body.id);
      if (m.status !== 'pending') fail(409, '이미 처리된 신청입니다');
      D.members = D.members.filter((x) => x !== m);
    });

    on('POST', '/admin/rank', { perm: 'admin' }, ({ me, body }) => {
      const m = target(body.id);
      if (m.status !== 'active') fail(409, '승인된 조직원만 직급을 바꿀 수 있습니다');
      if (m.id === me.id) fail(400, '자기 직급은 바꿀 수 없습니다');
      if (m.level <= me.level) fail(403, '자신보다 높거나 같은 직급은 바꿀 수 없습니다');
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 1 || level > 6) fail(400, '직급을 다시 골라 주세요');
      if (level < me.level) fail(403, '자신보다 높은 직급으로는 임명할 수 없습니다');
      if (level === m.level) return { member: pub(m) };
      const up = level < m.level;
      m.level = level;
      log('rank', up ? 'rank_up' : 'rank_down', m.id, me.id, m.name + '님이 ' + josa(rankName(level), '으로/로') + (up ? ' 승진했습니다' : ' 강등됐습니다'));
      notify(up ? '승진' : '강등', m.name + ' → ' + rankName(level));
      return { member: pub(m) };
    });

    /* 퇴장: 접속을 끊고 로그인을 막는다. 남긴 기록과 경고 내역은 그대로 둔다. */
    function kick(me, id, reason) {
      const m = target(id);
      if (m.id === me.id) fail(400, '자기 자신은 퇴장시킬 수 없습니다');
      if (m.status === 'active' && m.level <= me.level) fail(403, '자신보다 높거나 같은 직급은 퇴장시킬 수 없습니다');
      if (m.onDutySince) stopDuty(m, me);
      revokeSessions(m.id);
      m.status = 'removed';
      m.username = null;
      m.removedAt = now();
      m.removedReason = reason || '';
      log('kick', 'kick', m.id, me.id, m.name + '님이 퇴장 처리됐습니다' + (reason ? ' (사유: ' + reason + ')' : ''));
      notify('퇴장', m.name + (reason ? ' / 사유: ' + reason : '') + ' / 처리 ' + me.name);
    }
    on('POST', '/admin/kick', { perm: 'admin' }, ({ me, body }) => {
      kick(me, body.id, text(body.reason, 100, '', '사유는 100자까지 쓸 수 있습니다'));
    });
    on('DELETE', '/admin/members/:id', { perm: 'admin' }, ({ me, params }) => { kick(me, params.id, ''); });

    /* 경고: 보스·부보스(와 개발자)가 아랫사람에게 준다. 누적 횟수는 모두에게 보인다. */
    on('POST', '/admin/warn', { perm: 'admin' }, ({ me, body }) => {
      const m = target(body.id);
      if (m.status !== 'active') fail(409, '승인된 조직원에게만 경고할 수 있습니다');
      if (m.id === me.id) fail(400, '자기 자신에게는 경고할 수 없습니다');
      if (m.level <= me.level) fail(403, '자신보다 높거나 같은 직급에게는 경고할 수 없습니다');
      const reason = text(body.reason, 100, '경고 사유를 입력해 주세요', '사유는 100자까지 쓸 수 있습니다');
      const w = { id: ++D.seq.warning, uid: m.id, by: me.id, reason, createdAt: now() };
      D.warnings.unshift(w);
      const count = D.warnings.filter((x) => x.uid === m.id).length;
      log('warn', 'warn', m.id, me.id, m.name + '님이 경고를 받았습니다 (누적 ' + count + '회): ' + reason);
      notify('경고', m.name + ' / 누적 ' + count + '회 / 사유: ' + reason + ' / 처리 ' + me.name);
      return { warning: warnPub(w), count };
    });

    on('GET', '/warnings', {}, ({ me, query }) => {
      const uid = query.uid ? Number(query.uid) : me.id;
      if (uid !== me.id && !isAdmin(me)) fail(403, '다른 사람의 경고 내역은 ' + adminLabel() + '만 볼 수 있습니다');
      return { warnings: D.warnings.filter((w) => w.uid === uid).map(warnPub) };
    });

    on('DELETE', '/warnings/:id', { perm: 'admin' }, ({ me, params }) => {
      const w = D.warnings.find((x) => x.id === Number(params.id));
      if (!w) fail(404, '경고를 찾을 수 없습니다');
      const m = byId(w.uid);
      if (m && m.id === me.id) fail(403, '자기 경고는 취소할 수 없습니다');
      if (m && m.status === 'active' && m.level <= me.level) fail(403, '자신보다 높거나 같은 직급의 경고는 취소할 수 없습니다');
      D.warnings = D.warnings.filter((x) => x !== w);
      log('warn', 'warn_cancel', w.uid, me.id, nameOf(w.uid) + '님의 경고 1회가 취소됐습니다');
      return { count: D.warnings.filter((x) => x.uid === w.uid).length };
    });

    on('POST', '/admin/reset-password', { perm: 'admin' }, async ({ me, body }) => {
      const m = target(body.id);
      if (m.status !== 'active') fail(409, '승인된 조직원만 초기화할 수 있습니다');
      if (m.id !== me.id && m.level <= me.level) fail(403, '자신보다 높거나 같은 직급은 초기화할 수 없습니다');
      const temp = env.token(4);
      m.pw = await env.hashPassword(temp);
      revokeSessions(m.id);
      return { temp };
    });

    /* ---------- 직급표 ---------- */
    function rosterPub(me) {
      const R = D.roster;
      const byName = new Map();
      for (const m of D.members) if (m.status === 'active') byName.set(m.name, m);
      let total = 0, titleCount = 0;
      const tiers = R.tiers.map((t) => {
        let count = 0;
        const titles = t.titles.map((x) => {
          titleCount += 1;
          count += x.people.length;
          return {
            id: x.id, name: x.name, icon: x.icon,
            people: x.people.map((p) => {
              const m = byName.get(p.name);
              return { id: p.id, name: p.name, gid: p.gid, uid: m ? m.id : null, onDuty: !!(m && m.onDutySince) };
            }),
          };
        });
        total += count;
        return { id: t.id, name: t.name, count, titles };
      });
      return {
        tiers, total, titleCount, updatedAt: R.updatedAt, byName: R.by ? nameOf(R.by) : null,
        text: formatRoster(R), canEdit: isAdmin(me),
      };
    }
    function findTier(id) {
      const t = D.roster.tiers.find((x) => x.id === Number(id));
      if (!t) fail(404, '구분을 찾을 수 없습니다. 새로고침해 주세요');
      return t;
    }
    function findTitle(id) {
      for (const t of D.roster.tiers) {
        const i = t.titles.findIndex((x) => x.id === Number(id));
        if (i >= 0) return { tier: t, title: t.titles[i], i };
      }
      fail(404, '직급을 찾을 수 없습니다. 새로고침해 주세요');
    }
    function findPerson(id) {
      for (const t of D.roster.tiers) {
        for (const x of t.titles) {
          const i = x.people.findIndex((p) => p.id === Number(id));
          if (i >= 0) return { tier: t, title: x, person: x.people[i], i };
        }
      }
      fail(404, '그 사람을 직급표에서 찾을 수 없습니다. 새로고침해 주세요');
    }
    const titleLabel = (x) => x.name || '이름 없는 직급';
    const rosterTotal = () => D.roster.tiers.reduce((s, t) => s + t.titles.reduce((n, x) => n + x.people.length, 0), 0);
    function tierName(v) { return text(v, ROSTER_LIMIT.tier, '구분 이름을 입력해 주세요', '구분 이름은 ' + ROSTER_LIMIT.tier + '자까지 쓸 수 있습니다'); }
    function titleName(v) { return text(v, ROSTER_LIMIT.title, '', '직급 이름은 ' + ROSTER_LIMIT.title + '자까지 쓸 수 있습니다'); }
    function iconOf(v) {
      const s = String(v == null ? '' : v).replace(/\s+/g, '');
      if (s.length > ROSTER_LIMIT.icon) fail(400, '아이콘은 이모지 하나만 넣어 주세요');
      return s;
    }
    function personName(v) { return text(v, ROSTER_LIMIT.name, '이름을 입력해 주세요', '이름은 ' + ROSTER_LIMIT.name + '자까지 쓸 수 있습니다'); }
    function gidOf(v) {
      const s = String(v == null ? '' : v).trim();
      if (s && !/^\d{1,10}$/.test(s)) fail(400, '고유번호는 숫자로만 적어 주세요');
      return s;
    }
    function moveIn(arr, i, d) {
      const j = i + (Number(d) < 0 ? -1 : 1);
      if (j < 0 || j >= arr.length) return false;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return true;
    }

    on('GET', '/roster', {}, ({ me }) => ({ roster: rosterPub(me) }));

    on('POST', '/roster', { perm: 'admin' }, ({ me, body }) => {
      const R = D.roster;
      let msg = '';
      switch (body.op) {
        case 'tier.add': {
          if (R.tiers.length >= ROSTER_LIMIT.tiers) fail(400, '구분은 ' + ROSTER_LIMIT.tiers + '개까지 만들 수 있습니다');
          const name = tierName(body.name);
          R.tiers.push({ id: ++D.seq.roster, name, titles: [] });
          msg = '구분 ' + name + ' 추가';
          break;
        }
        case 'tier.rename': {
          const t = findTier(body.id);
          const name = tierName(body.name);
          if (name === t.name) return { roster: rosterPub(me) };
          msg = '구분 이름 ' + t.name + ' → ' + name;
          t.name = name;
          break;
        }
        case 'tier.move': {
          const t = findTier(body.id);
          if (!moveIn(R.tiers, R.tiers.indexOf(t), body.dir)) return { roster: rosterPub(me) };
          msg = '구분 ' + t.name + ' 순서 바꿈';
          break;
        }
        case 'tier.remove': {
          const t = findTier(body.id);
          const n = t.titles.reduce((s2, x) => s2 + x.people.length, 0);
          R.tiers.splice(R.tiers.indexOf(t), 1);
          msg = '구분 ' + t.name + ' 삭제' + (t.titles.length ? ' (직급 ' + t.titles.length + '개, ' + n + '명)' : '');
          break;
        }
        case 'title.add': {
          const t = findTier(body.tierId);
          if (t.titles.length >= ROSTER_LIMIT.titles) fail(400, '한 구분에 직급은 ' + ROSTER_LIMIT.titles + '개까지 둘 수 있습니다');
          const name = titleName(body.name), icon = iconOf(body.icon);
          if (!name && !icon) fail(400, '직급 이름을 입력해 주세요');
          t.titles.push({ id: ++D.seq.roster, name, icon, people: [] });
          msg = josa(t.name, '에/에') + ' 직급 ' + (name || icon) + ' 추가';
          break;
        }
        case 'title.edit': {
          const f = findTitle(body.id);
          const name = titleName(body.name), icon = iconOf(body.icon);
          if (!name && !icon) fail(400, '직급 이름을 입력해 주세요');
          const before = titleLabel(f.title);
          const changes = [];
          if (name !== f.title.name) changes.push('이름 ' + before + ' → ' + (name || '없음'));
          if (icon !== f.title.icon) changes.push('아이콘 ' + (icon || '없음'));
          f.title.name = name;
          f.title.icon = icon;
          if (body.tierId != null && Number(body.tierId) !== f.tier.id) {
            const to = findTier(body.tierId);
            if (to.titles.length >= ROSTER_LIMIT.titles) fail(400, '한 구분에 직급은 ' + ROSTER_LIMIT.titles + '개까지 둘 수 있습니다');
            f.tier.titles.splice(f.i, 1);
            to.titles.push(f.title);
            changes.push(f.tier.name + ' → ' + to.name);
          }
          if (!changes.length) return { roster: rosterPub(me) };
          msg = '직급 ' + before + ': ' + changes.join(', ');
          break;
        }
        case 'title.move': {
          const f = findTitle(body.id);
          if (!moveIn(f.tier.titles, f.i, body.dir)) return { roster: rosterPub(me) };
          msg = '직급 ' + titleLabel(f.title) + ' 순서 바꿈';
          break;
        }
        case 'title.remove': {
          const f = findTitle(body.id);
          f.tier.titles.splice(f.i, 1);
          msg = '직급 ' + titleLabel(f.title) + ' 삭제' + (f.title.people.length ? ' (' + f.title.people.length + '명)' : '');
          break;
        }
        case 'person.add': {
          const f = findTitle(body.titleId);
          if (rosterTotal() >= ROSTER_LIMIT.people) fail(400, '직급표에는 ' + ROSTER_LIMIT.people + '명까지 넣을 수 있습니다');
          const p = { id: ++D.seq.roster, name: personName(body.name), gid: gidOf(body.gid) };
          f.title.people.push(p);
          msg = josa(titleLabel(f.title), '에/에') + ' ' + personLabel(p) + ' 추가';
          break;
        }
        case 'person.edit': {
          const f = findPerson(body.id);
          const before = personLabel(f.person);
          const name = personName(body.name), gid = gidOf(body.gid);
          const changes = [];
          if (name !== f.person.name || gid !== f.person.gid) changes.push(before + ' → ' + personLabel({ name, gid }));
          f.person.name = name;
          f.person.gid = gid;
          if (body.titleId != null && Number(body.titleId) !== f.title.id) {
            const to = findTitle(body.titleId);
            f.title.people.splice(f.i, 1);
            to.title.people.push(f.person);
            changes.push(titleLabel(f.title) + ' → ' + titleLabel(to.title));
          }
          if (!changes.length) return { roster: rosterPub(me) };
          msg = personLabel(f.person) + ': ' + changes.join(', ');
          break;
        }
        case 'person.remove': {
          const f = findPerson(body.id);
          f.title.people.splice(f.i, 1);
          msg = josa(titleLabel(f.title), '에서/에서') + ' ' + personLabel(f.person) + ' 뺌';
          break;
        }
        case 'import': {
          const parsed = parseRoster(body.text);
          const titles = parsed.tiers.reduce((n, t) => n + t.titles.length, 0);
          const people = parsed.tiers.reduce((n, t) => n + t.titles.reduce((m, x) => m + x.people.length, 0), 0);
          if (!titles) fail(400, '직급을 하나도 찾지 못했습니다. "두목 : 이름(번호)" 같은 줄이 있는지 확인해 주세요');
          if (parsed.tiers.length > ROSTER_LIMIT.tiers || people > ROSTER_LIMIT.people || parsed.tiers.some((t) => t.titles.length > ROSTER_LIMIT.titles)) {
            fail(400, '직급표가 너무 큽니다 (구분 ' + ROSTER_LIMIT.tiers + '개, 한 구분에 직급 ' + ROSTER_LIMIT.titles + '개, ' + ROSTER_LIMIT.people + '명까지)');
          }
          const preview = { tiers: parsed.tiers.length, titles, people, names: parsed.tiers.map((t) => t.name) };
          if (body.dry) return { preview };
          fillRoster(D, parsed);
          msg = '디스코드 글로 새로 불러옴 (구분 ' + preview.tiers + '개, 직급 ' + titles + '개, ' + people + '명)';
          break;
        }
        default:
          fail(400, '알 수 없는 요청입니다');
      }
      R.updatedAt = now();
      R.by = me.id;
      log('roster', 'roster', null, me.id, '직급표: ' + msg + ' - ' + me.name);
      return { roster: rosterPub(me), msg };
    });

    on('POST', '/admin/settings', { perm: 'admin' }, ({ body }) => {
      if (body.ranks !== undefined) {
        if (!Array.isArray(body.ranks) || body.ranks.length !== 6) fail(400, '직급은 6개를 모두 정해 주세요');
        const ranks = body.ranks.map((r, i) => ({
          name: text(r && r.name, 10, (i + 1) + '번째 직급 이름을 입력해 주세요', '직급 이름은 10자까지 쓸 수 있습니다'),
          desc: text(r && r.desc, 40, '', '직급 설명은 40자까지 쓸 수 있습니다'),
        }));
        if (new Set(ranks.map((r) => r.name)).size !== 6) fail(400, '직급 이름이 겹치지 않게 정해 주세요');
        D.settings.ranks = ranks;
      }
      if (body.currency !== undefined) {
        D.settings.currency = text(body.currency, 4, '화폐 표기를 입력해 주세요', '화폐 표기는 4자까지 쓸 수 있습니다');
      }
      if (body.rivals !== undefined) {
        if (!Array.isArray(body.rivals)) fail(400, '상대 조직 목록 형식이 잘못됐습니다');
        const list = [...new Set(body.rivals.map((x) => String(x == null ? '' : x).trim()).filter(Boolean))];
        if (!list.length) fail(400, '상대 조직을 하나 이상 적어 주세요');
        if (list.length > 10) fail(400, '상대 조직은 10개까지 정할 수 있습니다');
        if (list.some((x) => x.length > 12)) fail(400, '조직 이름은 12자까지 쓸 수 있습니다');
        if (list.includes('적야')) fail(400, '적야는 상대 조직 목록에 넣을 수 없습니다');
        D.settings.rivals = list;
      }
      return { settings: publicSettings() };
    });

    on('GET', '/admin/export', { perm: 'admin' }, () => {
      const copy = JSON.parse(JSON.stringify(D));
      copy.sessions = {};
      copy.exportedAt = now();
      return { backup: copy };
    });

    on('POST', '/admin/import', { perm: 'admin' }, ({ body }) => {
      const src = body.backup;
      if (!src || typeof src !== 'object' || !Array.isArray(src.members)) fail(400, '백업 파일 형식이 맞지 않습니다');
      const valid = src.members.every((m) => m && Number.isInteger(m.id) && typeof m.name === 'string' && m.pw && Number.isInteger(m.level));
      if (!valid) fail(400, '백업 파일의 조직원 정보가 손상됐습니다');
      if (!src.members.some((m) => m.status === 'active' && m.level <= 1)) fail(400, '개발자나 ' + rankName(1) + '가 없는 백업은 복원할 수 없습니다');
      const copy = JSON.parse(JSON.stringify(src));
      for (const k of Object.keys(D)) delete D[k];
      Object.assign(D, copy);
      delete D.exportedAt;
      migrate(D);
      D.sessions = {};
      return { relogin: true };
    });

    /* ---------------- 진입점 ---------------- */
    async function handle(method, path, body, token, query) {
      try {
        const route = routes.find((r) => r.method === method && r.re.test(path));
        if (!route) fail(404, '없는 경로입니다');
        const mm = path.match(route.re);
        const params = {};
        route.keys.forEach((k, i) => { params[k] = decodeURIComponent(mm[i + 1]); });
        let me = null;
        if (route.opts.auth !== false) {
          me = authed(token);
          if (route.opts.perm === 'admin' && !isAdmin(me)) fail(403, adminLabel() + '만 할 수 있습니다');
          if (route.opts.perm === 'officer' && !isOfficer(me)) fail(403, officerLabel() + '만 할 수 있습니다');
        }
        const out = await route.fn({ me, body: body && typeof body === 'object' ? body : {}, params, query: query || {}, token });
        if (method !== 'GET') save();
        return { status: 200, body: out === undefined ? { ok: true } : out };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
        if (env.log) env.log(e);
        return { status: 500, body: { error: '서버에서 오류가 났습니다. 잠시 뒤 다시 시도하세요' } };
      }
    }

    return { handle, data: D };
  }

  return {
    createCore, freshData, migrate, DEFAULT_RANKS, DEFAULT_RIVALS, DEFAULT_GUNS, REPORT_TYPES, LEGACY_TYPES, RESULTS,
    WAR_MODES, DEV_LEVEL, josa, fmtDur, fmtMoney, weekStart, dayStart,
    parseRoster, formatRoster, ROSTER_SEED,
  };
});
