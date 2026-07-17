# Next.js 관리자 서버 전환 기록

## 작업 목적

관리자 브라우저가 DB 자격 증명을 보유하거나 기존 Node API를 경유하지 않도록, 관리자 인증·인가와 PostgreSQL 접근을 Vercel Next.js 서버 경계로 옮긴다.

## 선택한 방식

- React 화면은 유지하고 Next.js App Router를 기본 실행·빌드 경로로 사용한다.
- `GET /admin/hospital-guides`를 첫 server route로 이전한다.
- Firebase Admin SDK가 ID token의 서명, 발급자, audience, 만료를 검증한다.
- PostgreSQL `app_users.firebase_uid`의 역할이 `ADMIN`일 때만 요청을 허용한다.
- Vercel Functions는 Supabase transaction pooler 6543 포트와 `bodeul_admin_service`를 사용한다.
- Vercel Functions는 Supabase Tokyo와 같은 `hnd1` 단일 리전에서 실행한다.
- Supabase가 제공하는 공개 Root CA로 인증서와 호스트명을 검증하며 TLS 검증을 끄지 않는다.
- 쿼리는 이름 없는 parameterized query로 실행하고 pool 크기는 인스턴스당 1로 제한한다.
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
| `NEXT_PUBLIC_FIREBASE_*` | 브라우저 | Firebase Web SDK 설정 |
| `NEXT_PUBLIC_BODEUL_DATA_BACKEND` | 브라우저 | 기본 `api`, rollback은 `firebase` |
| `NEXT_PUBLIC_BODEUL_API_BASE_URL` | 브라우저 | 비우면 동일 출처, 과거 Node 비교 시에만 외부 URL |
| `FIREBASE_PROJECT_ID` | 서버 | Firebase ID token audience 검증 |
| `ADMIN_DATABASE_URL` | 서버 | 관리자 조회 전용 PostgreSQL 연결 |

Firebase ID token 검증은 privileged Firebase Admin API를 호출하지 않으므로 현재 단계에서는 프로젝트 ID만 사용한다. 계정 강제 로그아웃을 즉시 반영하는 revocation check가 필요해지면 Vercel OIDC 기반 Google Cloud WIF 또는 전용 서비스 계정 자격 증명을 별도 설계한다.

## DB 권한

- login role: `bodeul_admin_service`
- group role: `bodeul_admin_runtime`
- connection limit: 5
- 애플리케이션 pool max: 1
- `bodeul.app_users`: `SELECT`
- `bodeul.hospital_guides`: `SELECT`
- `INSERT`, `UPDATE`, `DELETE`: 허용하지 않음

DB password는 migration이나 문서에 넣지 않는다. 개발 DB role의 `LOGIN` 활성화와 비밀번호 회전은 Vercel Preview Sensitive 환경변수 반영과 같은 작업 단위로 수행한다. 2026-07-17 기준으로 Preview 전용 자격 증명을 등록했으며 Production에는 `ADMIN_DATABASE_URL`을 등록하지 않았다.

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

1. token 없이 `/admin/hospital-guides` 호출: `401`
2. 유효한 일반 사용자 token: `403`
3. PostgreSQL `ADMIN` 역할 사용자 token: `200`
4. 응답 `items`와 `limit`, 병원·진료과·단계 수 확인
5. 브라우저 bundle과 Vercel build log에 DB URL이 노출되지 않았는지 확인

### 2026-07-17 Preview 검증 결과

- Preview deployment: `bodeul-admin-heyiu9xmh-wlsrjsals110.vercel.app`
- token 없음: `401 missing_authorization`
- PostgreSQL `PATIENT` 역할 token: `403 admin_role_required`
- PostgreSQL `ADMIN` 역할 token: `200`, 병원 가이드 1건과 `limit=50` 확인
- Supabase transaction pooler 연결: 공개 Root CA와 `rejectUnauthorized=true` 조합으로 성공
- 검증용 Firebase 사용자 2명과 `app_users` 임시 역할 행은 검증 직후 삭제
- `bodeul_admin_service`는 `SELECT` 전용 권한과 connection limit 5를 유지

## Rollback

1. Vercel Preview 승격을 중단한다.
2. `npm run build:vite`로 rollback 산출물 생성이 가능한지 확인한다.
3. 브라우저 데이터 모드는 `VITE_BODEUL_DATA_BACKEND=firebase`를 사용한다.
4. 필요하면 `bodeul_admin_service`를 `NOLOGIN`으로 돌리고 Vercel `ADMIN_DATABASE_URL`을 제거한다.

## 리스크와 후속 작업

- Vite 화면의 매니저 심사 기능은 아직 Firestore·Storage에 직접 접근한다. 도메인별 PostgreSQL 계약이 준비될 때 순차 이전한다.
- token revocation 즉시 확인은 현재 범위가 아니다. 관리자 세션 만료와 위험 수준을 확인한 뒤 WIF 기반 자격 증명을 검토한다.
- App Check reCAPTCHA Enterprise와 custom backend 검증은 [Issue #16](https://github.com/bodeul110/bodeul-admin-web/issues/16)에서 진행한다.
- production 환경, 도메인, 별도 DB 자격 증명은 메인 저장소 #134에서 확정한다.
