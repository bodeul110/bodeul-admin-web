# BoDeul 관리자 웹 작업 규칙

## 기본 원칙

- UI 문구, 사용자에게 보이는 오류/안내 문구, 주석, 문서 설명은 한국어로 작성한다.
- 파일 인코딩은 UTF-8을 유지한다.
- 사용자 승인 없이 의존성 버전, Node 런타임 버전, Firebase 패키지 버전을 올리지 않는다.
- Firebase Web config, App Check token, API URL, 서비스 계정 키, Vercel/Firebase token은 커밋하지 않는다.
- 원 저장소 `bodeul110/Bodeul`의 Android, API, Rules, Functions, 공통 운영 문서 변경은 이 저장소에서 직접 수정하지 않고 연결 이슈/PR로 추적한다.

## 검증 기준

- 관리자 웹 변경: `npm run test`, `npm run build`
- Vite rollback 영향 변경: `npm run build:vite`
- lint 영향 변경: `npm run lint`
- GitHub YAML 변경: `yq e '.' <파일>`로 파싱 확인
- 문서 전용 변경은 링크와 경로가 현재 저장소 구조와 맞는지 확인한다.

## 배포 경계

- Vercel Preview가 Next.js 관리자 웹과 서버 route의 기본 검증 경로다.
- Firebase Hosting preview는 `admin-web-preview` Environment의 Vite rollback 검증에만 사용한다.
- production live 배포는 원 저장소 이슈 #134 기준이 확정되기 전까지 추가하지 않는다.
- Firebase Hosting 설정은 이 저장소의 `firebase.json`에서 rollback용 정적 산출물만 소유한다.
- Firestore Rules, Storage Rules, Functions는 원 저장소 `bodeul110/Bodeul`이 계속 소유한다.
- `ADMIN_DATABASE_URL`과 Firebase 서버 설정은 Next.js 서버에서만 읽고 브라우저 환경변수로 노출하지 않는다.
- 관리자 서버는 Spring Core API나 기존 Node API를 경유하지 않고 관리자 전용 DB role로 PostgreSQL을 직접 조회한다.

## PR 본문

PR 본문에는 최소한 다음 항목을 남긴다.

- 작업 목적
- 선택한 방식
- 대안
- 선택 이유
- 리스크
- 변경 범위
- 검증
- 남은 범위
