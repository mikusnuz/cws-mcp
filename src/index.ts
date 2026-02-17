#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";

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

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
