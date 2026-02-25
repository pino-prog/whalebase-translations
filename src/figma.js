/**
 * Figma API 클라이언트
 * - 파일 전체 노드 트리를 가져와 TEXT 노드만 추출
 */
import axios from 'axios';

const FIGMA_API = 'https://api.figma.com/v1';

const TIMEOUT_MS = 120000;  // 2분 (대형 파일 대응)
const MAX_RETRIES = 3;       // 실패 시 최대 재시도 횟수
const RETRY_DELAY_MS = 3000; // 재시도 전 대기 시간 (3초)

// 경로에 포함할 노드 타입 (화면 구조를 나타내는 타입들)
const PATH_NODE_TYPES = new Set([
  'FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'
]);

// 경로에서 제외할 타입 (최상위 구조)
const SKIP_PATH_TYPES = new Set(['DOCUMENT', 'CANVAS']);

/**
 * Figma 파일 document 노드 전체를 가져옴
 * - geometry=omit: 벡터/도형 좌표 데이터 제외 → 응답 크기 대폭 감소
 * - 타임아웃 2분, 실패 시 최대 3회 재시도
 */
export async function fetchFigmaDocument(fileId, token) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        console.log(`   재시도 중... (${attempt}/${MAX_RETRIES})`);
        await sleep(RETRY_DELAY_MS * (attempt - 1));
      }

      const response = await axios.get(`${FIGMA_API}/files/${fileId}`, {
        headers: { 'X-Figma-Token': token },
        timeout: TIMEOUT_MS,
        params: {
          geometry: 'omit',       // 도형 좌표 제외 (응답 크기 50~80% 감소)
          branch_data: false,     // 브랜치 데이터 제외
        },
      });

      return response.data.document;
    } catch (err) {
      lastError = err;

      if (err.response?.status === 403) {
        throw new Error('Figma 접근 권한 없음 — FIGMA_TOKEN이 올바른지 확인하세요.');
      }
      if (err.response?.status === 404) {
        throw new Error('Figma 파일을 찾을 수 없음 — FIGMA_FILE_ID가 올바른지 확인하세요.');
      }

      const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
      if (isTimeout && attempt < MAX_RETRIES) {
        console.warn(`⚠️  타임아웃 발생 (${attempt}/${MAX_RETRIES}회), 잠시 후 재시도합니다...`);
        continue;
      }
    }
  }

  throw new Error(`Figma API 요청 실패 (${MAX_RETRIES}회 시도): ${lastError.message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * document 노드에서 영어 TEXT 노드만 추출
 * - 한글 텍스트(디자인 설명/주석) 자동 제외
 * @returns { nodes: Array<{ text, path, nodeId }>, skippedKorean: number }
 */
export function extractTextNodes(document, pageFilter = null) {
  const nodes = [];
  const stats = { skippedKorean: 0, skippedNoise: 0 };

  // 페이지(CANVAS) 필터링
  const pages = pageFilter
    ? document.children.filter(p => p.name === pageFilter)
    : document.children;

  if (pageFilter && pages.length === 0) {
    console.warn(`⚠️  페이지 "${pageFilter}"를 찾을 수 없습니다.`);
    console.warn(`   사용 가능한 페이지: ${document.children.map(p => p.name).join(', ')}`);
  }

  for (const page of pages) {
    traverse(page, [], nodes, stats, 0);
  }

  return { nodes, stats };
}

function traverse(node, parentPath, nodes, stats, depth) {
  // 너무 깊은 depth는 스킵 (성능 보호)
  if (depth > 20) return;

  if (node.type === 'TEXT') {
    const text = (node.characters || '').trim();
    if (!text) return;

    if (isNoise(text)) { stats.skippedNoise++; return; }
    if (isKorean(text)) { stats.skippedKorean++; return; }  // 한글 = 디자인 주석
    if (!hasEnglish(text)) { stats.skippedNoise++; return; } // 영어 없음

    nodes.push({ text, path: parentPath, nodeId: node.id });
    return;
  }

  // 현재 노드 이름을 경로에 포함할지 결정
  const isPathNode = PATH_NODE_TYPES.has(node.type);
  const isSkipNode = SKIP_PATH_TYPES.has(node.type) || node.type === 'CANVAS';
  const newPath = (!isSkipNode && isPathNode) ? [...parentPath, node.name] : parentPath;

  if (node.children) {
    for (const child of node.children) {
      traverse(child, newPath, nodes, stats, depth + 1);
    }
  }
}

/**
 * 아이콘, 이모지 등 번역 불필요한 노이즈 텍스트 판별
 */
function isNoise(text) {
  // 1~2자 특수문자만 있는 경우 (아이콘 문자 등)
  if (text.length <= 2 && /^[^\w\s가-힣ぁ-ヺ一-龥]+$/.test(text)) return true;
  // 숫자만 있는 경우 (금액, 퍼센트, 수량 등)
  if (/^\d+(\.\d+)?%?$/.test(text)) return true;
  // URL
  if (/^https?:\/\//.test(text)) return true;
  return false;
}

/**
 * 한글이 포함된 텍스트인지 판별
 * Figma에서 디자인 설명/주석을 한글로 작성한 경우 번역 대상에서 제외
 */
function isKorean(text) {
  // 한글(가-힣, 자모)이 하나라도 있으면 한국어 텍스트로 판단
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

/**
 * 영어(라틴 알파벳)가 포함된 텍스트인지 판별
 * 영어가 전혀 없는 텍스트(예: 순수 기호, 숫자+기호 조합)는 번역 불필요
 */
function hasEnglish(text) {
  return /[a-zA-Z]/.test(text);
}
