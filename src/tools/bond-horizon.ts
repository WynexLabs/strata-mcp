import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { bondCoreInputShape, isoDate } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Decompose a fixed-rate bond's total return over a user-specified horizon into carry + roll-down + price + reinvestment components. Also returns a scenario grid of total returns across a yield-change grid.

Required: activeYtmPct (the current YTM at which the bond is marked) and horizonDate (ISO date, must be after settlementDate). horizonYieldChangeBp and horizonSpreadChangeBp default to 0. reinvestmentRatePct defaults to activeYtmPct. scenariosBp defaults to [-50, -25, 0, 25, 50].

The decomposition identity (carry + roll + price + reinvest = totalPnl) closes in dirty-price space (post-2026-04-23 fix). horizonDate past maturity is clamped to maturity and reported as held-to-maturity.`;

const inputShape = {
  ...bondCoreInputShape,
  horizonDate: isoDate.describe(
    "Horizon date (YYYY-MM-DD). Must be after settlementDate. If past maturityDate, clamped to maturity.",
  ),
  activeYtmPct: z
    .number()
    .describe("Current yield-to-maturity of the bond in percent, at which the position is marked."),
  horizonYieldChangeBp: z
    .number()
    .optional()
    .describe("Assumed yield change at horizon, in basis points. Default 0."),
  horizonSpreadChangeBp: z
    .number()
    .optional()
    .describe("Assumed spread change at horizon, in basis points. Optional; only meaningful in curve+spread context."),
  reinvestmentRatePct: z
    .number()
    .optional()
    .describe(
      "Rate at which coupons are reinvested (percent). Defaults to activeYtmPct (market-rate reinvestment convention).",
    ),
  scenariosBp: z
    .array(z.number())
    .optional()
    .describe(
      "Yield-change scenarios (basis points) for the scenario grid. Default [-50, -25, 0, 25, 50].",
    ),
} as const;

const inputZod = z.object(inputShape);

export function registerBondHorizon(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_horizon",
    {
      title: "Bond horizon return decomposition",
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
        const data = await client.post<unknown>("/api/v1/compute/bond/horizon", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
