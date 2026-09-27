# 관리자 웹 개발·운영 분리

| 구분 | 개발 | 운영 |
| --- | --- | --- |
| 브랜치 | `dev` | `master` |
| Vercel 환경 | Preview | Production |
| Firebase 프로젝트 | `bodeul-dev` | `bodeul-prod-110` |
| PostgreSQL 프로젝트 | `bodeul-db-dev` | `bodeul-db-prod` |
| DB 사용자 | 개발 DB의 관리자 전용 role | 운영 DB의 별도 관리자 전용 role |

브라우저는 관리자 Next.js 서버만 호출한다. 서버는 해당 환경의 PostgreSQL을 직접 조회하며 Spring Core API를 중간 proxy로 사용하지 않는다. 같은 환경의 사용자·매니저 서비스와 DB는 공유하지만 DB 비밀번호와 권한은 분리한다.

## 작업 흐름

1. `dev`에서 기능 브랜치를 만들고 `dev`로 PR을 연다.
2. lint·서버 테스트·Next.js 빌드·Vite rollback 빌드·CodeQL·Vercel 검사를 통과하면 squash merge한다.
3. 개발 환경에서 검증한 묶음을 `dev → master` PR로 올리고 merge commit으로 반영한다.
4. 운영의 환경변수로 새로 빌드한다. Preview 산출물을 운영에 그대로 승격하지 않는다.
5. 운영 긴급 수정은 `master → dev` PR을 merge commit으로 반영해 양쪽 이력을 맞춘다.

기본 브랜치는 `master`를 유지한다. 기존 팀원 PR은 자동으로 base를 바꾸지 않는다. 서버용 환경변수는 브라우저에 노출하지 않으며, Preview·Production에 같은 `ADMIN_DATABASE_URL`을 넣지 않는다. 운영 배포 성공은 실제 DB 연결과 업무 권한 검증까지 성공했다는 의미가 아니다.

`ADMIN_DATABASE_URL`에는 query나 fragment를 넣지 않는다. `pg`는 URL 옵션으로 호스트·계정·TLS 설정을 덮어쓸 수 있으므로, 연결 대상은 URL 본문에만 적고 TLS는 서버의 인증서 검증 설정을 사용한다.

## 선택 근거

Vercel 빌드와 서버 연결 시 Firebase 프로젝트·앱 ID·Storage 및 PostgreSQL 프로젝트·Tokyo 리전·`bodeul_admin_service` role을 검사한다. 다른 환경의 값이나 누락된 DB 설정은 배포 실패로 처리한다. 로컬·CI placeholder는 실제 배포와 구분하며 Vercel 검사를 끄는 예외 변수는 제공하지 않는다.

- 작업 목적: 개발 코드·데이터가 운영 환경에 섞이는 실수를 막는다.
- 선택한 방식: 기존 Vercel 프로젝트와 개발·운영 DB를 유지하고 Git 브랜치와 환경변수를 분리한다.
- 대안: 별도 staging 프로젝트 추가 또는 `master` 하나에서 수동 환경 전환을 검토했다.
- 선택 이유: 현재 MVP 규모에서 새 서버·DB 비용 없이 명확한 개발 검증 경계를 만들 수 있다.
- 리스크: 브랜치 간 동기화를 놓치면 이력이 갈라지고, 빌드 시 주입된 Firebase 설정이 잘못되면 다른 환경으로 접속할 수 있으므로 대상 환경으로 다시 빌드해야 한다.

[공통 전환 기준](https://github.com/bodeul110/bodeul-platform/blob/master/docs/operations/dev-production-branch-transition-plan.md)과 [실제 실행 결과](https://github.com/bodeul110/bodeul-platform/blob/master/docs/reports/dev-production-separation-2026-09-27.md)를 함께 확인한다.
