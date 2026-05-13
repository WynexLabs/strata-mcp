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

const GOLDEN_KRD = {
  keyRateDurations: [
    { tenor: "0.5Y", tenorYears: 0.5, krd: 0.04, dv01: 0.4 },
    { tenor: "2Y", tenorYears: 2, krd: 0.65, dv01: 6.5 },
    { tenor: "5Y", tenorYears: 5, krd: 2.10, dv01: 21.0 },
    { tenor: "10Y", tenorYears: 10, krd: 4.91, dv01: 49.1 },
    { tenor: "30Y", tenorYears: 30, krd: 0.05, dv01: 0.5 },
  ],
  krdSum: 7.75,
  effectiveDuration: 7.78,
  notional: 100,
  inputs: {},
};

function fixedFetch(capture: { body?: unknown; url?: string } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.url = typeof input === "string" ? input : input.toString();
    capture.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(
      JSON.stringify({
        data: GOLDEN_KRD,
        meta: { asOf: "2026-05-13", source: "Bond KRD", cached: false },
        error: null,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
}

const validArgs = {
  faceValue: 100,
  couponPct: 5,
  frequencyPerYear: 2,
  settlementDate: "2024-06-15",
  maturityDate: "2034-06-15",
  curvePoints: [
    { t: 1, zeroPct: 4 },
    { t: 5, zeroPct: 4 },
    { t: 10, zeroPct: 4 },
    { t: 30, zeroPct: 4 },
  ],
};

describe("strata_bond_krd (tool wiring)", () => {
  it("is advertised via tools/list with description + inputSchema", async () => {
    const client = await mountClient(fixedFetch());
    const list = await client.listTools();
    const tool = list.tools.find((t) => t.name === "strata_bond_krd");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/key-rate|KRD/i);
    expect(tool?.inputSchema?.type).toBe("object");
    await client.close();
  });

  it("forwards a well-formed request and returns golden KRD payload + krdSum/effectiveDuration", async () => {
    const capture: { body?: unknown; url?: string } = {};
    const client = await mountClient(fixedFetch(capture));
    const result = (await client.callTool({
      name: "strata_bond_krd",
      arguments: validArgs,
    })) as unknown as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(capture.url).toBe("http://localhost:3001/api/v1/compute/bond/krd");
    const parsed = JSON.parse(result.content[0]!.text) as typeof GOLDEN_KRD;
    expect(parsed.keyRateDurations).toHaveLength(5);
    expect(parsed.krdSum).toBe(7.75);
    expect(parsed.effectiveDuration).toBe(7.78);
    expect(result.structuredContent?.krdSum).toBe(7.75);
    await client.close();
  });

  it("rejects custom tenors > 12 entries at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_krd",
      arguments: {
        ...validArgs,
        tenors: Array(13).fill(1),
      },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });

  it("rejects curvePoints with 1 point at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_krd",
      arguments: { ...validArgs, curvePoints: [{ t: 5, zeroPct: 4 }] },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });
});
