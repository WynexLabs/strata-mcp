import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Price an American call or put using a Cox-Ross-Rubinstein binomial tree and return the option price plus the early-exercise boundary per non-terminal time step (S* — the spot price at which early exercise becomes optimal).

Output intentionally excludes per-node values — a 1000-step tree has ~500k nodes, which blows past MCP payload limits. Use price + boundary for analytics; re-call with fewer steps if you need visualization-grade detail.

All rates/yields are decimals; T in years; steps is an integer in [1, 1000], default 200.`;

const inputShape = {
  S: z.number().positive().describe("Current spot price of the underlying."),
  K: z.number().positive().describe("Strike price."),
  r: z.number().describe("Risk-free rate (decimal, continuous compounding)."),
  sigma: z.number().positive().describe("Volatility (decimal annualized)."),
  T: z.number().positive().describe("Time to expiry in years."),
  optionType: z.enum(["call", "put"]).describe("Option type."),
  q: z
    .number()
    .optional()
    .describe("Continuous dividend yield on the underlying (decimal). Default 0."),
  steps: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .describe("Number of binomial tree steps. Default 200; max 1000."),
} as const;

const inputZod = z.object(inputShape);

export function registerAmericanOption(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_american_option",
    {
      title: "American option price (CRR binomial tree)",
      description,
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const parsed = inputZod.safeParse(args);
      if (!parsed.success) {
        return toolErrorContent("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }
      try {
        const data = await client.post<unknown>("/api/v1/compute/option/american", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
