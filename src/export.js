/**
 * 번역 검토용 자체 포함 HTML 파일 내보내기
 * - 실행: npm run export
 * - review-export.html 파일 생성 → Slack/이메일 등으로 공유
 * - 검토자가 브라우저에서 열어서 수정 후 JSON 다운로드
 * - 서버/인터넷 연결 불필요
 */
import { writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PROJECT_DIR } from './config.js';
import { nestedToFlat } from './keyGen.js';
import { loadConfidence } from './translator.js';
import { readLocale } from './locales.js';

const OUTPUT_FILE = path.join('docs', 'index.html');

const ALL_LANG_LABELS = {
  ko: '한국어', zh: '중국어', ja: '일본어',
  id: 'Indonesia', hi: 'Hindi', tr: 'Türkçe',
  vi: 'Tiếng Việt', pt: 'Português', ru: 'Русский',
  de: 'Deutsch', es: 'Español', fr: 'Français',
};

async function detectLangs() {
  const localesDir = path.join(PROJECT_DIR, 'locales');
  try {
    const files = await readdir(localesDir);
    return files
      .filter(f => f.endsWith('.json') && f !== 'en.json' && !f.startsWith('.'))
      .map(f => f.replace('.json', ''))
      .sort();
  } catch {
    return [];
  }
}

async function buildTableData(langs) {
  const enNested = await readLocale('en');
  const enFlat = nestedToFlat(enNested);

  const langFlats = {};
  for (const lang of langs) {
    langFlats[lang] = nestedToFlat(await readLocale(lang));
  }

  const confidence = await loadConfidence();

  const rows = Object.entries(enFlat).map(([key, enText]) => {
    const langData = {};
    let minConfidence = 100;

    for (const lang of langs) {
      const text = langFlats[lang][key] || '';
      const score = confidence[lang]?.[key] ?? null;
      langData[lang] = { text, confidence: score };
      if (score !== null && score < minConfidence) minConfidence = score;
    }

    return { key, en: enText, langs: langData, minConfidence: minConfidence === 100 ? null : minConfidence };
  });

  rows.sort((a, b) => (a.minConfidence ?? 100) - (b.minConfidence ?? 100));
  return rows;
}

function buildExportHTML(rows, langs) {
  const langLabels = Object.fromEntries(langs.map(l => [l, ALL_LANG_LABELS[l] || l.toUpperCase()]));
  const totalKeys = rows.length;
  const needsReview = rows.filter(r => r.minConfidence !== null && r.minConfidence < 80).length;
  const confRows = rows.filter(r => r.minConfidence !== null);
  const avgConf = confRows.length
    ? Math.round(confRows.reduce((s, r) => s + r.minConfidence, 0) / confRows.length)
    : null;

  const exportDate = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>번역 검토 — ${exportDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f6fa; color: #333; }

  .header { background: #1a1a2e; color: white; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
  .header h1 { font-size: 18px; font-weight: 700; }
  .header-right { display: flex; gap: 10px; align-items: center; }
  .export-date { font-size: 12px; color: #aaa; }
  select { padding: 7px 12px; border-radius: 6px; border: none; font-size: 14px; cursor: pointer; }
  .btn-dl { background: #4CAF50; color: white; border: none; padding: 8px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
  .btn-dl:hover { background: #45a049; }
  .btn-dl:disabled { background: #aaa; cursor: not-allowed; }
  .save-status { font-size: 13px; color: #a0d4a0; min-width: 100px; text-align: right; }

  .guide-banner { background: #e8f4fd; border-left: 4px solid #4a90d9; padding: 14px 24px; font-size: 14px; color: #1a5276; line-height: 1.7; }
  .guide-banner strong { font-weight: 700; }

  .stats { display: flex; gap: 16px; padding: 16px 24px; background: white; border-bottom: 1px solid #e0e0e0; }
  .stat-card { text-align: center; padding: 10px 20px; border-radius: 8px; background: #f8f9fc; min-width: 100px; }
  .stat-card .num { font-size: 24px; font-weight: 700; }
  .stat-card .label { font-size: 12px; color: #888; margin-top: 2px; }
  .stat-card.warning .num { color: #e67e22; }
  .stat-card.danger .num { color: #e74c3c; }
  .stat-card.good .num { color: #27ae60; }

  .table-wrap { padding: 16px 24px; overflow-x: auto; }
  .search-wrap { padding: 0 24px 12px; }
  .search-input { width: 100%; max-width: 400px; padding: 9px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; }
  .search-input:focus { border-color: #4a90d9; }

  table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); font-size: 13px; }
  thead { background: #f0f2f8; }
  th { padding: 12px 14px; text-align: left; font-weight: 600; color: #555; border-bottom: 2px solid #e0e4f0; white-space: nowrap; }
  td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafbff; }

  .td-key { font-family: monospace; font-size: 11px; color: #888; max-width: 180px; word-break: break-all; }
  .td-en { color: #444; max-width: 180px; }
  .td-lang { position: relative; min-width: 160px; max-width: 200px; }
  .lang-text { display: block; color: #333; line-height: 1.5; word-break: break-word; padding: 2px 4px; border-radius: 4px; }
  .lang-text[contenteditable="true"] { outline: 2px solid #4a90d9; background: #f0f7ff; min-height: 22px; }
  .edit-btn { display: none; position: absolute; top: 6px; right: 6px; background: #e8f0fe; border: none; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; color: #4a90d9; }
  .td-lang:hover .edit-btn { display: block; }
  .changed-badge { display: inline-block; background: #fff3cd; color: #856404; font-size: 10px; padding: 1px 5px; border-radius: 3px; margin-left: 4px; }

  .confidence { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; margin-top: 4px; }
  .conf-high { background: #d4edda; color: #155724; }
  .conf-mid  { background: #fff3cd; color: #856404; }
  .conf-low  { background: #f8d7da; color: #721c24; }
  .conf-none { background: #e9ecef; color: #6c757d; }
  .td-min-conf { text-align: center; white-space: nowrap; }
  .min-conf-bar { height: 4px; border-radius: 2px; margin-top: 4px; }
  .bar-high { background: #28a745; }
  .bar-mid  { background: #ffc107; }
  .bar-low  { background: #dc3545; }
  .empty { text-align: center; padding: 60px; color: #aaa; }

  /* 다운로드 완료 모달 */
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 200; align-items: center; justify-content: center; }
  .modal-overlay.show { display: flex; }
  .modal { background: white; border-radius: 12px; padding: 32px; max-width: 420px; width: 90%; text-align: center; }
  .modal h2 { font-size: 20px; margin-bottom: 12px; }
  .modal p { color: #666; font-size: 14px; line-height: 1.7; margin-bottom: 20px; }
  .modal-close { background: #4a90d9; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>번역 검토</h1>
    <div class="export-date">내보낸 시각: ${exportDate}</div>
  </div>
  <div class="header-right">
    <select id="filterSelect" onchange="applyFilter()">
      <option value="all">전체 보기</option>
      <option value="review">검토 필요 (80% 미만)</option>
      <option value="low">낮음 (50% 미만)</option>
    </select>
    <button class="btn-dl" id="dlBtn" onclick="downloadChanges()" disabled>수정 내용 다운로드</button>
    <span class="save-status" id="saveStatus"></span>
  </div>
</div>

<div class="guide-banner">
  <strong>사용 방법:</strong>
  각 셀의 <strong>편집</strong> 버튼을 눌러 번역을 수정하세요.
  수정 후 <strong>수정 내용 다운로드</strong> 버튼을 누르면 변경된 언어의 JSON 파일이 저장됩니다.
  다운로드된 파일을 <code>locales/</code> 폴더에 복사해서 덮어쓰세요.
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
</div>

<div class="search-wrap" style="padding-top:16px">
  <input class="search-input" type="text" placeholder="키 또는 텍스트 검색..." oninput="applyFilter()" id="searchInput">
</div>

<div class="table-wrap">
  <table id="mainTable">
    <thead>
      <tr>
        <th>키</th>
        <th>영어 (원문)</th>
        ${langs.map(l => `<th>${langLabels[l]}</th>`).join('\n        ')}
        <th style="text-align:center">최소 신뢰도</th>
      </tr>
    </thead>
    <tbody id="tableBody"></tbody>
  </table>
  <div class="empty" id="emptyMsg" style="display:none">표시할 항목이 없습니다.</div>
</div>

<!-- 다운로드 완료 안내 모달 -->
<div class="modal-overlay" id="modalOverlay">
  <div class="modal">
    <h2>✅ 다운로드 완료</h2>
    <p id="modalMsg"></p>
    <button class="modal-close" onclick="document.getElementById('modalOverlay').classList.remove('show')">확인</button>
  </div>
</div>

<script>
const ALL_ROWS = ${JSON.stringify(rows)};
const LANGS = ${JSON.stringify(langs)};
const LANG_LABELS = ${JSON.stringify(langLabels)};
let changes = {}; // { "ko::key": "수정된 텍스트" }

// ── 중첩 JSON 변환 (서버 없이 브라우저에서 직접 처리) ──
function flatToNested(flat) {
  const nested = {};
  for (const [dotKey, value] of Object.entries(flat)) {
    const keys = dotKey.split('.');
    let cur = nested;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof cur[keys[i]] === 'string') cur[keys[i]] = { _value: cur[keys[i]] };
      if (!cur[keys[i]]) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }
  return nested;
}

function confClass(s) {
  if (s === null) return 'conf-none';
  return s >= 90 ? 'conf-high' : s >= 70 ? 'conf-mid' : 'conf-low';
}
function barClass(s) {
  if (s === null) return '';
  return s >= 80 ? 'bar-high' : s >= 60 ? 'bar-mid' : 'bar-low';
}

function renderTable(rows) {
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.key = row.key;

    const tdKey = document.createElement('td');
    tdKey.className = 'td-key';
    tdKey.textContent = row.key;
    tr.appendChild(tdKey);

    const tdEn = document.createElement('td');
    tdEn.className = 'td-en';
    tdEn.textContent = row.en;
    tr.appendChild(tdEn);

    LANGS.forEach(lang => {
      const { text, confidence } = row.langs[lang];
      const changeKey = lang + '::' + row.key;
      const currentText = changes[changeKey] ?? text;

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
      if (changeKey in changes) {
        const b = document.createElement('span');
        b.className = 'changed-badge'; b.textContent = '수정됨';
        td.appendChild(b);
      }
      td.appendChild(editBtn);
      td.appendChild(document.createElement('br'));
      td.appendChild(confBadge);
      tr.appendChild(td);
    });

    const tdMin = document.createElement('td');
    tdMin.className = 'td-min-conf';
    const s = row.minConfidence;
    if (s !== null) {
      const badge = document.createElement('span');
      badge.className = 'confidence ' + confClass(s);
      badge.style.fontSize = '13px';
      badge.textContent = s + '%';
      const bar = document.createElement('div');
      bar.className = 'min-conf-bar ' + barClass(s);
      bar.style.width = s + '%';
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
    if (!span.parentNode.querySelector('.changed-badge')) {
      const b = document.createElement('span');
      b.className = 'changed-badge'; b.textContent = '수정됨';
      span.parentNode.insertBefore(b, span.nextSibling);
    }
  } else {
    delete changes[changeKey];
    span.parentNode.querySelectorAll('.changed-badge').forEach(b => b.remove());
  }
  document.getElementById('dlBtn').disabled = Object.keys(changes).length === 0;
}

function applyFilter() {
  const filter = document.getElementById('filterSelect').value;
  const search = document.getElementById('searchInput').value.toLowerCase();
  const filtered = ALL_ROWS.filter(row => {
    if (search) {
      const match = row.key.toLowerCase().includes(search) ||
        row.en.toLowerCase().includes(search) ||
        LANGS.some(l => row.langs[l].text.toLowerCase().includes(search));
      if (!match) return false;
    }
    if (filter === 'review') return row.minConfidence !== null && row.minConfidence < 80;
    if (filter === 'low') return row.minConfidence !== null && row.minConfidence < 50;
    return true;
  });
  renderTable(filtered);
  document.getElementById('emptyMsg').style.display = filtered.length === 0 ? 'block' : 'none';
  document.getElementById('mainTable').style.display = filtered.length === 0 ? 'none' : '';
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadChanges() {
  if (Object.keys(changes).length === 0) return;

  // 언어별로 변경 사항 분류
  const byLang = {};
  for (const [changeKey, newText] of Object.entries(changes)) {
    const colonIdx = changeKey.indexOf('::');
    const lang = changeKey.slice(0, colonIdx);
    const key = changeKey.slice(colonIdx + 2);
    if (!byLang[lang]) byLang[lang] = {};
    byLang[lang][key] = newText;
  }

  const downloadedLangs = [];
  for (const [lang, langChanges] of Object.entries(byLang)) {
    // 해당 언어의 전체 데이터 재구성
    const fullFlat = {};
    ALL_ROWS.forEach(row => {
      const text = changes[lang + '::' + row.key] ?? row.langs[lang]?.text ?? '';
      if (text) fullFlat[row.key] = text;
    });
    downloadJSON(lang + '.json', flatToNested(fullFlat));
    downloadedLangs.push(LANG_LABELS[lang] || lang);
  }

  // 수정됨 배지 초기화
  document.querySelectorAll('.changed-badge').forEach(b => b.remove());
  document.querySelectorAll('.lang-text').forEach(span => {
    span.dataset.original = span.textContent;
  });
  const savedCount = Object.keys(changes).length;
  changes = {};
  document.getElementById('dlBtn').disabled = true;

  // 완료 모달
  document.getElementById('modalMsg').innerHTML =
    '<strong>' + downloadedLangs.join(', ') + '</strong> 파일이 다운로드됐습니다.<br><br>' +
    '다운로드된 <strong>' + downloadedLangs.map(l => {
      const code = Object.keys(LANG_LABELS).find(k => LANG_LABELS[k] === l);
      return '<code>' + code + '.json</code>';
    }).join(', ') + '</strong> 파일을<br>' +
    '프로젝트의 <code>locales/</code> 폴더에 복사해서 덮어쓰세요.';
  document.getElementById('modalOverlay').classList.add('show');
}

renderTable(ALL_ROWS);
</script>
</body>
</html>`;
}

// ── 실행 ──
async function main() {
  if (!existsSync(path.join(PROJECT_DIR, 'locales', 'en.json'))) {
    console.error('❌ locales/en.json이 없습니다. 먼저 npm run sync를 실행하세요.');
    process.exit(1);
  }

  console.log('📦 번역 데이터 불러오는 중...');
  const langs = await detectLangs();
  console.log(`   감지된 언어: ${langs.join(', ')}`);
  const rows = await buildTableData(langs);
  const html = buildExportHTML(rows, langs);

  if (!existsSync('docs')) await mkdir('docs', { recursive: true });
  await writeFile(OUTPUT_FILE, html, 'utf-8');

  console.log(`\n✅ 검토 페이지 생성 완료: ${OUTPUT_FILE}`);
  console.log(`   총 ${rows.length}개 키, 검토 필요: ${rows.filter(r => r.minConfidence !== null && r.minConfidence < 80).length}개\n`);
  console.log('다음 단계 — GitHub Pages 배포:');
  console.log('  git add docs/ locales/ .cache/');
  console.log('  git commit -m "Update translations review page"');
  console.log('  git push\n');
}

main().catch(err => {
  console.error('❌ 오류:', err.message);
  process.exit(1);
});
