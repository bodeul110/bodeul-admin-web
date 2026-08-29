# Next.js 관리자 서버 전환 기록

## 작업 목적

관리자 브라우저가 DB 자격 증명을 보유하거나 기존 Node API를 경유하지 않도록, 관리자 인증·인가와 PostgreSQL 접근을 Vercel Next.js 서버 경계로 옮긴다.

## 선택한 방식

- React 화면은 유지하고 Next.js App Router를 기본 실행·빌드 경로로 사용한다.
- 병원 가이드, 동행 배정, 매니저 심사, 역할 관리, 긴급 접근, 감사 조회를 Next.js server route로 운영한다.
- Firebase Admin SDK가 ID token의 서명, 발급자, audience, 만료를 검증한다.
- reCAPTCHA Enterprise App Check token을 `X-Firebase-AppCheck` 헤더로 받고 Firebase Admin SDK와 정확한 Web App ID로 검증한다.
- App Check는 `off`·`observe`·`enforce`를 분리하고 VALID 요청 확인 전에는 `observe`까지만 사용한다.
- PostgreSQL `app_users.firebase_uid`의 역할이 `ADMIN`이고 `admin_role_assignments`의 세부 역할이 활성 상태일 때만 요청을 허용한다.
- `SUPER_ADMIN`, `OPERATIONS`, `DEVELOPER` 권한을 서버에서 분리하고 세부 역할이 없으면 실패하도록 닫는다.
- 매니저 증빙 원본은 Firebase Admin SDK가 서버에서만 읽고, 확인 사유와 감사 기록을 남긴 뒤 브라우저에 inline 응답한다.
- 원문 확인 사유는 UTF-8 JSON 본문으로 전달하고, 성공·거부·실패 결과를 PostgreSQL 감사 기록에 구분한다. 감사 기록에 실패하면 원문 bytes를 반환하지 않는다.
- 브라우저 미리보기에는 관리자 UID 일부와 매니저 ID 워터마크를 표시하고, 대상 변경·모달 종료·화면 해제 시 Blob URL을 즉시 폐기한다. 서버는 PDF, JPEG, PNG, WebP만 인라인 허용하며 HTML, SVG와 그 밖의 MIME은 성공 감사 전에 거부하고 `415`와 `FAILED` 감사를 남긴다. 응답은 `nosniff`, 동일 출처 제한과 `sandbox; default-src 'none'` CSP를 사용한다.
- 원본 저장 경로와 Firebase Storage console URL은 브라우저에 노출하지 않는다.
- Vercel Functions는 Supabase transaction pooler 6543 포트와 `bodeul_admin_service`를 사용한다.
- Vercel Functions는 Supabase Tokyo와 같은 `hnd1` 단일 리전에서 실행한다.
- Supabase가 제공하는 공개 Root CA로 인증서와 호스트명을 검증하며 TLS 검증을 끄지 않는다.
- 쿼리는 이름 없는 parameterized query로 실행하고 pool 크기는 인스턴스당 1로 제한한다.
- 매니저 배정은 테이블 직접 쓰기 대신 예약 상태·version·역할을 검증하는 `assign_companion_session` 함수만 실행한다.
- 기존 Vite 빌드는 CI rollback 자산으로 유지하되 Firebase Hosting 배포 경로는 종료한다.

## 검토한 대안

| 대안 | 판단 |
| --- | --- |
| 브라우저에서 Supabase 직접 접근 | DB 접속 경계와 관리자 인가를 클라이언트에 맡기게 되어 제외 |
| Next.js가 기존 Node API를 호출 | 서버가 중복되고 종료 대상 Node 계약이 유지되어 제외 |
| Next.js가 Spring Core API를 호출 | 관리자·사용자 서버 경계가 다시 섞이므로 제외 |
| Vite를 한 번에 제거 | 전환 실패 시 관리자 운영 도구를 즉시 복구하기 어려워 제외 |

## 선택 이유

현재 MVP 규모에서는 개인정보가 거의 없는 병원 가이드 read model로 서버 경계, DB role, 배포 환경을 먼저 검증하는 것이 위험이 가장 낮다. UI 전면 재작성 없이 인증·인가·DB 연결만 실제 목표 구조로 옮길 수 있고, 문제가 생기면 검증된 Vite 산출물로 돌아갈 수 있다.

## 환경변수 경계

| 이름 | 위치 | 용도 |
| --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_*` | 브라우저 | Firebase Web SDK 설정과 App Check provider 공개 스위치·site key |
| `NEXT_PUBLIC_BODEUL_DATA_BACKEND` | 브라우저 | 기본 `api`, rollback은 `firebase` |
| `NEXT_PUBLIC_BODEUL_API_BASE_URL` | 브라우저 | 비우면 동일 출처, 과거 Node 비교 시에만 외부 URL |
| `FIREBASE_PROJECT_ID` | 서버 | Firebase ID token audience 검증 |
| `FIREBASE_STORAGE_BUCKET` | 서버 | 매니저 증빙 원본을 읽는 Storage bucket |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | 서버 | Firestore·Storage 중계 route 전용 자격 증명 |
| `ADMIN_DATABASE_URL` | 서버 | 관리자 조회 전용 PostgreSQL 연결 |
| `ADMIN_APP_CHECK_MODE` | 서버 | `off`, `observe`, `enforce` 전환 |
| `ADMIN_MFA_MODE` | 서버 | 관리자 다중 인증 관찰·강제 전환 |
| `ADMIN_MFA_ENFORCE_READY` | 서버 | 전 관리자 MFA 등록·복구 확인 뒤 강제 전환을 명시 승인 |
| `FIREBASE_APPCHECK_ALLOWED_APP_IDS` | 서버 | 현재 배포 환경이 신뢰하는 Firebase Web App ID |

Firebase ID token 검증 자체는 프로젝트 ID만으로 수행한다. Firestore·Storage 중계 route의 서비스 계정 JSON은 브라우저와 저장소에 노출하지 않고 Preview와 Production을 분리한다. 매니저 심사 route는 `users` 심사 상태와 `adminAuditOutbox`를 변경하므로 Firestore 읽기·쓰기 권한이 필요하고, 증빙 원본은 Storage 객체 조회 권한만 사용한다. Admin SDK는 Rules를 우회하므로 서비스 계정에는 이 동작에 필요한 최소 IAM 권한만 부여하고 정기 회전하며, 장기 운영에서는 Vercel OIDC 기반 WIF로 교체한다.

## 관리자 역할과 서버 route

| 역할 | 허용 범위 |
| --- | --- |
| `SUPER_ADMIN` | 역할 변경·회수, 긴급 접근 승인·회수, 운영·심사, 감사 조회 |
| `OPERATIONS` | 운영 조회·처리, 매니저 심사, 사유가 기록되는 원문 미리보기 |
| `DEVELOPER` | 개인정보가 없는 진단 정보만 허용하며 운영·심사·원문 접근은 거부 |

| Route | 최소 권한 | 감사 |
| --- | --- | --- |
| `GET /admin/access-context` | 활성 세부 역할 | 현재 역할과 권한만 반환 |
| `GET /admin/hospital-guides` | `SUPER_ADMIN`, `OPERATIONS` | 운영 데이터 조회, `DEVELOPER`는 거부 |
| `GET/POST /admin/manager-reviews` | `SUPER_ADMIN`, `OPERATIONS` | 심사 변경 기록과 미전달 감사 outbox 최대 10건 재처리 |
| `POST /admin/manager-reviews/{id}/documents/{key}` | `SUPER_ADMIN`, `OPERATIONS` | UTF-8 JSON 본문에 10자 이상 확인 사유를 담고 원문 열람 기록 |
| `GET/PUT/DELETE /admin/role-assignments` | `SUPER_ADMIN` | 역할 변경·회수 기록 |
| `POST/DELETE /admin/break-glass` | `SUPER_ADMIN` | 2인 승인과 최대 60분 유효기간 기록 |
| `GET /admin/audits` | `SUPER_ADMIN` | 최근 관리자 접근 기록 조회 |

브라우저의 `ADMIN` 역할만으로 Firestore와 Storage에 직접 접근하는 경로는 허용하지 않는다. 관리자 기능은 세부 역할을 확인하는 Next.js 서버를 거쳐야 한다.
역할 변경, 긴급 접근과 매니저 심사는 성공뿐 아니라 인증된 관리자의 권한 거부, 입력 거부와 저장 실패도 `DENIED` 또는 `FAILED`로 기록한다. 실패 감사에는 원문 입력이나 비밀값을 복제하지 않고 공개 오류 코드만 남기며, 감사 기록 자체가 실패하면 원 요청을 성공 처리하지 않는다.

## DB 권한

- login role: `bodeul_admin_service`
- group role: `bodeul_admin_runtime`
- connection limit: 5
- 애플리케이션 pool max: 1
- `bodeul.app_users`, `bodeul.hospital_guides`, `bodeul.appointment_requests`: `SELECT`
- `bodeul.search_appointment_by_public_code(uuid, text)`: `EXECUTE`. 내부에서 관리자 역할 확인, 분당 10회 제한, 해시 감사 기록과 정확 일치 조회를 함께 처리한다.
- 세션·리포트·후속 처리·배정 감사 테이블: `SELECT`
- `bodeul.assign_companion_session`: `EXECUTE`
- 테이블 `INSERT`, `UPDATE`, `DELETE`: 허용하지 않음

2026-07-18 개발 DB에서 함수가 `security definer`, `search_path=bodeul, pg_temp`로 고정된 것을 다시 확인했다. `bodeul_admin_runtime`만 실행할 수 있고 `bodeul_core_runtime`, `anon`, `authenticated`, `service_role`, `PUBLIC`은 실행할 수 없다. Supabase Security Advisor 경고도 0건이다.

DB password는 migration이나 문서에 넣지 않는다. 개발 DB role의 `LOGIN` 활성화와 비밀번호 회전은 Vercel Preview Sensitive 환경변수 반영과 같은 작업 단위로 수행한다. 2026-07-17 기준으로 Preview 전용 자격 증명을 등록했다. 별도 Supabase production 프로젝트에는 관리자 role을 생성했지만 Vercel 연결 전까지 `NOLOGIN`을 유지하며, Production에는 `ADMIN_DATABASE_URL`을 등록하지 않았다.

원격 PostgreSQL 연결은 [Supabase SSL configuration](https://supabase.com/docs/guides/platform/ssl-enforcement)에서 제공하는 `Supabase Root 2021 CA`를 사용한다. `rejectUnauthorized: false`나 인증서 검증 없는 연결은 허용하지 않는다.

## 검증 순서

```powershell
npm ci
npm run test
npm run lint
npm run build
npm run build:vite
```

Preview 배포 후:

1. Firebase ID token 없이 `/admin/hospital-guides` 호출: `401`
2. `observe`에서 App Check token 누락·위조·다른 Web App ID가 판정되지만 기존 인증 흐름은 유지되는지 확인
3. 유효한 일반 사용자 Firebase ID token: `403`
4. PostgreSQL `ADMIN` 역할과 정상 App Check token: `200`, `valid` 판정
5. `enforce` 후보에서 App Check token 누락·위조는 `401`, 다른 Web App ID는 `403`
6. 응답 `items`와 `limit`, 병원·진료과·단계 수 확인
7. 브라우저 bundle과 Vercel build log에 DB URL이나 token 원문이 노출되지 않았는지 확인

매니저 배정 API는 다음을 추가로 확인한다.

1. token 없음과 일반 사용자 token: 각각 `401`, `403`
2. 잘못된 UUID와 version: `400`
3. 존재하지 않는 예약: `404`
4. 예약 상태 또는 version 충돌: `409`, DB 변경 없음
5. `REQUESTED` 예약 성공: `201`, 예약 `MATCHED`, 세션 `READY`, 감사 이력 1건

관리자 역할·매니저 심사 API는 다음을 추가로 확인한다.

1. 세부 역할이 없는 `ADMIN`: 모든 관리자 route `403`
2. `DEVELOPER`: 매니저 목록·심사·원문과 역할 관리 `403`
3. `OPERATIONS`: 마스킹 목록과 심사 가능, 역할 관리 `403`
4. `DEVELOPER`: 병원 가이드 API와 메뉴도 거부·비표시
5. 원문 미리보기: 10자 미만 사유 `400`, 정상 요청은 inline 응답과 감사 1건, 감사 실패 시 원문 미반환
6. 마지막 `SUPER_ADMIN` 회수와 자기 자신에 대한 긴급 승인: DB에서 거부
7. SMS 또는 TOTP가 등록된 관리자 계정: 이메일·비밀번호 뒤 2차 인증 UI를 완료하면 로그인 성공
8. `ADMIN_MFA_MODE=enforce`: `ADMIN_MFA_ENFORCE_READY=true`가 없으면 서버 설정 오류로 fail-closed, MFA claim 없는 ID token은 `401`

### 2026-07-17 Preview 검증 결과

- Preview deployment: `bodeul-admin-heyiu9xmh-wlsrjsals110.vercel.app`
- token 없음: `401 missing_authorization`
- PostgreSQL `PATIENT` 역할 token: `403 admin_role_required`
- PostgreSQL `ADMIN` 역할 token: `200`, 병원 가이드 1건과 `limit=50` 확인
- Supabase transaction pooler 연결: 공개 Root CA와 `rejectUnauthorized=true` 조합으로 성공
- 검증용 Firebase 사용자 2명과 `app_users` 임시 역할 행은 검증 직후 삭제
- `bodeul_admin_service`는 `SELECT` 전용 권한과 connection limit 5를 유지

### 2026-07-18 매니저 배정 API Preview 검증 결과

- Preview deployment: `bodeul-admin-web-git-codex-admin-companion-905d09-wlsrjsals110.vercel.app`
- Vercel Deployment Protection은 인증된 CLI로 통과하고 애플리케이션 응답을 별도로 확인했다.
- token 없음 `401`, PostgreSQL `PATIENT` 역할 `403`, `ADMIN`의 잘못된 입력 `400` 확인
- 이미 취소된 예약의 배정 요청은 `409 appointment_state_conflict`, DB 변경 없음
- 임시 `REQUESTED` 예약의 배정 요청은 `201`, 예약 `MATCHED`·version 1, 세션 `READY`, 감사 이력 1건 확인
- 임시 예약·세션·감사 이력은 검증 직후 역순 삭제했고 잔여 0건을 확인했다.
- Firebase ID token은 메모리와 표준입력에서만 처리하고 파일, PR, 명령 출력에 남기지 않았다.

## 예약 공개 코드 검색

- 경로: `POST /admin/appointments/public-code`, JSON 본문 `{ "publicCode": "BD-ABC123" }`
- 코드를 URL 쿼리에 넣지 않아 호스팅 접근 로그에 평문이 남는 범위를 줄인다.
- Firebase ID token, App Check와 PostgreSQL `ADMIN` 역할을 모두 확인한다.
- `BD-` + 영문 대문자·숫자 6자리의 정확 검색만 허용하며 부분 검색은 제공하지 않는다.
- 관리자별 최근 1분의 정상 검색을 10회로 제한하고 초과 시 `429 public_code_rate_limited`를 반환한다.
- DB 감사 기록에는 공개 코드 평문 대신 SHA-256 해시와 조회 결과만 저장한다.
- 검색 결과에 내부 예약 UUID를 함께 표시하지만 후속 변경·인가에는 계속 내부 UUID와 별도 권한 확인을 사용한다.

## Rollback

1. 서버 검증 오류가 있으면 `ADMIN_APP_CHECK_MODE=observe`로 내려 차단만 해제한다.
2. 서버 검증을 긴급 우회할 때만 `ADMIN_APP_CHECK_MODE=off`로 내린다.
3. reCAPTCHA Enterprise provider 또는 외부 스크립트가 문제면 `NEXT_PUBLIC_FIREBASE_APPCHECK_ENABLED=false`로 바꾸고 재배포해 브라우저 초기화 자체를 중단한다.
4. Vercel Preview 승격을 중단한다.
5. `npm run build:vite`로 rollback 산출물 생성이 가능한지 확인한다.
6. 브라우저 데이터 모드는 `VITE_BODEUL_DATA_BACKEND=firebase`를 사용한다.
7. 필요하면 `bodeul_admin_service`를 `NOLOGIN`으로 돌리고 Vercel `ADMIN_DATABASE_URL`을 제거한다.

## 리스크와 후속 작업

- 매니저 심사와 원문 미리보기의 서버 경유 코드는 구현됐지만 Preview 실제 계정·증빙으로 E2E 검증하기 전에는 Production에 승격하지 않는다.
- Firestore·Storage Rules는 브라우저 `ADMIN` 접근을 닫는다. 이 Rules 배포와 관리자 웹 서버 환경변수 반영은 같은 출시 창에서 수행해 기능 공백을 피한다. Android의 기존 관리자 화면도 Firebase 직접 접근을 사용하므로, 해당 경로를 폐기하거나 서버 API로 이전했다는 증거 없이는 Rules를 운영에 배포하지 않는다.
- 관리자 MFA는 `observe`로 시작하고 모든 운영 관리자 등록과 재로그인 증거를 확인한 뒤 `enforce`로 전환한다.
- 심사 변경은 Firestore 변경과 같은 트랜잭션에 `adminAuditOutbox` PENDING 항목을 만든다. PostgreSQL 감사 성공 뒤 DELIVERED로 전환하며, 같은 작업 UUID 재시도와 심사 목록 조회 시 최대 10건을 재처리한다. 항목별 오류는 격리해 다른 감사와 심사 목록 조회를 막지 않으며, 실패 항목은 PENDING으로 남겨 다시 시도한다. 감사 함수의 8번째 `operation_id`와 partial unique index가 같은 작업의 중복 insert를 막는다. PENDING에는 재처리에 필요한 필드, 당시 관리자 역할과 결정적 `payloadHash`를 둬 역할 회수 뒤에도 원래 권한 맥락으로 감사할 수 있게 한다. 재처리할 때 원문으로 계산한 hash가 저장된 값과 다르면 해당 항목을 격리한다. DELIVERED 전환 때 사유·대상·actor·역할 등 원문 필드는 지운다. 이후 문서는 작업 UUID·payload hash·감사 ID·시각만 남기는 tombstone으로 사용하며 관리자 감사와 같은 1년 뒤 `expiresAt`을 기록한다. 따라서 같은 UUID의 다른 심사 내용은 Firestore 변경 전에 거부되고, 심사 원문은 장기간 중복 보관되지 않는다. 목록 조회 시 만료 tombstone을 최대 50건 정리하고, 장기간 관리자 접속이 없는 환경도 정리되도록 운영 전 Firestore TTL 정책을 같은 필드에 연결한다.
- production DB에는 Flyway V15까지 적용됐지만 관리자 DB login과 Vercel `ADMIN_DATABASE_URL`은 아직 비활성이다. 운영 role 활성화와 성공·충돌 smoke 전에는 배정 route를 공개하지 않는다.
- token revocation 즉시 확인은 현재 범위가 아니다. 관리자 세션 만료와 위험 수준을 확인한 뒤 WIF 기반 자격 증명을 검토한다.
- App Check 클라이언트·custom backend 검증 코드는 반영했으며, 환경별 provider와 VALID 메트릭 검증은 [Issue #16](https://github.com/bodeul110/bodeul-admin-web/issues/16)에서 계속 추적한다.
- production Google Cloud/Firebase와 Supabase 기반은 생성했다. Vercel Production DB 자격 증명, 도메인, App Check와 관리자 운영 검증은 메인 저장소 #134의 출시 게이트로 유지한다.
- 공용 production 리소스와 DB migration의 실제 검증 결과는 메인 저장소의 [Production 인프라 구축 기록](https://github.com/bodeul110/Bodeul/blob/master/docs/reports/production-infrastructure-bootstrap-2026-07-17.md)을 따른다.
