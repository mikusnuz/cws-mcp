# cws-mcp

[한국어](README.ko.md)

[![MCP Badge](https://lobehub.com/badge/mcp/mikusnuz-cws-mcp)](https://lobehub.com/mcp/mikusnuz-cws-mcp)

MCP server for Chrome Web Store extension management. Upload, publish, and manage Chrome extensions directly from Claude Code or any MCP client.

## Tools

| Tool | Description |
|---|---|
| `upload` | Upload a ZIP file to Chrome Web Store (create/update draft) |
| `publish` | Publish an extension to the store |
| `status` | Fetch the current status of an extension |
| `cancel` | Cancel a pending submission |
| `deploy-percentage` | Set staged rollout percentage (0-100) |
| `get` | Read draft/published listing metadata (v1 API) |
| `update-metadata` | Update listing metadata including title/summary/description/category and raw metadata payload |
| `update-metadata-ui` | Update listing metadata via dashboard UI automation (Playwright) |

## Setup

### 1. Create OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Chrome Web Store API**
4. Create OAuth2 credentials (Desktop app type)
5. Note your **Client ID** and **Client Secret**

### 2. Get Refresh Token

```bash
# Open in browser to get authorization code
open "https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob"

# Exchange code for refresh token
curl -X POST https://oauth2.googleapis.com/token \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTH_CODE" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
```

### 3. Configure MCP

Add to your Claude Code MCP settings (`~/.claude/settings.local.json`):

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
        "CWS_ITEM_ID": "your-extension-id"
      }
    }
  }
}
```

Or install globally via npm:

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

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CWS_CLIENT_ID` | Yes | Google OAuth2 Client ID |
| `CWS_CLIENT_SECRET` | Yes | Google OAuth2 Client Secret |
| `CWS_REFRESH_TOKEN` | Yes | OAuth2 Refresh Token |
| `CWS_PUBLISHER_ID` | No | Publisher ID (default: `me`) |
| `CWS_ITEM_ID` | No | Default extension item ID |

## Usage Examples

### Check extension status
```
Use the cws-mcp status tool
```

### Upload and publish
```
1. Use cws-mcp upload with zipPath="/path/to/extension.zip"
2. Use cws-mcp publish
```

### Update listing title/description without publishing
```
Use cws-mcp update-metadata with:
- title="Pexus"
- summary="Official wallet for Plumise"
- description="..."
- category="productivity"
- defaultLocale="en"
```

### Update advanced metadata fields
```
Use cws-mcp update-metadata with metadata={
  "homepageUrl": "https://plumise.com",
  "supportUrl": "https://plug.plumise.com/docs"
}
```

### When API metadata updates don't reflect
```
Use cws-mcp update-metadata-ui with:
- title
- summary
- description
- category
- homepageUrl
- supportUrl
```

Notes:
- This tool automates the Chrome Web Store dashboard UI.
- First run with `headless=false` if login is required.
- Browser profile path defaults to `~/.cws-mcp-profile` (override with `CWS_DASHBOARD_PROFILE_DIR`).

### Staged rollout
```
1. Use cws-mcp publish
2. Use cws-mcp deploy-percentage with percentage=10
```

## License

MIT
