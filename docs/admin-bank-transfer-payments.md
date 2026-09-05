# 관리자 무통장입금 처리

## 목적과 선택 근거

예약 공개 코드로 찾은 예약의 입금자명·금액을 대조하고 입금 확인, 검토 필요, 환불 요청·완료를 기록한다. 실제 이체나 환불을 실행하는 기능은 아니다.

현재 MVP에서는 기존 Next.js 관리자 서버와 PostgreSQL V22 상태 변경 함수를 유지한다. 관리자 상세 조회만 V23 함수로 추가하며, Spring Core API 경유나 브라우저의 DB 직접 연결은 사용하지 않는다. 원장 테이블에 관리자 서비스의 직접 수정 권한을 추가하는 대안은 버전 검사·감사·상태 전이 규칙을 우회할 수 있어 제외했다. 상세 전체를 무제한 조회하는 대신 최근 이력 20건과 추가 이력 존재 여부만 반환한다.

## 변경 범위

| 구분 | 내용 |
| --- | --- |
| 화면 | 예약 코드 검색 결과 아래 결제 상세, 처리 사유·금액 입력, 확인 대화상자, 이력 표 |
| 조회 | `GET /admin/appointments/{appointmentRequestId}/payment` |
| 변경 | `PATCH /admin/appointments/{appointmentRequestId}/payment` |
| 인증·인가 | 기존 Firebase ID token·MFA·App Check 정책과 활성 `SUPER_ADMIN`/`OPERATIONS` 역할 확인 |
| DB 계약 | [메인 PR #406](https://github.com/bodeul110/Bodeul/pull/406)의 V23 조회 함수와 기존 V22 상태 변경 함수 |
| 제외 | 실제 송금·자동 입금 인식, 은행 계좌 등록, Production 쓰기 허용, Android 변경 |

변경 본문은 `operationId`, `paymentVersion`, `targetStatus`, `receivedAmount`, `reason`으로 제한한다. 담당자 ID는 본문이 아닌 검증된 인증 문맥에서 결정한다. 금액은 0 이상 PostgreSQL integer 범위의 정수, 사유는 공백 제거 후 10~500자다. 입금 확인·검토 필요에는 확인한 금액을 직접 입력하고, 환불 요청·완료에는 `receivedAmount: null`을 보낸다.

## 상태와 중복 처리

| 현재 상태 | 다음 처리 |
| --- | --- |
| 입금 확인 대기 | 입금 확인, 검토 필요 |
| 검토 필요 | 입금 확인, 환불 요청. 취소된 예약은 환불 요청만 허용 |
| 입금 확인 | 환불 요청 |
| 환불 요청 | 환불 완료 |
| 입금 처리 취소 | 지연 입금을 확인한 경우 검토 필요 |
| 환불 완료 | 종료 |

상태 전이와 금액 일치 여부의 최종 판단은 DB V22 함수가 수행한다. 상태 변경, 변경 감사, 상세 재조회와 조회 감사를 한 연결·트랜잭션으로 묶고 재조회나 응답 해석에 실패하면 rollback한다. 버전 충돌은 `409`로 반환하고 재조회 전까지 화면을 잠근다.

응답 유실·통신 실패·`503`은 성공 여부를 알 수 없는 상태다. 같은 화면에서는 최초 작업 ID·버전·사유·금액을 보존하고 입력과 재조회를 잠근 뒤 동일 요청만 재전송한다. 작업 ID는 메모리에만 보관하므로 새로고침·화면 이동 뒤에는 유지되지 않는다. 이 경우 새 변경을 즉시 제출하지 말고 최신 원장·이력을 먼저 대조한다. 전송 취소가 서버 트랜잭션 취소를 보장하지는 않는다.

## 환경과 적용 순서

`ADMIN_BANK_TRANSFER_WRITES_ENABLED`는 서버 전용이며 기본값은 `false`다. 정확히 `true`이고 `VERCEL_ENV=preview`인 경우에만 Vercel에서 변경을 허용한다. Vercel 밖에서는 `NODE_ENV=development`여야 한다. `VERCEL_ENV=production` 또는 로컬 production 빌드는 플래그만 바꿔도 열리지 않는다. 조회 권한은 쓰기 플래그와 별도로 항상 검증한다.

1. 메인 PR #406을 검토·병합하고 기존 migration workflow로 개발 DB의 V23 적용을 확인한다. 웹 저장소에서 DDL이나 DB 권한을 직접 변경하지 않는다.
2. 이 웹 변경의 Preview에서 쓰기 플래그를 비운 상태로 관리자 `200`, 일반 사용자·개발 역할 `403`, 무인증 `401`, 변경 `423`을 확인한다.
3. 개발 DB 연결과 합성 예약임을 확인한 뒤 해당 Preview에만 쓰기 플래그를 켜고 재배포한다. 실제 관리자 ID token과 App Check 정책을 그대로 사용한다.
4. 합성 예약에서 정상 변경·이력·감사, 버전 충돌, 같은 작업 재시도, 취소 예약의 입금 확인 거부를 확인한다. 다른 예약과 실제 결제 데이터가 바뀌지 않았는지 대조한다.
5. 문제가 생기면 플래그를 끄고 재배포한다. V23 제거가 필요하면 웹을 먼저 이전 배포로 복구한 뒤 메인 저장소 rollback 절차를 따른다. 원장·이력·감사 데이터는 삭제하지 않는다.

## 검증 기록

2026-09-05 로컬 검증:

| 검증 | 결과 |
| --- | --- |
| `npm test` | 서버·계약·트랜잭션 테스트 141개 통과 |
| `npm run lint` | 통과 |
| `npm run build` | CI와 같은 비운영 Firebase placeholder 설정으로 Next.js 빌드 통과 |
| `npm run build:vite` | 통과. 기존 Firebase vendor 청크의 500kB 초과 경고는 유지 |
| 빌드된 Next.js route | 무인증 GET·PATCH 모두 `401 missing_authorization`, `Cache-Control: no-store` 확인 |
| 실제 Chrome, 합성 응답 | 입금 확인 → 환불 요청 → 환불 완료, 부분 입금 검토 처리 확인 |
| 응답 유실 | 서버 반영 후 `503`을 모사하고 동일 작업 ID·내용으로 재시도. 상태 변경·이력은 한 번만 반영 |
| 버전 충돌 | `409` 뒤 입력·제출 잠금, 재조회 후 선택·사유 초기화 확인 |
| 접근·환경 | 쓰기 비활성 화면, 취소 예약의 환불 전용 선택지, `403`·`404` 안내와 결제 상세 비표시 확인 |
| 화면 | 데스크톱·390px 모바일 캡처 확인. 페이지 가로 넘침·겹침 없음, 넓은 이력 표만 내부 스크롤 |
| 브라우저 오류 | 합성 시나리오에서 페이지 JavaScript 오류 없음 |

화면 검증은 저장소 외부의 임시 로컬 harness에서 실제 컴포넌트에 합성 응답을 제공해 수행했다. 인증 우회 코드나 합성 사용자를 제품에 추가하지 않았다. DB 함수의 권한·감사·이력 제한·rollback은 메인 PR #406의 격리 PostgreSQL CI에서 별도로 통과했다. 이 두 결과를 실제 Vercel 계정·개발 DB 연결 검증으로 간주하지 않는다.

### Preview 런타임 호환성

`a683a17`의 Vercel 빌드는 성공했지만 실제 무인증 호출에서 결제 경로와 기존 병원 가이드 경로가 모두 `500`이었다. 로그에서 Firebase Admin SDK 초기 로딩 중 `jwks-rsa`의 CommonJS `require('jose')`가 ESM 모듈을 불러오지 못하는 `ERR_REQUIRE_ESM`을 확인했다. 같은 설치 상태에서 Node의 `--no-experimental-require-module` 조건으로 동일 오류를 재현했다. 따라서 배포 Node 버전이 오래됐다고 단정하거나 빌드 성공을 API 정상 동작으로 간주하지 않는다.

- 선택한 방식: `firebase-admin`, `jwks-rsa`, `jose`를 Next.js `transpilePackages`로 명시하고 Firebase Admin의 external 설정을 제거한다. DB 드라이버 `pg`는 기존 external 경계를 유지한다.
- 대안: Node·의존성 버전 교체, App Check 검증 제거, SDK 동적 import를 검토했다. 버전 교체는 승인 범위가 아니고, 검증 제거는 인증 경계를 약화한다. 동적 import만으로는 SDK 내부의 CommonJS 호출이 바뀌지 않는다.
- 선택 이유: 현재 설정에서 재현되는 모듈 호환성만 번들 경계에서 처리해 기존 SDK·인증 코드와 패키지 버전을 유지한다. [Next.js transpilePackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages)와 [기본 external 패키지 목록](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages)을 근거로 삼는다.
- 리스크: SDK의 다른 동적 로딩 경로에 영향이 있을 수 있어 결제뿐 아니라 기존 관리자 API도 실제 Preview에서 재검사한다. 무인증 차단 성공은 유효한 App Check·Firestore·Storage 작업 성공의 증거는 아니다.

`scripts/check-built-admin-runtime.mjs`는 기존 빌드를 제한된 Node 조건에서 직접 실행해 관리자 API의 인증 거부 응답을 확인한다. 실제 DB·서비스 계정은 전달하지 않고 CI placeholder만 사용한다. CI의 Next.js 빌드 직후 이 검사를 실행해 빌드 단계에서 드러나지 않는 초기 모듈 로딩 오류를 차단한다.

2026-09-05 로컬 재검증에서는 수정 전 빌드의 `500` 실패를 먼저 확인한 뒤, 수정 빌드의 기존 병원 가이드 GET·결제 GET/PATCH에 대해 무인증·잘못된 인증 형식·가짜 Firebase token 조합 9건이 모두 `401`, JSON, `no-store`, 고정 오류 본문으로 거부됨을 확인했다. 테스트 141건, lint, Next.js 빌드, Vite rollback 빌드, workflow YAML 파싱도 통과했다. 새 커밋의 실제 Vercel Preview 재검사 결과는 PR #51에 기록한다.

## 남은 범위와 리스크

- 두 PR의 리뷰와 병합, 개발 DB V23 적용, Vercel Preview 실제 인증·DB 통합 확인이 남아 있다. 이 변경만으로 메인 이슈 #27을 닫지 않는다.
- 운영자의 입금 대조 실수까지 자동으로 방지하지는 않는다. 입금 확인은 DB가 입금자명 등록과 확인 금액·예상 금액의 일치를 요구하며, 불일치는 검토 필요로 기록한다.
- 기록 사유에 불필요한 계좌번호·환자 연락처를 넣지 않는다. DB 오류 원문과 인증 토큰은 응답·로그·문서에 남기지 않는다.
- 변경 실패는 성공으로 표시하지 않는다. DB 상세 조회 감사에 실패하면 상세나 변경 성공 응답을 반환하지 않는다.
