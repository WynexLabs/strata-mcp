import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StrataClient } from "./client.js";
import { registerPriceBond } from "./tools/price-bond.js";
import { registerBondSpreads } from "./tools/bond-spreads.js";
import { registerBondStress } from "./tools/bond-stress.js";
import { registerBondHorizon } from "./tools/bond-horizon.js";
import { registerBsm } from "./tools/bsm.js";
import { registerAmericanOption } from "./tools/american-option.js";
import { registerPortfolioVar } from "./tools/portfolio-var.js";

export interface CreateServerOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createServer(opts: CreateServerOptions): McpServer {
  const server = new McpServer(
    { name: "strata-mcp", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Strata MCP server: numerical finance compute tools (bond pricing, option pricing, portfolio VaR). All tools call Strata's v1 REST API with the user's STRATA_API_KEY; rate limits follow the user's subscription tier (Free 10/min, Plus 60/min, Pro 300/min).",
    },
  );

  const client = new StrataClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
  });

  registerPriceBond(server, client);
  registerBondSpreads(server, client);
  registerBondStress(server, client);
  registerBondHorizon(server, client);
  registerBsm(server, client);
  registerAmericanOption(server, client);
  registerPortfolioVar(server, client);

  return server;
}
