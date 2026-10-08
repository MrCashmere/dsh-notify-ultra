/**
 * Offline smoke test for the dsh-notify-ultra client half.
 *
 * Loads the real `lib/client.js` bundle through a stub `window.__ModuleLoader__`,
 * renders the Settings page with a very small React stand-in (hooks included),
 * and walks the rendered tree the way a user would: open a tab, toggle a switch,
 * press a button. Every RPC the page issues is asserted.
 *
 *   node tests/client-smoke.mjs
 */
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// tiny React
// ---------------------------------------------------------------------------

function createReact() {
  const store = new Map();
  const pendingEffects = [];
  let current = null;
  let onChange = () => {};

  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  const React = {
    createElement(type, props, ...children) {
      const flat = [];
      const push = (child) => {
        if (Array.isArray(child)) child.forEach(push);
        else if (child !== null && child !== undefined && child !== false && child !== true) flat.push(child);
      };
      children.forEach(push);
      return { type, props: Object.assign({}, props, { children: flat.length === 1 ? flat[0] : flat }) };
    },
    useState(initial) {
      const hook = current.hook();
      if (hook.init !== true) {
        hook.value = typeof initial === "function" ? initial() : initial;
        hook.init = true;
      }
      return [
        hook.value,
        (next) => {
          hook.value = typeof next === "function" ? next(hook.value) : next;
          onChange();
        },
      ];
    },
    useEffect(fn, deps) {
      const hook = current.hook();
      if (!sameDeps(hook.deps, deps)) {
        hook.deps = deps;
        pendingEffects.push(fn);
      }
    },
    useCallback(fn, deps) {
      const hook = current.hook();
      if (hook.fn === undefined || !sameDeps(hook.deps, deps)) {
        hook.fn = fn;
        hook.deps = deps;
      }
      return hook.fn;
    },
    useMemo(fn, deps) {
      const hook = current.hook();
      if (!sameDeps(hook.deps, deps)) {
        hook.deps = deps;
        hook.value = fn();
      }
      return hook.value;
    },
    useRef(value) {
      const hook = current.hook();
      if (hook.init !== true) {
        hook.value = { current: value };
        hook.init = true;
      }
      return hook.value;
    },
    useId() {
      return "id";
    },
  };

  return {
    React,
    setOnChange(fn) {
      onChange = fn;
    },
    /** Render one component tree, running effects and settling state updates. */
    render(type, props) {
      let tree;
      for (let pass = 0; pass < 25; pass += 1) {
        store.forEach((hooks) => hooks.forEach((hook) => { hook.cursor = 0; }));
        tree = renderNode({ type, props: Object.assign({}, props, { children: [] }) }, []);
        if (pendingEffects.length === 0) break;
        const effects = pendingEffects.splice(0, pendingEffects.length);
        for (const effect of effects) {
          const cleanup = effect();
          if (typeof cleanup === "function") cleanup();
        }
      }
      return tree;
    },
  };

  function renderNode(node, path) {
    if (node === null || node === undefined || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, path.concat(index)));
    const { type, props } = node;
    if (typeof type === "function") {
      const key = path.join(".");
      let hooks = store.get(key);
      if (hooks === undefined) {
        hooks = [];
        store.set(key, hooks);
      }
      const frame = {
        hook() {
          const index = frame.cursor;
          frame.cursor += 1;
          if (hooks[index] === undefined) hooks[index] = {};
          return hooks[index];
        },
        cursor: 0,
      };
      const previous = current;
      current = frame;
      let rendered;
      try {
        rendered = type(props);
      } finally {
        current = previous;
      }
      return renderNode(rendered, path);
    }
    const children = props.children === undefined ? [] : Array.isArray(props.children) ? props.children : [props.children];
    return {
      type,
      props: Object.assign({}, props, { children: children.map((child, index) => renderNode(child, path.concat(index))) }),
    };
  }
}

// ---------------------------------------------------------------------------
// tree helpers
// ---------------------------------------------------------------------------

function walk(node, visit) {
  if (node === null || node === undefined || node === false || node === true) return;
  if (typeof node !== "object") {
    visit(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  visit(node);
  const children = node.props && node.props.children;
  if (Array.isArray(children)) children.forEach((child) => walk(child, visit));
  else if (children !== undefined) walk(children, visit);
}

function textOf(node) {
  let out = "";
  walk(node, (element) => {
    if (typeof element === "string" || typeof element === "number") out += String(element);
  });
  return out;
}

function findAll(tree, predicate) {
  const found = [];
  walk(tree, (element) => {
    if (typeof element === "object" && element.type !== undefined && predicate(element)) found.push(element);
  });
  return found;
}

/** Find the first element whose own visible text contains `label`. */
function findByText(tree, label) {
  const matches = findAll(tree, (element) => textOf(element).includes(label));
  for (const match of matches) if (textOf(match).trim() === label.trim()) return match;
  return matches[matches.length - 1];
}

function click(element) {
  assert.ok(element !== undefined, "click target not found");
  assert.equal(typeof element.props.onClick, "function", "element is not clickable");
  element.props.onClick({});
}

function setChecked(element, value) {
  assert.ok(element !== undefined, "toggle target not found");
  assert.equal(typeof element.props.onChange, "function", "element is not a control");
  element.props.onChange({ target: { checked: value } });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(5);
  }
}

/** Let queued promises settle, then re-render the page from its current state. */
let tree = null;
let renderPage = () => {};
async function settle() {
  await sleep(15);
  tree = renderPage();
  return tree;
}

/** Buttons and setting tabs both render as <button> with exact text. */
function findButton(tree, label) {
  return findAll(tree, (element) => element.type === "button" && textOf(element).trim() === label)[0];
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

function createHarness() {
  const registrations = [];
  globalThis.window = {
    __ModuleLoader__: {
      load(registration) {
        registrations.push(registration);
      },
    },
  };

  const effects = [];
  const dicts = {};
  const injected = new Map();
  const calls = [];
  const mounted = [];

  const overview = {
    ok: true,
    version: "0.1.0",
    writable: true,
    credentialsAvailable: true,
    enabled: true,
    triggers: { taskComplete: true, taskError: true, taskBlocked: false, taskCancelled: false, needsInput: true, goalComplete: true, subagentEnd: false, workflowEnd: false },
    template: { lang: "zh", title: "{status} · {project}", body: "{session}\n{summary}" },
    delivery: { debounceMs: 3000, minIntervalMs: 5000, timeoutMs: 10000, retries: 1, summaryChars: 180, bodyChars: 400, skipSubagentSessions: true, maxLog: 60 },
    channels: [
      {
        id: "c1",
        name: "我的 iPhone",
        protocol: "bark",
        enabled: true,
        secretRef: "DSH_NOTIFICATION_C1",
        defaultSecretRef: "DSH_NOTIFICATION_C1",
        hasInlineKey: false,
        secret: { ref: "DSH_NOTIFICATION_C1", configured: true, writable: true, inline: false },
        bark: { server: "https://api.day.app", sendAs: "post", sound: "", group: "DSH", icon: "", level: "", url: "", mode: "", badge: "", isArchive: false, autoCopy: false, copy: "" },
        meow: { server: "https://api.chuckfang.com", sendAs: "get", sound: "", text: "" },
        custom: { method: "POST", url: "", headers: {}, contentType: "application/json", body: "", acceptAnyStatus: false, expectContains: "", expectPath: "", expectEquals: "" },
      },
      {
        id: "c2",
        name: "自建网关",
        protocol: "custom",
        enabled: false,
        secretRef: "DSH_NOTIFICATION_C2",
        defaultSecretRef: "DSH_NOTIFICATION_C2",
        hasInlineKey: false,
        secret: { ref: "DSH_NOTIFICATION_C2", configured: false, writable: true, inline: false },
        bark: { server: "https://api.day.app", sendAs: "post", sound: "", group: "", icon: "", level: "", url: "", mode: "", badge: "", isArchive: false, autoCopy: false, copy: "" },
        meow: { server: "https://api.chuckfang.com", sendAs: "get", sound: "", text: "" },
        custom: { method: "POST", url: "https://push.example.com/hook", headers: {}, contentType: "application/json", body: '{"title":{title:json}}', acceptAnyStatus: false, expectContains: "", expectPath: "", expectEquals: "" },
      },
    ],
    deliveries: [
      { id: "d1", time: Date.now(), trigger: "taskComplete", channelId: "c1", channelName: "我的 iPhone", protocol: "bark", status: "ok", httpStatus: 200, latencyMs: 123, title: "任务完成 · proj", body: "全部改完了" },
    ],
    stats: { sent: 4, failed: 1, skipped: 2 },
  };

  const remote = {
    async $mount(request) {
      mounted.push(request);
      return () => {};
    },
  };
  const handle = {
    async getOverview() {
      calls.push(["get-overview", {}]);
      return { ok: true, value: overview };
    },
    async saveSettings(args) {
      calls.push(["save-settings", args]);
      Object.assign(overview, { enabled: args.enabled === undefined ? overview.enabled : args.enabled, triggers: args.triggers || overview.triggers, template: args.template || overview.template, delivery: args.delivery || overview.delivery });
      return { ok: true, value: { ok: true } };
    },
    async saveChannel(args) {
      calls.push(["save-channel", args]);
      return { ok: true, value: { ok: true } };
    },
    async deleteChannel(args) {
      calls.push(["delete-channel", args]);
      return { ok: true, value: { ok: true } };
    },
    async clearSecret(args) {
      calls.push(["clear-secret", args]);
      overview.channels[0].secret = { ref: "DSH_NOTIFICATION_C1", configured: false, writable: true, inline: false };
      return { ok: true, value: { ok: true } };
    },
    async testChannel(args) {
      calls.push(["test-channel", args]);
      return { ok: true, value: { ok: true, result: { channelId: args.id, channelName: "我的 iPhone", ok: true, status: 200, latencyMs: 88 } } };
    },
    async pushTest(args) {
      calls.push(["push-test", args]);
      return { ok: true, value: { ok: true, results: [{ channelId: "c1", ok: true }] } };
    },
    async clearDeliveries() {
      calls.push(["clear-deliveries", {}]);
      overview.deliveries = [];
      return { ok: true, value: { ok: true } };
    },
  };
  for (const key of Object.keys(handle)) remote[key] = handle[key];
  // The Client resolves the Remote namespace through `ctx.remote.<namespace>`.
  remote.notification = handle;

  const slots = {
    inject(slot, callback) {
      injected.set("slot:" + slot, callback);
      return () => {};
    },
    register(meta, Component) {
      injected.set("registered:" + meta.id, { meta, Component });
      return () => {};
    },
  };

  const locale = {
    register(ns, dictsFor) {
      dicts[ns] = dictsFor;
      return () => {};
    },
    bind(ns) {
      return (key) => (dicts[ns] && dicts[ns].zh && dicts[ns].zh[key] !== undefined ? dicts[ns].zh[key] : key);
    },
    getLocale() {
      return { id: "zh" };
    },
  };

  const ctx = {
    remote,
    get(key) {
      if (key === "locale") return locale;
      if (key === "slots") return slots;
      return undefined;
    },
    effect(fn) {
      const disposer = fn();
      effects.push(disposer);
      return () => {};
    },
  };

  return {
    registrations,
    ctx,
    calls,
    mounted,
    injected,
    locale,
    overview,
    dicts,
    effects,
    /** The real slot system runs an `inject` callback once the slot exists. */
    activate(slot) {
      const callback = injected.get("slot:" + slot);
      assert.ok(callback !== undefined, `nothing injected into ${slot}`);
      callback();
    },
  };
}

// ---------------------------------------------------------------------------
// driver
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

console.log("\ndsh-notify-ultra client smoke test\n");

const harness = createHarness();
await import("../lib/client.js");

const registration = harness.registrations[0];
const react = createReact();
const bundle = registration.factory((specifier) => {
  if (specifier === "react") return react.React;
  throw new Error(`unexpected require(${specifier})`);
});

await test("the bundle registers itself the way the module system expects", () => {
  assert.equal(harness.registrations.length, 1);
  assert.equal(registration.id, "dsh-notify-ultra");
  assert.equal(typeof registration.factory, "function");
  assert.equal(bundle.name, "dsh-notify-ultra");
  assert.deepEqual(bundle.inject, ["slots", "remote", "locale"]);
  assert.equal(typeof bundle.apply, "function");
});

await test("apply registers dictionaries, styles and the Remote namespace", () => {
  bundle.apply(harness.ctx);
  assert.ok(harness.dicts["dsh-notify-ultra"] !== undefined, "dictionaries must be registered");
  assert.equal(harness.dicts["dsh-notify-ultra"].zh.nav, "通知推送");
  assert.equal(harness.mounted.length, 1);
  assert.equal(harness.mounted[0].package, "dsh-notify-ultra");
  assert.equal(harness.mounted[0].descriptors.length, 10, "all ten wire methods must be mounted");
  assert.ok(harness.injected.has("slot:settings.section"), "the page must claim a settings section");
});

await test("the settings entry is a labelled list row", () => {
  harness.activate("settings.section");
  const register = harness.injected.get("registered:dsh-notify-ultra");
  assert.ok(register !== undefined, "settings.section must be registered on inject");
  assert.deepEqual(Object.keys(register.meta).sort(), ["id", "label", "name", "order"]);
  assert.equal(register.meta.name, "settings.section");
  assert.equal(register.meta.id, "dsh-notify-ultra");
  assert.equal(register.meta.label(), "通知推送");
});

const Component = harness.injected.get("registered:dsh-notify-ultra").Component;
renderPage = () => react.render(Component, {});
react.setOnChange(() => {
  tree = renderPage();
});

await test("the page loads the overview and renders it", async () => {
  tree = renderPage();
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "get-overview")), "get-overview was never called");
  await settle();
  const text = textOf(tree);
  assert.match(text, /通知推送/);
  assert.match(text, /我的 iPhone/);
  assert.match(text, /自建网关/);
  assert.match(text, /Bark/);
  assert.match(text, /已保存/);
  assert.match(text, /未设置/);
  assert.match(text, /https:\/\/push\.example\.com\/hook/, "the custom channel URL is shown");
});

await test("the toolbar offers a test push that calls push-test", async () => {
  const button = findButton(tree, "发送测试推送");
  assert.ok(button !== undefined, "the test-push button is missing");
  harness.calls.length = 0;
  click(button);
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "push-test")), "push-test was never called");
  await settle();
});

await test("testing one channel targets exactly that channel", async () => {
  const buttons = findAll(tree, (element) => element.type === "button" && textOf(element) === "测试");
  assert.ok(buttons.length >= 1, "no per-channel test button");
  harness.calls.length = 0;
  click(buttons[0]);
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "test-channel")), "test-channel was never called");
  const call = harness.calls.find((entry) => entry[0] === "test-channel");
  assert.equal(call[1].id, "c1");
  await settle();
  assert.match(textOf(tree), /测试成功/);
});

await test("deleting a channel asks for confirmation and calls delete-channel", async () => {
  globalThis.window.confirm = () => true;
  const buttons = findAll(tree, (element) => element.type === "button" && textOf(element) === "删除");
  assert.ok(buttons.length >= 1);
  harness.calls.length = 0;
  click(buttons[0]);
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "delete-channel")), "delete-channel was never called");
  assert.equal(harness.calls.find((entry) => entry[0] === "delete-channel")[1].id, "c1");
  await settle();
});

await test("the Triggers tab renders every trigger and saves a flipped one", async () => {
  click(findButton(tree, "触发"));
  await settle();
  const text = textOf(tree);
  for (const label of ["任务完成", "任务出错", "任务受阻", "任务被取消", "需要确认", "目标达成", "子代理结束", "工作流结束"]) {
    assert.match(text, new RegExp(label));
  }
  assert.match(text, /合并窗口/);

  // Flip "任务完成" off and save.
  const rows = findAll(tree, (element) => element.props && element.props.className === "dshn-row" && textOf(element).includes("任务完成"));
  const row = rows[rows.length - 1];
  assert.ok(row !== undefined, "the trigger row is missing");
  const checkbox = findAll(row, (element) => element.type === "input" && element.props.type === "checkbox")[0];
  assert.ok(checkbox !== undefined, "the trigger switch is missing");
  assert.equal(checkbox.props.checked, true);
  setChecked(checkbox, false);
  await settle();

  harness.calls.length = 0;
  click(findButton(tree, "保存"));
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "save-settings")), "save-settings was never called");
  const payload = harness.calls.find((entry) => entry[0] === "save-settings")[1];
  assert.equal(payload.triggers.taskComplete, false);
  assert.equal(payload.triggers.needsInput, true, "other triggers must be preserved");
  assert.equal(payload.delivery.debounceMs, 3000, "delivery policy must be preserved");
  await settle();
});

await test("the Message tab renders the template and the placeholder reference", async () => {
  click(findButton(tree, "文案"));
  await settle();
  const text = textOf(tree);
  assert.match(text, /标题模板/);
  assert.match(text, /正文模板/);
  assert.match(text, /\{summary\}/);
  assert.match(text, /\{\{secret\}\}/);
});

await test("the History tab renders deliveries and clears them", async () => {
  click(findButton(tree, "记录"));
  await settle();
  assert.match(textOf(tree), /我的 iPhone/);
  assert.match(textOf(tree), /123ms/);
  harness.calls.length = 0;
  click(findButton(tree, "清空记录"));
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "clear-deliveries")), "clear-deliveries was never called");
  await settle();
  assert.match(textOf(tree), /还没有推送记录/);
});

await test("editing a channel opens the editor prefilled for its protocol", async () => {
  click(findButton(tree, "通道"));
  await settle();
  const editButtons = findAll(tree, (element) => element.type === "button" && textOf(element) === "编辑");
  assert.ok(editButtons.length >= 2, `expected two channels to edit, saw ${editButtons.length}`);
  click(editButtons[1]); // the custom channel
  await settle();
  const text = textOf(tree);
  assert.match(text, /请求 URL/);
  assert.match(text, /https:\/\/push\.example\.com\/hook/);
  assert.match(text, /请求体/);
});

await test("saving an edited channel sends the whole channel and no secret", async () => {
  harness.calls.length = 0;
  click(findButton(tree, "保存"));
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "save-channel")), "save-channel was never called");
  const payload = harness.calls.find((entry) => entry[0] === "save-channel")[1];
  assert.equal(payload.channel.id, "c2");
  assert.equal(payload.channel.protocol, "custom");
  assert.equal(payload.channel.custom.url, "https://push.example.com/hook");
  assert.equal(payload.secret, undefined, "an untouched secret must not be resent");
  assert.equal(payload.channel.secret, undefined);
  assert.equal(payload.channel.hasInlineKey, undefined);
  await settle();
});

function findSelect(tree, optionValue) {
  return findAll(tree, (element) => element.type === "select" && (Array.isArray(element.props.children) ? element.props.children : []).some((option) => option && option.props && option.props.value === optionValue))[0];
}

function setValue(element, value) {
  assert.ok(element !== undefined, "input target not found");
  assert.equal(typeof element.props.onChange, "function", "element is not an input");
  element.props.onChange({ target: { value } });
}

await test("a stored secret can be cleared from the editor", async () => {
  const editButtons = findAll(tree, (element) => element.type === "button" && textOf(element) === "编辑");
  click(editButtons[0]); // the Bark channel, which has a stored secret
  await settle();
  assert.match(textOf(tree), /已保存/);
  const clearButton = findButton(tree, "清除密钥");
  assert.ok(clearButton !== undefined, "a stored secret must be clearable");
  harness.calls.length = 0;
  click(clearButton);
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "clear-secret")), "clear-secret was never called");
  assert.equal(harness.calls.find((entry) => entry[0] === "clear-secret")[1].id, "c1");
  await settle();
  assert.equal(findButton(tree, "清除密钥"), undefined, "the button must disappear once the secret is gone");
  click(findButton(tree, "取消"));
  await settle();
});

await test("adding a channel opens a Bark draft by default", async () => {
  click(findButton(tree, "新增通道"));
  await settle();
  const text = textOf(tree);
  assert.match(text, /设备密钥（Bark device key）/);
  assert.match(text, /副标题 subtitle/);
  assert.match(text, /^.*POST \/push/s);
});

await test("switching the protocol reveals that protocol's own fields", async () => {
  setValue(findSelect(tree, "custom"), "custom");
  await settle();
  assert.match(textOf(tree), /请求体/);
  assert.match(textOf(tree), /\{title:json\}/);
  assert.match(textOf(tree), /请求 URL/);

  setValue(findSelect(tree, "miaotixing"), "miaotixing");
  await settle();
  const miaotixing = textOf(tree);
  assert.match(miaotixing, /喵码（MIAO_ID）/);
  assert.match(miaotixing, /模板 templ/);
  assert.match(miaotixing, /\/trigger/);

  setValue(findSelect(tree, "meow"), "meow");
  await settle();
  const meow = textOf(tree);
  assert.match(meow, /昵称（nickname）/);
  assert.match(meow, /msgType/);
  const serverInput = findAll(tree, (element) => element.type === "input" && element.props.value === "https://api.chuckfang.com")[0];
  assert.ok(serverInput !== undefined, "the MeoW default server must be prefilled");

  setValue(findSelect(tree, "miaotixing"), "miaotixing");
  await settle();
});

await test("saving a draft without a name reports the error instead of calling", async () => {
  harness.calls.length = 0;
  click(findButton(tree, "保存"));
  await settle();
  assert.equal(harness.calls.some((entry) => entry[0] === "save-channel"), false);
  assert.match(textOf(tree), /请填写名称/);
});

await test("a named draft saves its protocol, name and the freshly typed secret", async () => {
  const nameInput = findAll(tree, (element) => element.type === "input" && element.props.type !== "checkbox" && element.props.type !== "password")[0];
  setValue(nameInput, "我的喵提醒");
  const secretInput = findAll(tree, (element) => element.type === "input" && element.props.type === "password")[0];
  setValue(secretInput, "tDS0Se9");
  await settle();

  harness.calls.length = 0;
  click(findButton(tree, "保存"));
  assert.ok(await waitFor(() => harness.calls.some((entry) => entry[0] === "save-channel")), "save-channel was never called");
  const payload = harness.calls.find((entry) => entry[0] === "save-channel")[1];
  assert.equal(payload.channel.protocol, "miaotixing");
  assert.equal(payload.channel.name, "我的喵提醒");
  assert.equal(payload.secret, "tDS0Se9", "a typed secret must be sent to the credentials service");
  assert.equal(payload.channel.secret, undefined, "the secret must never ride inside the channel object");
  assert.equal(payload.channel.key, undefined, "the inline key is not the client's business");
  await settle();
});

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  for (const failure of failed) console.error(`\nFAILED: ${failure.name}\n${failure.error instanceof Error ? failure.error.stack : failure.error}`);
  process.exit(1);
}
