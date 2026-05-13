import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { bondCoreInputShape, curvePoint, scheduleEntry } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Compute OAS (Option-Adjusted Spread), OAD (option-adjusted duration), and OAC (option-adjusted convexity) for a callable / putable bond. Uses Strata's Black-Derman-Toy lognormal binomial tree calibrated to the supplied zero curve. OAS is solved via bisection so the tree reprices the bond to the supplied market clean price; OAD/OAC are ±25bp finite differences with the tree rebuilt at each bump.

Required: curvePoints (full zero curve), cleanPrice (market dirty/clean reference), and at least one of callSchedule or putSchedule. Optional model knobs: sigma (lognormal short-rate vol, default 0.15), steps (BDT steps, default ceil(ttm/dt) capped at 120), dt (step length in years, default 0.5 = semi).

Returns oasBp, oadDuration, oacConvexity, optionFreeDirtyPrice, optionAdjDirtyPrice, and optionValuePct (the value of the embedded option in price points).

Use-when: a bond has embedded calls or puts and a plain Z-spread is misleading (OAS strips option value). Use-when comparing callable corporates against option-free benchmarks.

Do-not-use-when: the bond is option-free — use strata_bond_spreads or strata_price_bond instead. OAS collapses to Z-spread for option-free bullets but the tree machinery is unnecessary overhead.

Caveat: OAC can be negative for callable bonds trading near their call price — that's expected, not a bug. Sigma is a single scalar; this is a single-factor BDT, not a Hull-White two-factor.`;

const inputShape = {
  ...bondCoreInputShape,
  cleanPrice: z
    .number()
    .positive()
    .describe("Market clean price per 100 par. OAS is solved so the BDT tree reprices to this number."),
  curvePoints: z
    .array(curvePoint)
    .min(2)
    .max(60)
    .describe("Zero curve as an array of {t (years > 0), zeroPct (percent, continuous compounding)} points."),
  callSchedule: z
    .array(scheduleEntry)
    .max(30)
    .optional()
    .describe("Call schedule for callable bonds. Each entry: { date: YYYY-MM-DD, price: per-100-par }."),
  putSchedule: z
    .array(scheduleEntry)
    .max(30)
    .optional()
    .describe("Put schedule for putable bonds. Each entry: { date: YYYY-MM-DD, price: per-100-par }."),
  sigma: z
    .number()
    .min(0)
    .max(0.6)
    .optional()
    .describe("Lognormal short-rate volatility for the BDT tree (decimal). Default 0.15."),
  steps: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe("Number of BDT steps. Default ceil(ttm/dt), capped at 120 to bound compute."),
  dt: z
    .number()
    .min(0.0833)
    .max(1)
    .optional()
    .describe("BDT step length in years. Default 0.5 (semi-annual). Smaller dt → finer grid + more compute."),
} as const;

const inputZod = z
  .object(inputShape)
  .refine(
    (v) => (v.callSchedule && v.callSchedule.length > 0) || (v.putSchedule && v.putSchedule.length > 0),
    {
      message:
        "At least one of callSchedule or putSchedule must contain entries (the bond must have an embedded option).",
    },
  );

export function registerBondOas(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_oas",
    {
      title: "Bond OAS, OAD, and OAC via BDT binomial tree",
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
        const data = await client.post<unknown>("/api/v1/compute/bond/oas", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
