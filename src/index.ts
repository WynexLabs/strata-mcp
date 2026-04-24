#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

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

  const server = createServer({ apiKey, baseUrl });
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
  process.stderr.write(`strata-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
