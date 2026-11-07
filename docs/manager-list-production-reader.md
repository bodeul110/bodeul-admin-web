# 운영 심사 목록 읽기 인증

## 판단과 범위

- 작업 목적: 운영 관리자 심사 목록의 Google 기본 인증 정보 누락 오류를 복구한다.
- 선택한 방식: 개발에서 검증한 전용 OIDC reader를 필요한 파일만 운영에 반영하고, 운영 전용 WIF와 서비스 계정을 별도로 사용한다.
- 대안: 장기 서비스 계정 키 저장, 개발 계정 재사용, 개발 브랜치 전체 운영 반영은 사용하지 않는다.
- 선택 이유: 현재 MVP의 목록 조회에 필요한 읽기 권한만 부여하고 기존 운영 기능·의존성 변경 범위를 제한할 수 있다.
- 리스크: Firestore IAM은 컬렉션 단위가 아니라 DB 단위다. 전용 계정은 기본 DB 전체 문서를 읽을 수 있다. 응답의 매니저 필터·마스킹은 IAM 제한이 아니다.

## 고정 경계

| 항목 | 운영 값 |
| --- | --- |
| 배포 | 이 관리자 프로젝트의 Vercel Production, `master` |
| 프로젝트 | `bodeul-prod-110` |
| 서비스 계정 | `admin-manager-list-prod@bodeul-prod-110.iam.gserviceaccount.com` |
| WIF | `vercel-admin-production` pool의 `vercel` provider |
| 허용 신원 | 서명된 Vercel 팀 ID, 프로젝트 ID, `environment=production` 모두 일치 |
| Firestore 권한 | 기본 DB 조건의 `datastore.entities.get`, `datastore.entities.list` |
| 환경변수 | Production에만 `MANAGER_LIST_AUTH_MODE=vercel-oidc` |
| token | 요청마다 발급, 대행 token 수명 600초 |

브랜치는 애플리케이션의 런타임 검사이며 서명된 OIDC 브랜치 보장이 아니다. IAM은 지정된 팀·프로젝트의 Production 신원만 신뢰한다. Preview와 Development는 이 운영 계정으로 교환할 수 없다.

Firebase ID token, 기존 MFA/App Check 모드, PostgreSQL 관리자 역할 검사를 먼저 수행한다. 전용 GET은 기존 매니저 필터·마스킹과 PostgreSQL 조회 감사를 유지한다. 인증이나 감사 실패를 성공한 빈 목록으로 바꾸지 않으며 ADC나 다른 계정으로 재시도하지 않는다.

읽기 전용 GET에서는 Firestore outbox 재처리·삭제를 호출하지 않는다. 따라서 기존 PENDING 감사 복구는 이 GET으로 수행하지 않는다. 심사 승인·반려 POST, 원본/파생본 다운로드, Auth 및 Storage 권한은 이번 연결 범위가 아니다. 목록 조회 성공을 이 기능들의 운영 검증 완료로 해석하지 않는다.

## 적용 절차

1. 공식 관리자와 공용 Vercel 프로젝트 접근, 현재 운영 배포 SHA를 확인한다.
2. 대상 전용 자원의 기존 상태를 보존하고, 동명 자원이 예상과 다르면 덮어쓰지 않는다.
3. 별도 승인받은 설정 권한은 운영 프로젝트에 최대 1시간만 부여하고, 성공·실패와 관계없이 즉시 회수한다.
4. 읽기 역할·DB 조건·WIF·전용 계정 연결을 검증한다. 서비스 계정 키와 Token Creator 역할을 만들지 않는다.
5. PR과 필수 CI를 통과한 운영 hotfix만 적용한다. 개발 기능 전체를 같이 출시하지 않는다.
6. Production 모드 설정 후 운영 환경으로 재빌드한다. 로그인/MFA 후 실제 심사 목록 HTTP 200, 감사 처리, 개발 회귀와 설정 권한 회수를 확인한다.

## 중단과 복구

배포 문제가 생기면 확인해 둔 이전 운영 배포로 복귀하고, 이번 Production 모드 설정을 제거한다. 이전 배포는 인증 누락 오류를 가진 상태이므로 기능 정상 복구라고 적지 않는다. 신규 WIF 신뢰나 reader 바인딩을 회수하면 새 token 발급 또는 읽기를 차단할 수 있다. 이미 발급된 token의 만료와 IAM 전파 지연도 고려한다.

## 적용 전 검증 (2026-11-07)

- 단위 테스트 185건, lint, Next.js build, Vite rollback build를 통과했다. 기존 Firebase 청크 크기 경고는 남아 있다.
- 빌드된 서버에서 access-context·심사 목록 GET/POST·병원 가이드·결제 GET/PATCH에 대한 무인증·잘못된 인증 형식·가짜 token 요청 18건이 모두 차단됐다.
- 운영 전용 custom role은 get/list 2개뿐이며 기본 DB 조건이 적용됐다. WIF는 지정 팀·프로젝트의 Production만 허용하고, 전용 서비스 계정의 사용자 관리 키는 0개다.
- 첫 시도의 WIF 생성 요청이 권한 오류로 거부되어 임시 권한을 회수했다. 재시도는 실제 권한 적용 확인 후 완료했으며, 작업 후 임시 역할 3개가 제거된 것을 정책 재조회로 확인했다.
- 이 단계에서는 실제 운영 배포와 로그인 후 목록 조회를 아직 검증하지 않았다. 배포 후 결과는 별도 실행 기록으로 남긴다.

개인 계정·IAM 원본·배포 복구 정보는 공개 문서가 아닌 로컬 운영 기록에 보존한다.

근거: [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp), [Firestore 서버 IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam).
