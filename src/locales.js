/**
 * locales 디렉토리 파일 읽기/쓰기
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const LOCALES_DIR = 'locales';
const SUPPORTED_LANGS = ['en', 'ko', 'zh', 'ja'];

export async function ensureLocalesDir() {
  if (!existsSync(LOCALES_DIR)) {
    await mkdir(LOCALES_DIR, { recursive: true });
  }
}

export function localePath(lang) {
  return path.join(LOCALES_DIR, `${lang}.json`);
}

export async function readLocale(lang) {
  const file = localePath(lang);
  if (!existsSync(file)) return {};
  try {
    const data = await readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function writeLocale(lang, data) {
  await ensureLocalesDir();
  await writeFile(localePath(lang), JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * 중첩 JSON에서 특정 키 삭제
 * "a.b.c" → nested 객체에서 a.b.c 제거
 */
export function removeNestedKey(obj, dotKey) {
  const keys = dotKey.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') return;
    current = current[keys[i]];
  }
  delete current[keys[keys.length - 1]];
  // 빈 객체 정리 (선택적)
}

/**
 * 중첩 JSON에 특정 키 설정
 */
export function setNestedKey(obj, dotKey, value) {
  const keys = dotKey.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

export { SUPPORTED_LANGS };
