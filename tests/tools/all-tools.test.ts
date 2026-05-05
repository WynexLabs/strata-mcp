import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

interface CaptureEntry {
  url: string;
  body: unknown;
}

async function mountClient(
  fetchImpl: typeof fetch,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer({
    apiKey: "test-key",
    baseUrl: "http://localhost:3001",
    fetchImpl,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

function echoFetch(capture: CaptureEntry[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.push({
      url: typeof input === "string" ? input : input.toString(),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return new Response(
      JSON.stringify({
        data: { _mockEcho: true },
        meta: { asOf: "2026-04-24", source: "mock", cached: false },
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

const ALL_TOOLS = [
  "strata_price_bond",
  "strata_bond_spreads",
  "strata_bond_stress",
  "strata_bond_horizon",
  "strata_bsm",
  "strata_american_option",
  "strata_portfolio_var",
];

describe("Tool registration (all 7)", () => {
  it("advertises every v1 tool with a description and inputSchema", async () => {
    const { client, close } = await mountClient(echoFetch());
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([...ALL_TOOLS].sort());
    for (const t of list.tools) {
      expect(typeof t.description).toBe("string");
      expect((t.description ?? "").length).toBeGreaterThan(20);
      expect(t.inputSchema?.type).toBe("object");
    }
    await close();
  });
});

describe("Tool upstream routing (all 7)", () => {
  const cases: Array<{
    tool: string;
    args: Record<string, unknown>;
    expectedPath: string;
    expectBody?: (b: Record<string, unknown>) => void;
  }> = [
    {
      tool: "strata_price_bond",
      args: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        ytmPct: 5,
      },
      expectedPath: "/api/v1/compute/bond",
    },
    {
      tool: "strata_bond_spreads",
      args: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        ytmPct: 5,
        currency: "USD",
      },
      expectedPath: "/api/v1/compute/bond",
      expectBody: (b) => {
        expect(b.benchmark).toBe("ust"); // USD → UST
        expect(b.currency).toBeUndefined(); // mapped away before send
      },
    },
    {
      tool: "strata_bond_spreads",
      args: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        ytmPct: 5,
        currency: "EUR",
      },
      expectedPath: "/api/v1/compute/bond",
      expectBody: (b) => {
        expect(b.benchmark).toBe("ecb-aaa");
      },
    },
    {
      tool: "strata_bond_stress",
      args: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        curvePoints: [
          { t: 1, zeroPct: 4 },
          { t: 5, zeroPct: 4 },
          { t: 10, zeroPct: 4 },
        ],
      },
      expectedPath: "/api/v1/compute/bond/stress",
    },
    {
      tool: "strata_bond_horizon",
      args: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        horizonDate: "2025-06-15",
        activeYtmPct: 5,
      },
      expectedPath: "/api/v1/compute/bond/horizon",
    },
    {
      tool: "strata_bsm",
      args: { S: 100, K: 100, r: 0.05, sigma: 0.2, T: 1, type: "call" },
      expectedPath: "/api/v1/compute/bsm",
    },
    {
      tool: "strata_american_option",
      args: { S: 100, K: 100, r: 0.05, sigma: 0.2, T: 1, optionType: "put", steps: 50 },
      expectedPath: "/api/v1/compute/option/american",
    },
    {
      tool: "strata_portfolio_var",
      args: {
        weights: [0.6, 0.4],
        annualizedReturns: [0.08, 0.04],
        covarianceMatrix: [
          [0.04, 0.01],
          [0.01, 0.02],
        ],
        initialValue: 1_000_000,
        horizonMonths: 12,
        numSimulations: 200,
      },
      expectedPath: "/api/v1/compute/var",
    },
  ];

  for (const c of cases) {
    it(`${c.tool} → POST ${c.expectedPath}`, async () => {
      const capture: CaptureEntry[] = [];
      const { client, close } = await mountClient(echoFetch(capture));
      const result = (await client.callTool({
        name: c.tool,
        arguments: c.args,
      })) as unknown as { isError?: boolean; content: Array<{ text: string }> };
      expect(result.isError).toBeFalsy();
      expect(capture.length).toBe(1);
      expect(capture[0]?.url).toBe(`http://localhost:3001${c.expectedPath}`);
      if (c.expectBody) c.expectBody(capture[0]!.body as Record<string, unknown>);
      const parsed = JSON.parse(result.content[0]!.text) as { _mockEcho: boolean };
      expect(parsed._mockEcho).toBe(true);
      await close();
    });
  }
});

describe("Tool input validation (schema-level rejections)", () => {
  it("strata_bsm rejects negative sigma locally", async () => {
    const { client, close } = await mountClient(echoFetch());
    const result = (await client.callTool({
      name: "strata_bsm",
      arguments: { S: 100, K: 100, r: 0.05, sigma: -0.2, T: 1, type: "call" },
    })) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    // The SDK runs the declared inputSchema before invoking the handler, so
    // a schema-level reject surfaces as "Input validation error" from the
    // server rather than our handler's INVALID_INPUT path. Our handler's
    // Zod refine() is still the fallback for anything that slips past.
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await close();
  });

  it("strata_american_option rejects steps=2000", async () => {
    const { client, close } = await mountClient(echoFetch());
    const result = (await client.callTool({
      name: "strata_american_option",
      arguments: { S: 100, K: 100, r: 0.05, sigma: 0.2, T: 1, optionType: "call", steps: 2000 },
    })) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    // The SDK runs the declared inputSchema before invoking the handler, so
    // a schema-level reject surfaces as "Input validation error" from the
    // server rather than our handler's INVALID_INPUT path. Our handler's
    // Zod refine() is still the fallback for anything that slips past.
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await close();
  });

  it("strata_bond_stress rejects curvePoints with 1 point", async () => {
    const { client, close } = await mountClient(echoFetch());
    const result = (await client.callTool({
      name: "strata_bond_stress",
      arguments: {
        faceValue: 100,
        couponPct: 5,
        frequencyPerYear: 2,
        settlementDate: "2024-06-15",
        maturityDate: "2029-06-15",
        curvePoints: [{ t: 5, zeroPct: 4 }],
      },
    })) as unknown as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    // The SDK runs the declared inputSchema before invoking the handler, so
    // a schema-level reject surfaces as "Input validation error" from the
    // server rather than our handler's INVALID_INPUT path. Our handler's
    // Zod refine() is still the fallback for anything that slips past.
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await close();
  });
});
