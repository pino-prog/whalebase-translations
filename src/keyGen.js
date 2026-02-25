/**
 * i18n 키 자동 생성기
 * - Figma 노드 경로 + 텍스트 내용으로 중첩 JSON 키를 생성
 * - 예: path=["Header","Navigation"], text="Get Started" → header.navigation.get_started
 */

const MAX_PATH_DEPTH = 4;   // 경로 최대 깊이
const MAX_KEY_LENGTH = 40;  // 단일 키 최대 길이

/**
 * 노드 이름 → snake_case 키
 */
export function nameToKey(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')   // 특수문자 → 공백
    .replace(/\s+/g, '_')            // 공백 → 언더스코어
    .replace(/^_+|_+$/g, '')         // 앞뒤 언더스코어 제거
    .substring(0, MAX_KEY_LENGTH)    // 길이 제한
    || 'unknown';
}

/**
 * 텍스트 내용 → snake_case 키 (첫 줄만, 길이 제한)
 */
export function textToKey(text) {
  const firstLine = text.split('\n')[0].trim().substring(0, 50);
  return nameToKey(firstLine) || 'text';
}

/**
 * 경로 배열 → 점 구분 prefix
 * 최대 MAX_PATH_DEPTH 깊이까지만 사용
 */
export function pathToPrefix(path) {
  return path
    .slice(-MAX_PATH_DEPTH)
    .map(nameToKey)
    .filter(k => k !== 'unknown' && k.length > 0)
    .join('.');
}

/**
 * 텍스트 노드 배열 → 평면 맵 { "header.navigation.get_started": "Get Started" }
 * 중복 키는 _2, _3으로 처리
 */
export function buildFlatMap(textNodes) {
  const usedKeys = new Map();
  const flatMap = {};

  for (const { text, path } of textNodes) {
    const prefix = pathToPrefix(path);
    const leaf = textToKey(text);
    let key = prefix ? `${prefix}.${leaf}` : leaf;

    // 중복 처리
    if (usedKeys.has(key)) {
      const count = usedKeys.get(key) + 1;
      usedKeys.set(key, count);
      key = `${key}_${count}`;
    } else {
      usedKeys.set(key, 1);
    }

    flatMap[key] = text;
  }

  return flatMap;
}

/**
 * 평면 맵 → 중첩 JSON 객체
 * { "common.button.save": "Save" } → { common: { button: { save: "Save" } } }
 */
export function flatToNested(flat) {
  const nested = {};

  for (const [dotKey, value] of Object.entries(flat)) {
    const keys = dotKey.split('.');
    let current = nested;

    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      // 이미 문자열 값이 있으면 _value로 이동 (충돌 방지)
      if (typeof current[k] === 'string') {
        current[k] = { _value: current[k] };
      }
      if (!current[k] || typeof current[k] !== 'object') {
        current[k] = {};
      }
      current = current[k];
    }

    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
  }

  return nested;
}

/**
 * 중첩 JSON → 평면 맵 (역변환, 캐시 비교용)
 */
export function nestedToFlat(nested, prefix = '') {
  const flat = {};
  for (const [key, value] of Object.entries(nested)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat[fullKey] = value;
    } else if (typeof value === 'object') {
      Object.assign(flat, nestedToFlat(value, fullKey));
    }
  }
  return flat;
}
