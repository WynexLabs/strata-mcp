import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { bondCoreInputShape, curvePoint, scheduleEntry } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Compute OAS (Option-Adjusted Spread), OAD (option-adjusted duration), and OAC (option-adjusted convexity) for a callable / putable bond.

Two engines are supported via the 'model' input:
  • model: "bdt" (default) — Black-Derman-Toy lognormal binomial tree (Black, Derman, Toy 1990). Matches the CFA Level II curriculum and is backward-compatible with all existing callers. Knobs: sigma, steps, dt.
  • model: "hw1f" — Hull-White 1F trinomial tree (Hull-White 1990, §32.7), φ(t) calibrated to the input curve. Matches what Bloomberg / ICE / MSCI users see for institutional callable bond analytics. Knobs: sigma, alpha (mean reversion), steps, dt.

Both engines: OAS is solved via bisection so the tree reprices the bond to the supplied market clean price; OAD/OAC are ±25bp finite differences with the tree rebuilt at each bump.

Required: curvePoints (full zero curve), cleanPrice (market dirty/clean reference), and at least one of callSchedule or putSchedule. Optional knobs: model ("bdt" | "hw1f", default "bdt"), sigma (short-rate vol, default 0.15), alpha (HW1F mean reversion, default 0.03; ignored under "bdt"), steps (default ceil(ttm/dt) capped at 120), dt (step length in years, default 0.5 = semi).

Returns model (echoed), oasBp, oadDuration, oacConvexity, optionFreeDirtyPrice, optionAdjDirtyPrice, and optionValuePct (the value of the embedded option in price points). The 'modelInputs' block also echoes alpha when model="hw1f".

Use-when: a bond has embedded calls or puts and a plain Z-spread is misleading (OAS strips option value). Use "bdt" for CFA-aligned answers; use "hw1f" to compare against institutional desk OAS.

Do-not-use-when: the bond is option-free — use strata_bond_spreads or strata_price_bond instead. OAS collapses to Z-spread for option-free bullets but the tree machinery is unnecessary overhead.

Caveat: OAC can be negative for callable bonds trading near their call price — that's expected, not a bug. Both engines are single-factor short-rate models; for two-factor work use a different system.`;

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
    .describe(
      "Short-rate volatility (decimal). For model='bdt' this is the lognormal vol of the BDT lattice; for model='hw1f' it is the absolute Gaussian vol σ in dr = (θ(t) − α r) dt + σ dW. Default 0.15.",
    ),
  steps: z
    .number()
    .int()
    .min(1)
    .max(120)
    .optional()
    .describe("Number of tree steps (BDT or HW1F). Default ceil(ttm/dt), capped at 120 to bound compute."),
  dt: z
    .number()
    .min(0.0833)
    .max(1)
    .optional()
    .describe("Tree step length in years. Default 0.5 (semi-annual). Smaller dt → finer grid + more compute."),
  model: z
    .enum(["bdt", "hw1f"])
    .optional()
    .describe(
      "OAS engine. 'bdt' (default) = Black-Derman-Toy lognormal binomial — matches the CFA Level II curriculum and is backward-compatible with all existing callers. 'hw1f' = Hull-White 1F trinomial (Hull-White 1990) — matches Bloomberg/ICE/MSCI institutional benchmarks; consumes the 'alpha' knob.",
    ),
  alpha: z
    .number()
    .min(0.001)
    .max(0.5)
    .optional()
    .describe(
      "HW1F mean-reversion speed α in dr = (θ(t) − α r) dt + σ dW. Default 0.03 (Hull-White textbook starting point; common Bloomberg vanilla USD benchmark). Ignored when model='bdt'. Bounded [0.001, 0.5] to keep the trinomial tree's jmax = ceil(0.184/(α·dt)) numerically well-behaved.",
    ),
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
      title: "Bond OAS, OAD, and OAC via BDT binomial or Hull-White trinomial tree",
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
