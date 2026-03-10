/**
 * 프로젝트 디렉토리 설정
 *
 * --project <dir> 플래그로 데이터 디렉토리(locales/, .cache/, .env)를 지정.
 * 미지정 시 현재 작업 디렉토리 사용.
 *
 * 사용예:
 *   node src/index.js sync --project ~/projects/whalebase
 *   node src/index.js sync                    # 현재 디렉토리
 */
import { resolve } from 'path';
import dotenv from 'dotenv';

const projectArgIdx = process.argv.indexOf('--project');
export const PROJECT_DIR =
  projectArgIdx !== -1 ? resolve(process.argv[projectArgIdx + 1]) : resolve('.');

// 프로젝트 디렉토리의 .env 로드
dotenv.config({ path: resolve(PROJECT_DIR, '.env') });
