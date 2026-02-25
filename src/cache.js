/**
 * 번역 캐시 관리
 * - 마지막 추출 결과를 저장해 변경된 텍스트만 재번역
 * - 캐시 형식: { "key": "English text" } 평면 맵
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const CACHE_DIR = '.cache';
const CACHE_FILE = path.join(CACHE_DIR, 'translation-cache.json');

export async function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveCache(flatMap) {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
  await writeFile(CACHE_FILE, JSON.stringify(flatMap, null, 2), 'utf-8');
}

/**
 * 현재 추출 결과와 캐시를 비교해 변경 사항 반환
 * @returns { added, changed, removed }
 */
export function diffFlatMaps(current, cached) {
  const added = {};    // 새로 추가된 키
  const changed = {};  // 값이 바뀐 키
  const removed = [];  // 삭제된 키

  for (const [key, value] of Object.entries(current)) {
    if (!(key in cached)) {
      added[key] = value;
    } else if (cached[key] !== value) {
      changed[key] = value;
    }
  }

  for (const key of Object.keys(cached)) {
    if (!(key in current)) {
      removed.push(key);
    }
  }

  return { added, changed, removed };
}
