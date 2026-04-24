import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Price a European option under Black-Scholes-Merton and return the price + full Greeks (delta, gamma, theta, vega, rho). If marketPrice is supplied, additionally returns an implied volatility solved from the BSM pricing equation.

All rates and volatilities are decimals (e.g. 0.05 for 5%, not 5). T is in years. q (continuous dividend yield) defaults to 0.`;

const inputShape = {
  S: z.number().positive().describe("Current spot price of the underlying."),
  K: z.number().positive().describe("Strike price."),
  r: z.number().describe("Risk-free rate (decimal, continuous compounding)."),
  sigma: z.number().positive().describe("Volatility (decimal annualized)."),
  T: z.number().positive().describe("Time to expiry in years."),
  type: z.enum(["call", "put"]).describe("Option type."),
  q: z
    .number()
    .optional()
    .describe("Continuous dividend yield on the underlying (decimal). Default 0."),
  marketPrice: z
    .number()
    .nonnegative()
    .optional()
    .describe("If provided, the route additionally solves implied volatility from this market price."),
} as const;

const inputZod = z.object(inputShape);

export function registerBsm(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bsm",
    {
      title: "BSM European option price + Greeks (+ IV solver)",
      description,
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const parsed = inputZod.safeParse(args);
      if (!parsed.success) {
        return toolErrorContent("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }
      const { q, ...rest } = parsed.data;
      try {
        const data = await client.post<unknown>("/api/v1/compute/bsm", { ...rest, delta: q });
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
