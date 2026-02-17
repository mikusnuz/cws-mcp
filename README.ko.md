# cws-mcp

Chrome Web Store 확장 프로그램 관리를 위한 MCP 서버. Claude Code 또는 MCP 클라이언트에서 직접 크롬 확장 프로그램을 업로드, 퍼블리시, 관리할 수 있습니다.

## 도구

| 도구 | 설명 |
|---|---|
| `upload` | ZIP 파일을 Chrome Web Store에 업로드 (초안 생성/업데이트) |
| `publish` | 확장 프로그램을 스토어에 퍼블리시 |
| `status` | 확장 프로그램의 현재 상태 확인 |
| `cancel` | 제출 대기 중인 항목 취소 |
| `deploy-percentage` | 단계적 배포 비율 설정 (0-100) |
| `get` | DRAFT/PUBLISHED 리스팅 메타데이터 조회 (v1 API) |
| `update-metadata` | 제목/요약/설명/카테고리 및 raw metadata 포함 메타데이터 업데이트 |
| `update-metadata-ui` | 대시보드 UI 자동화(Playwright)로 리스팅 메타데이터 업데이트 |

## 설정

### 1. OAuth2 자격 증명 생성

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성 (또는 기존 프로젝트 선택)
3. **Chrome Web Store API** 활성화
4. OAuth2 자격 증명 생성 (데스크톱 앱 유형)
5. **Client ID**와 **Client Secret** 기록

### 2. Refresh Token 발급

```bash
# 브라우저에서 열어 인증 코드 획득
open "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob"

# 코드를 refresh token으로 교환
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

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

### 퍼블리시 없이 제목/설명 업데이트
```
cws-mcp update-metadata 사용:
- title="PlumWallet"
- summary="Official wallet for Plumise"
- description="..."
- category="productivity"
- defaultLocale="en"
```

### 고급 메타데이터 업데이트
```
cws-mcp update-metadata에서 metadata 객체 전달:
{
  "homepageUrl": "https://plumise.com",
  "supportUrl": "https://plug.plumise.com/docs"
}
```

### API 반영이 안 되는 경우(UI 자동화)
```
cws-mcp update-metadata-ui 사용:
- title
- summary
- description
- category
- homepageUrl
- supportUrl
```

참고:
- 이 도구는 Chrome Web Store 대시보드 UI를 자동 조작합니다.
- 로그인 필요 시 `headless=false`로 1회 실행해 로그인하세요.
- 브라우저 프로필 기본 경로: `~/.cws-mcp-profile` (`CWS_DASHBOARD_PROFILE_DIR`로 변경 가능)

### 단계적 배포
```
1. cws-mcp publish
2. cws-mcp deploy-percentage (percentage=10)
```

## 라이선스

MIT

[English](README.md)
