# Chrome Web Store Extension Management

This project uses **cws-mcp** to manage Chrome Web Store extensions via MCP tools.

## Available Tools

Use `mcp__cws-mcp__<tool>` for all Chrome Web Store operations:

| Tool | When to Use |
|---|---|
| `upload` | Upload a new ZIP build to Chrome Web Store as a draft |
| `publish` | Publish the current draft to users (supports staged rollout) |
| `status` | Check review state, published version, deploy percentage |
| `cancel` | Cancel a pending review submission |
| `deploy-percentage` | Increase staged rollout percentage (10 -> 50 -> 100) |
| `get` | Alias of status; not listing text, projection unsupported |
| `get-metadata-ui` | Read current draft description, category, homepage URL and support URL |
| `update-metadata` | Save supported draft fields through the dashboard and verify after reload |
| `update-metadata-ui` | Alias of update-metadata |

## Common Workflows

### Build and publish a new version
1. Build the extension ZIP
2. `upload` with the ZIP path
3. `status` to confirm upload succeeded
4. `publish` to submit for review

### Staged rollout
1. `publish` with `deployPercentage=10` for an eligible extension
2. Monitor with `status`
3. Increase with `deploy-percentage` (10 -> 50 -> 100)

### Update store listing
1. Use `get-metadata-ui` to read the current draft, then `update-metadata` for description, category, homepageUrl or supportUrl
2. `publish` if changes need to go live

## Important Notes

- Always `status` before `publish` to check current state
- `deploy-percentage` only works for extensions with 10,000+ weekly active users
- Rollout percentage can only increase, never decrease
- Dashboard tools require Chrome and headless=false on first run for Google login; category must match the visible option exactly
- Saving never submits for review; unverified results return errors
- Title/summary/defaultLocale require manifest or localized-message edits and a new ZIP upload
- Icons/screenshots require the Developer Dashboard; raw metadata and storeIconPath are unsupported
- STAGED_PUBLISH holds publication after approval, independently of rollout percentage
- publish blockOnWarnings=true stops on validation warnings; default false
