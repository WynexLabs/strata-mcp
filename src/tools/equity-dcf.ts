import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Run a 2-stage DCF or Reverse-DCF valuation using caller-supplied inputs (manual mode — no live market data fetched). All inputs are numbers; use the /api/v1/equities/:ticker endpoints or strata_bond_spreads to source data if needed.

Modes:
  • "dcf" (default) — standard 2-stage Gordon-perpetuity DCF. Returns impliedPrice, upside, enterpriseValue, projectedYears.
  • "reverseDCF" — solves for the stage-1 growth rate implied by currentPrice. Requires currentPrice > 0. Returns impliedGrowthRatePct.

Required inputs:
  baseFCF             — trailing free cash flow to firm (same currency units as netDebt; can be negative)
  sharesOutstanding   — diluted shares outstanding (millions if baseFCF is in millions)

Optional inputs and defaults:
  projectionYears     — integer 1–30, default 5
  stage1GrowthPct     — stage-1 annual FCF growth rate %, default 5
  terminalGrowthPct   — Gordon perpetuity terminal growth rate %, default 2.5
  waccPct             — discount rate %, default 9. Must be > terminalGrowthPct.
  netDebt             — total debt minus cash (subtracted from enterprise value), default 0
  currentPrice        — share price for upside calculation and reverseDCF

Optional: scenarios (up to 10 bull/base/bear DCFs with probability-weighted price):
  Each scenario: { label?, stage1GrowthPct, terminalGrowthPct, waccPct, probabilityPct }
  Probabilities need not sum to 100 — the route normalises them.

Optional: sensitivity grid (2D implied price table for different WACC and terminal growth assumptions):
  sensitivity: { waccPct: [8, 9, 10, 11], terminalGrowthPct: [2, 2.5, 3] }
  Each axis capped at 15 steps (max 15×15 = 225 grid cells).

Returns: impliedPrice, upside, enterpriseValue, equityValue, sumPVProjectedFCFs, terminalValue, pvTerminalValue, projectedYears[], optional scenarios / sensitivity / reverseDCF objects, plus resolved inputs with data-provenance tags.`;

const scenarioCase = z.object({
  label: z.string().optional().describe("Scenario name (e.g. 'Bull', 'Base', 'Bear')."),
  stage1GrowthPct: z.number().describe("Stage-1 FCF growth rate for this scenario (%)."),
  terminalGrowthPct: z.number().describe("Terminal growth rate for this scenario (%)."),
  waccPct: z.number().describe("Discount rate for this scenario (%). Must be > terminalGrowthPct."),
  probabilityPct: z.number().min(0).max(100).describe("Probability weight (0–100). Route normalises all scenario weights."),
});

const sensitivityInput = z.object({
  waccPct: z
    .array(z.number())
    .max(15)
    .optional()
    .describe("WACC values to test (max 15). Example: [7, 8, 9, 10, 11]."),
  terminalGrowthPct: z
    .array(z.number())
    .max(15)
    .optional()
    .describe("Terminal growth values to test (max 15). Example: [2, 2.5, 3]."),
});

const inputShape = {
  baseFCF: z
    .number()
    .describe("Trailing free cash flow to firm (FCFF), in the same units as netDebt and sharesOutstanding. Can be negative."),
  sharesOutstanding: z
    .number()
    .positive()
    .describe("Diluted shares outstanding. Use the same unit scale as baseFCF (e.g. millions)."),
  projectionYears: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Stage-1 projection horizon in years (1–30, default 5)."),
  stage1GrowthPct: z
    .number()
    .optional()
    .describe("Stage-1 annual FCF growth rate in percent (default 5)."),
  terminalGrowthPct: z
    .number()
    .optional()
    .describe("Gordon perpetuity terminal growth rate in percent (default 2.5). Must be less than waccPct."),
  waccPct: z
    .number()
    .optional()
    .describe("Weighted average cost of capital in percent (default 9). Must be greater than terminalGrowthPct."),
  netDebt: z
    .number()
    .optional()
    .describe("Net debt (total debt minus cash). Subtracted from enterprise value to get equity value. Default 0. Can be negative (net cash position)."),
  currentPrice: z
    .number()
    .positive()
    .optional()
    .describe("Current share price. Used to compute upside and required for reverseDCF mode."),
  mode: z
    .enum(["dcf", "reverseDCF"])
    .optional()
    .describe('"dcf" (default) — implied price from inputs. "reverseDCF" — implied stage-1 growth rate from currentPrice.'),
  scenarios: z
    .array(scenarioCase)
    .max(10)
    .optional()
    .describe("Up to 10 bull/base/bear DCF scenarios. Returns per-scenario impliedPrice plus a probability-weighted composite price."),
  sensitivity: sensitivityInput
    .optional()
    .describe("2D sensitivity grid: supply waccPct and terminalGrowthPct arrays. Returns impliedPriceGrid[terminal][wacc]."),
} as const;

const inputZod = z.object(inputShape);

export function registerEquityDcf(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_equity_dcf",
    {
      title: "Equity DCF valuation (manual mode)",
      description,
      inputSchema: inputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = inputZod.safeParse(args);
      if (!parsed.success) {
        return toolErrorContent("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }
      try {
        const data = await client.post<unknown>("/api/v1/compute/equity/dcf", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
