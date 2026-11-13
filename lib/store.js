/* ============================================================
   저장소
   - DATABASE_URL 이 있으면 Postgres (Neon 같은 무료 DB)
     : 데이터 전체를 압축해서 한 줄에 저장, 켤 때마다 백업 표에 한 벌 남김(최근 14개)
   - 없으면 파일 (DATA_DIR/data.json)
   Render 무료 플랜은 잠들 때 파일이 지워지므로 DATABASE_URL 을 쓰세요.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function fileStore(dir) {
  const file = path.join(dir, 'data.json');
  return {
    kind: 'file',
    label: file,
    async load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        const broken = file + '.broken-' + Date.now();
        try { fs.renameSync(file, broken); } catch (_) { /* ignore */ }
        console.error('[data] data.json을 읽지 못해 ' + path.basename(broken) + ' 로 옮기고 새로 시작합니다:', e.message);
        return null;
      }
    },
    async write(json) {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, file);
    },
    async close() {},
  };
}

// 접속 주소의 sslmode / channel_binding 은 여기서 직접 처리한다
function pgConfig(url) {
  const u = new URL(url);
  const mode = (u.searchParams.get('sslmode') || '').toLowerCase();
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding');
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(u.hostname);
  let ssl;
  if (mode === 'disable' || (!mode && local)) ssl = false;
  else ssl = { rejectUnauthorized: mode !== 'no-verify' && process.env.DB_SSL_VERIFY !== 'false' };
  return { connectionString: u.toString(), ssl, host: u.hostname };
}

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS jeokya_store (id integer PRIMARY KEY, data bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())',
  'CREATE TABLE IF NOT EXISTS jeokya_backup (id bigserial PRIMARY KEY, data bytea NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
];

function pgStore(url) {
  const { Pool } = require('pg');
  const cfg = pgConfig(url);
  const pool = new Pool({
    connectionString: cfg.connectionString,
    ssl: cfg.ssl,
    max: 2,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000,
  });
  // 쉬고 있던 연결이 DB 쪽에서 끊기면 여기로 온다. 다음 쿼리 때 새로 연결하므로 기록만 한다.
  pool.on('error', (e) => console.error('[db] 연결이 끊겼습니다:', e.message));
  let ready = null;
  const init = () => {
    if (!ready) {
      ready = (async () => { for (const q of SCHEMA) await pool.query(q); })();
      ready.catch(() => { ready = null; });
    }
    return ready;
  };
  return {
    kind: 'postgres',
    label: cfg.host,
    async load() {
      await init();
      const r = await pool.query('SELECT data FROM jeokya_store WHERE id = 1');
      if (!r.rows.length) return null;
      const data = JSON.parse(zlib.gunzipSync(r.rows[0].data).toString('utf8'));
      try {
        await pool.query('INSERT INTO jeokya_backup (data) SELECT data FROM jeokya_store WHERE id = 1');
        await pool.query('DELETE FROM jeokya_backup WHERE id NOT IN (SELECT id FROM jeokya_backup ORDER BY id DESC LIMIT 14)');
      } catch (e) {
        console.error('[db] 시작 백업을 남기지 못했습니다:', e.message);
      }
      return data;
    },
    async write(json) {
      await init();
      const buf = zlib.gzipSync(Buffer.from(json, 'utf8'));
      await pool.query(
        'INSERT INTO jeokya_store (id, data, updated_at) VALUES (1, $1, now()) ' +
        'ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()',
        [buf],
      );
    },
    async close() { try { await pool.end(); } catch (_) { /* ignore */ } },
  };
}

function openStore({ databaseUrl, dataDir }) {
  return databaseUrl ? pgStore(databaseUrl) : fileStore(dataDir);
}

module.exports = { openStore, fileStore, pgStore, pgConfig };
