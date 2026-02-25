/**
 * whalebasetrans CLI
 *
 * 사용법:
 *   node src/index.js extract          Figma → locales/en.json 생성
 *   node src/index.js translate        en.json → ko/zh/ja.json 번역
 *   node src/index.js update           변경된 텍스트만 감지해 업데이트
 *   node src/index.js sync             extract + translate 한번에 실행
 *
 * 환경변수 (.env):
 *   FIGMA_TOKEN        Figma Personal Access Token
 *   FIGMA_FILE_ID      번역할 Figma 파일 ID
 *   ANTHROPIC_API_KEY  번역에 사용할 Claude API 키
 *   FIGMA_PAGE_NAME    (선택) 특정 페이지만 추출
 */
import 'dotenv/config';
import { fetchFigmaDocument, extractTextNodes } from './figma.js';
import { buildFlatMap, flatToNested, nestedToFlat } from './keyGen.js';
import { Translator } from './translator.js';
import { loadCache, saveCache, diffFlatMaps } from './cache.js';
import {
  readLocale,
  writeLocale,
  removeNestedKey,
  setNestedKey,
  ensureLocalesDir,
} from './locales.js';

const TARGET_LANGS = ['ko', 'zh', 'ja'];

// ──────────────────────────────────────────────
// 환경변수 검증
// ──────────────────────────────────────────────
function requireEnv(...keys) {
  const missing = keys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ 필수 환경변수가 없습니다: ${missing.join(', ')}`);
    console.error('   env.template 파일을 참고해 .env 파일을 생성하세요.');
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// extract: Figma → en.json
// ──────────────────────────────────────────────
async function cmdExtract() {
  requireEnv('FIGMA_TOKEN', 'FIGMA_FILE_ID');

  const { FIGMA_TOKEN, FIGMA_FILE_ID, FIGMA_PAGE_NAME } = process.env;

  console.log('🔍 Figma 파일 불러오는 중...');
  const document = await fetchFigmaDocument(FIGMA_FILE_ID, FIGMA_TOKEN);

  console.log('📝 영어 텍스트 노드 추출 중...');
  const { nodes: textNodes, stats } = extractTextNodes(document, FIGMA_PAGE_NAME || null);
  console.log(`   → 영어 텍스트 ${textNodes.length}개 추출`);
  if (stats.skippedKorean > 0) {
    console.log(`   → 한글 텍스트 ${stats.skippedKorean}개 제외 (디자인 주석으로 판단)`);
  }

  const flatMap = buildFlatMap(textNodes);
  const nested = flatToNested(flatMap);

  await ensureLocalesDir();
  await writeLocale('en', nested);
  await saveCache(flatMap);

  console.log(`✅ locales/en.json 생성 완료 (${Object.keys(flatMap).length}개 키)`);
  return flatMap;
}

// ──────────────────────────────────────────────
// translate: en.json → ko/zh/ja.json
// ──────────────────────────────────────────────
async function cmdTranslate() {
  requireEnv('ANTHROPIC_API_KEY');

  const enNested = await readLocale('en');
  const flatMap = nestedToFlat(enNested);

  if (Object.keys(flatMap).length === 0) {
    console.error('❌ locales/en.json이 없거나 비어있습니다. 먼저 extract를 실행하세요.');
    process.exit(1);
  }

  const translator = new Translator(process.env.ANTHROPIC_API_KEY);

  for (const lang of TARGET_LANGS) {
    console.log(`\n🌐 ${lang} 번역 시작...`);
    const translated = await translator.translateFlatMap(flatMap, lang);
    const nested = flatToNested(translated);
    await writeLocale(lang, nested);
    console.log(`✅ locales/${lang}.json 저장 완료`);
  }
}

// ──────────────────────────────────────────────
// update: 변경된 텍스트만 감지해 업데이트
// ──────────────────────────────────────────────
async function cmdUpdate() {
  requireEnv('FIGMA_TOKEN', 'FIGMA_FILE_ID', 'ANTHROPIC_API_KEY');

  const { FIGMA_TOKEN, FIGMA_FILE_ID, FIGMA_PAGE_NAME } = process.env;

  console.log('🔍 Figma 파일 불러오는 중...');
  const document = await fetchFigmaDocument(FIGMA_FILE_ID, FIGMA_TOKEN);
  const { nodes: textNodes, stats } = extractTextNodes(document, FIGMA_PAGE_NAME || null);
  if (stats.skippedKorean > 0) {
    console.log(`   → 한글 텍스트 ${stats.skippedKorean}개 제외 (디자인 주석)`);
  }
  const currentFlat = buildFlatMap(textNodes);

  const cachedFlat = await loadCache();
  const { added, changed, removed } = diffFlatMaps(currentFlat, cachedFlat);

  const addedCount = Object.keys(added).length;
  const changedCount = Object.keys(changed).length;
  const removedCount = removed.length;

  console.log(`\n📊 변경 사항 감지:`);
  console.log(`   + 추가: ${addedCount}개`);
  console.log(`   ~ 수정: ${changedCount}개`);
  console.log(`   - 삭제: ${removedCount}개`);

  if (addedCount + changedCount + removedCount === 0) {
    console.log('\n✅ 변경된 텍스트가 없습니다.');
    return;
  }

  // en.json 업데이트
  const enNested = await readLocale('en');
  for (const [key, value] of Object.entries({ ...added, ...changed })) {
    setNestedKey(enNested, key, value);
  }
  for (const key of removed) {
    removeNestedKey(enNested, key);
  }
  await writeLocale('en', enNested);
  console.log('\n✅ locales/en.json 업데이트 완료');

  // 번역이 필요한 키가 있으면 번역
  const toTranslate = { ...added, ...changed };
  if (Object.keys(toTranslate).length === 0) {
    // 삭제만 있는 경우 — 번역 파일에서도 제거
    for (const lang of TARGET_LANGS) {
      const nested = await readLocale(lang);
      for (const key of removed) removeNestedKey(nested, key);
      await writeLocale(lang, nested);
      console.log(`✅ locales/${lang}.json 삭제 항목 반영 완료`);
    }
  } else {
    const translator = new Translator(process.env.ANTHROPIC_API_KEY);

    for (const lang of TARGET_LANGS) {
      console.log(`\n🌐 ${lang} 번역 중...`);
      const translatedFlat = await translator.translateFlatMap(toTranslate, lang);
      const langNested = await readLocale(lang);

      // 추가/수정 반영
      for (const [key, value] of Object.entries(translatedFlat)) {
        setNestedKey(langNested, key, value);
      }
      // 삭제 반영
      for (const key of removed) {
        removeNestedKey(langNested, key);
      }

      await writeLocale(lang, langNested);
      console.log(`✅ locales/${lang}.json 업데이트 완료`);
    }
  }

  // 캐시 업데이트
  await saveCache(currentFlat);
  console.log('\n🎉 모든 업데이트 완료!');
}

// ──────────────────────────────────────────────
// sync: extract + translate 한번에
// ──────────────────────────────────────────────
async function cmdSync() {
  await cmdExtract();
  await cmdTranslate();
  console.log('\n🎉 전체 동기화 완료!');
}

// ──────────────────────────────────────────────
// 엔트리 포인트
// ──────────────────────────────────────────────
const command = process.argv[2];

const commands = {
  extract: cmdExtract,
  translate: cmdTranslate,
  update: cmdUpdate,
  sync: cmdSync,
};

if (!command || !commands[command]) {
  console.log(`
사용법: node src/index.js <command>

Commands:
  extract    Figma에서 텍스트를 추출해 locales/en.json 생성
  translate  locales/en.json을 한국어/중국어/일본어로 번역
  update     Figma 변경 사항만 감지해 모든 locale 파일 업데이트
  sync       extract + translate를 한번에 실행 (처음 시작 시)

예시:
  npm run sync         # 처음 시작
  npm run update       # Figma 업데이트 이후
  npm run translate    # 번역만 다시 실행
`);
  process.exit(0);
}

commands[command]().catch(err => {
  console.error(`❌ 오류 발생:`, err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
