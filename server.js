/* ============================================================
   적야 인트라넷 서버
   - 데이터: DATABASE_URL 이 있으면 Postgres, 없으면 data/data.json
   - 선택: DISCORD_WEBHOOK_URL 환경변수 -> 디스코드 알림
   ============================================================ */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { createCore, freshData } = require('./lib/core');
const { openStore } = require('./lib/store');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const WEBHOOK = (process.env.DISCORD_WEBHOOK_URL || '').trim();
const BOOT_TRIES = Math.max(1, Number(process.env.DB_BOOT_TRIES) || 8);

/* ---------------- 저장 ----------------
   바뀔 때마다 잠깐 모았다가 한 번에 쓴다. 쓰는 중에 또 바뀌면 끝난 뒤 다시 쓰고,
   실패하면 점점 간격을 늘려 다시 시도한다. 종료 신호를 받으면 마지막으로 한 번 더 쓴다. */
const store = openStore({ databaseUrl: DATABASE_URL, dataDir: DATA_DIR });
const SAVE_DELAY = store.kind === 'file' ? 120 : 1000;
let core = null;
let saveTimer = null;
let writing = null;
let dirty = false;
let failCount = 0;
let lastSavedAt = 0;

function schedule(ms) {
  if (saveTimer || writing) return;
  saveTimer = setTimeout(() => { saveTimer = null; runWrite(); }, ms);
}
function save() {
  dirty = true;
  schedule(SAVE_DELAY);
}
function runWrite() {
  if (writing || !dirty || !core) return writing;
  dirty = false;
  const json = JSON.stringify(core.data);
  writing = store.write(json)
    .then(() => {
      if (failCount) console.log('[data] 저장이 다시 됩니다');
      failCount = 0;
      lastSavedAt = Date.now();
    })
    .catch((e) => {
      dirty = true;
      failCount += 1;
      console.error('[data] 저장 실패 (' + failCount + '번째), 잠시 뒤 다시 시도:', e.message);
    })
    .finally(() => {
      writing = null;
      if (dirty) schedule(failCount ? Math.min(30000, 2000 * failCount) : SAVE_DELAY);
    });
  return writing;
}
async function flushNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (writing) await writing;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (dirty) await runWrite();
}

/* ---------------- 비밀번호 ---------------- */
const scrypt = (pw, salt) => new Promise((resolve, reject) => {
  crypto.scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});
const pbkdf2 = (pw, salt, iter) => new Promise((resolve, reject) => {
  crypto.pbkdf2(pw, salt, iter, 32, 'sha256', (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});
function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/* ---------------- 디스코드 ---------------- */
function discord(ev) {
  if (!WEBHOOK) return;
  fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: '적야',
      embeds: [{
        title: ev.title,
        description: ev.text,
        color: 0xf2f2f2,
        timestamp: new Date().toISOString(),
        footer: { text: '적야 인트라넷' },
      }],
    }),
  }).catch((e) => console.error('[webhook]', e.message));
}

/* ---------------- 코어 ---------------- */
const coreEnv = {
  save,
  hashPassword: async (pw) => {
    const salt = crypto.randomBytes(16).toString('hex');
    return { algo: 'scrypt', salt, hash: await scrypt(pw, salt) };
  },
  verifyPassword: async (pw, rec) => {
    if (!rec || !rec.salt || !rec.hash) return false;
    if (rec.algo === 'scrypt') return safeEqualHex(await scrypt(pw, rec.salt), rec.hash);
    if (rec.algo === 'pbkdf2') return safeEqualHex(await pbkdf2(pw, rec.salt, rec.iter || 100000), rec.hash);
    return false;
  },
  token: (n) => crypto.randomBytes(n || 32).toString('hex'),
  notify: discord,
  log: (e) => console.error('[core]', e),
};

/* ---------------- HTTP ---------------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

app.get('/healthz', (req, res) => {
  res.set('cache-control', 'no-store');
  res.json({ ok: true, store: store.kind, saving: failCount ? 'retrying' : 'ok', lastSavedAt: lastSavedAt || null });
});

app.use('/api', async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const r = await core.handle(req.method, req.path, req.body, token, req.query);
  res.set('cache-control', 'no-store');
  res.status(r.status).json(r.body);
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: '보낸 데이터가 너무 큽니다' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: '요청 형식이 잘못됐습니다' });
  return next(err);
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

/* ---------------- 시작 ----------------
   데이터를 다 불러온 다음에 문을 연다. DB에 닿지 않으면 빈 데이터로 시작하지 않고
   (그러면 기존 데이터를 덮어쓸 수 있으므로) 몇 번 다시 시도한 뒤 종료한다. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
let stopping = false;

async function boot() {
  console.log('[data] 저장소: ' + (store.kind === 'postgres' ? 'Postgres (' + store.label + ')' : '파일 ' + store.label));
  if (store.kind === 'file' && process.env.RENDER) {
    console.warn('[data] 주의: Render에서 DATABASE_URL 없이 실행 중입니다. 서버가 잠들거나 다시 배포되면 데이터가 지워집니다.');
  }
  let data = null;
  for (let i = 1; ; i++) {
    try {
      data = await store.load();
      break;
    } catch (e) {
      console.error('[data] 불러오기 실패 (' + i + '/' + BOOT_TRIES + '):', e.message);
      if (i >= BOOT_TRIES) {
        console.error('[data] 데이터를 불러오지 못해 종료합니다. DATABASE_URL 을 확인하세요.');
        process.exit(1);
      }
      await sleep(Math.min(10000, 1000 * i));
    }
    if (stopping) return;
  }
  core = createCore({ ...coreEnv, data: data || freshData() });
  if (!data) {
    console.log('[data] 저장된 데이터가 없어 새로 시작합니다. 처음 가입하는 사람이 개발자가 됩니다.');
    save();
  }
  server = app.listen(PORT, () => {
    console.log('적야 인트라넷 실행 중: http://localhost:' + PORT);
    if (!WEBHOOK) console.log('(디스코드 알림 꺼짐: DISCORD_WEBHOOK_URL 미설정)');
  });
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(0), 9000);
  try { await flushNow(); } catch (e) { console.error('[data] 종료 중 저장 실패:', e.message); }
  await store.close();
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

boot().catch((e) => {
  console.error('[boot] 시작 실패:', e);
  process.exit(1);
});
