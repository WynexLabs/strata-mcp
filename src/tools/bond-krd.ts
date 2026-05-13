import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { bondCoreInputShape, curvePoint } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Compute Key-Rate Durations (KRD) for a fixed-coupon bond — the partial duration with respect to a 1bp bump at each key tenor on the zero curve, distributed via a triangular kernel.

Required: curvePoints (full zero curve). Optional: tenors (key maturities in years; default [0.5, 2, 5, 10, 30]).

Returns one entry per key tenor with KRD and DV01, plus krdSum (sum across buckets) and effectiveDuration (parallel-shift effective duration) so the caller can sanity-check that the buckets partition the curve correctly. For an option-free bullet on a flat curve the sum should sit within ±10% of effective duration.

Use-when: hedging or attributing curve risk by maturity bucket (e.g. a barbell vs a bullet under twists); diagnosing why a bond's stress P&L deviates from a parallel-shift expectation.

Do-not-use-when: the bond has embedded options — KRD here is computed on the option-free cashflows. Use strata_bond_oas for OAD/OAC on callables/putables.`;

const inputShape = {
  ...bondCoreInputShape,
  curvePoints: z
    .array(curvePoint)
    .min(2)
    .max(60)
    .describe("Zero curve as an array of {t (years > 0), zeroPct (percent, continuous compounding)} points."),
  tenors: z
    .array(z.number().positive())
    .min(1)
    .max(12)
    .optional()
    .describe("Key-rate maturities in years. Default [0.5, 2, 5, 10, 30]."),
} as const;

const inputZod = z.object(inputShape);

export function registerBondKrd(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_krd",
    {
      title: "Bond key-rate durations across the curve",
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
        const data = await client.post<unknown>("/api/v1/compute/bond/krd", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
