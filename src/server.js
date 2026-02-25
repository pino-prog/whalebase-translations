/**
 * 번역 검토 어드민 서버
 * - 로컬 실행: npm run review  → http://localhost:3000
 * - 외부 공유: npm run share   → 공개 URL 자동 생성 (비밀번호 보호)
 */
import 'dotenv/config';
import { createServer } from 'http';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { nestedToFlat, flatToNested } from './keyGen.js';
import { loadConfidence } from './translator.js';
import { readLocale, writeLocale, setNestedKey } from './locales.js';

const PORT = 3000;
const LANGS = ['ko', 'zh', 'ja'];
const LANG_LABELS = { ko: '한국어', zh: '중국어', ja: '일본어' };

// --share 플래그 감지
const IS_SHARE_MODE = process.argv.includes('--share');

// ──────────────────────────────────────────────
// Basic Auth 인증 (ADMIN_PASSWORD가 설정된 경우)
// ──────────────────────────────────────────────
function checkAuth(req, res) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return true; // 비밀번호 미설정 → 인증 생략

  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const inputPass = decoded.split(':').slice(1).join(':'); // "user:pass" 형식
    if (inputPass === password) return true;
  }

  // 인증 실패 → 브라우저에 로그인 팝업 표시
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="번역 어드민 — 비밀번호를 입력하세요"',
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end('<html><body style="padding:40px;font-family:sans-serif"><h2>🔒 접근 제한</h2><p>비밀번호가 필요합니다.</p></body></html>');
  return false;
}

// ──────────────────────────────────────────────
// 모든 번역 데이터를 테이블 형식으로 병합
// ──────────────────────────────────────────────
async function buildTableData() {
  const enNested = await readLocale('en');
  const enFlat = nestedToFlat(enNested);

  const langFlats = {};
  for (const lang of LANGS) {
    const nested = await readLocale(lang);
    langFlats[lang] = nestedToFlat(nested);
  }

  const confidence = await loadConfidence();

  const rows = Object.entries(enFlat).map(([key, enText]) => {
    const langData = {};
    let minConfidence = 100;

    for (const lang of LANGS) {
      const text = langFlats[lang][key] || '';
      const score = confidence[lang]?.[key] ?? null;
      langData[lang] = { text, confidence: score };
      if (score !== null && score < minConfidence) minConfidence = score;
    }

    if (minConfidence === 100) minConfidence = null;

    return { key, en: enText, langs: langData, minConfidence };
  });

  // 신뢰도 낮은 순으로 기본 정렬
  rows.sort((a, b) => {
    const ca = a.minConfidence ?? 100;
    const cb = b.minConfidence ?? 100;
    return ca - cb;
  });

  return rows;
}

// ──────────────────────────────────────────────
// HTML 어드민 페이지
// ──────────────────────────────────────────────
function buildHTML(rows) {
  const totalKeys = rows.length;
  const needsReview = rows.filter(r => r.minConfidence !== null && r.minConfidence < 80).length;
  const hasConfidence = rows.some(r => r.minConfidence !== null);
  const avgConf = hasConfidence
    ? Math.round(rows.filter(r => r.minConfidence !== null).reduce((s, r) => s + r.minConfidence, 0) / rows.filter(r => r.minConfidence !== null).length)
    : null;

  const rowsJson = JSON.stringify(rows);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>번역 검토 어드민</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f6fa; color: #333; }

  /* 헤더 */
  .header { background: #1a1a2e; color: white; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header-controls { display: flex; gap: 10px; align-items: center; }
  select { padding: 7px 12px; border-radius: 6px; border: none; font-size: 14px; cursor: pointer; background: #fff; }
  .btn-save { background: #4CAF50; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
  .btn-save:hover { background: #45a049; }
  .btn-save:disabled { background: #aaa; cursor: not-allowed; }
  .save-status { font-size: 13px; color: #a0d4a0; min-width: 80px; text-align: right; }

  /* 통계 */
  .stats { display: flex; gap: 16px; padding: 16px 24px; background: white; border-bottom: 1px solid #e0e0e0; }
  .stat-card { text-align: center; padding: 10px 20px; border-radius: 8px; background: #f8f9fc; min-width: 100px; }
  .stat-card .num { font-size: 24px; font-weight: 700; }
  .stat-card .label { font-size: 12px; color: #888; margin-top: 2px; }
  .stat-card.warning .num { color: #e67e22; }
  .stat-card.danger .num { color: #e74c3c; }
  .stat-card.good .num { color: #27ae60; }

  /* 테이블 */
  .table-wrap { padding: 20px 24px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); font-size: 13px; }
  thead { background: #f0f2f8; }
  th { padding: 12px 14px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #e0e4f0; white-space: nowrap; }
  td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafbff; }
  tr.hidden { display: none; }

  /* 키 열 */
  .td-key { font-family: monospace; font-size: 11px; color: #888; max-width: 200px; word-break: break-all; }

  /* 영어 원문 */
  .td-en { color: #444; max-width: 180px; }

  /* 번역 셀 */
  .td-lang { position: relative; min-width: 160px; max-width: 200px; }
  .lang-text { display: block; color: #333; line-height: 1.5; word-break: break-word; }
  .lang-text[contenteditable="true"] { outline: 2px solid #4a90d9; border-radius: 4px; padding: 2px 4px; background: #f0f7ff; min-height: 22px; }
  .edit-btn { display: none; position: absolute; top: 6px; right: 6px; background: #e8f0fe; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4a90d9; }
  .td-lang:hover .edit-btn { display: block; }
  .changed-badge { display: inline-block; background: #fff3cd; color: #856404; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }

  /* 신뢰도 배지 */
  .confidence { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; margin-top: 4px; }
  .conf-high { background: #d4edda; color: #155724; }
  .conf-mid  { background: #fff3cd; color: #856404; }
  .conf-low  { background: #f8d7da; color: #721c24; }
  .conf-none { background: #e9ecef; color: #6c757d; }

  /* 최소 신뢰도 열 */
  .td-min-conf { text-align: center; white-space: nowrap; }
  .min-conf-bar { height: 4px; border-radius: 2px; margin-top: 4px; }
  .bar-high { background: #28a745; }
  .bar-mid  { background: #ffc107; }
  .bar-low  { background: #dc3545; }

  /* 검색 */
  .search-wrap { padding: 0 24px 12px; }
  .search-input { width: 100%; max-width: 400px; padding: 9px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; }
  .search-input:focus { border-color: #4a90d9; }

  /* 빈 상태 */
  .empty { text-align: center; padding: 60px; color: #aaa; }
</style>
</head>
<body>

<div class="header">
  <h1>번역 검토 어드민</h1>
  <div class="header-controls">
    <select id="filterSelect" onchange="applyFilter()">
      <option value="all">전체 보기</option>
      <option value="review">검토 필요 (80% 미만)</option>
      <option value="low">낮음 (50% 미만)</option>
      <option value="no-score">점수 없음</option>
    </select>
    <button class="btn-save" id="saveBtn" onclick="saveChanges()" disabled>저장</button>
    <span class="save-status" id="saveStatus"></span>
  </div>
</div>

<div class="stats">
  <div class="stat-card">
    <div class="num">${totalKeys}</div>
    <div class="label">전체 키</div>
  </div>
  <div class="stat-card ${needsReview > 0 ? 'warning' : 'good'}">
    <div class="num">${needsReview}</div>
    <div class="label">검토 필요</div>
  </div>
  ${avgConf !== null ? `
  <div class="stat-card ${avgConf >= 90 ? 'good' : avgConf >= 70 ? 'warning' : 'danger'}">
    <div class="num">${avgConf}%</div>
    <div class="label">평균 신뢰도</div>
  </div>` : ''}
  <div class="stat-card">
    <div class="num">${rows.filter(r => r.minConfidence !== null && r.minConfidence >= 80).length}</div>
    <div class="label">이상 없음</div>
  </div>
</div>

<div class="search-wrap">
  <input class="search-input" type="text" placeholder="키 또는 텍스트 검색..." oninput="applyFilter()" id="searchInput">
</div>

<div class="table-wrap">
  <table id="mainTable">
    <thead>
      <tr>
        <th>키</th>
        <th>영어 (원문)</th>
        <th>한국어</th>
        <th>중국어</th>
        <th>일본어</th>
        <th style="text-align:center">최소 신뢰도</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
  <div class="empty" id="emptyMsg" style="display:none">표시할 항목이 없습니다.</div>
</div>

<script>
const ALL_ROWS = ${rowsJson};
const LANGS = ['ko', 'zh', 'ja'];
const LANG_LABELS = { ko: '한국어', zh: '중국어', ja: '일본어' };
let changes = {}; // { "ko::header.nav.home": "수정된 텍스트" }

function confClass(score) {
  if (score === null) return 'conf-none';
  if (score >= 90) return 'conf-high';
  if (score >= 70) return 'conf-mid';
  return 'conf-low';
}
function barClass(score) {
  if (score === null) return '';
  if (score >= 80) return 'bar-high';
  if (score >= 60) return 'bar-mid';
  return 'bar-low';
}

function renderTable(rows) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';

  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.key = row.key;

    // 키 열
    const tdKey = document.createElement('td');
    tdKey.className = 'td-key';
    tdKey.textContent = row.key;
    tr.appendChild(tdKey);

    // 영어 열
    const tdEn = document.createElement('td');
    tdEn.className = 'td-en';
    tdEn.textContent = row.en;
    tr.appendChild(tdEn);

    // 언어별 열
    LANGS.forEach(lang => {
      const { text, confidence } = row.langs[lang];
      const changeKey = lang + '::' + row.key;
      const currentText = changes[changeKey] ?? text;
      const isChanged = changeKey in changes;

      const td = document.createElement('td');
      td.className = 'td-lang';

      const span = document.createElement('span');
      span.className = 'lang-text';
      span.textContent = currentText;
      span.dataset.lang = lang;
      span.dataset.key = row.key;
      span.dataset.original = text;

      const editBtn = document.createElement('button');
      editBtn.className = 'edit-btn';
      editBtn.textContent = '편집';
      editBtn.onclick = () => startEdit(span, editBtn);

      const confBadge = document.createElement('span');
      confBadge.className = 'confidence ' + confClass(confidence);
      confBadge.textContent = confidence !== null ? confidence + '%' : '점수 없음';

      td.appendChild(span);
      if (isChanged) {
        const badge = document.createElement('span');
        badge.className = 'changed-badge';
        badge.textContent = '수정됨';
        td.appendChild(badge);
      }
      td.appendChild(editBtn);
      td.appendChild(document.createElement('br'));
      td.appendChild(confBadge);

      tr.appendChild(td);
    });

    // 최소 신뢰도 열
    const tdMin = document.createElement('td');
    tdMin.className = 'td-min-conf';
    const score = row.minConfidence;
    if (score !== null) {
      const badge = document.createElement('span');
      badge.className = 'confidence ' + confClass(score);
      badge.style.fontSize = '13px';
      badge.textContent = score + '%';
      const bar = document.createElement('div');
      bar.className = 'min-conf-bar ' + barClass(score);
      bar.style.width = score + '%';
      tdMin.appendChild(badge);
      tdMin.appendChild(bar);
    } else {
      tdMin.innerHTML = '<span class="confidence conf-none">-</span>';
    }
    tr.appendChild(tdMin);

    tbody.appendChild(tr);
  });
}

function startEdit(span, btn) {
  span.contentEditable = 'true';
  span.focus();
  // 커서를 끝으로
  const range = document.createRange();
  range.selectNodeContents(span);
  range.collapse(false);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);

  btn.textContent = '완료';
  btn.onclick = () => finishEdit(span, btn);

  span.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(span, btn); }
    if (e.key === 'Escape') { span.textContent = span.dataset.original; finishEdit(span, btn); }
  };
}

function finishEdit(span, btn) {
  span.contentEditable = 'false';
  btn.textContent = '편집';
  btn.onclick = () => startEdit(span, btn);

  const lang = span.dataset.lang;
  const key = span.dataset.key;
  const newText = span.textContent.trim();
  const changeKey = lang + '::' + key;

  if (newText !== span.dataset.original) {
    changes[changeKey] = newText;
    // "수정됨" 배지 추가
    if (!span.nextSibling?.classList?.contains('changed-badge')) {
      const badge = document.createElement('span');
      badge.className = 'changed-badge';
      badge.textContent = '수정됨';
      span.parentNode.insertBefore(badge, span.nextSibling);
    }
  } else {
    delete changes[changeKey];
  }

  document.getElementById('saveBtn').disabled = Object.keys(changes).length === 0;
}

function applyFilter() {
  const filter = document.getElementById('filterSelect').value;
  const search = document.getElementById('searchInput').value.toLowerCase();

  let filtered = ALL_ROWS.filter(row => {
    // 검색 필터
    if (search) {
      const inKey = row.key.toLowerCase().includes(search);
      const inEn = row.en.toLowerCase().includes(search);
      const inLang = LANGS.some(l => row.langs[l].text.toLowerCase().includes(search));
      if (!inKey && !inEn && !inLang) return false;
    }
    // 신뢰도 필터
    if (filter === 'review') return row.minConfidence !== null && row.minConfidence < 80;
    if (filter === 'low') return row.minConfidence !== null && row.minConfidence < 50;
    if (filter === 'no-score') return row.minConfidence === null;
    return true;
  });

  renderTable(filtered);
  document.getElementById('emptyMsg').style.display = filtered.length === 0 ? 'block' : 'none';
  document.getElementById('mainTable').style.display = filtered.length === 0 ? 'none' : '';
}

async function saveChanges() {
  if (Object.keys(changes).length === 0) return;

  const btn = document.getElementById('saveBtn');
  const status = document.getElementById('saveStatus');
  btn.disabled = true;
  btn.textContent = '저장 중...';
  status.textContent = '';

  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    const data = await res.json();

    if (data.success) {
      const count = Object.keys(changes).length;
      changes = {};
      status.textContent = count + '개 저장 완료 ✓';
      setTimeout(() => { status.textContent = ''; }, 3000);
      // "수정됨" 배지 모두 제거
      document.querySelectorAll('.changed-badge').forEach(b => b.remove());
      // original 값 갱신
      document.querySelectorAll('.lang-text').forEach(span => {
        span.dataset.original = span.textContent;
      });
    } else {
      status.textContent = '저장 실패';
      btn.disabled = false;
    }
  } catch {
    status.textContent = '저장 중 오류 발생';
    btn.disabled = false;
  }

  btn.textContent = '저장';
}

// 초기 렌더링
renderTable(ALL_ROWS);
</script>
</body>
</html>`;
}

// ──────────────────────────────────────────────
// HTTP 서버
// ──────────────────────────────────────────────
const server = createServer(async (req, res) => {
  // 모든 요청에 인증 체크 (ADMIN_PASSWORD 설정 시)
  if (!checkAuth(req, res)) return;

  // POST /api/save — 수정된 번역 저장
  if (req.method === 'POST' && req.url === '/api/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { changes } = JSON.parse(body);
        // changes: { "ko::header.nav.home": "수정된 텍스트" }
        const byLang = {};
        for (const [changeKey, text] of Object.entries(changes)) {
          const [lang, ...keyParts] = changeKey.split('::');
          const key = keyParts.join('::');
          if (!byLang[lang]) byLang[lang] = {};
          byLang[lang][key] = text;
        }
        for (const [lang, updates] of Object.entries(byLang)) {
          const nested = await readLocale(lang);
          for (const [key, text] of Object.entries(updates)) {
            setNestedKey(nested, key, text);
          }
          await writeLocale(lang, nested);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('저장 오류:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // GET / — 어드민 페이지
  if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
    try {
      // en.json이 없으면 안내
      if (!existsSync(path.join('locales', 'en.json'))) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<html><body style="font-family:sans-serif;padding:40px">
          <h2>⚠️ 번역 데이터가 없습니다</h2>
          <p>먼저 터미널에서 <code>npm run sync</code>를 실행해 번역을 생성하세요.</p>
        </body></html>`);
        return;
      }
      const rows = await buildTableData();
      const html = buildHTML(rows);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (err) {
      console.error('페이지 생성 오류:', err.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('서버 오류: ' + err.message);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, async () => {
  if (IS_SHARE_MODE) {
    // ── 공유 모드: localtunnel로 외부 URL 생성 ──
    if (!process.env.ADMIN_PASSWORD) {
      console.error('\n❌ 공유 모드에는 ADMIN_PASSWORD 설정이 필수입니다.');
      console.error('   .env 파일에 ADMIN_PASSWORD=원하는비밀번호 를 추가하세요.\n');
      process.exit(1);
    }

    console.log('\n🔗 외부 공유 링크 생성 중...');
    try {
      const { default: localtunnel } = await import('localtunnel');
      const tunnel = await localtunnel({ port: PORT });

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  ✅ 번역 어드민 공유 링크 생성 완료!');
      console.log('');
      console.log(`  🔗 링크:      ${tunnel.url}`);
      console.log(`  🔑 비밀번호:  ${process.env.ADMIN_PASSWORD}`);
      console.log('');
      console.log('  이 링크와 비밀번호를 검토자에게 공유하세요.');
      console.log('  Ctrl+C 를 누르면 링크가 닫힙니다.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      tunnel.on('close', () => {
        console.log('\n🔌 터널이 닫혔습니다. 공유 링크가 더 이상 작동하지 않습니다.');
      });
    } catch (err) {
      console.error('\n❌ 공유 링크 생성 실패:', err.message);
      console.error('   인터넷 연결을 확인하거나 잠시 후 다시 시도하세요.\n');
      process.exit(1);
    }
  } else {
    // ── 일반 모드: 로컬 전용 ──
    console.log(`\n✅ 번역 검토 어드민 실행 중`);
    console.log(`   브라우저에서 열기: http://localhost:${PORT}`);
    console.log('   종료하려면 Ctrl+C 를 누르세요.\n');

    // macOS에서 자동으로 브라우저 열기
    import('child_process').then(({ exec }) => {
      exec(`open http://localhost:${PORT}`);
    }).catch(() => {});
  }
});
