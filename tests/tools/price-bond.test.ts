import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}

async function mountClient(fetchImpl: typeof fetch): Promise<Client> {
  const server = createServer({ apiKey: "test-key", baseUrl: "http://localhost:3001", fetchImpl });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function okFetch(capture: { body?: unknown; url?: string } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.url = typeof input === "string" ? input : input.toString();
    capture.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(
      JSON.stringify({
        data: {
          price: 100.0,
          cleanPrice: 100.0,
          dirtyPrice: 100.0,
          accrued: 0,
          ytmPct: 4.5,
          risk: { modifiedDuration: 7.2, macaulayDuration: 7.4, convexity: 60.1, dv01: 720 },
          gSpreadBp: null,
          gSpreadBenchmark: null,
          inputs: {},
        },
        meta: { asOf: "2026-04-23", source: "Bond Analytics", cached: false },
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

describe("strata_price_bond (tool wiring)", () => {
  it("is advertised via tools/list with description + inputSchema", async () => {
    const client = await mountClient(okFetch());
    const list = await client.listTools();
    const tool = list.tools.find((t) => t.name === "strata_price_bond");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/fixed-coupon/i);
    expect(tool?.inputSchema?.type).toBe("object");
    expect(Object.keys((tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})).toEqual(
      expect.arrayContaining([
        "faceValue",
        "couponPct",
        "frequencyPerYear",
        "settlementDate",
        "maturityDate",
      ]),
    );
    await client.close();
  });

  it("forwards a well-formed request and returns JSON content + structuredContent", async () => {
    const capture: { body?: unknown; url?: string } = {};
    const client = await mountClient(okFetch(capture));
    const result = (await client.callTool({
      name: "strata_price_bond",
      arguments: {
        faceValue: 1000,
        couponPct: 4.5,
        frequencyPerYear: 2,
        settlementDate: "2026-04-23",
        maturityDate: "2030-04-23",
        ytmPct: 4.5,
      },
    })) as unknown as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(capture.url).toBe("http://localhost:3001/api/v1/compute/bond");
    expect(capture.body).toMatchObject({ faceValue: 1000, ytmPct: 4.5 });
    expect(result.content[0]?.type).toBe("text");
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ytmPct: 4.5, cleanPrice: 100 });
    expect(result.structuredContent?.ytmPct).toBe(4.5);
    await client.close();
  });

  it("rejects when both ytmPct and cleanPrice are supplied", async () => {
    const client = await mountClient(okFetch());
    const result = (await client.callTool({
      name: "strata_price_bond",
      arguments: {
        faceValue: 1000,
        couponPct: 4.5,
        frequencyPerYear: 2,
        settlementDate: "2026-04-23",
        maturityDate: "2030-04-23",
        ytmPct: 4.5,
        cleanPrice: 100,
      },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Exactly one of ytmPct or cleanPrice/);
    await client.close();
  });

  it("surfaces upstream v1 error envelopes as isError tool results", async () => {
    const errFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          data: null,
          error: {
            code: "INVALID_FIELDS",
            message: "maturityDate must be after settlementDate.",
          },
        }),
        { status: 400 },
      )) as typeof fetch;
    const client = await mountClient(errFetch);
    const result = (await client.callTool({
      name: "strata_price_bond",
      arguments: {
        faceValue: 1000,
        couponPct: 4.5,
        frequencyPerYear: 2,
        settlementDate: "2030-04-23",
        maturityDate: "2026-04-23",
        ytmPct: 4.5,
      },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/INVALID_FIELDS/);
    expect(result.content[0]?.text).toMatch(/maturityDate must be after settlementDate/);
    await client.close();
  });
});
