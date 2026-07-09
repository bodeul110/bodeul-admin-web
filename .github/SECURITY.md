# 보안 정책

## 지원 범위

현재 저장소의 기본 브랜치 `master`와 공개된 최신 PR 기준으로 보안 제보를 검토한다. 관리자 웹 UI, Firebase Web config, App Check 설정, Firebase Hosting, GitHub Actions 변경은 우선 확인 대상이다.

Firestore Rules, Storage Rules, Functions, Android 앱, `bodeul-api`처럼 원 저장소가 소유하는 영역의 취약점은 [bodeul110/Bodeul](https://github.com/bodeul110/Bodeul) 이슈 또는 보안 제보 경로와 함께 연결한다.

## 취약점 제보

민감한 취약점이나 실제 비밀값은 공개 Issue, Discussion, PR 댓글에 올리지 않는다.

제보에는 가능한 범위에서 다음 내용을 포함한다.

- 영향을 받는 화면, workflow, 설정 파일
- 재현 절차
- 예상 영향
- 로그, 스크린샷, 요청/응답 예시에서 민감값을 제거한 증거
- 임시 완화 방법이 있다면 그 내용

## 처리 기준

- 제보를 확인한 뒤 영향 범위와 우선순위를 정한다.
- 실제 비밀값 유출 가능성이 있으면 해당 값은 즉시 폐기하고 재발급한다.
- 보안 수정 PR은 관련 Issue나 Security Advisory와 연결하고 `npm run lint`, `npm run build`를 수행한다.
- 공개 가능한 정보만 일반 Issue나 PR에 남긴다.
