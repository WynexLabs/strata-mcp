#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

async function main(): Promise<void> {
  const apiKey = process.env.STRATA_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "strata-mcp: STRATA_API_KEY environment variable is required.\n" +
        "Get a key at https://project-strata.wynexlabs.studio/account (API Keys section).\n",
    );
    process.exit(1);
  }

  const baseUrl = process.env.STRATA_API_BASE?.trim() || undefined;
  const timeoutMs = parsePositiveInt(process.env.STRATA_API_TIMEOUT_MS);
  const maxBytes = parsePositiveInt(process.env.STRATA_MAX_BYTES);

  let server;
  try {
    server = createServer({ apiKey, baseUrl, timeoutMs, maxBytes });
  } catch (err) {
    process.stderr.write(`strata-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();

  const shutdown = async (): Promise<void> => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await server.connect(transport);
  process.stderr.write(
    `strata-mcp ready on stdio (base: ${baseUrl ?? "https://project-strata.wynexlabs.studio"}).\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`strata-mcp fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
