#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { chromium, type Page } from "playwright";
import { homedir } from "os";
import { resolve } from "path";

// ── Config ──

const CLIENT_ID = process.env.CWS_CLIENT_ID || "";
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.CWS_REFRESH_TOKEN || "";
const PUBLISHER_ID = process.env.CWS_PUBLISHER_ID || "me";
const DEFAULT_ITEM_ID = process.env.CWS_ITEM_ID || "";

const API_BASE = "https://chromewebstore.googleapis.com";
const UPLOAD_BASE = "https://chromewebstore.googleapis.com/upload/v2";
const V1_BASE = "https://www.googleapis.com/chromewebstore/v1.1";
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

  const res = await fetch(url, { ...options, headers });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fillTextFieldByLabel(page: Page, labels: string[], value: string) {
  const parts = labels.map(escapeRegExp).join("|");
  const regex = new RegExp(parts, "i");
  const locator = page.getByLabel(regex).first();
  if ((await locator.count()) === 0) {
    throw new Error(`Unable to locate field by labels: ${labels.join(", ")}`);
  }
  await locator.fill(value);
}

async function clickSaveButton(page: Page) {
  const saveBtn = page.getByRole("button", { name: /save|저장/i }).first();
  if ((await saveBtn.count()) === 0) {
    throw new Error("Save button not found on dashboard page.");
  }
  await saveBtn.click();
  await page.waitForTimeout(2000);
}

// ── MCP Server ──

const server = new McpServer({
  name: "cws-mcp",
  version: "1.1.0",
});

// ── upload ──
server.tool(
  "upload",
  "Upload a ZIP file to Chrome Web Store. If itemId is provided, updates an existing item. If omitted, creates a new item.",
  {
    zipPath: z.string().describe("Absolute path to the ZIP file to upload"),
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID. Omit to create a new item."),
    publisherId: z
      .string()
      .optional()
      .describe("Publisher ID (defaults to CWS_PUBLISHER_ID env var or 'me')"),
  },
  async ({ zipPath, itemId, publisherId }) => {
    try {
      const pub = resolvePublisherId(publisherId);
      const zipData = readFileSync(zipPath);

      const id = itemId || DEFAULT_ITEM_ID;
      const url = id
        ? `${UPLOAD_BASE}/publishers/${pub}/items/${id}:upload`
        : `${UPLOAD_BASE}/publishers/${pub}/items:upload`;

      const result = await apiCall(url, {
        method: "POST",
        headers: { "Content-Type": "application/zip" },
        body: zipData,
      });

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
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
  "Publish an extension to Chrome Web Store. The item must have a draft ready.",
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

      const url = `${API_BASE}/v2/publishers/${pub}/items/${id}:publish`;
      const result = await apiCall(url, { method: "POST" });

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
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
  "Fetch the current status of an extension on Chrome Web Store.",
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

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
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
  "Cancel a pending submission on Chrome Web Store.",
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

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
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
  "Set the published deploy percentage for staged rollout on Chrome Web Store.",
  {
    percentage: z
      .number()
      .min(0)
      .max(100)
      .describe("Deploy percentage (0-100)"),
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

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── get (v1) ──
server.tool(
  "get",
  "Get the current metadata of a Chrome Web Store item (v1 API). Returns description, category, and other listing fields.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    projection: z
      .enum(["DRAFT", "PUBLISHED"])
      .optional()
      .describe("Metadata projection to fetch (defaults to DRAFT)"),
  },
  async ({ itemId, projection }) => {
    try {
      const id = resolveItemId(itemId);
      const p = projection || "DRAFT";
      const url = `${V1_BASE}/items/${id}?projection=${encodeURIComponent(p)}`;
      const result = await apiCall(url, { method: "GET" });

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── update-metadata (v1) ──
server.tool(
  "update-metadata",
  "Update the store listing metadata of a Chrome Web Store item (v1 API). Supports both common fields and raw metadata payload for advanced fields.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    title: z
      .string()
      .optional()
      .describe("Store listing title"),
    summary: z
      .string()
      .optional()
      .describe("Store listing short summary"),
    description: z
      .string()
      .optional()
      .describe("Store listing description"),
    category: z
      .string()
      .optional()
      .describe("Category (e.g. 'productivity', 'developer_tools')"),
    defaultLocale: z
      .string()
      .optional()
      .describe("Default locale (e.g. 'ko', 'en')"),
    homepageUrl: z
      .string()
      .optional()
      .describe("Homepage URL"),
    supportUrl: z
      .string()
      .optional()
      .describe("Support URL"),
    metadata: z
      .record(z.unknown())
      .optional()
      .describe(
        "Raw metadata object forwarded as-is to the v1 API. Useful for fields not exposed as first-class params."
      ),
  },
  async ({
    itemId,
    title,
    summary,
    description,
    category,
    defaultLocale,
    homepageUrl,
    supportUrl,
    metadata,
  }) => {
    try {
      const id = resolveItemId(itemId);
      const url = `${V1_BASE}/items/${id}`;

      const payload: Record<string, unknown> = {
        ...(metadata || {}),
      };
      if (title !== undefined) payload.title = title;
      if (summary !== undefined) payload.summary = summary;
      if (description !== undefined) payload.description = description;
      if (category !== undefined) payload.category = category;
      if (defaultLocale !== undefined) payload.defaultLocale = defaultLocale;
      if (homepageUrl !== undefined) payload.homepageUrl = homepageUrl;
      if (supportUrl !== undefined) payload.supportUrl = supportUrl;

      if (Object.keys(payload).length === 0) {
        throw new Error("No metadata fields provided.");
      }

      const result = await apiCall(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      return {
        content: [{ type: "text" as const, text: result.body }],
        isError: !result.ok,
      };
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  },
);

// ── update-metadata-ui (dashboard automation) ──
server.tool(
  "update-metadata-ui",
  "Update listing metadata via Chrome Web Store dashboard UI automation (Playwright). Use this when API metadata updates are not reflected.",
  {
    itemId: z
      .string()
      .optional()
      .describe("Extension item ID (defaults to CWS_ITEM_ID env var)"),
    title: z.string().optional().describe("Store listing title"),
    summary: z.string().optional().describe("Store listing short summary"),
    description: z.string().optional().describe("Store listing long description"),
    category: z.string().optional().describe("Category label as shown in dashboard UI"),
    homepageUrl: z.string().optional().describe("Homepage URL"),
    supportUrl: z.string().optional().describe("Support URL"),
    accountIndex: z
      .number()
      .int()
      .min(0)
      .max(9)
      .optional()
      .describe("Google account index in dashboard URL (default: 0)"),
    headless: z
      .boolean()
      .optional()
      .describe("Run browser headless (default: false)"),
  },
  async ({
    itemId,
    title,
    summary,
    description,
    category,
    homepageUrl,
    supportUrl,
    accountIndex,
    headless,
  }) => {
    try {
      const id = resolveItemId(itemId);
      const idx = accountIndex ?? 0;
      const dashboardUrl = `https://chromewebstore.google.com/u/${idx}/dashboard/${id}/edit`;

      const hasAnyField = [title, summary, description, category, homepageUrl, supportUrl].some(
        (v) => typeof v === "string" && v.trim().length > 0
      );
      if (!hasAnyField) {
        throw new Error("No fields provided for UI update.");
      }

      const context = await chromium.launchPersistentContext(DASHBOARD_PROFILE_DIR, {
        channel: "chrome",
        headless: headless ?? false,
      });

      try {
        const page = context.pages()[0] || (await context.newPage());
        await page.goto(dashboardUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForTimeout(2500);

        if (page.url().includes("accounts.google.com")) {
          throw new Error(
            `Not signed in to Chrome Web Store dashboard. Open once with headless=false and sign in. Profile dir: ${DASHBOARD_PROFILE_DIR}`
          );
        }

        if (title?.trim()) {
          await fillTextFieldByLabel(page, ["Title", "제목", "Name", "이름"], title.trim());
        }
        if (summary?.trim()) {
          await fillTextFieldByLabel(
            page,
            ["Summary", "Short description", "요약", "짧은 설명"],
            summary.trim()
          );
        }
        if (description?.trim()) {
          await fillTextFieldByLabel(page, ["Description", "설명"], description.trim());
        }
        if (homepageUrl?.trim()) {
          await fillTextFieldByLabel(page, ["Homepage", "홈페이지"], homepageUrl.trim());
        }
        if (supportUrl?.trim()) {
          await fillTextFieldByLabel(page, ["Support", "지원", "Help", "도움말"], supportUrl.trim());
        }

        if (category?.trim()) {
          const categoryCombo = page
            .getByRole("combobox", { name: /category|카테고리/i })
            .first();
          if ((await categoryCombo.count()) > 0) {
            await categoryCombo.click();
            const option = page.getByRole("option", { name: new RegExp(escapeRegExp(category), "i") }).first();
            if ((await option.count()) > 0) {
              await option.click();
            }
          }
        }

        await clickSaveButton(page);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  ok: true,
                  mode: "dashboard-ui",
                  profileDir: DASHBOARD_PROFILE_DIR,
                  url: page.url(),
                },
                null,
                2
              ),
            },
          ],
          isError: false,
        };
      } finally {
        await context.close();
      }
    } catch (e: any) {
      return {
        content: [{ type: "text" as const, text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
