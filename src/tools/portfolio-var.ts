import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrataClient } from "../client.js";
import { errorToToolResult, toolErrorContent, toolJsonContent } from "./helpers.js";

const description = `Run a Monte Carlo portfolio simulation under correlated returns (normal or Student-t) and return Value-at-Risk 95/99, CVaR, probability of loss, distribution moments (skewness, excess kurtosis), and a Cornish-Fisher adjusted 95% VaR (\`varCornishFisher95\`) that corrects the normal quantile for skew/kurt — when the simulated sample is too small (n < 30) the field is null and \`cornishFisherUnavailable: "n<30"\` is returned.

v1 upstream caps numSimulations at 5,000 per call — values above are silently clamped. horizonMonths must be an integer in [1, 120]. weights must sum to 1.0 (±0.01) and covarianceMatrix must be N×N where N = weights.length.

Use for portfolio-level tail-risk decisions; for full fan-chart path simulation, call multiple times with different horizons.`;

const inputShape = {
  weights: z
    .array(z.number())
    .min(1)
    .max(50)
    .describe("Portfolio weights (sum ≈ 1.0, ±0.01). Length N defines the portfolio. Max 50 assets."),
  annualizedReturns: z
    .array(z.number())
    .min(1)
    .max(50)
    .describe("Annualized expected returns per asset (decimal), length must equal weights.length. Max 50."),
  covarianceMatrix: z
    .array(z.array(z.number()).max(50))
    .max(50)
    .describe("N×N annualized return covariance matrix, where N = weights.length. Max 50×50."),
  initialValue: z.number().positive().describe("Initial portfolio value (numeraire-consistent, e.g. USD)."),
  horizonMonths: z
    .number()
    .int()
    .min(1)
    .max(120)
    .describe("Simulation horizon in months (1–120)."),
  numSimulations: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Number of Monte Carlo paths. Default 2000; upstream caps at 5000."),
  distributionType: z
    .enum(["normal", "student_t"])
    .optional()
    .describe("Return distribution for shocks. Default 'normal'."),
  degreesOfFreedom: z
    .number()
    .positive()
    .optional()
    .describe("Degrees of freedom for Student-t distribution (fatter tails as df → 2+). Default 5."),
} as const;

const inputZod = z
  .object(inputShape)
  .refine((v) => Math.abs(v.weights.reduce((a, b) => a + b, 0) - 1.0) <= 0.01, {
    message: "weights must sum to 1.0 (±0.01).",
  })
  .refine((v) => v.annualizedReturns.length === v.weights.length, {
    message: "annualizedReturns.length must equal weights.length.",
  })
  .refine(
    (v) =>
      v.covarianceMatrix.length === v.weights.length &&
      v.covarianceMatrix.every((row) => row.length === v.weights.length),
    { message: "covarianceMatrix must be N×N where N = weights.length." },
  );

export function registerPortfolioVar(server: McpServer, client: StrataClient): void {
  server.registerTool(
    "strata_portfolio_var",
    {
      title: "Portfolio VaR / CVaR (Monte Carlo)",
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
        const data = await client.post<unknown>("/api/v1/compute/var", parsed.data);
        return toolJsonContent(data);
      } catch (err) {
        return errorToToolResult(err);
      }
    },
  );
}
