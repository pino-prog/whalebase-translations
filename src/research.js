/**
 * 번역 품질 향상을 위한 실제 서비스 용어 조사
 * - Claude 웹 검색으로 실제 Prop Trading / Crypto 플랫폼에서 쓰는 표현 조사
 * - 결과를 .cache/glossary.json에 저장
 * - 이후 번역 시 참고 용어집으로 활용
 *
 * 실행: npm run research
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { PROJECT_DIR } from './config.js';
import { nestedToFlat } from './keyGen.js';
import { readLocale } from './locales.js';

const GLOSSARY_FILE = path.join(PROJECT_DIR, '.cache', 'glossary.json');
const MODEL = 'claude-sonnet-4-6';

// 언어별 참고 서비스
const REFERENCE_PLATFORMS = {
  ko: 'Upbit(업비트), Bithumb(빗썸), Bitget Korea, 키움증권 해외선물, 하이투자증권, MEXC 한국어, 바이낸스 한국어',
  zh: 'OKX(欧易), 火币(HTX), 币安(Binance), Bybit中文, Gate.io, 币圈/加密货币社区',
  ja: 'bitFlyer, GMO Coin, Coincheck, SBI VC Trade, DMM Bitcoin, バイナンスジャパン',
  id: 'Indodax, Tokocrypto, Pintu, Rekeningku, Binance Indonesia, Bybit Indonesia',
  hi: 'WazirX, CoinDCX, ZebPay, CoinSwitch, Binance India, Bybit Hindi',
  tr: 'Binance Türkçe, Paribu, BtcTurk, Bitexen, ICRYPEX, Bybit Türkçe',
  vi: 'Remitano, VNDC, Binance Vietnamese, Bybit Vietnam, Gate.io Vietnamese',
  pt: 'Mercado Bitcoin, Foxbit, NovaDAX, Binance Brasil, Bybit Português',
  ru: 'Binance Русский, Bybit Русский, Garantex, CommEX, OKX Русский',
  de: 'Binance Deutschland, Bitpanda, Bison, Bybit Deutsch, Kraken Deutsch',
  es: 'Binance Español, Bitso, Ripio, Buda.com, Bybit Español, Kraken Español',
  fr: 'Binance Français, Coinhouse, Paymium, Bybit Français, Kraken Français',
};

// 언어별 검색 쿼리 키워드
const SEARCH_CONTEXT = {
  ko: '한국어 암호화폐 트레이딩 플랫폼 UI 용어 프롭트레이딩',
  zh: '加密货币交易平台界面用语 期货交易术语 自营交易',
  ja: '仮想通貨取引プラットフォーム UI用語 先物取引 プロップトレーディング',
  id: 'platform trading kripto Bahasa Indonesia terminologi UI prop trading',
  hi: 'क्रिप्टो ट्रेडिंग प्लेटफॉर्म UI हिंदी शब्दावली',
  tr: 'kripto para işlem platformu Türkçe UI terminoloji prop trading',
  vi: 'nền tảng giao dịch tiền điện tử UI tiếng Việt thuật ngữ',
  pt: 'plataforma de trading criptomoedas UI português brasileiro terminologia',
  ru: 'криптовалютная торговая платформа UI терминология пропрайетарный трейдинг',
  de: 'Krypto-Handelsplattform UI Terminologie Deutsch Eigenhandel',
  es: 'plataforma trading criptomonedas UI terminología español prop trading',
  fr: 'plateforme trading cryptomonnaies UI terminologie français prop trading',
};

// 전체 지원 언어
const ALL_LANG_NAMES = {
  ko: 'Korean (한국어)',
  zh: 'Chinese Simplified (简体中文)',
  ja: 'Japanese (日本語)',
  id: 'Indonesian (Bahasa Indonesia)',
  hi: 'Hindi (हिन्दी)',
  tr: 'Turkish (Türkçe)',
  vi: 'Vietnamese (Tiếng Việt)',
  pt: 'Portuguese Brazilian (Português do Brasil)',
  ru: 'Russian (Русский)',
  de: 'German (Deutsch)',
  es: 'Spanish (Español)',
  fr: 'French (Français)',
};

// 환경변수 TARGET_LANGS에서 동적으로 읽기, 없으면 기본값 ko/zh/ja
const LANGS = (process.env.TARGET_LANGS || 'ko,zh,ja')
  .split(',')
  .map(s => s.trim())
  .filter(l => ALL_LANG_NAMES[l]);

const LANG_NAMES = Object.fromEntries(
  LANGS.map(l => [l, ALL_LANG_NAMES[l]])
);

export async function buildGlossary(forceRebuild = false) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');
  }

  // 기존 용어집 로드 (있으면)
  let existingGlossary = {};
  if (existsSync(GLOSSARY_FILE)) {
    try {
      existingGlossary = JSON.parse(await readFile(GLOSSARY_FILE, 'utf-8'));
    } catch { existingGlossary = {}; }
  }

  // 조사가 필요한 언어 결정
  // - forceRebuild: 전체 재조사
  // - 기본: 기존 데이터가 없거나 30일 이상 된 언어만 조사
  const langsToResearch = LANGS.filter(lang => {
    if (forceRebuild) return true;
    const existing = existingGlossary[lang];
    if (!existing || Object.keys(existing).length === 0) return true; // 데이터 없음
    // 해당 언어의 조사 시각 확인 (언어별 타임스탬프 or 전체 타임스탬프)
    const researchedAt = existingGlossary[`_researched_at_${lang}`] || existingGlossary._researched_at;
    if (!researchedAt) return true;
    const age = Date.now() - new Date(researchedAt).getTime();
    return age > 30 * 24 * 60 * 60 * 1000; // 30일 초과 시 재조사
  });

  const skippedLangs = LANGS.filter(l => !langsToResearch.includes(l));

  if (skippedLangs.length > 0) {
    console.log(`   ✅ 기존 용어집 유지: ${skippedLangs.map(l => ALL_LANG_NAMES[l]).join(', ')}`);
  }
  if (langsToResearch.length === 0) {
    console.log('   모든 언어의 용어집이 최신 상태입니다. (--force 옵션으로 강제 재조사 가능)');
    return existingGlossary;
  }

  console.log(`   🔍 조사 대상: ${langsToResearch.map(l => ALL_LANG_NAMES[l]).join(', ')}`);

  // en.json에서 번역 대상 텍스트 샘플 추출 (최대 80개)
  const enNested = await readLocale('en');
  const enFlat = nestedToFlat(enNested);
  const sampleTexts = Object.values(enFlat)
    .filter(t => t.length < 60)       // 짧은 UI 텍스트 위주
    .slice(0, 80);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 기존 데이터를 기반으로 시작 (스킵된 언어 데이터 보존)
  const glossary = { ...existingGlossary, _researched_at: existingGlossary._researched_at || new Date().toISOString() };

  for (let i = 0; i < langsToResearch.length; i++) {
    const lang = langsToResearch[i];
    console.log(`\n🔍 ${ALL_LANG_NAMES[lang]} 용어 조사 중...`);
    console.log(`   참고 서비스: ${REFERENCE_PLATFORMS[lang]}`);

    const existing = existingGlossary[lang] || null;

    let retried = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        glossary[lang] = await researchLanguage(client, lang, sampleTexts);
        glossary[`_researched_at_${lang}`] = new Date().toISOString();
        const termCount = Object.keys(glossary[lang]).length;
        console.log(`   ✅ ${termCount}개 용어 수집 완료`);
        break;
      } catch (err) {
        const isRateLimit = err.message.includes('429') || err.message.includes('rate_limit');
        if (isRateLimit && attempt < 3) {
          const waitSec = 65 * attempt;
          console.log(`   ⏳ API 한도 초과 — ${waitSec}초 대기 후 재시도 (${attempt}/3)...`);
          await new Promise(r => setTimeout(r, waitSec * 1000));
          retried = true;
        } else {
          if (existing && Object.keys(existing).length > 0) {
            glossary[lang] = existing;
            console.warn(`   ⚠️  조사 실패, 기존 용어집 유지 (${Object.keys(existing).length}개)`);
          } else {
            console.warn(`   ⚠️  조사 실패, 빈 용어집으로 진행`);
            glossary[lang] = {};
          }
          break;
        }
      }
    }

    // 언어 간 간격 (마지막 언어 제외) — rate limit 방지
    if (i < langsToResearch.length - 1) {
      process.stdout.write('   다음 언어 조사까지 60초 대기...');
      await new Promise(r => setTimeout(r, 60000));
      console.log(' 계속');
    }

    // 중간 저장 (한 언어씩 진행 상황 보존, 기존 데이터 유지)
    const cacheDir = path.join(PROJECT_DIR, '.cache');
    if (!existsSync(cacheDir)) await mkdir(cacheDir, { recursive: true });
    const partial = existsSync(GLOSSARY_FILE)
      ? JSON.parse(await readFile(GLOSSARY_FILE, 'utf-8').catch(() => '{}'))
      : {};
    partial[lang] = glossary[lang];
    partial[`_researched_at_${lang}`] = glossary[`_researched_at_${lang}`];
    partial._researched_at = glossary._researched_at;
    await writeFile(GLOSSARY_FILE, JSON.stringify(partial, null, 2), 'utf-8');
  }

  await writeFile(GLOSSARY_FILE, JSON.stringify(glossary, null, 2), 'utf-8');
  console.log(`\n💾 용어집 저장 완료: ${GLOSSARY_FILE}`);

  return glossary;
}

async function researchLanguage(client, lang, sampleTexts) {
  const langName = ALL_LANG_NAMES[lang];
  const platforms = REFERENCE_PLATFORMS[lang];
  const searchContext = SEARCH_CONTEXT[lang];

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 6,
      },
    ],
    messages: [
      {
        role: 'user',
        content: `You are a professional localization researcher specializing in financial trading platforms.

Research how actual prop trading and cryptocurrency trading platforms use UI terminology in ${langName}.

Reference platforms to research: ${platforms}
Search context: ${searchContext}

RESEARCH TASKS:
1. Search how major ${langName} crypto/trading platforms (${platforms}) actually display their UI
2. Find real examples of how these English terms appear in ${langName} trading interfaces
3. Look for community discussions (Reddit, Discord, Twitter/X, local forums) about trading UI terminology in ${langName}
4. Check if traders prefer certain expressions over others

English terms to find ${langName} equivalents for:
${sampleTexts.join(', ')}

After researching, create a glossary JSON object mapping English terms to their most natural, widely-used ${langName} equivalents as actually used on real platforms.

Focus on:
- Terms that major exchanges actually use (not just literal translations)
- Expressions the trading community genuinely uses
- Natural-sounding UI text (buttons, labels, messages)

Return ONLY a valid JSON object like this (no explanation):
{
  "English Term": "실제 사용되는 번역",
  "Save": "저장",
  "Dashboard": "대시보드",
  ...
}`,
      },
    ],
  });

  // 최종 텍스트 응답 추출 (tool use 이후 마지막 text block)
  const textBlock = [...message.content].reverse().find(b => b.type === 'text');
  if (!textBlock) return {};

  const raw = textBlock.text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(raw);
  } catch {
    // JSON 파싱 실패 시 텍스트에서 키-값 쌍 추출 시도
    const pairs = {};
    const lines = raw.split('\n');
    for (const line of lines) {
      const match = line.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
      if (match) pairs[match[1]] = match[2];
    }
    return pairs;
  }
}

export async function loadGlossary() {
  if (!existsSync(GLOSSARY_FILE)) return {};
  try {
    return JSON.parse(await readFile(GLOSSARY_FILE, 'utf-8'));
  } catch { return {}; }
}

// CLI 직접 실행 시
if (process.argv[1].endsWith('research.js')) {
  const forceRebuild = process.argv.includes('--force');

  console.log('\n🌐 실제 트레이딩 플랫폼 용어 조사 시작...');
  console.log(`   대상 언어: ${LANGS.map(l => ALL_LANG_NAMES[l]).join(', ')}`);
  console.log('   웹 검색으로 실제 서비스 표현을 수집합니다.\n');

  buildGlossary(forceRebuild)
    .then(glossary => {
      const langs = LANGS.filter(l => Object.keys(glossary[l] || {}).length > 0);
      console.log('\n📚 수집된 용어집 미리보기:');
      for (const lang of langs) {
        const entries = Object.entries(glossary[lang]).slice(0, 5);
        console.log(`\n  [${lang}]`);
        for (const [en, tr] of entries) {
          console.log(`    ${en} → ${tr}`);
        }
        if (Object.keys(glossary[lang]).length > 5) {
          console.log(`    ... 외 ${Object.keys(glossary[lang]).length - 5}개`);
        }
      }
      console.log('\n✅ 완료. 이제 npm run translate 실행 시 이 용어집이 자동 적용됩니다.\n');
    })
    .catch(err => {
      console.error('❌ 오류:', err.message);
      process.exit(1);
    });
}
