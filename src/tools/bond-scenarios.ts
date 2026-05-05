import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { priceBondInputShape } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Run a bundle of named historical and non-parallel curve stress scenarios on a fixed-rate bond. Returns the base price plus, for each scenario, the shifted price, new YTM, percent price change, modified-duration delta, P&L, and percent of notional.

No curve required — the route synthesises a flat zero curve from the bond's YTM (or solves YTM from cleanPrice) and then bumps it per scenario. Optionally supply creditSpreadBps to shift the flat base level up by the credit spread before applying rate shocks (spread is held fixed during each scenario).

Built-in scenarios (10 total):
  Historical: covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008
  Non-parallel: bull-steepener, bear-steepener, bull-flattener, bear-flattener, positive-butterfly, negative-butterfly

Omit scenarioIds to run all 10; supply a subset of IDs to filter.

Caveats:
  • Flat-zero approximation: base repricing uses a flat curve anchored at YTM, not a full term structure. Scenario rankings are valid; absolute ΔP values carry a small model-mixing bias for non-par bonds.
  • Curve calibration is UST-based. For non-USD bonds, scenario ΔP moves in the correct direction but magnitudes are not currency-specific.
  • fed-hike-cycle-2022 calibration is conservative — actual 2022 P&L was worse. Use for ordered ranking, not absolute drawdown forecasting.

Per-scenario output fields: id, label, description, category, caveat, rateShockBps, spreadShockBps, newPrice, newCleanPrice, newYtm, priceChangePct, deltaModDur, pnl, pctNotional.`;

const inputShape = {
  ...priceBondInputShape,
  creditSpreadBps: z
    .number()
    .optional()
    .describe(
      "Credit spread in basis points added to the flat-zero base level (default 0). Spread is held constant across scenarios — only rates are shocked.",
    ),
  scenarioIds: z
    .array(z.string())
    .optional()
    .describe(
      "Optional filter. Known IDs: covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008, bull-steepener, bear-steepener, bull-flattener, bear-flattener, positive-butterfly, negative-butterfly. Omit to run all 10.",
    ),
} as const;

const inputZod = z.object(inputShape).refine(
  (v) => (v.ytmPct !== undefined) !== (v.cleanPrice !== undefined),
  { message: "Exactly one of ytmPct or cleanPrice must be provided." },
);

export function registerBondScenarios(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_scenarios",
    {
      title: "Bond scenario bundle (historical + non-parallel stress)",
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
        const data = await client.post<unknown>("/api/v1/compute/bond/scenarios", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
