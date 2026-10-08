# Chrome Web Store Extension Management

This project uses **cws-mcp** to manage Chrome Web Store extensions via MCP tools.

## Available Tools

Use `mcp__cws-mcp__<tool>` for all Chrome Web Store operations:

- `upload` — Upload a ZIP file to Chrome Web Store (updates existing item draft)
- `publish` — Publish an extension with optional staged rollout and skip-review
- `status` — Fetch current status: review state, deploy percentage, version
- `cancel` — Cancel a pending submission
- `deploy-percentage` — Set staged rollout percentage (0-100, must exceed current)
- `get` — Alias of status, not listing text; projection is unsupported
- `get-metadata-ui` — Read current draft description, category, homepage URL and support URL
- `update-metadata` — Save supported draft fields through the dashboard and verify after reload
- `update-metadata-ui` — Alias of update-metadata

## Common Workflows

### Build and publish a new version
1. Build the extension ZIP
2. Call `upload` with the ZIP path
3. Call `status` to confirm upload succeeded
4. Call `publish` to submit for review

### Staged rollout
1. Call `publish` with `deployPercentage=10` for an eligible extension
2. Monitor with `status`
3. Increase with `deploy-percentage` (10 -> 50 -> 100)

### Update store listing
1. Use `get-metadata-ui` to read the current draft, then `update-metadata` for description, category, homepageUrl or supportUrl
2. Call `publish` if changes need to go live

## Rules

- Always check `status` before `publish` to verify current state
- `deploy-percentage` only works for extensions with 10,000+ weekly active users
- Rollout percentage can only increase, never decrease
- Dashboard tools require Chrome and headless=false on first run for Google login; category must match the visible option exactly
- Saving never submits for review; unverified results return errors
- Title/summary/defaultLocale require manifest or localized-message edits and a new ZIP upload
- Icons/screenshots require the Developer Dashboard; raw metadata and storeIconPath are unsupported
- STAGED_PUBLISH holds publication after approval, independently of rollout percentage
- publish blockOnWarnings=true stops on validation warnings; default false
