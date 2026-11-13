/* 서버 없이 브라우저에서 돌아가는 미리보기 한 장(demo.html)을 만든다.
   - lib/core.js 를 페이지 안에 넣고, localStorage 를 저장소로 쓴다.
   - 예시 데이터(scripts/seed-data.js)로 채운 상태에서 시작한다.
   실행: node scripts/build-demo.js [본문 글꼴 woff2 경로] [출력 경로]
   글꼴 경로를 주면 Pretendard 를 페이지에 직접 넣는다 (외부 CDN 을 막는 곳에서 쓸 때). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const fontPath = process.argv[2];
const outPath = process.argv[3] || path.join(ROOT, 'demo.html');

let html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const core = fs.readFileSync(path.join(ROOT, 'lib', 'core.js'), 'utf8');
const seed = fs.readFileSync(path.join(ROOT, 'scripts', 'seed-data.js'), 'utf8');
for (const [name, src] of [['core', core], ['seed', seed]]) {
  if (/<\/script/i.test(src)) throw new Error(name + ' 안에 </script> 가 있습니다');
}

html = html.replace('<title>적야</title>', '<title>적야 인트라넷 미리보기</title>');

if (fontPath) {
  const b64 = fs.readFileSync(fontPath).toString('base64');
  html = html
    .replace(/\s*<link rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"[^>]*>/, '')
    .replace(/\s*<link rel="stylesheet" href="https:\/\/cdn\.jsdelivr\.net[^>]*>/, '');
  html = html.replace('<style>', () => "<style>@font-face{font-family:'Pretendard Variable';font-style:normal;font-weight:45 920;font-display:swap;" +
    "src:url(data:font/woff2;base64," + b64 + ") format('woff2');}</style>\n<style>");
}

const boot = `
/* ---- 미리보기 모드: 서버 대신 이 브라우저 안에서 코어를 돌린다 ---- */
window.JEOKYA_DEMO = true;
(function () {
  var KEY = 'jeokya.demo.data.v3';
  var ITER = 60000;
  var enc = new TextEncoder();
  var subtle = window.crypto && window.crypto.subtle;
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function rand(n) { var a = new Uint8Array(n || 32); window.crypto.getRandomValues(a); return hex(a.buffer); }
  async function derive(pw, salt, iter) {
    if (!subtle) {
      var h = 2166136261, str = salt + ':' + pw;
      for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
      return 'fnv' + h.toString(16);
    }
    var key = await subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: iter, hash: 'SHA-256' }, key, 256);
    return hex(bits);
  }
  async function hashPassword(pw) { var salt = rand(16); return { algo: 'pbkdf2', salt: salt, iter: ITER, hash: await derive(pw, salt, ITER) }; }
  async function verifyPassword(pw, rec) { return !!rec && rec.algo === 'pbkdf2' && (await derive(pw, rec.salt, rec.iter || ITER)) === rec.hash; }
  function read() { try { var raw = window.localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } }
  function write(d) { try { window.localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) { /* 저장 불가: 이번 방문 동안만 유지 */ } }
  async function fill(D) { JeokyaSeed.seed(D, { now: Date.now(), pw: await hashPassword('1234') }); }
  var core = null;
  window.JEOKYA_DEMO_READY = (async function () {
    var data = read();
    if (!data || !Array.isArray(data.members) || !data.members.length) { data = JeokyaCore.freshData(); await fill(data); }
    core = JeokyaCore.createCore({
      data: data, save: function () { write(core.data); },
      hashPassword: hashPassword, verifyPassword: verifyPassword, token: rand,
      log: function (e) { console.error(e); },
    });
    write(core.data);
    window.JEOKYA_DEMO_CORE = core;
  })();
  window.JEOKYA_DEMO_RESET = async function () {
    await window.JEOKYA_DEMO_READY;
    var D = core.data;
    Object.keys(D).forEach(function (k) { delete D[k]; });
    Object.assign(D, JeokyaCore.freshData());
    await fill(D);
    write(D);
  };
})();
`;

const marker = '<script>\n(() => {';
if (!html.includes(marker)) throw new Error('앱 스크립트 시작 위치를 찾지 못했습니다');
// 치환 문자열 안의 $' 같은 패턴이 해석되지 않도록 함수로 넘긴다
html = html.replace(marker, () => '<script>\n' + core + '\n</script>\n<script>\n' + seed + '\n</script>\n<script>' + boot + '</script>\n' + marker);

fs.writeFileSync(outPath, html);
console.log('demo written: ' + outPath + ' (' + Math.round(Buffer.byteLength(html) / 1024) + ' KB)');
