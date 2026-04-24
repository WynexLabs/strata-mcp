#!/usr/bin/env node
// Smoke test: spawn the built stdio server, run the MCP initialize handshake
// + tools/list + a schema-level tools/call (rejected locally by the Zod
// refine(), so no upstream HTTP is performed). Exits 0 on success, 1 on
// failure, with human-readable output on stderr.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "..", "dist", "index.js");

const child = spawn(process.execPath, [serverEntry], {
  env: { ...process.env, STRATA_API_KEY: "smoke-test-key" },
  stdio: ["pipe", "pipe", "pipe"],
});

let stderrBuf = "";
child.stderr.on("data", (d) => { stderrBuf += d.toString(); });

let stdoutBuf = "";
const pending = new Map();
child.stdout.on("data", (chunk) => {
  stdoutBuf += chunk.toString();
  let idx;
  while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.slice(0, idx).trim();
    stdoutBuf = stdoutBuf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(`smoke: non-JSON line on stdout: ${line}\n`);
      continue;
    }
    if (typeof msg.id !== "undefined" && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function request(id, method, params) {
  return new Promise((res, rej) => {
    pending.set(id, res);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error(`timed out waiting for response id=${id} method=${method}`));
      }
    }, 5000);
  });
}

function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function fail(msg) {
  process.stderr.write(`smoke: FAIL — ${msg}\n`);
  if (stderrBuf) process.stderr.write(`smoke: child stderr:\n${stderrBuf}\n`);
  child.kill("SIGKILL");
  process.exit(1);
}

try {
  const init = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  if (init.error) fail(`initialize error: ${JSON.stringify(init.error)}`);
  if (!init.result?.serverInfo?.name) fail("initialize missing serverInfo.name");
  if (init.result.serverInfo.name !== "strata-mcp") {
    fail(`expected serverInfo.name=strata-mcp, got ${init.result.serverInfo.name}`);
  }

  notify("notifications/initialized", {});

  const list = await request(2, "tools/list", {});
  if (list.error) fail(`tools/list error: ${JSON.stringify(list.error)}`);
  const expected = [
    "strata_price_bond",
    "strata_bond_spreads",
    "strata_bond_stress",
    "strata_bond_horizon",
    "strata_bsm",
    "strata_american_option",
    "strata_portfolio_var",
  ];
  const got = (list.result?.tools ?? []).map((t) => t.name).sort();
  const missing = expected.filter((n) => !got.includes(n));
  if (missing.length) fail(`tools/list missing: ${missing.join(", ")} (got ${got.join(", ")})`);
  const tool = list.result?.tools?.find((t) => t.name === "strata_price_bond");
  if (!tool?.inputSchema?.properties?.faceValue)
    fail("strata_price_bond inputSchema missing faceValue");

  const callRes = await request(3, "tools/call", {
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
  });
  if (callRes.error) fail(`tools/call transport error: ${JSON.stringify(callRes.error)}`);
  if (!callRes.result?.isError) fail("expected isError=true on conflicting inputs");
  const txt = callRes.result?.content?.[0]?.text ?? "";
  if (!/Exactly one of ytmPct or cleanPrice/.test(txt)) {
    fail(`unexpected error text: ${txt}`);
  }

  process.stderr.write("smoke: OK — initialize, tools/list, tools/call (schema reject) all succeeded.\n");
  child.kill("SIGTERM");
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
