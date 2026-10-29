# 개발 심사 목록 전용 OIDC reader

관련: [이슈 #79](https://github.com/bodeul110/bodeul-admin-web/issues/79), [PR #85](https://github.com/bodeul110/bodeul-admin-web/pull/85). 2026-10-29 기준.

## 선택과 범위

- 작업 목적: Vercel Preview의 기본 자격 증명 누락으로 실패하는 매니저 심사 목록을 개발 환경에서 복구한다.
- 선택한 방식: 공식 `@vercel/oidc`와 `google-auth-library`로 요청의 OIDC 토큰을 Google STS에서 교환하고, 전용 서비스 계정의 10분 토큰으로 Firestore를 읽는다. 요청마다 별도 client를 만들고 사용 후 종료한다.
- 대안: 기존 JSON reader 초안의 장기 키 생성·Vercel 보관은 폐기한다. 공용 계정에 광범위한 권한을 주거나 운영 자격 증명을 복사하지 않는다.
- 선택 이유: 현재 MVP의 목록 복구에는 개발 데이터 읽기만 필요하다. 장기 키를 새로 보관하지 않고 조회와 승인·원본 열람 경계를 분리할 수 있다.
- 리스크: IAM은 컬렉션이 아니라 DB 단위다. Vercel의 서명된 신원에는 Git 브랜치가 없어 IAM 신뢰는 프로젝트의 Preview 전체에 적용된다. `dev` 제한은 별도 배포 설정·런타임 검사이지 암호학적인 브랜치 보장이 아니다.

## 대상 설정

| 항목 | 값 |
| --- | --- |
| Google Cloud 프로젝트 | `bodeul-dev` / `533563500316` |
| 전용 서비스 계정 | `admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com` |
| custom role | `projects/bodeul-dev/roles/adminManagerListReader` |
| 읽기 권한 | `datastore.entities.get`, `datastore.entities.list`만 |
| DB 조건 | `resource.name == "projects/bodeul-dev/databases/(default)"` |
| 조건 제목 | `OnlyBodeulDevDefaultDatabase` |
| WIF pool / provider | `vercel-admin-preview` / `vercel` |
| Vercel 팀 | `bodeul110` / `team_0MogsXXfpLLKhV4AZoE3Aa20` |
| Vercel 프로젝트 | `bodeul-admin-web` / `prj_qV8aWaut3kcqf1e1gW2aThN3g6AK` |
| provider 신뢰 조건 | 서명된 `owner_id`, `project_id`, `environment=preview`를 모두 비교 |
| Vercel audience | `https://vercel.com/bodeul110` |
| 적용 환경변수 | Preview의 `dev`에만 `MANAGER_LIST_AUTH_MODE=vercel-oidc` |
| 기존 프로젝트 설정 | `FIREBASE_PROJECT_ID=bodeul-dev` 유지 |

위 서비스 계정은 **개발 기본 DB 전체 문서를 읽을 수 있다**. `role == MANAGER` 필터와 마스킹은 응답 처리이며 IAM 제한이 아니다. 서버 SDK는 Firestore Security Rules를 우회한다. 쓰기·삭제·Auth·Storage·다른 프로젝트 권한은 추가하지 않는다. 기존 GitHub WIF pool은 재사용하지 않는다.

OIDC issuer는 실제 Vercel 설정에서 팀 모드 `https://oidc.vercel.com/bodeul110`인 것을 확인했다. Production을 포함하는 프로젝트 공통 OIDC 설정은 변경하지 않았다. 전용 계정에는 새 pool의 지정 프로젝트 신원에 대한 `roles/iam.workloadIdentityUser`만 부여했다. 서비스 계정 키와 `roles/iam.serviceAccountTokenCreator`는 만들지 않았다.

## 요청 경계

1. 기존 Firebase ID token, MFA, App Check와 PostgreSQL 관리자 역할 검사를 먼저 수행한다.
2. 전용 모드에서는 `VERCEL=1`, Preview, `dev` 브랜치, 개발 Firebase project를 확인한다. 다른 환경이나 알 수 없는 모드, 폐기한 `json-reader`는 거부한다.
3. 현재 요청의 OIDC 토큰을 공급한다. Google supplier context의 audience는 Vercel SDK에 전달하지 않는다. assertion과 access token은 로그·파일·브라우저에 남기지 않는다.
4. 공식 Google SDK로 STS 교환과 지정 서비스 계정 impersonation을 수행한 뒤 기본 DB의 매니저 목록을 조회한다. 실패 시 ADC나 공용 JSON credential로 재시도하지 않는다.
5. 기존 마스킹·정렬과 PostgreSQL VIEW/FAILED/DENIED 감사를 유지한다. 감사 실패 시 목록을 반환하지 않는다.

전용 GET은 `reconcilePendingManagerReviewAudits`를 실행하지 않는다. outbox의 조회·재처리·전달 표시·정리를 보류하며 기존 큐 항목을 변경하지 않는다. 별도 자동 재처리 호출자는 현재 저장소에서 확인되지 않아, 이 모드에서는 목록 GET을 통한 PENDING 감사 복구와 만료 tombstone 정리가 진행되지 않는다. 별도 처리자나 추가 쓰기 권한은 이번 복구 범위에 없다. 실제 backlog는 조사하지 않았다.

심사 POST, 원문/파생본·Storage 경로와 기존 공용 Firebase App은 그대로다. 읽기 계정으로 심사 승인, 반려, 원본 다운로드가 가능해지는 것은 아니다. PostgreSQL의 기존 조회 감사 쓰기는 유지하며, 업무 데이터나 계정 권한 변경은 하지 않는다.

## 적용과 확인

2026-10-29 사용자에게 개발 Preview 읽기 연결, DB 단위 권한 범위, Preview 전체 신뢰 범위와 공식 SDK 추가를 승인받았다. 개발 프로젝트에 한해 최대 1시간의 임시 설정 권한도 별도 승인받았다. 읽기 role, DB 조건 바인딩, 별도 WIF pool/provider와 지정 신원의 계정 연결을 만들었다. 설정 후 임시 권한을 즉시 회수하고 정책에서 제거된 것을 확인했다. 사용자 관리 키는 0개다. Vercel에는 Preview/dev 전용 모드만 등록했다. **실제 배포와 목록 복구는 아직 확인 전**이며 아래 로컬 검증과 구분한다.

- 로컬 검증: 단위 테스트 186건, lint, Next.js build, Vite rollback build를 통과했다. 허용 환경·고정 교환 대상·토큰 supplier·다른 credential 우회 금지, 인증 전 reader 미실행, outbox 미호출, 감사 실패 차단과 공식 SDK client 구성을 검사했다. 빌드된 서버의 무인증·잘못된 인증·가짜 token 요청 18건도 모두 401로 차단됐다.
- 배포 전: 기존 동명 pool/role과 계정의 추가 권한을 확인한다. 대상·권한이 다르면 덮어쓰지 않는다.
- 개발 반영 후: 실제 Preview 관리자 로그인과 목록 조회, 예약 조회 회귀를 확인한다. 인증 없는 요청과 허용되지 않은 역할은 계속 차단돼야 한다.
- IAM 검증: 최종 role의 두 읽기 권한, 단일 DB 조건 바인딩과 WIF의 팀·프로젝트·Preview 신뢰 조건을 대조했다. 설정 권한 확인에는 testIamPermissions를 사용했으나 reader 신원으로 실제 데이터 쓰기를 시험한 것은 아니다. 차단 확인을 이유로 실제 업무 문서를 생성·수정·삭제하지 않는다.
- 임시 권한을 별도 승인받으면 최대 유효시간을 설정하고 완료·실패 시 즉시 제거한 뒤 회수 여부를 확인한다.
- 실기기는 사용자 요청에 따라 이번 검증에서 제외한다.

## 중단과 회수

문제가 생기면 Preview/dev의 전용 모드 설정을 제거하고 승인된 이전 배포로 되돌린다. 기존 ADC 누락 상태로 돌아가면 목록은 다시 오류가 될 수 있으며 이를 정상 복구로 표시하지 않는다. 신규 pool 신뢰 또는 전용 계정의 바인딩을 회수하면 새 단기 토큰 발급·읽기를 차단할 수 있다. 이미 발급된 토큰의 만료와 IAM 전파 지연도 고려한다. Production과 기존 GitHub 인증 연결은 변경하지 않는다.

근거: [Vercel Google Cloud OIDC](https://vercel.com/docs/oidc/gcp), [Vercel OIDC token·SDK](https://vercel.com/docs/oidc/reference), [Firestore IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam), [DB별 IAM 조건](https://docs.cloud.google.com/firestore/native/docs/manage-databases).
