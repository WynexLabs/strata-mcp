import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StrataClient } from "./client.js";
import { registerPriceBond } from "./tools/price-bond.js";
import { registerBondSpreads } from "./tools/bond-spreads.js";
import { registerBondStress } from "./tools/bond-stress.js";
import { registerBondScenarios } from "./tools/bond-scenarios.js";
import { registerBondHorizon } from "./tools/bond-horizon.js";
import { registerBsm } from "./tools/bsm.js";
import { registerAmericanOption } from "./tools/american-option.js";
import { registerPortfolioVar } from "./tools/portfolio-var.js";
import { registerEquityDcf } from "./tools/equity-dcf.js";

export interface CreateServerOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

const INSTRUCTIONS = `Strata MCP server — numerical finance compute tools.

All tools call Strata's v1 REST API with the user's STRATA_API_KEY. Rate limits follow the user's subscription tier (Free 100/day + 10/min · Plus 1k/day + 60/min · Pro 10k/day + 300/min). All responses follow the Strata v1 envelope { data, meta, error } and tool-side errors surface as [CODE] message text content with isError=true.

Use these tools when you need numerical results that LLMs hallucinate at: iterative YTM solves, bond risk metrics under named curve scenarios, BSM Greeks + IV solver, CRR binomial trees, Monte Carlo VaR. Do NOT use for live market data feeds, options chains, news, filings, or chart rendering — Strata's compute layer is not a market-data terminal.

Tool guide

  strata_price_bond — Use when pricing or solving the YTM of a fixed-coupon bond (including callable/putable). Supply exactly one of ytmPct or cleanPrice. Returns dirty/clean price, accrued, ModDur, MacD, convexity, DV01.
    For callable bonds: add callSchedule ([{date, price}]) → returns ytcPct, ytwPct, ytwType.
    For putable bonds: add putSchedule ([{date, price}]) → returns ytpPct.
    Do not use for: floating-rate, zero-coupon, TIPS.

  strata_bond_spreads — Use when you have a YTM and need a spread vs the UST or ECB-AAA government curve.
    Caveat: I-Spread / ASW are deferred. G-Spread for non-USD/EUR currencies falls back to UST and is therefore a cross-currency comparison; treat it as directional.

  strata_bond_stress — Use to reprice a bond under named historical curve scenarios (covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008) plus six non-parallel shifts (steepener / flattener / butterfly variants). Requires a full zero curve (curvePoints). Caveat: fed-hike-cycle-2022 calibration is conservative — use for ordered ranking, not absolute drawdown forecasting.

  strata_bond_scenarios — Use to run the same 10 named scenarios WITHOUT supplying a curve. No curvePoints needed — the route synthesises a flat zero from ytmPct (or solves it from cleanPrice) and applies bumps. Optionally add creditSpreadBps to lift the base level. Returns per-scenario: newYtm, newPrice, priceChangePct, deltaModDur, pnl, pctNotional. Use this when you only have a YTM/price, not a full term structure.

  strata_bond_horizon — Use for carry, roll-down, price, and reinvestment P&L decomposition over a user-supplied horizon.
    Identity: P&L_total = carry + roll + price + reinvestment. Verify before reporting numbers.

  strata_bsm — Use when pricing a European option and reporting full Greeks. If marketPrice is supplied, it also returns implied volatility.
    Greeks scaling convention (matches Strata web UI):
      • theta is per-day (already divided by 365)
      • vega and rho are per-1% (multiplied by 0.01 — i.e. for a 1 vol-point or 1bp-of-100 rate move)
      • delta and gamma are per-unit underlying
    Do not multiply theta/vega/rho by 100/365 again when surfacing them to the user.

  strata_american_option — Use for American calls/puts via a CRR binomial tree. Returns price + early-exercise boundary per non-terminal step.
    Convergence note: 200 steps is fine for puts. For deep-ITM calls or short-dated calls on dividend-paying underliers, push steps to 500-1000 to converge price; output excludes per-node values regardless of steps.

  strata_equity_dcf — Use for 2-stage DCF or Reverse-DCF equity valuation using caller-supplied numbers (manual mode — no upstream market data). Required: baseFCF (trailing FCFF), sharesOutstanding. Optional: waccPct (default 9), terminalGrowthPct (default 2.5), stage1GrowthPct (default 5), netDebt, currentPrice. Add scenarios[] for probability-weighted bull/base/bear and sensitivity{} for a WACC × terminal-growth grid. Use reverseDCF mode to solve for the implied growth rate at the current price.
    Caveat: this tool never fetches live data; the caller is responsible for supplying correct baseFCF, shares, and WACC. For auto-populated inputs use the REST endpoint directly with a ticker.

  strata_portfolio_var — Use for Monte Carlo VaR/CVaR on a multi-asset portfolio. Capped at 5,000 simulations server-side. Returns VaR 95/99, CVaR 95/99, probLoss, skewness, kurtosis, Sortino, Calmar, max drawdown.
    Tail estimates at 5k sims are noisy; quote VaR 95 with confidence; treat VaR 99 as indicative. Skewness and kurtosis are portfolio-return distribution statistics useful for Cornish-Fisher adjustments.

Authentication: Bearer token in STRATA_API_KEY (sk_strata_live_*). Get a key at https://project-strata.wynexlabs.studio/account.`;

export function createServer(opts: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: "strata-mcp", version: "0.1.5" },
    {
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
    },
  );

  const client = new StrataClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes,
  });

  registerPriceBond(server, client);
  registerBondSpreads(server, client);
  registerBondStress(server, client);
  registerBondScenarios(server, client);
  registerBondHorizon(server, client);
  registerBsm(server, client);
  registerAmericanOption(server, client);
  registerPortfolioVar(server, client);
  registerEquityDcf(server, client);

  return server;
}
