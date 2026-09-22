# BoDeul 관리자 웹 작업 규칙

## 기본 원칙

- UI 문구, 사용자에게 보이는 오류/안내 문구, 주석, 문서 설명은 한국어로 작성한다.
- 파일 인코딩은 UTF-8을 유지한다.
- 사용자 승인 없이 의존성 버전, Node 런타임 버전, Firebase 패키지 버전을 올리지 않는다.
- Firebase Web config, App Check token, API URL, 서비스 계정 키, Vercel/Firebase token은 커밋하지 않는다.
- 원 저장소 `bodeul110/bodeul-platform`의 Android, API, Rules, Functions, 공통 운영 문서 변경은 이 저장소에서 직접 수정하지 않고 연결 이슈/PR로 추적한다.

## 검증 기준

- 관리자 웹 변경: `npm run test`, `npm run build`
- Vite rollback 영향 변경: `npm run build:vite`
- lint 영향 변경: `npm run lint`
- GitHub YAML 변경: `yq e '.' <파일>`로 파싱 확인
- 문서 전용 변경은 링크와 경로가 현재 저장소 구조와 맞는지 확인한다.

## 배포 경계

- Vercel Preview가 Next.js 관리자 웹과 서버 route의 기본 검증 경로다.
- Vercel Functions는 Supabase Tokyo와 같은 `hnd1`에서 실행한다.
- Vite rollback은 CI에서 `build:vite` 산출물 생성까지만 확인하고 별도 Hosting 배포 경로를 두지 않는다.
- Production Firebase Auth 설정·계정 등록과 운영 DB·업무 활성화는 구분한다. 운영 DB 재개·역할 부여·실제 쓰기 활성화는 원 저장소 이슈 #134와 환경 문서의 게이트를 따르며, 문서 수정만으로 실행하지 않는다.
- Firestore Rules, Storage Rules, Functions는 원 저장소 `bodeul110/bodeul-platform`이 계속 소유한다.
- `ADMIN_DATABASE_URL`과 Firebase 서버 설정은 Next.js 서버에서만 읽고 브라우저 환경변수로 노출하지 않는다.
- 관리자 서버는 Spring Core API나 기존 Node API를 경유하지 않는다. 관리자 전용 DB role로 PostgreSQL을 조회하고, 쓰기는 허용된 배정·결제·감사 함수만 사용한다. 일반 테이블 직접 쓰기 권한을 추가하지 않는다.

## PR 본문

일반 PR은 `배경`, `변경 내용`, `확인`, 필요한 경우 `참고할 점`만 짧게 작성한다. 빈 항목이나 도구 이름을 넣지 않는다. 설계·보안·인프라 변경은 선택 방식, 대안, 현재 규모에 맞는 이유와 리스크를 자연스럽게 덧붙인다.

실행한 검증과 미실행 범위를 구분하고, 과거 검증 기록을 현재 배포·DB 검증 결과로 적지 않는다.
