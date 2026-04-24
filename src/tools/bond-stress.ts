import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { bondCoreInputShape, curvePoint } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Reprice a fixed-rate coupon bond under named historical and non-parallel curve scenarios. Returns base dirty price plus per-scenario shifted price, percent price change, P&L, and percent of notional.

Built-in scenarios (all UST-calibrated): covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008 (historical) + bull-steepener, bear-steepener, bull-flattener, bear-flattener, positive-butterfly, negative-butterfly (non-parallel). Omit scenarioIds to run all 10; supply a subset of IDs to filter.

Base dirty price is discounted off the caller-supplied curvePoints (curve-mode pricing), not from a YTM — supply a zero curve consistent with the bond's currency. Non-USD bonds get scenario ΔP&L in the SAME direction as the scenario's bump, but the calibration is UST-based; use for directional risk, not trading.

To populate curvePoints, search the web for current Treasury zero rates (USD) or ECB AAA zero rates (EUR). Typical USD tenors: 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30 years. A minimum of 2 points is required; more tenors give more accurate interpolation. zeroPct values are in percent (e.g. 4.5 for 4.5%), continuous compounding.`;

const inputShape = {
  ...bondCoreInputShape,
  curvePoints: z
    .array(curvePoint)
    .min(2)
    .describe(
      "Zero curve as an array of {t (years, > 0), zeroPct (percent, continuous compounding)} points. Minimum 2 points.",
    ),
  scenarioIds: z
    .array(z.string())
    .optional()
    .describe(
      "Optional filter. Known IDs: covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008, bull-steepener, bear-steepener, bull-flattener, bear-flattener, positive-butterfly, negative-butterfly. Omit to run all.",
    ),
} as const;

const inputZod = z.object(inputShape);

export function registerBondStress(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_stress",
    {
      title: "Bond named-scenario stress testing",
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
        const data = await client.post<unknown>("/api/v1/compute/bond/stress", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
