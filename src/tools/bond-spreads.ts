import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { priceBondInputShape } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Compute the G-Spread (bond YTM minus interpolated benchmark govt curve at matching maturity) for a fixed-rate coupon bond. Currency controls the benchmark: USD uses the US Treasury zero curve, EUR uses the ECB AAA euro-area govt curve.

Exactly one of ytmPct or cleanPrice must be provided — same as strata_price_bond. The route first solves / applies YTM, then interpolates the benchmark curve at the bond's time-to-maturity.

The response is the full bond analytics output (same as strata_price_bond) plus a gSpreadBp field (G-Spread in basis points) and a gSpreadBenchmark object ({ type: "ust" | "ecb-aaa", asOf: string | null }) indicating which benchmark curve was used and when it was last updated. Always check gSpreadBenchmark.type before comparing spreads across bonds with different currencies — USD and EUR G-Spreads reference different benchmarks and are not directly comparable.

v1 scope: G-Spread only. I-Spread (vs swap curve), ASW, and Z-Spread are tracked for v2 (pending structured spreads REST route + reliable trading-grade swap data).`;

const currencyBenchmarkShape = {
  currency: z.enum(["USD", "EUR"]).describe(
    "Currency of the bond — selects benchmark curve: USD → US Treasury, EUR → ECB AAA euro-area.",
  ),
} as const;

const inputShape = {
  ...priceBondInputShape,
  ...currencyBenchmarkShape,
} as const;

const inputZod = z.object(inputShape).refine(
  (v) => (v.ytmPct !== undefined) !== (v.cleanPrice !== undefined),
  { message: "Exactly one of ytmPct or cleanPrice must be provided." },
);

export function registerBondSpreads(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_bond_spreads",
    {
      title: "Bond spreads — G-Spread (v1)",
      description,
      inputSchema: inputShape,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const parsed = inputZod.safeParse(args);
      if (!parsed.success) {
        return toolErrorContent("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }
      const { currency, ...bondArgs } = parsed.data;
      const benchmark = currency === "USD" ? "ust" : "ecb-aaa";
      try {
        const data = await client.post<unknown>("/api/v1/compute/bond", {
          ...bondArgs,
          benchmark,
        });
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
