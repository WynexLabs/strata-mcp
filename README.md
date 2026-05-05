# @wynexlabs/strata-mcp

MCP (Model Context Protocol) server exposing Strata's numerical finance compute endpoints as tools — for Claude Code, Claude Desktop, Cursor, Codex CLI, and any other stdio MCP client.

The server wraps Strata's public v1 REST API. All finance math runs server-side; the MCP package forwards tool calls to `https://project-strata.wynexlabs.studio/api/v1/compute/*` using your API key.

## Status

v0.1.3 — seven tools, stdio transport only. Security hardening: host allowlist on `STRATA_API_BASE`, array input bounds, `retryAfter` surfaced on 429, rate-limit quota logged to stderr, BSM response renames `inputs.dividendYield` (was `inputs.delta`) to avoid collision with the option Greek. ChatGPT/OpenAI section updated for Responses API MCP path.

| Tool | Endpoint |
|---|---|
| `strata_price_bond` | `POST /api/v1/compute/bond` |
| `strata_bond_spreads` | `POST /api/v1/compute/bond` (with benchmark) |
| `strata_bond_stress` | `POST /api/v1/compute/bond/stress` |
| `strata_bond_horizon` | `POST /api/v1/compute/bond/horizon` |
| `strata_bsm` | `POST /api/v1/compute/bsm` |
| `strata_american_option` | `POST /api/v1/compute/option/american` |
| `strata_portfolio_var` | `POST /api/v1/compute/var` |

---

## Get an API key

**[project-strata.wynexlabs.studio/account](https://project-strata.wynexlabs.studio/account)** → API Keys section.

Free tier: 100 calls/day · 10/min — no card required.  
Plus: 1,000/day · 60/min. Pro: 10,000/day · 300/min.

Your key will look like `sk_strata_live_xxxxxxxxxxxxxxxx`.

---

## Setup

### Claude Code (CLI)

The fastest path — one command, works immediately in the current session:

```bash
claude mcp add --scope user --env STRATA_API_KEY=sk_strata_live_... strata -- npx -y @wynexlabs/strata-mcp
```

**All flags must come before the server name.** The `--` separates the name from the command.

**Scope options:**

| Flag | Where config is stored | Shared? |
|---|---|---|
| `--scope user` | `~/.claude.json` (global) | No — your machine only |
| `--scope project` | `.mcp.json` in project root | Yes — commit it, all teammates get the tools |
| `--scope local` | `~/.claude.json` for this project path | No |

For a team repo, `--scope project` is recommended — the config travels with the codebase:

```bash
claude mcp add --scope project --env STRATA_API_KEY=sk_strata_live_... strata -- npx -y @wynexlabs/strata-mcp
```

This writes (or updates) `.mcp.json` in the project root:

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

> **Note:** Each teammate needs their own API key in the env field, or can set `STRATA_API_KEY` in their shell and remove the `env` block — but Claude Code does not inherit shell env vars automatically, so the `--env` flag is the reliable path.

**Verify it's working** — paste this into a Claude Code session:

```
call strata_price_bond with faceValue 1000, couponPct 4.5, frequencyPerYear 2,
settlementDate 2024-01-01, maturityDate 2034-01-01, ytmPct 4.8, dayCountConvention 30/360
```

You should get back a dirty price, clean price, ModDur, DV01, and convexity in about 1 second.

---

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Fully quit and relaunch Claude Desktop. The seven `strata_*` tools appear under the MCP (plug) icon.

> **Windows note:** `npm` must be installed globally for `npx` to resolve from Claude Desktop's restricted PATH. If the tools don't appear, use the full path to `npx.cmd` as the `command` value (e.g. `C:\\Users\\you\\AppData\\Roaming\\npm\\npx.cmd`).

---

### Cursor

**Global** (all projects): `~/.cursor/mcp.json`  
**Project-level** (committed to repo): `.cursor/mcp.json` in repo root

Same JSON format as Claude Desktop:

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

Restart Cursor after saving. The outer key must be exactly `"mcpServers"` (case-sensitive) — Cursor silently ignores the file if it's wrong.

> **PATH gotcha:** Cursor uses a restricted PATH. If `npx` works in your terminal but Strata tools don't appear, replace `"npx"` with the absolute path to your `npx` binary: `"/Users/you/.nvm/versions/node/v20.x.x/bin/npx"` (or wherever `which npx` points).

---

### Codex CLI

**Global:** `~/.codex/config.toml`  
**Project-level:** `.codex/config.toml` in repo root (only works in trusted projects — Codex will prompt you on first use)

```toml
[mcp_servers.strata]
command = "npx"
args = ["-y", "@wynexlabs/strata-mcp"]
enabled = true

[mcp_servers.strata.env]
STRATA_API_KEY = "sk_strata_live_..."
```

No restart needed — MCP servers start per session.

---

### ChatGPT and OpenAI API

ChatGPT and the OpenAI Responses API support **remote** MCP servers over HTTP/SSE — not local stdio processes. There are two paths:

#### Option A — OpenAI Responses API (programmatic)

Pass a remote Strata MCP server as a tool in any Responses API request:

```json
{
  "model": "gpt-4o",
  "tools": [{
    "type": "mcp",
    "server_label": "strata",
    "server_url": "https://mcp.project-strata.wynexlabs.studio/sse/",
    "allowed_tools": ["strata_price_bond", "strata_bsm", "strata_portfolio_var"],
    "require_approval": "never"
  }]
}
```

> **Note:** A hosted remote MCP endpoint (`mcp.project-strata.wynexlabs.studio`) is not yet live — contact [wuttipat@wynexlabs.studio](mailto:wuttipat@wynexlabs.studio) to join the waitlist. The stdio package (`@wynexlabs/strata-mcp`) is Claude Code / Claude Desktop / Cursor only.

#### Option B — GPT Action (no remote server needed)

Point a custom GPT directly at Strata's REST API without any MCP server:

1. Open [chat.openai.com](https://chat.openai.com) → Explore GPTs → Create → Configure → Add Action
2. Paste the Strata OpenAPI schema URL: `https://project-strata.wynexlabs.studio/api/v1/openapi.json`
3. Set authentication: API Key → Bearer → paste your `sk_strata_live_...` key
4. Save and test — the GPT can now call `POST /api/v1/compute/bsm`, `/compute/bond`, `/compute/var`, etc.

This covers all seven compute endpoints without any local process or server deployment.

---

## Environment variables

| Var | Required | Default | Purpose |
|---|---|---|---|
| `STRATA_API_KEY` | **yes** | — | Bearer token forwarded to Strata's v1 API on every tool call. Get one at [/account](https://project-strata.wynexlabs.studio/account). |
| `STRATA_API_BASE` | no | `https://project-strata.wynexlabs.studio` | Override for local development only. Must be `https://`; `http://` is only allowed for localhost / 127.0.0.1 / ::1. Only `project-strata.wynexlabs.studio` is accepted as a remote host — other values are rejected at startup to prevent accidental key exfiltration. |
| `STRATA_API_TIMEOUT_MS` | no | `15000` | Per-request abort timeout in ms. Clamped to [1000, 120000]. |
| `STRATA_MAX_BYTES` | no | `524288` (512 KiB) | Max response body size. Clamped to [1024, 8388608]. Larger responses are rejected with `OUTPUT_TOO_LARGE`. |

---

## Tools — detail

### `strata_price_bond`

Price a fixed-rate coupon bond. Supply exactly one of `ytmPct` (returns dirty/clean price) or `cleanPrice` (returns solved YTM). Returns accrued interest, modified + Macaulay duration, convexity, and DV01 scaled to `notional`.

v1: fixed-coupon bonds only. Floating, zero-coupon, TIPS, callable, putable → v2. Day-count default `30/360`; accepted: `30/360`, `ACT/ACT`, `ACT/360`, `ACT/365F`.

### `strata_bond_spreads`

G-Spread (bond YTM minus interpolated benchmark zero rate at matching maturity). `currency: "USD"` → UST curve; `currency: "EUR"` → ECB AAA euro-area curve.

Response: full bond analytics payload (same as `strata_price_bond`) plus `gSpreadBp` (basis points) and `gSpreadBenchmark: { type, asOf }` — always check `gSpreadBenchmark.type` before comparing spreads across currencies, they reference different benchmarks. v1: G-Spread only; I-Spread / ASW / Z-Spread → v2.

### `strata_bond_stress`

Reprice under ten named scenarios: four historical (`covid-mar-2020`, `taper-tantrum-2013`, `fed-hike-cycle-2022`, `lehman-2008`) and six non-parallel (bull/bear steepener, bull/bear flattener, positive/negative butterfly). Returns base dirty price plus per-scenario shifted price, % change, P&L, % notional. Caller supplies a zero curve (min 2, max 30 points); base price is curve-discounted.

All scenarios UST-calibrated. `fed-hike-cycle-2022` is conservative vs actual 2022 drawdown — use for ordered ranking, not absolute forecasting.

### `strata_bond_horizon`

Carry + roll-down + price + reinvestment P&L decomposition over a user-specified horizon, plus a scenario grid of total returns across a yield-change grid (default ±50, ±25, 0 bp; max 50 scenarios).

`reinvestmentRatePct` defaults to `activeYtmPct`. `horizonDate` past maturity is clamped to maturity. The decomposition identity (sum = total P&L) closes in dirty-price space.

### `strata_bsm`

Price a European option under Black-Scholes-Merton. Returns price + full Greeks (delta, gamma, theta, vega, rho). Supply `marketPrice` to additionally solve implied volatility.

All rates/vols are decimals (e.g. `0.05` for 5%). `T` is in years. Continuous dividend yield `q` defaults to 0.

Greeks scaling (matches Strata UI): theta is per-day (÷365 applied); vega and rho are per 1% move (×0.01 applied). Do not scale them again.

The response includes `inputs.dividendYield` (the `q` you supplied) alongside `greeks.delta` (the option delta). These are different quantities — `dividendYield` is the continuous yield on the underlying; `greeks.delta` is ∂Price/∂S.

### `strata_american_option`

American call/put via Cox-Ross-Rubinstein binomial tree. Returns price + early-exercise boundary per non-terminal step. `steps` ∈ [1, 1000], default 200. Per-node tree values are omitted (a 1000-step tree has ~500k nodes).

Convergence note: 200 steps is sufficient for most puts. For deep-ITM calls or short-dated calls on dividend-paying underliers, use 500–1000 steps.

### `strata_portfolio_var`

Monte Carlo VaR/CVaR on a multi-asset portfolio under correlated returns (normal or Student-t). Returns VaR 95/99, CVaR 95/99, probLoss, distribution summary.

`numSimulations` capped at 5,000 server-side. `horizonMonths` ∈ [1, 120]. `weights` must sum to 1.0 (±0.01). `covarianceMatrix` is N×N (max 50×50). VaR 99 at 5k sims is noisy — quote with confidence intervals.

---

## Error handling

Non-2xx responses surface the v1 error envelope's `code` and `message` as `isError: true` tool results. Rate-limit errors include a `retryAfter` value in seconds.

| Code | When |
|---|---|
| `RATE_LIMIT_DAILY` | Daily quota exhausted. Check remaining quota in stderr logs. |
| `RATE_LIMIT_MINUTE` | Per-minute quota hit. `retryAfter` indicates seconds to wait. |
| `INVALID_KEY` | `STRATA_API_KEY` not recognised. Get a new key at [/account](https://project-strata.wynexlabs.studio/account). |
| `TIMEOUT` | Request exceeded `STRATA_API_TIMEOUT_MS` (default 15s). |
| `NETWORK_ERROR` | DNS / TCP / TLS failure before any response. |
| `OUTPUT_TOO_LARGE` | Response exceeds `STRATA_MAX_BYTES`. Increase the cap or reduce input complexity. |
| `UPSTREAM_NON_JSON` | Upstream returned a non-JSON body (details logged to stderr only). |
| `UPSTREAM_MALFORMED` | 200 OK with a malformed v1 envelope. |

Remaining daily and per-minute quota is written to stderr on every successful call — useful for agent operators monitoring headroom.

---

## Troubleshooting

**Tools don't appear in Claude Desktop / Cursor**
1. Fully quit the app (not just close the window) and relaunch.
2. Check the config file is valid JSON — a single trailing comma or missing brace silently breaks the entire file.
3. Confirm `npx` is on the app's PATH (see platform-specific note above).

**`strata-mcp: STRATA_API_KEY environment variable is required`**
The key isn't reaching the process. In Claude Desktop / Cursor, the `env` block in the config file is the only reliable way — shell env vars are not inherited. In Claude Code, re-run `claude mcp add` with `--env STRATA_API_KEY=sk_strata_live_...`.

**`INVALID_KEY` error on every tool call**
Make sure you're using a live key (`sk_strata_live_...`) not a test or placeholder value. Get one at [project-strata.wynexlabs.studio/account](https://project-strata.wynexlabs.studio/account).

**`STRATA_API_BASE host '...' is not an allowed Strata endpoint`**
Remove the `STRATA_API_BASE` env var — it's for local development only. The default (`project-strata.wynexlabs.studio`) is used when the var is absent.

**Rate limit hit (`RATE_LIMIT_DAILY`)**
Free tier is 100 calls/day. Upgrade at [/pricing](https://project-strata.wynexlabs.studio/pricing) for 1k/day (Plus) or 10k/day (Pro), or add credit packs at [/developers/pricing](https://project-strata.wynexlabs.studio/developers/pricing) for PAYG access without a subscription.

---

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run test:run    # vitest (34 tests)
npm run build       # tsc → dist/
npm run dev         # run src/index.ts with tsx (requires STRATA_API_KEY)
```

## Architecture

```
src/
  index.ts              # CLI entry: reads env, wires StdioServerTransport
  server.ts             # createServer(): McpServer + INSTRUCTIONS + registers all 7 tools
  client.ts             # StrataClient: fetch, Bearer auth, host allowlist, envelope unwrap
  errors.ts             # StrataApiError
  schemas/bond.ts       # shared Zod shapes
  tools/
    price-bond.ts
    bond-spreads.ts
    bond-stress.ts
    bond-horizon.ts
    bsm.ts
    american-option.ts
    portfolio-var.ts
    helpers.ts          # toolJsonContent, toolErrorContent, errorToToolResult
```

## License

MIT © WynexLabs
