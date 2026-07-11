# Vercel Preview API mode checklist

이 문서는 `bodeul-admin-web` Preview 배포에서 `bodeul-api` read API 연결을 확인하기 위한 절차다.
Production 전환 절차가 아니며, #140 preview 검증에만 사용한다.

## Vercel Preview env

Vercel 프로젝트 `bodeul-admin-web`의 Preview 환경에만 아래 값을 설정한다.

```text
VITE_BODEUL_DATA_BACKEND=api
VITE_BODEUL_API_BASE_URL=<HTTPS preview API endpoint>
```

- Production 환경에는 적용하지 않는다.
- `VITE_BODEUL_API_BASE_URL`에 외부 `http://` origin을 넣지 않는다.
- 임시 Quick Tunnel URL은 코드, 이슈, PR 본문에 고정하지 않고 팀 내부 보안 채널로 공유한다.
- 환경변수 변경 후에는 Preview 배포를 redeploy 해야 한다.

## API server prerequisites

Oracle API 서버는 Preview 관리자 웹 origin을 CORS allow-list에 포함해야 한다.

```text
BODEUL_API_ALLOWED_ORIGINS=<vercel-preview-origin>
```

API 서버 쪽에 설정해야 하는 비밀값은 공개 문서나 PR 본문에 남기지 않는다.

- `DATABASE_URL`
- Supabase DB password / connection string
- Firebase service account JSON
- Firebase ID token

## Verification

1. Preview URL에 접속한다.
2. Firebase 관리자 계정으로 로그인한다.
3. 병원 가이드 API 검증 화면에서 Backend가 `API 모드`인지 확인한다.
4. 조회 버튼을 눌러 `/admin/hospital-guides?limit=50` 응답을 확인한다.
5. 브라우저 콘솔에 CORS 오류가 없는지 확인한다.
6. 별도 터미널에서 인증 없는 관리자 API가 401인지 확인한다.

```powershell
Invoke-RestMethod `
  -Uri "<HTTPS preview API endpoint>/admin/hospital-guides?limit=50"
```

예상 결과:

```text
401 missing_authorization
```

## Rollback

문제가 생기면 Preview 환경변수를 아래처럼 되돌린다.

```text
VITE_BODEUL_DATA_BACKEND=firebase
```

그리고 API endpoint 관련 Preview env를 제거하거나 비활성화한다.

