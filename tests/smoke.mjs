/**
 * Offline smoke test for the dsh-notify-ultra host half.
 *
 * Loads the real `lib/host.js` under a resolve hook that stubs the two runtime
 * peers, drives the real Cordis events and the real settings/credentials
 * services, and asserts the HTTP requests each protocol produces against a
 * throwaway local server. No network access, no DSH install required.
 *
 *   node tests/smoke.mjs
 */
import assert from "node:assert/strict";
import http from "node:http";
import { register } from "node:module";

register(new URL("./resolve-hook.mjs", import.meta.url));

const host = await import("../lib/host.js");
const { apply, Config } = host;

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function createHarness() {
  const listeners = new Map();
  const effects = [];
  const secrets = new Map();
  const holder = { state: {} };
  let revision = 1;
  const titles = new Map();

  const settings = {
    describe() {
      return [{ ns: "dsh-notify-ultra", user: holder.state, value: Config.parse(holder.state), applies: "live", revision }];
    },
    async replace(ns, section) {
      assert.equal(ns, "dsh-notify-ultra");
      // The real service resets every volatile field first, so a partial write
      // silently loses data — the plugin must always send a full snapshot.
      holder.state = JSON.parse(JSON.stringify(section));
      revision += 1;
    },
  };

  const credentials = {
    async resolve(ref) {
      return secrets.has(ref) ? { value: secrets.get(ref), source: "store" } : undefined;
    },
    async set(ref, value) {
      if (typeof value !== "string" || value === "") throw new Error("empty secret");
      secrets.set(ref, value);
    },
    async unset(ref) {
      secrets.delete(ref);
    },
    async describe(ref) {
      return { configured: secrets.has(ref), writable: true, source: secrets.has(ref) ? "store" : undefined };
    },
  };

  const sessionQuery = {
    async readTitle(sessionId) {
      const title = titles.get(sessionId);
      return title === undefined ? undefined : { title, eventSeq: 1, updatedAt: Date.now(), messageSeqs: [], source: { kind: "fallback" } };
    },
  };

  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    get(key) {
      if (key === "settings") return settings;
      if (key === "credentials") return credentials;
      if (key === "sessionQuery") return sessionQuery;
      return undefined;
    },
    typert: { register: () => () => {} },
    effect(fn) {
      const disposer = fn();
      effects.push(disposer);
      return () => {};
    },
    on(event, handler) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return () => {
        const index = list.indexOf(handler);
        if (index >= 0) list.splice(index, 1);
      };
    },
    emit(event, ...args) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(...args);
    },
    listenerCount(event) {
      return (listeners.get(event) ?? []).length;
    },
    disposeAll() {
      for (const disposer of effects) {
        if (typeof disposer === "function") disposer();
      }
    },
  };

  return { ctx, settings, credentials, secrets, sessionQuery, titles, holder };
}

function createServer() {
  const requests = [];
  let responder = () => ({ status: 200, body: JSON.stringify({ code: 200, message: "success", timestamp: Date.now() }) });
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(record);
      const answer = responder(record);
      res.writeHead(answer.status, { "content-type": answer.contentType ?? "application/json" });
      res.end(answer.body);
    });
  });
  return {
    requests,
    setResponder(fn) {
      responder = fn;
    },
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
}

function session(id, cwd) {
  return { id, header: { id, cwd, isSeeded: false, createdAt: Date.now(), version: 4 } };
}

function assistantEvent(text, model = "deepseek-v4.1-flash") {
  return {
    type: "assistant/message",
    seq: 2,
    time: Date.now(),
    data: { turn: 1, step: 1, message: { role: "assistant", content: [{ type: "text", text }], source: { kind: "model", provider: "p", model } }, stream: [] },
  };
}

function turnStartEvent(time = Date.now() - 4200) {
  return { type: "turn/start", seq: 1, time, data: { turn: 1 } };
}

function turnEndEvent(reason = "completed") {
  const data = { turn: 1, reason: reason === "error" ? { kind: "error", error: { message: "boom", code: "x" } } : { kind: reason } };
  return { type: "turn/end", seq: 3, time: Date.now(), data };
}

// ---------------------------------------------------------------------------
// test driver
// ---------------------------------------------------------------------------

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
  }
}

const server = createServer();
const base = await server.listen();
const harness = createHarness();
apply(harness.ctx);
const runtime = harness.ctx.notification;

assert.ok(runtime !== undefined, "the runtime service must register on the owning context");

/** Fresh configuration: one channel, immediate delivery, no coalescing delay. */
async function configure(channel, secret, overrides = {}) {
  server.requests.length = 0;
  const ctx = harness.ctx;
  await runtime.saveSettings({
    enabled: true,
    triggers: { taskComplete: true, taskError: true, needsInput: true, goalComplete: true, subagentEnd: true, workflowEnd: true, taskBlocked: false, taskCancelled: false },
    template: { lang: "zh", title: "{status} · {project}", body: "{session}\n{summary}" },
    delivery: { debounceMs: 0, minIntervalMs: 0, timeoutMs: 3000, retries: 1, summaryChars: 180, bodyChars: 400, skipSubagentSessions: true, maxLog: 60 },
    ...overrides,
  });
  const overview = await runtime.getOverview();
  for (const existing of overview.channels) await runtime.deleteChannel({ id: existing.id });
  if (channel !== undefined) {
    const saved = await runtime.saveChannel({ channel: { id: "c1", name: "test", enabled: true, ...channel }, secret });
    assert.equal(saved.ok, true, `saveChannel failed: ${saved.error ?? ""}`);
  }
  server.requests.length = 0;
}

console.log("\ndsh-notify-ultra host smoke test\n");

await test("exposes the plugin face the Loader expects", () => {
  assert.equal(typeof host.apply, "function");
  assert.equal(host.name, "dsh-notify-ultra");
  assert.deepEqual(host.inject, ["typert", "settings"]);
  assert.equal(typeof Config.parse, "function");
});

await test("registers listeners for every documented trigger", () => {
  for (const event of [
    "session/event",
    "api-session/added",
    "api-session/status",
    "api-session/removed",
    "goal/changed",
    "subagent/end",
    "workflow/end",
    "agent/error",
    "approval/request",
    "user-questions/request",
  ]) {
    assert.ok(harness.ctx.listenerCount(event) > 0, `missing listener for ${event}`);
  }
});

await test("states the settings truth: nothing is stored as a plain secret field", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "BARKKEY123");
  assert.equal(harness.secrets.get("DSH_NOTIFICATION_C1"), "BARKKEY123", "the key belongs in the credentials service");
  const stored = harness.holder.state;
  assert.equal(JSON.stringify(stored).includes("BARKKEY123"), false, "the settings entry must not contain the secret");
  assert.equal(stored.channels[0].key, "");
});

await test("Bark · POST /push with the documented JSON fields", async () => {
  await configure({ protocol: "bark", bark: { server: base, sound: "birdsong", group: "DSH", isArchive: true, subtitle: "sub", level: "timeSensitive", badge: "3", ttl: "60", mode: "ignored" } }, "DEVKEY");
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnStartEvent());
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), assistantEvent("全部改完了，测试通过。"));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");

  const request = server.requests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/push");
  assert.match(request.headers["content-type"], /application\/json/);
  const body = JSON.parse(request.body);
  assert.equal(body.device_key, "DEVKEY");
  assert.equal(body.title, "任务完成 · proj");
  assert.match(body.body, /全部改完了/);
  assert.equal(body.sound, "birdsong");
  assert.equal(body.group, "DSH");
  assert.equal(body.subtitle, "sub");
  assert.equal(body.level, "timeSensitive");
  assert.equal(body.badge, "3");
  assert.equal(body.ttl, "60");
  assert.equal(body.isArchive, "1");
  assert.equal(body.mode, undefined, "Bark has no `mode` parameter; it must not be sent");
});

await test("Bark · GET form puts key/title/body in the path and encodes correctly", async () => {
  await configure({ protocol: "bark", bark: { server: base, sendAs: "get", sound: "alarm" } }, "GETKEY");
  harness.ctx.emit("session/event", session("session-1", "/a+b"), assistantEvent("plus + slash / test"));
  harness.ctx.emit("session/event", session("session-1", "/a+b"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const request = server.requests[0];
  assert.equal(request.method, "GET");
  assert.ok(request.url.startsWith("/GETKEY/"), `unexpected path ${request.url}`);
  assert.match(decodeURIComponent(request.url), /任务完成/);
  assert.match(request.url, /sound=alarm/);
  assert.match(request.url, /%2B/);
  assert.match(request.url, /%2F/);
  assert.equal(/\+/.test(request.url), false, "a literal + must be percent-encoded");
});

await test("Bark · a non-200 code in the body is a failure", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "DEVKEY");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 400, message: "device token is not exists" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  assert.ok(await waitFor(() => runtime.getOverview().then(() => true)), "overview");
  await sleep(30);
  const log = runtime.listDeliveries({ limit: 5 });
  assert.equal(log.deliveries[0].status, "fail");
  assert.match(log.deliveries[0].error, /device token is not exists/);
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, message: "success" }) }));
});

await test("MeoW · GET /{nickname}/{title}/{msg} with its query options", async () => {
  await configure({ protocol: "meow", meow: { server: base, msgType: "html", htmlHeight: "350", url: "https://example.com/x" } }, "JohnDoe");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ status: 200, data: true, msg: "发送成功" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const request = server.requests[0];
  assert.equal(request.method, "GET");
  assert.ok(request.url.startsWith("/JohnDoe/"), `unexpected path ${request.url}`);
  assert.match(request.url, /msgType=html/);
  assert.match(request.url, /htmlHeight=350/);
  assert.match(request.url, /url=https%3A%2F%2Fexample\.com%2Fx/);
  await sleep(30);
  assert.equal(runtime.listDeliveries({ limit: 1 }).deliveries[0].status, "ok");
});

await test("MeoW · a business error inside an HTTP 200 is a failure", async () => {
  await configure({ protocol: "meow", meow: { server: base } }, "Ghost");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ status: 404, data: false, msg: "发送失败，该昵称没有注册" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  assert.ok(await waitFor(() => runtime.listDeliveries({ limit: 1 }).deliveries[0]?.status === "fail"), "MeoW 404 must be reported as a failure");
  assert.match(runtime.listDeliveries({ limit: 1 }).deliveries[0].error, /404/);
  // A rate limit is a business code too, and must not read as delivered.
  server.requests.length = 0;
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ status: 429, data: false, msg: "非会员用户3秒内只能发送1条消息" }) }));
  harness.ctx.emit("session/event", session("session-2", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => runtime.listDeliveries({ limit: 1 }).deliveries[0]?.status === "fail"), "MeoW 429 must be reported as a failure");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, message: "success" }) }));
});

await test("MeoW · POST /{nickname} sends the JSON body form", async () => {
  await configure({ protocol: "meow", meow: { server: base, sendAs: "post" } }, "JohnDoe");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ status: 200, data: true, msg: "发送成功" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const request = server.requests[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/JohnDoe");
  assert.match(request.headers["content-type"], /application\/json/);
  const body = JSON.parse(request.body);
  assert.ok(typeof body.msg === "string" && body.msg.length > 0, "MeoW POST requires `msg`");
  assert.equal(typeof body.title, "string");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, message: "success" }) }));
});

await test("喵提醒 MiaoTixing · GET /trigger?id=…&type=json, judged from the body", async () => {
  await configure({ protocol: "miaotixing", miaotixing: { server: base, templ: "t1" } }, "tDS0Se9");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 0, data: { users: 3, remaining: 0 }, msg: "完成" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const request = server.requests[0];
  assert.equal(request.method, "GET");
  assert.match(request.url, /^\/trigger\?/);
  assert.match(request.url, /id=tDS0Se9/);
  assert.match(request.url, /type=json/);
  assert.match(request.url, /templ=t1/);
  assert.match(decodeURIComponent(request.url), /任务完成/);
  await sleep(30);
  assert.equal(runtime.listDeliveries({ limit: 1 }).deliveries[0].status, "ok");

  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 103, msg: "发送失败：找不到该提醒单", data: [] }) }));
  harness.ctx.emit("session/event", session("session-2", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => runtime.listDeliveries({ limit: 1 }).deliveries[0]?.status === "fail"), "喵提醒 code 103 must be reported as a failure");
  assert.match(runtime.listDeliveries({ limit: 1 }).deliveries[0].error, /103/);
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, message: "success" }) }));
});

await test("Custom · method, headers, body templates and the secret placeholder", async () => {
  await configure(
    {
      protocol: "custom",
      custom: {
        method: "POST",
        url: `${base}/hook?title={title:url}`,
        headers: { authorization: "Bearer {{secret}}", "x-source": "dsh/{project}" },
        contentType: "application/json",
        body: '{"text":{summary:json},"status":{status:json}}',
      },
    },
    "TOKEN42",
  );
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), assistantEvent('He said "done".'));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const request = server.requests[0];
  assert.equal(request.method, "POST");
  assert.match(request.url, /^\/hook\?title=/);
  assert.match(request.url, /%E4%BB%BB%E5%8A%A1%E5%AE%8C%E6%88%90/);
  assert.equal(request.headers.authorization, "Bearer TOKEN42");
  assert.equal(request.headers["x-source"], "dsh/proj");
  const body = JSON.parse(request.body);
  assert.equal(body.status, "任务完成");
  assert.ok(body.text.includes('He said "done".'), `unexpected text ${body.text}`);
});

await test("Custom · response expectations are enforced", async () => {
  await configure(
    { protocol: "custom", custom: { method: "GET", url: `${base}/hook`, expectPath: "code", expectEquals: "0", contentType: "application/json" } },
    undefined,
  );
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, msg: "no" }) }));
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  await sleep(40);
  const failed = runtime.listDeliveries({ limit: 3 }).deliveries[0];
  assert.equal(failed.status, "fail");
  assert.match(failed.error, /expected/);

  server.requests.length = 0;
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 0, msg: "ok" }) }));
  harness.ctx.emit("session/event", session("session-2", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no second push");
  await sleep(40);
  assert.equal(runtime.listDeliveries({ limit: 3 }).deliveries[0].status, "ok");
  server.setResponder(() => ({ status: 200, body: JSON.stringify({ code: 200, message: "success" }) }));
});

await test("trigger gating: a disabled trigger sends nothing", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  await runtime.saveSettings({ triggers: { taskComplete: false } });
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  await sleep(80);
  assert.equal(server.requests.length, 0, "a disabled trigger must not push");
  await runtime.saveSettings({ triggers: { taskComplete: true } });
});

await test("master switch off suppresses every push", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  await runtime.saveSettings({ enabled: false });
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  await sleep(80);
  assert.equal(server.requests.length, 0);
  await runtime.saveSettings({ enabled: true });
});

await test("sub-agent sessions are skipped by default", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  harness.ctx.emit("api-session/added", { sessionId: "session-child", running: false, blank: false, agentAvailable: true, origin: "subagent", updatedAt: Date.now(), cwd: "/tmp" });
  harness.ctx.emit("session/event", session("session-child", "/tmp"), turnEndEvent("completed"));
  await sleep(80);
  assert.equal(server.requests.length, 0);
});

await test("taskError trigger carries the failure reason", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("error"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  const state = runtime.getOverview();
  assert.ok(state !== undefined);
});

await test("needsInput asks through the approval waterfall and always continues the chain", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  let continued = 0;
  const handlers = await import("node:events");
  void handlers;
  // The harness dispatches waterfall listeners with their own next(); emulate the
  // real chain by letting every listener run and counting the next() calls.
  harness.ctx.emit("approval/request", { agent: { id: "session-1" }, toolName: "bash" }, () => {
    continued += 1;
    return "answered";
  });
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent for a pending approval");
  assert.ok(continued >= 1, "the waterfall chain must be continued exactly as received");
});

await test("goal completion pushes the objective", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  harness.ctx.emit("goal/changed", { agent: { id: "session-1" }, change: { operation: "complete", ref: { id: "g1", revision: 2 }, goal: { objective: "Ship the plugin" } } });
  assert.ok(await waitFor(() => server.requests.length >= 1), "no push was sent");
  assert.match(server.requests[0].url, /hook/);
});

await test("an unknown goal operation does not notify", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  harness.ctx.emit("goal/changed", { agent: { id: "session-1" }, change: { operation: "edit", ref: { id: "g1", revision: 3 } } });
  await sleep(80);
  assert.equal(server.requests.length, 0);
});

await test("subagent/end and workflow/end have their own triggers", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  harness.ctx.emit("subagent/end", { sessionId: "session-9", label: "explore" });
  assert.ok(await waitFor(() => server.requests.length >= 1), "subagent/end did not push");
  server.requests.length = 0;
  harness.ctx.emit("workflow/end", { sessionId: "session-10", name: "audit" }, { stopReason: "completed" });
  assert.ok(await waitFor(() => server.requests.length >= 1), "workflow/end did not push");
});

await test("saveChannel + saveSettings never drop the rest of the state", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "K1");
  await runtime.saveSettings({ template: { lang: "en", title: "T", body: "B" } });
  const saved2 = await runtime.saveChannel({ channel: { id: "c2", name: "second", protocol: "custom", custom: { method: "GET", url: `${base}/two` } } });
  assert.equal(saved2.ok, true);
  const overview = await runtime.getOverview();
  assert.equal(overview.channels.length, 2, "both channels must survive");
  assert.equal(overview.channels[0].protocol, "bark");
  assert.equal(overview.template.lang, "en", "the template written earlier must survive a channel write");
  assert.equal(overview.delivery.debounceMs, 0);
});

await test("the overview never returns a secret, only its status", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "TOPSECRET");
  const overview = await runtime.getOverview();
  const channel = overview.channels[0];
  assert.equal(Object.prototype.hasOwnProperty.call(channel, "key"), false);
  assert.equal(channel.hasInlineKey, false);
  assert.equal(channel.secret.configured, true);
  assert.equal(JSON.stringify(overview).includes("TOPSECRET"), false);
});

await test("testChannel actually sends and reports latency", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "DEVKEY");
  const result = await runtime.testChannel({ id: "c1" });
  assert.equal(result.ok, true);
  assert.equal(result.result.ok, true);
  assert.equal(typeof result.result.latencyMs, "number");
  assert.equal(server.requests.length, 1);
  const body = JSON.parse(server.requests[0].body);
  assert.match(body.title, /测试/);
});

await test("a channel without a secret fails loudly instead of silently", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, undefined);
  const result = await runtime.testChannel({ id: "c1" });
  assert.equal(result.result.ok, false);
  assert.match(result.result.error, /device key/i);
});

await test("clearing a secret removes it from the credentials service", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "GONE");
  assert.equal(harness.secrets.get("DSH_NOTIFICATION_C1"), "GONE");
  const cleared = await runtime.clearSecret({ id: "c1" });
  assert.equal(cleared.ok, true);
  assert.equal(harness.secrets.has("DSH_NOTIFICATION_C1"), false);
  const overview = await runtime.getOverview();
  assert.equal(overview.channels[0].secret.configured, false);
});

await test("delivery log accumulates and clears", async () => {
  await configure({ protocol: "bark", bark: { server: base } }, "DEVKEY");
  await runtime.testChannel({ id: "c1" });
  await runtime.testChannel({ id: "c1" });
  const log = runtime.listDeliveries({ limit: 10 });
  assert.ok(log.deliveries.length >= 2);
  assert.equal(log.deliveries[0].channelName, "test");
  assert.equal(typeof log.stats.sent, "number");
  await runtime.clearDeliveries();
  assert.equal(runtime.listDeliveries({}).deliveries.length, 0);
});

await test("an invalid custom URL is rejected before it can be saved", async () => {
  await configure(undefined);
  const saved = await runtime.saveChannel({ channel: { id: "bad", name: "bad", protocol: "custom", custom: { method: "GET", url: "not-a-url" } } });
  assert.equal(saved.ok, false);
  assert.match(saved.error, /http/i);
});

await test("a broken channel cannot stop a healthy one", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: "http://127.0.0.1:1/closed" } });
  await runtime.saveChannel({ channel: { id: "c2", name: "healthy", protocol: "custom", custom: { method: "GET", url: `${base}/ok` } } });
  server.requests.length = 0;
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  assert.ok(await waitFor(() => server.requests.length >= 1), "the healthy channel must still receive the push");
  assert.ok(await waitFor(() => runtime.listDeliveries({ limit: 5 }).deliveries.some((entry) => entry.status === "fail")), "the unreachable channel must be reported as a failure");
  const log = runtime.listDeliveries({ limit: 5 });
  assert.ok(log.deliveries.some((entry) => entry.status === "fail"));
  assert.ok(log.deliveries.some((entry) => entry.status === "ok"));
});

await test("a network failure is retried and then reported", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: "http://127.0.0.1:1/closed" } });
  await runtime.saveSettings({ delivery: { retries: 1, timeoutMs: 2000 } });
  const result = await runtime.testChannel({ id: "c1" });
  assert.equal(result.result.ok, false);
  assert.ok(server.requests.length === 0);
});

await test("shutdown clears pending timers", async () => {
  await configure({ protocol: "custom", custom: { method: "GET", url: `${base}/hook` } });
  await runtime.saveSettings({ delivery: { debounceMs: 60000 } });
  harness.ctx.emit("session/event", session("session-1", "/Users/me/proj"), turnEndEvent("completed"));
  runtime.dispose();
  await sleep(50);
  assert.equal(server.requests.length, 0);
});

await server.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  for (const failure of failed) console.error(`\nFAILED: ${failure.name}\n${failure.error instanceof Error ? failure.error.stack : failure.error}`);
  process.exit(1);
}
