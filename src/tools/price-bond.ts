import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { priceBondInputShape } from "../schemas/bond.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Price a fixed-rate coupon bond using Strata's bond analytics engine. Accepts either a yield (ytmPct) and returns the dirty/clean price, or a clean price and returns the solved YTM (bisection). Also returns accrued interest, modified + Macaulay duration, convexity, and DV01 scaled to the supplied notional.

Exactly one of ytmPct or cleanPrice must be provided. Day-count defaults to 30/360 (US corporate).

Note: v1 supports fixed-coupon bonds only. Floating-rate, zero-coupon, TIPS, callable, and putable bonds are tracked for v2.`;

const inputZod = z.object(priceBondInputShape).refine(
  (v) => (v.ytmPct !== undefined) !== (v.cleanPrice !== undefined),
  { message: "Exactly one of ytmPct or cleanPrice must be provided." },
);

export function registerPriceBond(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_price_bond",
    {
      title: "Price a fixed-coupon bond",
      description,
      inputSchema: priceBondInputShape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const parsed = inputZod.safeParse(args);
      if (!parsed.success) {
        return toolErrorContent("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
      }
      try {
        const data = await client.post<unknown>("/api/v1/compute/bond", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
