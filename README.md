# Scorebridge

이미지·PDF 악보를 MusicXML로 변환하는 웹 기반 로컬 PoC입니다. 실제 Audiveris 엔진을 사용하며 샘플 결과를 반환하는 모의 변환은 사용하지 않습니다.

## 구현된 기능

- JPG·PNG·PDF 업로드: 최대 20MB, PDF 최대 5페이지
- PostgreSQL 작업 저장, Redis/BullMQ 비동기 인식, 페이지별 상태
- Audiveris 5.11.0 실제 인식과 압축 MXL → MusicXML 변환
- 원본과 디지털 악보 비교, 원본 확대, 페이지별 MusicXML 다운로드
- 작업 이력·새로고침 복구·실패 페이지 재시도·삭제
- 워커가 실행 중일 때 7일 만료 작업 정리

웹 악보 편집·재생·계정 인증·전체 곡 병합·ZIP 출력·OCI 배포는 아직 구현하지 않았습니다. 현재는 한 컴퓨터의 사용자 한 명이 쓰는 localhost 전용이며 공개 서버용 구성은 아닙니다. 여러 페이지는 서로 독립적으로 인식합니다.

## 로컬 실행: macOS

필수: Node.js 22 이상, pnpm 10, Homebrew. 현재 검증 환경은 Apple Silicon입니다.

```sh
brew install postgresql@17 redis
pnpm install
pnpm setup:engine
pnpm setup:local
pnpm dev
```

브라우저에서 [http://127.0.0.1:5173](http://127.0.0.1:5173)을 엽니다. `fixtures/scores/simple.png` 또는 `simple.pdf`로 바로 시험할 수 있습니다.

`setup:engine`은 공식 macOS Audiveris 배포본을 `.local/`에 내려받습니다. 이 엔진은 AGPL-3.0이며 해당 설치 스크립트는 DMG 라이선스 동의 입력을 전달합니다. 배포·상용 서비스 적용 시 라이선스 의무를 별도로 검토해야 합니다. 설치 후 `setup:local`이 번들 Java를 사용하는 CLI wrapper를 만듭니다. 시스템 Java 설치는 필요하지 않습니다.

`setup:local`은 저장소 전용 PostgreSQL 클러스터와 Redis를 시작하며 시스템 로그인 시 자동 실행 서비스를 등록하지 않습니다. PostgreSQL은 로컬 연결에 trust 인증을 사용하므로 이 컴퓨터의 신뢰된 사용자만 사용하는 개발 환경이 전제입니다.

PDF에는 `pdftoppm`이 필요합니다. 이 컴퓨터에서는 Codex 번들 실행 파일을 사용합니다. 다른 환경에서는 `brew install poppler`로 준비하거나 `PDFTOPPM_BIN`을 지정하세요.

Node가 PATH에 없고 nvm을 사용한다면 먼저 `nvm use 22`를 실행하세요. 다른 OS에서는 PostgreSQL·Redis를 직접 준비하고 실행 환경 변수를 설정해야 하며, 자동 설치 스크립트는 macOS 전용입니다.

## 포트·데이터·종료

| 대상 | 값 |
| --- | --- |
| 웹 | 127.0.0.1:5173 |
| API | 127.0.0.1:3001 |
| PostgreSQL | 127.0.0.1:55432 / scorebridge |
| Redis | 127.0.0.1:56379 |
| 원본·결과·런타임·DB | 저장소 `.local/` 아래, Git 제외 |

`pnpm dev` 터미널에서 Ctrl+C로 웹·API·워커를 종료합니다. DB와 Redis도 종료하려면 `pnpm stop:local`을 실행합니다. 다음 사용 시 `pnpm setup:local`로 다시 시작할 수 있습니다.

환경 변수: `DATABASE_URL`, `REDIS_PORT`, `AUDIVERIS_BIN`, `PDFTOPPM_BIN`, `PG_BIN_DIR`, `REDIS_BIN`. Audiveris 실행 파일은 `-batch -export -output ... -- input.png`를 받는 CLI여야 합니다.

## 검증

```sh
pnpm build
pnpm test
# 웹/API/워커가 켜져 있어야 합니다. 실제 인식으로 수십 초가 걸릴 수 있습니다.
pnpm test:smoke
```

Smoke test는 자작 PNG·PDF의 실제 인식, MusicXML 다운로드, 4마디 출력, 잘못된 파일과 외부 origin 거절, 작업 삭제를 확인합니다. 품질 목표의 달성을 뜻하지는 않습니다.

샘플 이미지를 다시 생성하려면:

```sh
pnpm exec playwright install chromium
pnpm sample
```

샘플은 직접 작성한 CC0 악보이며 실제 스캔·사진과 다양한 음악 구조에 대한 성능은 추가 평가가 필요합니다. 제목·가사 OCR 품질은 설치된 OCR 언어 데이터에 따라 달라집니다.

## 설계와 현재 구현의 차이

현재는 모노레포 분리와 Docker Compose 전에 로컬에서 전체 흐름을 검증하는 단계입니다. 화면·서버·워커는 `src/web`, `src/server.ts`, `src/worker.ts`로 분리했습니다. DB migration은 시작 시 적용하는 초기 스키마이며 운영용 migration 시스템은 후속 단계입니다.

현재 API는 업로드와 작업 생성을 `POST /api/jobs`로 묶었습니다. 입력 준비 후 페이지를 선택하는 단계와 인증·권한, 엄격한 실행 lease, API 멱등성은 공개 MVP 전에 추가해야 합니다. 재시도 시 generation과 조건부 갱신으로 오래된 결과 확정을 막지만, 운영 수준의 장애 복구 검증은 아직 완료하지 않았습니다.

- [제품 기획](docs/product-plan.md)
- [기술 설계](docs/technical-design.md)
- [OCI 인프라 계획](docs/infrastructure-plan.md)

## 다음 단계

1. 실제 악보 자료로 품질·처리 시간·메모리를 측정한다.
2. 브라우저 기본 편집과 재생을 구현한다.
3. 패키지 분리·컨테이너화·인증·백업·실행 복구를 보강한다.
4. Linux ARM64 실제 인식을 검증하고 OCI에 배포한다.
