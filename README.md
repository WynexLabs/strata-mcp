# @wynexlabs/strata-mcp

MCP (Model Context Protocol) server exposing Strata's numerical finance compute endpoints as tools for MCP clients (Claude Desktop, Cursor, and any other stdio-based MCP client).

The server wraps Strata's public v1 REST API. It does not implement any finance math itself; it forwards tool calls to `https://project-strata.wynexlabs.studio/api/v1/compute/*` using the user's API key.

## Status

v0.1.1 — seven tools, stdio transport only. Adds 15s default request timeout, HTTPS-only baseUrl validation (localhost exempt), and a 512 KiB streamed response cap to keep tool output context-token-safe. See [Environment variables](#environment-variables) for tunables and [Errors](#error-handling) for the new `TIMEOUT` and `OUTPUT_TOO_LARGE` codes.

| Tool | Wraps |
|---|---|
| `strata_price_bond` | `POST /api/v1/compute/bond` |
| `strata_bond_spreads` | `POST /api/v1/compute/bond?benchmark=ust\|ecb-aaa` |
| `strata_bond_stress` | `POST /api/v1/compute/bond/stress` |
| `strata_bond_horizon` | `POST /api/v1/compute/bond/horizon` |
| `strata_bsm` | `POST /api/v1/compute/bsm` |
| `strata_american_option` | `POST /api/v1/compute/option/american` |
| `strata_portfolio_var` | `POST /api/v1/compute/var` |

## Prerequisites

- Node.js >= 18.17.
- A Strata API key. Get one at https://project-strata.wynexlabs.studio/account (API Keys section). Free tier allows 100/day + 10/min; Plus 1000/day + 60/min; Pro 10,000/day + 300/min.

## Install

```sh
npm install -g @wynexlabs/strata-mcp
```

Or run directly without a global install via `npx`:

```sh
npx @wynexlabs/strata-mcp
```

## Configure in Claude Desktop

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "strata": {
      "command": "npx",
      "args": ["-y", "@wynexlabs/strata-mcp"],
      "env": {
        "STRATA_API_KEY": "sk_strata_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. The seven `strata_*` tools should appear under the MCP menu.

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `STRATA_API_KEY` | yes | — | Bearer token forwarded to Strata's v1 API on every tool call. |
| `STRATA_API_BASE` | no | `https://project-strata.wynexlabs.studio` | Override for local development. Must be `https://`; `http://` is only allowed when the host is `localhost`, `127.0.0.1`, or `::1`. Invalid values fail at startup. |
| `STRATA_API_TIMEOUT_MS` | no | `15000` | Per-request abort timeout in milliseconds. Clamped to **[1000, 120000]**; values outside this range are silently coerced to the nearest bound. |
| `STRATA_MAX_BYTES` | no | `524288` (512 KiB) | Cap on response body size. Larger responses are rejected with `OUTPUT_TOO_LARGE` to protect MCP token budgets. Clamped to **[1024, 8388608]** (1 KiB – 8 MiB). |

## Tools — detail

### `strata_price_bond`

Price a fixed-rate coupon bond. Accepts either `ytmPct` (returns dirty / clean price) or `cleanPrice` (returns solved YTM). Returns accrued interest, modified + Macaulay duration, convexity, and DV01 scaled to the supplied notional.

v1 supports fixed-coupon bonds only. Floating, zero-coupon, TIPS, callable, and putable bonds are planned for v2. Day-count default `30/360`; accepted: `30/360`, `ACT/ACT`, `ACT/360`, `ACT/365F`. Exactly one of `ytmPct` or `cleanPrice` must be provided.

### `strata_bond_spreads`

Compute the G-Spread (bond YTM minus interpolated benchmark zero rate at the bond's maturity) for a fixed-rate coupon bond. `currency: "USD"` uses the US Treasury zero curve; `currency: "EUR"` uses the ECB AAA euro-area curve.

The response is the full bond analytics payload (same as `strata_price_bond`) plus a `gSpreadBp` field in basis points. v1 is G-Spread only. I-Spread / ASW / Z-Spread are tracked for v2 pending a structured spreads REST endpoint and trading-grade swap data.

### `strata_bond_stress`

Reprice a bond under ten named scenarios: four historical (covid-mar-2020, taper-tantrum-2013, fed-hike-cycle-2022, lehman-2008) and six non-parallel (bull/bear steepener, bull/bear flattener, positive/negative butterfly). Returns base dirty price plus per-scenario shifted price, % price change, P&L, and % notional. Caller supplies a zero curve; base price is curve-discounted (not YTM-derived).

All scenarios are UST-calibrated. Non-USD bonds get directionally-correct shifts but the magnitudes are US-rate-history-based — use for risk direction, not trading.

### `strata_bond_horizon`

Decompose a bond's total return over a user-specified horizon into carry + roll-down + price + reinvestment. Also returns a scenario grid of total returns across a yield-change grid (default ±50, ±25, 0 bp).

`reinvestmentRatePct` defaults to `activeYtmPct` (market-rate reinvestment). `horizonDate` past maturity is clamped to maturity and reported as held-to-maturity. The decomposition identity (sum of components = total P&L) closes in dirty-price space.

### `strata_bsm`

Price a European option under Black-Scholes-Merton. Returns price + full Greeks (delta, gamma, theta, vega, rho). If `marketPrice` is supplied, additionally solves implied volatility.

All rates / vols are decimals (e.g. `0.05` for 5%). `T` is in years. Continuous dividend yield `q` defaults to 0.

### `strata_american_option`

Price an American call or put via Cox-Ross-Rubinstein binomial tree. Returns the price plus the early-exercise boundary (S*) per non-terminal time step. Per-node tree values are deliberately omitted — a 1000-step tree has ~500k nodes, which blows past MCP payload budgets.

`steps` is an integer in [1, 1000], default 200. Continuous dividend yield `q` defaults to 0.

### `strata_portfolio_var`

Run a Monte Carlo portfolio simulation under correlated returns (normal or Student-t) and return VaR 95/99, CVaR, probability of loss, and distribution summary.

Upstream caps `numSimulations` at 5,000 per call (values above are silently clamped). `horizonMonths` ∈ [1, 120]. `weights` must sum to 1.0 (± 0.01). `covarianceMatrix` is N×N where N = `weights.length`. `distributionType` default `"normal"`; Student-t `degreesOfFreedom` default 5.

## Error handling

Upstream non-2xx responses surface the v1 error envelope's `error.code` and `error.message` as an `isError: true` tool result. No retries. Rate-limit errors (`RATE_LIMIT_EXCEEDED`, `DAILY_LIMIT_EXCEEDED`) are surfaced verbatim so the MCP client can back off.

Client-side error codes added in v0.1.1:

| Code | When |
|---|---|
| `TIMEOUT` | Request exceeded `STRATA_API_TIMEOUT_MS` (default 15s). |
| `NETWORK_ERROR` | DNS / TCP / TLS failure before any response was received. |
| `OUTPUT_TOO_LARGE` | Response body would exceed `STRATA_MAX_BYTES` (Content-Length pre-check or streamed-overrun mid-read). |
| `UPSTREAM_NON_JSON` | HTTP error response with a non-JSON body. |
| `UPSTREAM_MALFORMED` | 200 OK with a malformed v1 envelope (no `data`, no `error`). |

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run test:run    # vitest (client tests + 7-tool registration + per-tool upstream round-trip via InMemoryTransport)
npm run smoke       # build + spawn the stdio server, run initialize / tools/list / tools/call
npm run dev         # run src/index.ts with tsx (requires STRATA_API_KEY env)
npm run build       # tsc build into dist/
```

## Architecture

```
src/
  index.ts              # CLI entry: reads env, wires StdioServerTransport
  server.ts             # createServer(): McpServer + register all 7 tools
  client.ts             # StrataClient: fetch wrapper, Bearer auth, envelope unwrap
  errors.ts             # StrataApiError
  schemas/bond.ts       # shared Zod shapes (priceBondInputShape, bondCoreInputShape, curvePoint)
  tools/
    price-bond.ts       # strata_price_bond
    bond-spreads.ts     # strata_bond_spreads
    bond-stress.ts      # strata_bond_stress
    bond-horizon.ts     # strata_bond_horizon
    bsm.ts              # strata_bsm
    american-option.ts  # strata_american_option
    portfolio-var.ts    # strata_portfolio_var
    helpers.ts          # CallToolResult formatters + error → tool-result mapping
```

## License

MIT © WynexLabs
