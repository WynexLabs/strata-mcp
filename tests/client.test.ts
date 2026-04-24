import { describe, expect, it } from "vitest";
import { StrataClient } from "../src/client.js";
import { StrataApiError } from "../src/errors.js";

function makeFetchMock(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init ?? {});
  }) as typeof fetch;
}

describe("StrataClient", () => {
  it("requires a non-empty API key", () => {
    expect(() => new StrataClient({ apiKey: "" })).toThrow(/STRATA_API_KEY/);
  });

  it("forwards Bearer auth header and user-agent", async () => {
    let capturedAuth: string | undefined;
    let capturedUa: string | undefined;
    let capturedUrl = "";
    const fetchImpl = makeFetchMock((url, init) => {
      capturedUrl = url;
      const h = init.headers as Record<string, string> | undefined;
      capturedAuth = h?.["authorization"];
      capturedUa = h?.["user-agent"];
      return new Response(
        JSON.stringify({ data: { echo: true }, meta: null, error: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const client = new StrataClient({
      apiKey: "sk_strata_live_abc123",
      baseUrl: "https://example.test",
      fetchImpl,
    });
    const data = await client.post<{ echo: boolean }>("/api/v1/compute/bond", { hello: 1 });
    expect(data).toEqual({ echo: true });
    expect(capturedUrl).toBe("https://example.test/api/v1/compute/bond");
    expect(capturedAuth).toBe("Bearer sk_strata_live_abc123");
    expect(capturedUa).toMatch(/strata-mcp/);
  });

  it("strips trailing slashes from baseUrl", async () => {
    let capturedUrl = "";
    const fetchImpl = makeFetchMock((url) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({ data: {}, meta: null, error: null }),
        { status: 200 },
      );
    });
    const client = new StrataClient({
      apiKey: "k",
      baseUrl: "https://example.test///",
      fetchImpl,
    });
    await client.post("/api/v1/compute/bond", {});
    expect(capturedUrl).toBe("https://example.test/api/v1/compute/bond");
  });

  it("maps upstream v1 error envelope to StrataApiError", async () => {
    const fetchImpl = makeFetchMock(() =>
      new Response(
        JSON.stringify({
          data: null,
          error: { code: "INVALID_FIELDS", message: "couponPct must be >= 0." },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new StrataClient({ apiKey: "k", fetchImpl });
    await expect(client.post("/api/v1/compute/bond", {})).rejects.toMatchObject({
      name: "StrataApiError",
      code: "INVALID_FIELDS",
      httpStatus: 400,
    });
  });

  it("maps 401 without a JSON body to UPSTREAM_NON_JSON", async () => {
    const fetchImpl = makeFetchMock(() =>
      new Response("Unauthorized", { status: 401 }),
    );
    const client = new StrataClient({ apiKey: "k", fetchImpl });
    await expect(client.post("/api/v1/compute/bond", {})).rejects.toMatchObject({
      name: "StrataApiError",
      code: "UPSTREAM_NON_JSON",
      httpStatus: 401,
    });
  });

  it("maps network failure to NETWORK_ERROR", async () => {
    const fetchImpl = makeFetchMock(() => {
      throw new TypeError("fetch failed: ENOTFOUND");
    });
    const client = new StrataClient({ apiKey: "k", fetchImpl });
    await expect(client.post("/api/v1/compute/bond", {})).rejects.toBeInstanceOf(StrataApiError);
    await expect(client.post("/api/v1/compute/bond", {})).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      httpStatus: 0,
    });
  });

  it("contract: accepts the exact envelope shape returned by production", async () => {
    // Snapshot of an actual production response captured 2026-04-24 against
    // /api/v1/compute/bond. Note: NO `status` field — lib/v1-response.ts only
    // emits { data, meta, error }. Regression guard for the mis-coded
    // "status: 'ok' | 'error'" check that shipped in 275a9c8 and broke every
    // real upstream call.
    const prodEnvelope = {
      data: {
        price: 100.21,
        cleanPrice: 100.21,
        dirtyPrice: 100.21,
        accrued: 0,
        ytmPct: 4.25,
        risk: { modifiedDuration: 4.46, macaulayDuration: 4.56, convexity: 23.27, dv01: 0.0447 },
        gSpreadBp: null,
        gSpreadBenchmark: null,
        inputs: {},
      },
      meta: { asOf: "2026-04-24", source: "Bond Analytics", cached: false },
      error: null,
    };
    const fetchImpl = makeFetchMock(() =>
      new Response(JSON.stringify(prodEnvelope), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new StrataClient({ apiKey: "k", fetchImpl });
    const data = await client.post<{ ytmPct: number }>("/api/v1/compute/bond", {});
    expect(data.ytmPct).toBe(4.25);
  });

  it("rejects a 200 response whose envelope is malformed", async () => {
    const fetchImpl = makeFetchMock(() =>
      new Response(
        JSON.stringify({ data: null, meta: null, error: null }),
        { status: 200 },
      ),
    );
    const client = new StrataClient({ apiKey: "k", fetchImpl });
    await expect(client.post("/api/v1/compute/bond", {})).rejects.toMatchObject({
      code: "UPSTREAM_MALFORMED",
    });
  });
});
