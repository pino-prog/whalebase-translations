/**
 * Claude API 기반 번역기
 * - 1단계: 번역 (단순 프롬프트, 안정적)
 * - 2단계: 신뢰도 점수 (별도 호출, 실패해도 번역 결과에 영향 없음)
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const LANGUAGES = {
  ko: 'Korean (한국어)',
  zh: 'Chinese Simplified (简体中文)',
  ja: 'Japanese (日本語)',
};

// 신뢰도 점수는 Sonnet 사용 (Haiku보다 JSON 구조 준수율 높음)
const TRANSLATE_MODEL  = 'claude-haiku-4-5-20251001';
const CONFIDENCE_MODEL = 'claude-haiku-4-5-20251001';

const TRANSLATE_BATCH_SIZE  = 50;  // 안정성을 위해 50개로 줄임
const CONFIDENCE_BATCH_SIZE = 80;

const CONFIDENCE_FILE = path.join('.cache', 'confidence.json');

// ──────────────────────────────────────────────
// 번역에서 영어 그대로 유지할 용어 (진짜 고유명사/약어만)
// ──────────────────────────────────────────────
const KEEP_IN_ENGLISH = `
Cryptocurrency tickers: BTC, ETH, SOL, USDT, USDC, BNB (and any other crypto tickers)
Financial abbreviations: PnL, P&L, ROI, APY, APR, AML, KYC
Chart indicators: RSI, MACD, EMA, SMA, VWAP, ATR, OBV
Order type abbreviations: OCO, GTC, GTD, IOC, FOK
Brand/product names that are proper nouns
`.trim();

export class Translator {
  constructor(apiKey) {
    this.client = new Anthropic({ apiKey });
  }

  // ──────────────────────────────────────────────
  // 메인: 번역 실행 (신뢰도 점수는 별도)
  // ──────────────────────────────────────────────
  async translateFlatMap(flatMap, targetLang) {
    const langName = LANGUAGES[targetLang];
    if (!langName) throw new Error(`지원하지 않는 언어: ${targetLang}`);

    const entries = Object.entries(flatMap);
    const translatedResult = {};

    // 1단계: 번역
    for (let i = 0; i < entries.length; i += TRANSLATE_BATCH_SIZE) {
      const batch = Object.fromEntries(entries.slice(i, i + TRANSLATE_BATCH_SIZE));
      const batchNum = Math.floor(i / TRANSLATE_BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(entries.length / TRANSLATE_BATCH_SIZE);
      process.stdout.write(`   번역 중 [${targetLang}] 배치 ${batchNum}/${totalBatches}...`);

      const translated = await this._translateBatch(batch, langName);
      Object.assign(translatedResult, translated);
      console.log(' 완료');
    }

    // 2단계: 신뢰도 점수 (실패해도 번역 결과에 영향 없음)
    try {
      const confidenceResult = {};
      const entries2 = Object.entries(flatMap);
      for (let i = 0; i < entries2.length; i += CONFIDENCE_BATCH_SIZE) {
        const enBatch = Object.fromEntries(entries2.slice(i, i + CONFIDENCE_BATCH_SIZE));
        const trBatch = Object.fromEntries(
          entries2.slice(i, i + CONFIDENCE_BATCH_SIZE).map(([k]) => [k, translatedResult[k] || ''])
        );
        const scores = await this._scoreBatch(enBatch, trBatch, langName);
        Object.assign(confidenceResult, scores);
      }
      await this._saveConfidence(targetLang, confidenceResult);
    } catch (err) {
      console.warn(`   ⚠️  신뢰도 점수 계산 실패 (번역 결과에는 영향 없음): ${err.message}`);
    }

    return translatedResult;
  }

  // ──────────────────────────────────────────────
  // 번역 배치 (단순하고 안정적인 프롬프트)
  // ──────────────────────────────────────────────
  async _translateBatch(batch, langName, retryCount = 0) {
    const inputJson = JSON.stringify(batch, null, 2);

    const prompt = `Translate all English values in this JSON to ${langName}.
This is a professional prop trading and cryptocurrency platform UI.

IMPORTANT: You MUST translate EVERY value into ${langName}. Do not leave values in English.
Exception — keep in English only: ${KEEP_IN_ENGLISH}

Rules:
- Keep all JSON keys exactly the same
- Preserve template variables as-is: {variable}, {{var}}, %s, %d, :var
- Use natural, concise language suitable for trading platform UI
- Return ONLY the translated JSON object. No markdown, no explanation, nothing else.

${inputJson}`;

    let message;
    try {
      message = await this.client.messages.create({
        model: TRANSLATE_MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      this._handleApiError(err);
    }

    const raw = message.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      // 번역된 값이 실제로 바뀌었는지 검증
      const unchangedCount = Object.entries(parsed).filter(
        ([k, v]) => v === batch[k]
      ).length;
      const total = Object.keys(batch).length;

      // 80% 이상이 번역 안됐으면 재시도 (최대 2회)
      if (unchangedCount / total > 0.8 && retryCount < 2) {
        console.log(`\n   ⚠️  번역 비율 낮음 (${total - unchangedCount}/${total}), 재시도...`);
        return this._translateBatch(batch, langName, retryCount + 1);
      }

      return parsed;
    } catch {
      if (retryCount < 2) {
        console.log(`\n   ⚠️  JSON 파싱 실패, 재시도 (${retryCount + 1}/2)...`);
        return this._translateBatch(batch, langName, retryCount + 1);
      }
      console.error('\n   ❌ 파싱 실패 — 해당 배치 영어 원문 유지');
      console.error('   응답 미리보기:', raw.substring(0, 150));
      return batch;
    }
  }

  // ──────────────────────────────────────────────
  // 신뢰도 점수 배치 (번역과 별도 호출)
  // ──────────────────────────────────────────────
  async _scoreBatch(enBatch, trBatch, langName) {
    const pairs = Object.entries(enBatch).map(([k, en]) => ({
      key: k, en, translated: trBatch[k] || '',
    }));
    const inputJson = JSON.stringify(pairs, null, 2);

    const prompt = `Rate translation quality for each item (0-100).
Source language: English, Target language: ${langName}
Context: Professional prop trading and cryptocurrency platform

Scoring guide:
- 90-100: Perfect translation, common short UI text (Save, Cancel, Submit)
- 75-89: Good translation, standard financial/UI phrases
- 60-74: Acceptable but may need review (long sentences, marketing copy)
- 40-59: Uncertain — financial jargon, ambiguous context
- Below 40: Likely mistranslation or unclear source

Return ONLY a JSON object mapping each key to its score (number).
Example: {"header.title": 92, "footer.disclaimer": 55}

Items to score:
${inputJson}`;

    let message;
    try {
      message = await this.client.messages.create({
        model: CONFIDENCE_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch {
      // 신뢰도 실패는 무시
      return Object.fromEntries(Object.keys(enBatch).map(k => [k, null]));
    }

    const raw = message.content[0].text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return Object.fromEntries(Object.keys(enBatch).map(k => [k, null]));
    }
  }

  // ──────────────────────────────────────────────
  // API 오류 처리
  // ──────────────────────────────────────────────
  _handleApiError(err) {
    if (err.status === 401) {
      throw new Error(
        'Anthropic API 키가 유효하지 않습니다.\n' +
        '   → .env 파일의 ANTHROPIC_API_KEY를 확인하세요.\n' +
        '   → https://console.anthropic.com 에서 새 키를 발급받아 복사하세요.'
      );
    }
    if (err.status === 429) throw new Error('API 요청 한도 초과 — 잠시 후 다시 시도하세요.');
    throw err;
  }

  // ──────────────────────────────────────────────
  // 신뢰도 파일 저장
  // ──────────────────────────────────────────────
  async _saveConfidence(lang, confidenceMap) {
    if (!existsSync('.cache')) await mkdir('.cache', { recursive: true });
    let all = {};
    if (existsSync(CONFIDENCE_FILE)) {
      try { all = JSON.parse(await readFile(CONFIDENCE_FILE, 'utf-8')); } catch { all = {}; }
    }
    // null 값은 저장하지 않음
    const filtered = Object.fromEntries(
      Object.entries(confidenceMap).filter(([, v]) => v !== null)
    );
    all[lang] = { ...(all[lang] || {}), ...filtered };
    await writeFile(CONFIDENCE_FILE, JSON.stringify(all, null, 2), 'utf-8');
  }
}

export async function loadConfidence() {
  if (!existsSync(CONFIDENCE_FILE)) return {};
  try {
    return JSON.parse(await readFile(CONFIDENCE_FILE, 'utf-8'));
  } catch { return {}; }
}
