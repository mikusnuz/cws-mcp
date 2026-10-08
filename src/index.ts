#!/usr/bin/env node

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, realpathSync } from "fs";
import { readDashboardMetadata, updateDashboardMetadata, validateDashboardUpdate, withDashboard } from "./dashboard.js";
import { homedir } from "os";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Version ──

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));
const VERSION: string = pkg.version;

// ── Config ──

const CLIENT_ID = process.env.CWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.CWS_REFRESH_TOKEN || "";
const PUBLISHER_ID = process.env.CWS_PUBLISHER_ID || "me";
const DEFAULT_ITEM_ID = process.env.CWS_ITEM_ID || "";

const API_BASE = "https://chromewebstore.googleapis.com";
const UPLOAD_BASE = "https://chromewebstore.googleapis.com/upload/v2";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DASHBOARD_PROFILE_DIR =
  process.env.CWS_DASHBOARD_PROFILE_DIR || resolve(homedir(), ".cws-mcp-profile");

// ── OAuth2 Token Management ──

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      "Missing OAuth2 credentials. Set CWS_CLIENT_ID, CWS_CLIENT_SECRET, and CWS_REFRESH_TOKEN.",
    );
  }

  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: REFRESH_TOKEN,
    grant_type: "refresh_token",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.access_token;
}

// ── Helpers ──

function resolveItemId(itemId?: string): string {
  const id = itemId || DEFAULT_ITEM_ID;
  if (!id) {
    throw new Error(
      "No item ID provided. Pass itemId parameter or set CWS_ITEM_ID env var.",
    );
  }
  return id;
}

function resolvePublisherId(publisherId?: string): string {
  return publisherId || PUBLISHER_ID;
}

async function apiCall(
  url: string,
  options: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...(options.headers as Record<string, string> || {}),
  };

  const res = await fetch(url, { ...options, headers, signal: options.signal ?? AbortSignal.timeout(30_000) });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

/** Format API response with structured error info when applicable */
function formatResponse(result: { ok: boolean; status: number; body: string }): {
  content: { type: "text"; text: string }[];
  isError: boolean;
} {
  if (result.ok) {
    return {
      content: [{ type: "text" as const, text: result.body }],
      isError: false,
    };
  }

  // Try to parse error body for a more readable message
  let errorDetail = result.body;
  try {
    const parsed = JSON.parse(result.body);
    if (parsed.error?.message) {
      errorDetail = `${parsed.error.message} (code: ${parsed.error.code || result.status})`;
    }
  } catch {
    // Keep raw body
  }

  return {
    content: [{ type: "text" as const, text: `API Error (${result.status}): ${errorDetail}` }],
    isError: true,
  };
}

const dashboardOptions = {
  itemId: z.string().optional().describe("Extension item ID"),
  accountIndex: z.number().int().min(0).max(9).optional().describe("Google account index"),
  headless: z.boolean().optional().describe("Run browser headless; use false for the first sign-in"),
};
const metadataSchema = {
  ...dashboardOptions,
  description: z.string().optional().describe("Detailed store listing description"),
  category: z.string().optional().describe("Exact category label displayed by the dashboard"),
  homepageUrl: z.string().optional().describe("Homepage URL; empty string clears it"),
  supportUrl: z.string().optional().describe("Support URL; empty string clears it"),
  title: z.string().optional().describe("Unsupported: change manifest name and upload a new ZIP"),
  summary: z.string().optional().describe("Unsupported: change manifest description and upload a new ZIP"),
  defaultLocale: z.string().optional().describe("Unsupported: change manifest default_locale and upload a new ZIP"),
  metadata: z.record(z.unknown()).optional().describe("Unsupported: use the explicit dashboard fields"),
  storeIconPath: z.string().optional().describe("Unsupported: upload the store icon directly in the dashboard"),
};
const getSchema = {
  itemId: z.string().optional().describe("Extension item ID"),
  publisherId: z.string().optional().describe("Publisher ID"),
  projection: z.enum(["DRAFT", "PUBLISHED"]).optional().describe("Removed in 2.0; use get-metadata-ui for current draft listing text"),
};

// ── MCP Server ──

export function createServer() {
const server = new McpServer({
  name: "cws-mcp",
  version: VERSION,
});

// ── upload ──
server.tool(
  "upload",
  "Upload a ZIP file to update an existing Chrome Web Store item draft. Note: Creating new items via API is not supported in v2 — use the Developer Dashboard to create new items.",
  {
    zipPath: z.string().describe("Absolute path to the ZIP file to upload"),
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
  },
  async ({ zipPath, itemId, publisherId }) => {
    try {
      const id = resolveItemId(itemId);
      const pub = resolvePublisherId(publisherId);
      const zipData = readFileSync(zipPath);

      const url = `${UPLOAD_BASE}/publishers/${pub}/items/${id}:upload`;

      const result = await apiCall(url, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: zipData,
        signal: AbortSignal.timeout(15 * 60_000),
      });

      return formatResponse(result);
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── publish ──
server.tool(
  "publish",
  "Publish an extension to Chrome Web Store. Supports immediate publish, staged publish, initial deploy percentage, and skip-review.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
    publishType: z
      .enum(["DEFAULT_PUBLISH", "STAGED_PUBLISH"])
      .optional()
      .describe(
        "DEFAULT_PUBLISH: publishes immediately after approval. STAGED_PUBLISH: stages for manual publishing after approval. Defaults to DEFAULT_PUBLISH."
      ),
    deployPercentage: z
      .number()
      .int()
      .min(0)
      .max(100)
      .optional()
      .describe("Initial deploy percentage for staged rollout (0-100). Only used with STAGED_PUBLISH or DEFAULT_PUBLISH."),
    skipReview: z
      .boolean()
      .optional()
      .describe("Attempt to skip review if the extension qualifies. Defaults to false."),
    blockOnWarnings: z.boolean().optional().describe("Reject publishing when validation returns warnings (default: false)"),
  },
  async ({ itemId, publisherId, publishType, deployPercentage, skipReview, blockOnWarnings }) => {
    try {
      const id = resolveItemId(itemId);
      const pub = resolvePublisherId(publisherId);

      const url = `${API_BASE}/v2/publishers/${pub}/items/${id}:publish`;

      const body: Record<string, unknown> = {};
      if (publishType) body.publishType = publishType;
      if (deployPercentage !== undefined) {
        body.deployInfos = [{ deployPercentage }];
      }
      if (skipReview !== undefined) body.skipReview = skipReview;
      if (blockOnWarnings !== undefined) body.blockOnWarnings = blockOnWarnings;

      const hasBody = Object.keys(body).length > 0;

      const result = await apiCall(url, {
        method: "POST",
        ...(hasBody
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });

      return formatResponse(result);
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── status ──
server.tool(
  "status",
  "Fetch the current status of an extension on Chrome Web Store. Returns published/submitted revision status, deploy percentage, version, takedown/warning flags, and last upload state.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
  },
  async ({ itemId, publisherId }) => {
    try {
      const id = resolveItemId(itemId);
      const pub = resolvePublisherId(publisherId);

      const url = `${API_BASE}/v2/publishers/${pub}/items/${id}:fetchStatus`;
      const result = await apiCall(url, { method: "GET" });

      return formatResponse(result);
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── cancel ──
server.tool(
  "cancel",
  "Cancel a pending submission on Chrome Web Store. Can be used to cancel an item currently in review.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
  },
  async ({ itemId, publisherId }) => {
    try {
      const id = resolveItemId(itemId);
      const pub = resolvePublisherId(publisherId);

      const url = `${API_BASE}/v2/publishers/${pub}/items/${id}:cancelSubmission`;
      const result = await apiCall(url, { method: "POST" });

      return formatResponse(result);
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── deploy-percentage ──
server.tool(
  "deploy-percentage",
  "Set the published deploy percentage for staged rollout on Chrome Web Store. The new percentage must be higher than the current target. Only available for items with 10,000+ seven-day active users.",
  {
    percentage: z
      .number()
      .min(0)
      .max(100)
      .describe("Deploy percentage (0-100). Must be larger than the current target percentage."),
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
  },
  async ({ percentage, itemId, publisherId }) => {
    try {
      const id = resolveItemId(itemId);
      const pub = resolvePublisherId(publisherId);

      const url = `${API_BASE}/v2/publishers/${pub}/items/${id}:setPublishedDeployPercentage`;
      const result = await apiCall(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deployPercentage: percentage }),
      });

      return formatResponse(result);
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── Metadata and v2 status compatibility ──
server.tool(
  "get",
  "Fetch publication status through v2 (alias of status). Version 2 no longer returns listing metadata or supports projection; use get-metadata-ui for draft listing text.",
  getSchema,
  async ({ itemId, publisherId, projection }) => {
    try {
      if (projection !== undefined) {
        throw new Error("projection was removed in 2.0. get now returns v2 publication status. Use get-metadata-ui for draft listing text; published listing text is not exposed by the API.");
      }
      return formatResponse(await apiCall(`${API_BASE}/v2/publishers/${resolvePublisherId(publisherId)}/items/${resolveItemId(itemId)}:fetchStatus`, { method: "GET" }));
    } catch (error) {
      return { content: [{ type: "text" as const, text: String(error) }], isError: true };
    }
  },
);

server.tool(
  "get-metadata-ui",
  "Read the current draft listing description, category, homepage and support URL from the signed-in Developer Dashboard. This is not the published listing.",
  dashboardOptions,
  async ({ itemId, accountIndex, headless }) => {
    try {
      const metadata = await withDashboard({
        itemId: resolveItemId(itemId), profileDir: DASHBOARD_PROFILE_DIR, accountIndex, headless,
      }, readDashboardMetadata);
      return { content: [{ type: "text" as const, text: JSON.stringify({ mode: "dashboard-ui", projection: "DRAFT", metadata }) }] };
    } catch (error) {
      return { content: [{ type: "text" as const, text: String(error) }], isError: true };
    }
  },
);

for (const name of ["update-metadata", "update-metadata-ui"]) {
  server.tool(
    name,
    "Save draft listing description, category, homepage or support URL via the signed-in Developer Dashboard, then reload to verify. Does not submit for review. Package title/summary, raw payloads, and icon uploads are unsupported.",
    metadataSchema,
    async (args) => {
      try {
        validateDashboardUpdate(args);
        const result = await withDashboard({
          itemId: resolveItemId(args.itemId), profileDir: DASHBOARD_PROFILE_DIR,
          accountIndex: args.accountIndex, headless: args.headless,
        }, page => updateDashboardMetadata(page, args));
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: false };
      } catch (error) {
        return { content: [{ type: "text" as const, text: String(error) }], isError: true };
      }
    },
  );
}

// ── Resources ──

server.resource(
  "extension-status",
  new ResourceTemplate("cws://extensions/{extensionId}", { list: undefined }),
  { description: "Chrome Web Store v2 publication and rollout status; listing text is not provided by the API.", mimeType: "application/json" },
  async (uri, variables) => {
    const extensionId = String(variables.extensionId);
    const result = await apiCall(`${API_BASE}/v2/publishers/${resolvePublisherId()}/items/${encodeURIComponent(extensionId)}:fetchStatus`, { method: "GET" });
    if (!result.ok) throw new Error(`Chrome Web Store status failed (${result.status}): ${result.body}`);
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: result.body }] };
  },
);

// ── Prompts ──

server.prompt(
  "publish_extension",
  "Step-by-step guide for publishing or updating a Chrome extension on the Chrome Web Store. Walks through upload, metadata update, and publish steps.",
  {
    extensionId: z.string().describe("The Chrome Web Store extension item ID"),
    zipPath: z.string().describe("Absolute path to the built extension ZIP file"),
    version: z.string().optional().describe("New version string (e.g. '1.2.0') for context"),
  },
  ({ extensionId, zipPath, version }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Please help me publish my Chrome extension to the Chrome Web Store.

Extension ID: ${extensionId}
ZIP file: ${zipPath}${version ? `\nNew version: ${version}` : ""}

Follow these steps using the available cws-mcp tools:

1. **Upload the ZIP** — Use the \`upload\` tool with zipPath="${zipPath}" and itemId="${extensionId}" to upload the new build as a draft.
2. **Verify upload** — Use the \`status\` tool to confirm the upload succeeded and the item is in DRAFT state.
3. **Check/update metadata** — Use \`get-metadata-ui\` for current draft listing fields, and \`update-metadata\` to save supported changes. Title and summary come from the ZIP manifest. Saving listing fields does not submit for review.
4. **Publish** — Use \`publish\` to submit for review. Set blockOnWarnings=true to stop on validation warnings. Use publishType="STAGED_PUBLISH" to hold publication after approval; rollout percentage is controlled separately.
5. **Confirm submission** — Use the \`status\` tool again to confirm the item entered review queue.
6. **Optional staged rollout** — After approval, use \`deploy-percentage\` to gradually roll out (e.g., 10%, 50%, 100%).

Please start with step 1 now.`,
        },
      },
    ],
  }),
);

server.prompt(
  "check_status",
  "Check the review status and deployment percentage of a Chrome extension, and surface any actionable next steps.",
  {
    extensionId: z.string().describe("The Chrome Web Store extension item ID"),
  },
  ({ extensionId }) => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text: `Please check the current status of my Chrome extension.

Extension ID: ${extensionId}

Use the following cws-mcp tools to gather a full picture:

1. **Fetch status** — Use the \`status\` tool with itemId="${extensionId}" to get the review status and any rejection reasons.
2. **Inspect publication** — Read the published/submitted revisions from the status response. Listing text is not exposed by v2; \`get-metadata-ui\` reads the current dashboard draft, not the live listing.
3. **Summarize** — Report:
   - Current review state (e.g., IN_REVIEW, PUBLISHED, REJECTED, DRAFT)
   - Deployed version and deploy percentage if in staged rollout
   - Any rejection reason or action required
   - Recommended next steps (e.g., fix policy violations, increase deploy-percentage, or no action needed)

Please start with step 1 now.`,
        },
      },
    ],
  }),
);

return server;
}

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
}

if (process.argv[1] && realpathSync(process.argv[1]) === __filename) main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});

// ── Smithery Sandbox ──

export function createSandboxServer() {
  const sandbox = new McpServer({
    name: "cws-mcp",
    version: VERSION,
  });

  const noop = async () => ({ content: [{ type: "text" as const, text: "sandbox" }] });

  sandbox.tool("upload", "Upload a ZIP file to update an existing Chrome Web Store item draft.", {
    zipPath: z.string().describe("Absolute path to the ZIP file to upload"),
    itemId: z.string().optional().describe("Extension item ID"),
    publisherId: z.string().optional().describe("Publisher ID"),
  }, noop);

  sandbox.tool("publish", "Publish an extension to Chrome Web Store.", {
    itemId: z.string().optional().describe("Extension item ID"),
    publisherId: z.string().optional().describe("Publisher ID"),
    publishType: z.enum(["DEFAULT_PUBLISH", "STAGED_PUBLISH"]).optional().describe("Publish type"),
    deployPercentage: z.number().int().min(0).max(100).optional().describe("Initial deploy percentage"),
    skipReview: z.boolean().optional().describe("Attempt to skip review"),
    blockOnWarnings: z.boolean().optional().describe("Reject publishing on validation warnings"),
  }, noop);

  sandbox.tool("status", "Fetch the current status of an extension on Chrome Web Store.", {
    itemId: z.string().optional().describe("Extension item ID"),
    publisherId: z.string().optional().describe("Publisher ID"),
  }, noop);

  sandbox.tool("cancel", "Cancel a pending submission on Chrome Web Store.", {
    itemId: z.string().optional().describe("Extension item ID"),
    publisherId: z.string().optional().describe("Publisher ID"),
  }, noop);

  sandbox.tool("deploy-percentage", "Set the published deploy percentage for staged rollout.", {
    percentage: z.number().min(0).max(100).describe("Deploy percentage (0-100)"),
    itemId: z.string().optional().describe("Extension item ID"),
    publisherId: z.string().optional().describe("Publisher ID"),
  }, noop);

  sandbox.tool("get", "Read v2 publication status; listing metadata and projection are not supported.", getSchema, noop);
  sandbox.tool("get-metadata-ui", "Read current draft listing fields from the Developer Dashboard.", dashboardOptions, noop);
  sandbox.tool("update-metadata", "Save and verify draft listing fields through the Developer Dashboard.", metadataSchema, noop);
  sandbox.tool("update-metadata-ui", "Save and verify draft listing fields through the Developer Dashboard.", metadataSchema, noop);

  return sandbox;
}
