# DEV 심사 목록 전용 JSON reader

관련: [이슈 #79](https://github.com/bodeul110/bodeul-admin-web/issues/79). 2026-10-01 기준.

심사 목록 GET만 별도 Firebase named App과 native `cert`를 사용한다. `users`의 `role == MANAGER` 조회·마스킹·정렬은 유지한다. 공용 `FIREBASE_SERVICE_ACCOUNT_JSON`, 로그인 신원 확인, 심사 POST, 원문·Storage 처리 경로는 바꾸지 않는다. 인증·MFA·App Check·PG 역할 검사 후 reader를 초기화하며 필수 PG VIEW/FAILED/DENIED 감사는 그대로 남긴다. 조회나 감사가 실패하면 목록 대신 503을 반환한다.

## 활성화 범위

| 항목 | 정확한 값 |
| --- | --- |
| Google Cloud 프로젝트 | `bodeul-dev` / `533563500316` |
| 서비스 계정 | `admin-manager-list-dev@bodeul-dev.iam.gserviceaccount.com` |
| custom role | `projects/bodeul-dev/roles/adminManagerListReader` |
| role 권한 | `datastore.entities.get`, `datastore.entities.list`만 |
| binding 조건 | `resource.name == "projects/bodeul-dev/databases/(default)"` |
| 조건 제목 | `OnlyBodeulDevDefaultDatabase` |
| Vercel 프로젝트 | BoDeul (`bodeul110`) / `bodeul-admin-web` |
| 환경·Git 브랜치 | **Preview / dev만** |
| Config | `MANAGER_LIST_AUTH_MODE=json-reader` |
| Secret | `FIREBASE_MANAGER_LIST_SERVICE_ACCOUNT_JSON` |
| 기존 서버 Config | `FIREBASE_PROJECT_ID=bodeul-dev` 유지 |

IAM의 제한 단위는 DB이다. 위 SA는 **DEV 기본 DB 전체 문서를 읽을 수 있다**. MANAGER 필터나 마스킹으로 다른 컬렉션의 IAM 읽기 권한이 제한되지는 않는다. 서버 SDK는 Firestore Security Rules를 우회한다. 쓰기·삭제·Auth·Storage·Token Creator·다른 프로젝트 권한은 이 역할에 넣지 않는다. [공식 Firestore 권한](https://docs.cloud.google.com/firestore/native/docs/security/iam), [DB 조건](https://docs.cloud.google.com/firestore/native/docs/manage-databases), [IAM 지원 리소스](https://docs.cloud.google.com/iam/docs/conditions-resource-attributes), [서버 SDK와 Rules](https://docs.cloud.google.com/firestore/native/docs/security/rules-query).

기본 모드는 `legacy`이며 현재 공용 경로를 사용한다. `json-reader`를 명시하면 전용 Secret 누락·잘못된 JSON·다른 project/SA·Production·다른 브랜치를 거부하고 legacy/ADC로 재시도하지 않는다. Vercel branch 환경변수와 런타임 검사는 배포 설정 검사이며 서명된 Git 신원 기반 IAM 조건은 아니다. Secret은 build/runtime 코드가 사용할 수 있으므로 검토된 dev 코드에만 제공한다.

## 현재 IAM 준비 상태

2026-10-01에 기존 `wlsrjsals110@gmail.com` 연결로 지정 SA를 생성하고 metadata를 읽기 확인했다. SA unique ID는 `100565667345498428038`이다. 같은 연결의 custom role 생성은 **`iam.roles.create` 부족으로 거부**됐다. role은 없고 이 SA의 프로젝트 직접 바인딩도 없는 상태로 읽기 확인했다. 상위 조직 정책에서 이 SA 또는 전체 SA principalSet에 대한 상속 바인딩은 발견되지 않았다. 키 생성·조회·다운로드, Vercel Secret 저장은 실행하지 않았다.

권한 있는 관리자가 위 custom role과 정확한 DB 조건의 바인딩을 준비한 뒤 metadata를 재확인해야 한다. 현재 계정에 권한을 더 주거나 predefined viewer/user/admin으로 바꾸지 않는다. [Roles 화면](https://console.cloud.google.com/iam-admin/roles?project=bodeul-dev), [IAM 화면](https://console.cloud.google.com/iam-admin/iam?project=bodeul-dev), [custom role 생성](https://docs.cloud.google.com/iam/docs/creating-custom-roles). 기존 동명 role·SA가 있거나 추가 역할이 확인되면 덮어쓰지 않고 먼저 확인한다.

## GET outbox 보류 영향

`json-reader` GET은 `reconcilePendingManagerReviewAudits`를 실행하지 않는다. 따라서 outbox 문서 조회·DELIVERED 정리 삭제·PENDING PG 감사 재처리·Firestore 전달 표시를 모두 보류한다. 기존 큐 항목은 삭제하거나 변경하지 않는다. `legacy` GET은 기존 재처리 경로를 유지한다.

현재 저장소에서 별도의 자동 재처리 호출자는 확인되지 않았다. 전용 reader 활성화 뒤에는 PENDING 감사 복구와 만료 tombstone 정리가 목록 GET으로 진행되지 않는다. 심사 POST의 원래 감사 기록·전달 표시 시도는 유지하지만, 실패 항목의 후속 처리 담당과 재개 방법은 별도 승인 작업으로 남는다. 새 스케줄러·처리자나 추가 쓰기 권한은 만들지 않는다. 실제 backlog는 조회하지 않았다.

## 사용자 직접 키 생성·입력

**custom role/DB 바인딩, 코드 검증과 승인된 dev 반영이 준비되기 전에는 키를 생성·입력하지 않는다.** 이 PR의 초안 생성이나 Preview 빌드 성공만으로 dev 반영·권한 준비·실제 목록 복구가 완료되지는 않는다.

1. [DEV Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts?project=bodeul-dev)에서 위 SA email과 프로젝트를 확인한다. 역할·조건이 위 표와 같고 추가 권한이 없는지 관리자가 확인한다.
2. 사용자가 SA의 **Keys → Add key → Create new key → JSON → Create**를 직접 실행한다. 조직의 키 생성 정책이 막으면 중단한다. 예외 정책이나 다른 계정으로 우회하지 않는다. 파일은 사용자 로컬의 안전한 위치에 보관하고 채팅·첨부·저장소·Codex workspace에 넣지 않는다. [공식 키 생성 절차](https://docs.cloud.google.com/iam/docs/keys-create-delete).
3. 사용자가 `project_id`와 `client_email`을 위 표와 대조한다. Codex에는 JSON 내용이나 private key를 전달하지 않는다.
4. [Vercel 환경변수 화면](https://vercel.com/bodeul110/bodeul-admin-web/settings/environment-variables)에서 전용 JSON 변수의 type을 **Secret**, 환경을 **Preview**, Git Branch를 **dev**로 지정하고 사용자가 전체 JSON을 직접 저장한다. Config 모드도 동일 Preview/dev 범위로 등록한다. 전체 Preview·Production·Development·팀 Shared에는 등록하지 않는다. `NEXT_PUBLIC_`/`VITE_` 접두어를 붙이지 않는다. 기존 공용 credential과 DB·HMAC Secret은 교체하지 않는다. [Secret 설명](https://vercel.com/docs/environment-variables/sensitive-environment-variables), [branch 환경변수](https://vercel.com/docs/environment-variables).
5. 완료 확인은 변수명·Secret 유형·Preview/dev 대상 등 metadata만 공유한다. 환경변수 변경은 새 배포에 적용되므로 이후 승인된 dev 빌드가 필요하다. PR 병합·수동배포·실환경 목록 GET은 이번 작업에서 실행하지 않는다. 실제 GET은 MANAGER 조회와 PG 감사 쓰기를 수반하므로 별도로 승인받는다. [환경변수 적용](https://vercel.com/docs/environment-variables/managing-environment-variables).

## 검증·키 회전·회수

합성 테스트는 모드와 DEV project/SA/branch 제한, secret 오류 비노출, native SDK `cert`와 기본 DB client 구성, 인증 전에 reader 미초기화, outbox/HMAC/원문/쓰기 미호출, legacy 동작 보존, 필수 PG 감사 실패 503을 확인한다. SDK 테스트 RSA는 메모리에서 만든 로컬 fixture이며 Google 서비스 계정 키가 아니다. 토큰 발급·클라우드 요청·문서 조회는 수행하지 않는다. 실제 credential·IAM 허용 여부나 배포된 503 복구를 입증하는 테스트는 아니다.

사용자가 키 생성 날짜와 비밀이 아닌 key ID를 관리하고 최대 90일 주기로 교체한다. 새 키 생성 → 동일 Preview/dev Secret 교체 → 승인된 새 dev 배포와 검증 → 이전 키 비활성화 → 사용 종료 확인 뒤 삭제 순서다. 이번 작업에서는 키나 배포를 실행하지 않는다. [공식 회전 절차](https://docs.cloud.google.com/iam/docs/key-rotation).

Console에는 키 비활성화 기능이 없어 해당 단계는 담당자가 공식 gcloud/REST를 사용해야 한다. 키 비활성화·삭제는 이미 발급된 단기 credential을 회수하지 않는다. 유출 시에는 전용 SA 비활성화/삭제가 필요할 수 있으며 reader가 중단된다. [공식 키 비활성화·회수 설명](https://docs.cloud.google.com/iam/docs/keys-disable-enable).
