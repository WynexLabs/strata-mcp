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

// Golden upstream response — matches the v1 envelope shape returned by
// /api/v1/compute/bond/oas. The tool MUST forward the body unmodified and
// surface the data block as JSON text + structuredContent. If the shape on
// the route changes, this fixture should be updated to mirror it.
const GOLDEN_OAS = {
  oasBp: 47.5,
  oadDuration: 4.21,
  oacConvexity: 22.8,
  optionFreeDirtyPrice: 100.45,
  optionAdjDirtyPrice: 99.0,
  optionValuePct: 1.45,
  accrued: 0,
  notional: 100,
  ttmYears: 5.0,
  modelInputs: { sigma: 0.15, steps: 10, dt: 0.5 },
  inputs: {},
};

function fixedFetch(capture: { body?: unknown; url?: string } = {}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    capture.url = typeof input === "string" ? input : input.toString();
    capture.body = init?.body ? JSON.parse(init.body as string) : undefined;
    return new Response(
      JSON.stringify({
        data: GOLDEN_OAS,
        meta: { asOf: "2026-05-13", source: "Bond OAS", cached: false },
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
  settlementDate: "2024-01-15",
  maturityDate: "2029-01-15",
  cleanPrice: 99,
  curvePoints: [
    { t: 1, zeroPct: 5 },
    { t: 5, zeroPct: 5 },
    { t: 10, zeroPct: 5 },
  ],
  callSchedule: [{ date: "2026-01-15", price: 100 }],
};

describe("strata_bond_oas (tool wiring)", () => {
  it("is advertised via tools/list with description + inputSchema", async () => {
    const client = await mountClient(fixedFetch());
    const list = await client.listTools();
    const tool = list.tools.find((t) => t.name === "strata_bond_oas");
    expect(tool).toBeDefined();
    expect(tool?.description).toMatch(/OAS|Option-Adjusted/);
    expect(tool?.inputSchema?.type).toBe("object");
    const props = Object.keys(
      (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    expect(props).toEqual(
      expect.arrayContaining(["faceValue", "curvePoints", "callSchedule", "cleanPrice"]),
    );
    await client.close();
  });

  it("forwards a well-formed request and returns the golden OAS payload", async () => {
    const capture: { body?: unknown; url?: string } = {};
    const client = await mountClient(fixedFetch(capture));
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: validArgs,
    })) as unknown as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(capture.url).toBe("http://localhost:3001/api/v1/compute/bond/oas");
    expect(capture.body).toMatchObject({ cleanPrice: 99 });
    const parsed = JSON.parse(result.content[0]!.text) as typeof GOLDEN_OAS;
    expect(parsed.oasBp).toBe(47.5);
    expect(parsed.oadDuration).toBe(4.21);
    expect(parsed.oacConvexity).toBe(22.8);
    expect(result.structuredContent?.oasBp).toBe(47.5);
    await client.close();
  });

  it("rejects when both callSchedule and putSchedule are missing", async () => {
    const { callSchedule: _omit, ...rest } = validArgs;
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: rest,
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation|callSchedule|putSchedule)/);
    await client.close();
  });

  it("rejects sigma > 0.6 at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: { ...validArgs, sigma: 1.2 },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });

  // --- HW1F (model + alpha) schema additions --------------------------------

  it("advertises model and alpha in the tool input schema", async () => {
    const client = await mountClient(fixedFetch());
    const list = await client.listTools();
    const tool = list.tools.find((t) => t.name === "strata_bond_oas");
    expect(tool).toBeDefined();
    const props = (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["model", "alpha"]));
    expect(tool?.description).toMatch(/bdt/);
    expect(tool?.description).toMatch(/hw1f/i);
    expect(tool?.description).toMatch(/Hull-?White/i);
    await client.close();
  });

  it("forwards model='hw1f' and alpha to the v1 route", async () => {
    const capture: { body?: unknown; url?: string } = {};
    const client = await mountClient(fixedFetch(capture));
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: { ...validArgs, model: "hw1f", alpha: 0.05 },
    })) as unknown as ToolResult;
    expect(result.isError).toBeFalsy();
    expect(capture.body).toMatchObject({ model: "hw1f", alpha: 0.05 });
    await client.close();
  });

  it("rejects model values outside the 'bdt' | 'hw1f' enum at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: { ...validArgs, model: "vasicek" },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });

  it("rejects alpha below 0.001 at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: { ...validArgs, model: "hw1f", alpha: 0.0001 },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });

  it("rejects alpha above 0.5 at schema layer", async () => {
    const client = await mountClient(fixedFetch());
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: { ...validArgs, model: "hw1f", alpha: 1.0 },
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/(INVALID_INPUT|Input validation)/);
    await client.close();
  });

  it("surfaces upstream v1 error envelopes as isError tool results", async () => {
    const errFetch: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          data: null,
          error: { code: "COMPUTATION_ERROR", message: "Could not solve OAS — bracket failed." },
        }),
        { status: 400 },
      )) as typeof fetch;
    const client = await mountClient(errFetch);
    const result = (await client.callTool({
      name: "strata_bond_oas",
      arguments: validArgs,
    })) as unknown as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/COMPUTATION_ERROR/);
    await client.close();
  });
});
