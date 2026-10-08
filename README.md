# cws-mcp

[![npm version](https://img.shields.io/npm/v/cws-mcp)](https://www.npmjs.com/package/cws-mcp)

[한국어](README.ko.md)

[![MCP Badge](https://lobehub.com/badge/mcp/mikusnuz-cws-mcp)](https://lobehub.com/mcp/mikusnuz-cws-mcp)

MCP server for Chrome Web Store extension management. Upload, publish, and manage Chrome extensions directly from Claude Code or any MCP client.

## When to Use

Use this MCP when you need to:

- **"Upload a new version of my Chrome extension"** — build your ZIP and use the `upload` tool to push it as a draft
- **"Publish my extension to the Chrome Web Store"** — use `publish` to submit for review and go live
- **"Check the review status of my extension"** — use `status` to see review state, version, and deploy percentage
- **"Update my extension's description or category"** — use `update-metadata` to save and verify the draft listing
- **"Cancel a pending submission"** — use `cancel` to withdraw a submission under review
- **"Set up staged rollout for my extension"** — use `publish` with staged rollout, then `deploy-percentage` to ramp up

## Tools

| Tool | Description |
|---|---|
| `upload` | Upload a ZIP file to Chrome Web Store (update existing item draft) |
| `publish` | Submit/publish with publish type, rollout percentage, skip-review, and `blockOnWarnings` |
| `status` | Fetch the current status including review state, deploy percentage, and version |
| `cancel` | Cancel a pending submission |
| `deploy-percentage` | Set staged rollout percentage (0-100, must exceed current target) |
| `get` | Alias of `status`: v2 publication status, not listing text |
| `get-metadata-ui` | Read the current draft description, category, homepage URL, and support URL from the dashboard |
| `update-metadata` | Save those four supported draft fields through the dashboard and verify them after reload |
| `update-metadata-ui` | Alias of `update-metadata` |

## API Coverage

This MCP server covers **all Chrome Web Store API v2 endpoints**:

| v2 Endpoint | MCP Tool |
|---|---|
| `media.upload` | `upload` |
| `publishers.items.publish` | `publish` |
| `publishers.items.fetchStatus` | `status` |
| `publishers.items.cancelSubmission` | `cancel` |
| `publishers.items.setPublishedDeployPercentage` | `deploy-percentage` |

All API requests use v2. The public API has no listing-text read/write endpoints; dashboard tools use Playwright and a separate signed-in Chrome profile. Saving listing fields never submits for review. Missing fields, unmatched categories, and unconfirmed saves return errors instead of success.

## Setup

### 1. Create OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Chrome Web Store API**
4. Create OAuth2 credentials (Desktop app type)
5. Note your **Client ID** and **Client Secret**

### 2. Get Refresh Token

Follow Google's [OAuth flow for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) using a local loopback redirect URI, PKCE, and the scope `https://www.googleapis.com/auth/chromewebstore`. Request offline access (`access_type=offline`; use `prompt=consent` when you need a new refresh token). Exchange the authorization code using the same redirect URI and keep the refresh token in your MCP client's secret/environment settings. The former copy-and-paste OOB redirect is no longer supported by Google.

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
| `CWS_DASHBOARD_PROFILE_DIR` | No | Browser profile path for UI automation (default: `~/.cws-mcp-profile`) |

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

### Hold publication until after approval
```
Use cws-mcp publish with:
- publishType="STAGED_PUBLISH"
```

### Publish with skip-review
```
Use cws-mcp publish with skipReview=true
```

`STAGED_PUBLISH` holds an approved submission for a later publication; it is not the rollout percentage. Use `deployPercentage` separately for an eligible extension's gradual rollout.

### Stop publishing on validation warnings

```
Use cws-mcp publish with blockOnWarnings=true
```

The default is `false`, matching the API. Inspect returned `warningInfo.warnings` even when publishing succeeds.

### Read or save listing fields without submitting for review

```
Use cws-mcp get-metadata-ui with headless=false
Use cws-mcp update-metadata with:
- description="..."
- category="Developer Tools"
- homepageUrl="https://example.com"
- supportUrl="https://example.com/support"
```

Notes:
- `category` must match the visible option label exactly in the current dashboard language; English and Korean field labels are supported.
- These tools read/save the **current dashboard draft**, not the published listing or an arbitrary locale. Select the intended localization in the dashboard first; ambiguous fields fail safely.
- Change title, summary, and default locale in `manifest.json` / localized messages, rebuild, and `upload` the ZIP. Use the dashboard directly for icons and screenshots.
- First run with `headless=false` if login is required.
- Browser profile path defaults to `~/.cws-mcp-profile` (override with `CWS_DASHBOARD_PROFILE_DIR`).
- Google Chrome must be installed. Dashboard UI changes can require selector updates; unverified saves return errors. Verify the dashboard before retrying an ambiguous failure.

### Staged rollout
```
1. Use cws-mcp publish with deployPercentage=10
2. Monitor approval/publication with status
3. Use cws-mcp deploy-percentage with percentage=50
4. Use cws-mcp deploy-percentage with percentage=100
```

Note: `deploy-percentage` is only available for extensions with 10,000+ seven-day active users. The new percentage must always be higher than the current target.

## Migrating from 1.x to 2.0

Google [shuts down API v1 on October 15, 2026](https://developer.chrome.com/docs/webstore/api/v1). Version 2.0 no longer calls it:

- `get` now returns v2 status. Its old `projection` argument is rejected; use `get-metadata-ui` for draft listing text. Published listing text is not exposed by v2.
- `update-metadata` now uses the same dashboard workflow as `update-metadata-ui` and therefore needs Chrome login, not just an API token.
- Raw `metadata`, `title`, `summary`, and `defaultLocale` inputs are rejected with guidance; unsupported inputs are never silently ignored.
- `storeIconPath` is no longer accepted as a working upload. The previous generic file-input approach could not verify which asset it changed; upload the icon in the Developer Dashboard instead.

## License

MIT
