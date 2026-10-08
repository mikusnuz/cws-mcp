# cws-mcp

[![npm version](https://img.shields.io/npm/v/cws-mcp)](https://www.npmjs.com/package/cws-mcp)

[English](README.md)

[![MCP Badge](https://lobehub.com/badge/mcp/mikusnuz-cws-mcp)](https://lobehub.com/mcp/mikusnuz-cws-mcp)

Chrome Web Store 확장 프로그램 관리를 위한 MCP 서버. Claude Code 또는 MCP 클라이언트에서 직접 크롬 확장 프로그램을 업로드, 퍼블리시, 관리할 수 있습니다.

## 이런 경우에 사용하세요

- **"크롬 확장 프로그램 새 버전 업로드해줘"** — ZIP을 빌드하고 `upload` 도구로 초안 업데이트
- **"확장 프로그램 Chrome Web Store에 퍼블리시해줘"** — `publish`로 리뷰 제출 및 배포
- **"확장 프로그램 리뷰 상태 확인해줘"** — `status`로 리뷰 상태, 버전, 배포 비율 확인
- **"확장 프로그램 설명이나 카테고리 업데이트해줘"** — `update-metadata`로 초안을 저장하고 반영 확인
- **"제출 대기 중인 거 취소해줘"** — `cancel`로 리뷰 중인 제출 철회
- **"확장 프로그램 단계적 배포 설정해줘"** — `publish`로 단계적 배포 후 `deploy-percentage`로 비율 증가

## 도구

| 도구 | 설명 |
|---|---|
| `upload` | ZIP 파일을 Chrome Web Store에 업로드 (기존 항목 초안 업데이트) |
| `publish` | 게시 유형·배포 비율·리뷰 건너뛰기·`blockOnWarnings` 옵션으로 제출/게시 |
| `status` | 리뷰 상태, 배포 비율, 버전 등 현재 상태 확인 |
| `cancel` | 제출 대기 중인 항목 취소 |
| `deploy-percentage` | 단계적 배포 비율 설정 (0-100, 현재 목표보다 높아야 함) |
| `get` | `status`와 동일한 v2 게시 상태 조회. 리스팅 본문은 반환하지 않음 |
| `get-metadata-ui` | 대시보드의 현재 초안 설명·카테고리·홈페이지 URL·지원 URL 조회 |
| `update-metadata` | 위 4개 초안 항목을 대시보드에서 저장하고 새로고침 후 반영 확인 |
| `update-metadata-ui` | `update-metadata`와 동일 |

## API 커버리지

이 MCP 서버는 **모든 Chrome Web Store API v2 엔드포인트**를 지원합니다:

| v2 엔드포인트 | MCP 도구 |
|---|---|
| `media.upload` | `upload` |
| `publishers.items.publish` | `publish` |
| `publishers.items.fetchStatus` | `status` |
| `publishers.items.cancelSubmission` | `cancel` |
| `publishers.items.setPublishedDeployPercentage` | `deploy-percentage` |

모든 API 요청은 v2를 사용합니다. 공개 API에 리스팅 본문 조회·수정 기능이 없어 대시보드 도구는 별도 로그인된 Chrome 프로필과 Playwright를 사용합니다. 저장은 심사 제출로 대체되지 않습니다. 필드를 찾지 못하거나 카테고리·저장 결과를 확인하지 못하면 성공 대신 오류를 반환합니다.

## 설정

### 1. OAuth2 자격 증명 생성

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성 (또는 기존 프로젝트 선택)
3. **Chrome Web Store API** 활성화
4. OAuth2 자격 증명 생성 (데스크톱 앱 유형)
5. **Client ID**와 **Client Secret** 기록

### 2. Refresh Token 발급

Google의 [데스크톱 앱 OAuth 흐름](https://developers.google.com/identity/protocols/oauth2/native-app)에 따라 로컬 loopback redirect URI, PKCE, `https://www.googleapis.com/auth/chromewebstore` scope를 사용합니다. `access_type=offline`을 요청하고 새 refresh token이 필요하면 `prompt=consent`를 사용하세요. 같은 redirect URI로 코드를 교환한 뒤 refresh token은 MCP 클라이언트의 비밀값/환경변수 설정에 보관합니다. 예전 OOB 방식의 코드 복사·붙여넣기 redirect는 Google에서 더 이상 지원하지 않습니다.

### 3. MCP 설정

Claude Code MCP 설정 (`~/.claude/settings.local.json`)에 추가:

```json
{
  "mcpServers": {
    "cws-mcp": {
      "command": "node",
      "args": ["/path/to/cws-mcp/dist/index.js"],
      "env": {
        "CWS_CLIENT_ID": "xxxxx.apps.googleusercontent.com",
        "CWS_CLIENT_SECRET": "GOCSPX-xxxxx",
        "CWS_REFRESH_TOKEN": "1//xxxxx",
        "CWS_PUBLISHER_ID": "me",
        "CWS_ITEM_ID": "확장프로그램ID"
      }
    }
  }
}
```

또는 npm을 통해 전역 설치:

```json
{
  "mcpServers": {
    "cws-mcp": {
      "command": "npx",
      "args": ["-y", "cws-mcp"],
      "env": { ... }
    }
  }
}
```

## 환경 변수

| 변수 | 필수 | 설명 |
|---|---|---|
| `CWS_CLIENT_ID` | 예 | Google OAuth2 Client ID |
| `CWS_CLIENT_SECRET` | 예 | Google OAuth2 Client Secret |
| `CWS_REFRESH_TOKEN` | 예 | OAuth2 Refresh Token |
| `CWS_PUBLISHER_ID` | 아니오 | 퍼블리셔 ID (기본값: `me`) |
| `CWS_ITEM_ID` | 아니오 | 기본 확장 프로그램 Item ID |
| `CWS_DASHBOARD_PROFILE_DIR` | 아니오 | UI 자동화용 브라우저 프로필 경로 (기본값: `~/.cws-mcp-profile`) |

## 사용 예시

### 확장 프로그램 상태 확인
```
cws-mcp status 도구 사용
```

### 업로드 후 퍼블리시
```
1. cws-mcp upload (zipPath="/path/to/extension.zip")
2. cws-mcp publish
```

### 승인 후 게시를 보류하기
```
cws-mcp publish 사용:
- publishType="STAGED_PUBLISH"
```

### 리뷰 건너뛰기로 퍼블리시
```
cws-mcp publish에서 skipReview=true 사용
```

`STAGED_PUBLISH`는 승인 후 나중에 게시하도록 보류하는 옵션이며 배포 비율과 다릅니다. 사용 요건을 충족하는 확장 프로그램의 점진적 배포는 `deployPercentage`를 별도로 지정하세요.

### 검증 경고가 있으면 게시 중단

```
cws-mcp publish에서 blockOnWarnings=true 사용
```

기본값은 API와 동일하게 `false`입니다. 성공 응답이어도 `warningInfo.warnings`를 확인하세요.

### 심사 제출 없이 초안 조회·저장

```
cws-mcp get-metadata-ui에서 headless=false 사용
cws-mcp update-metadata 사용:
- description="..."
- category="Developer Tools"
- homepageUrl="https://example.com"
- supportUrl="https://example.com/support"
```

참고:
- `category`는 현재 대시보드 언어의 선택지 문구와 정확히 일치해야 합니다. 영어·한국어 필드 이름을 지원합니다.
- 조회·저장 대상은 **현재 대시보드 초안**입니다. 게시된 본문이나 임의 언어 버전 조회가 아닙니다. 원하는 로컬라이제이션을 대시보드에서 먼저 선택하세요. 필드가 모호하면 중단합니다.
- 제목·요약·기본 언어는 `manifest.json` / 번역 메시지를 수정하고 ZIP을 다시 빌드해 `upload`합니다. 아이콘·스크린샷은 대시보드에서 직접 올리세요.
- 로그인 필요 시 `headless=false`로 1회 실행해 로그인하세요.
- 브라우저 프로필 기본 경로: `~/.cws-mcp-profile` (`CWS_DASHBOARD_PROFILE_DIR`로 변경 가능)
- Google Chrome 설치가 필요합니다. 대시보드 UI 변경으로 선택자 수정이 필요할 수 있으며 확인할 수 없는 저장은 오류를 반환합니다. 모호한 실패는 재시도 전 대시보드에서 상태를 확인하세요.

### 단계적 배포
```
1. cws-mcp publish (deployPercentage=10)
2. status로 승인·게시 확인
3. cws-mcp deploy-percentage (percentage=50)
4. cws-mcp deploy-percentage (percentage=100)
```

참고: `deploy-percentage`는 7일 활성 사용자 10,000명 이상인 확장 프로그램에서만 사용 가능합니다. 새 비율은 항상 현재 목표보다 높아야 합니다.

## 1.x에서 2.0으로 이전

Google은 [2026년 10월 15일 v1 API를 종료](https://developer.chrome.com/docs/webstore/api/v1)합니다. 2.0은 v1을 호출하지 않습니다.

- `get`은 이제 v2 게시 상태를 반환합니다. 기존 `projection` 인수는 오류 처리하며, 초안 본문은 `get-metadata-ui`로 읽습니다. v2는 게시된 리스팅 본문을 제공하지 않습니다.
- `update-metadata`도 `update-metadata-ui`와 같은 대시보드 흐름을 사용하므로 API 토큰 외에 Chrome 로그인이 필요합니다.
- `metadata` 객체·`title`·`summary`·`defaultLocale`은 수정 방법을 안내하는 오류로 반환합니다. 미지원 입력을 무시하고 성공시키지 않습니다.
- `storeIconPath`는 더 이상 업로드 기능으로 지원하지 않습니다. 기존 범용 파일 입력 방식으로는 어떤 에셋에 반영됐는지 확실히 확인할 수 없어 중단했습니다. 아이콘은 Developer Dashboard에서 올리세요.

## 라이선스

MIT
