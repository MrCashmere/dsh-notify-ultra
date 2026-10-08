/**
 * dsh-notify-ultra — Host half.
 *
 * Watches the durable Session event feed for task boundaries (turn finished,
 * failed, blocked on a question/approval, sub-agent settled, workflow settled,
 * goal completed) and pushes a short message about each one to every enabled
 * channel over a plain HTTP/HTTPS push API:
 *
 *   - `custom`  any endpoint, with method / headers / body templates
 *   - `bark`    https://github.com/Finb/Bark (self-hostable)
 *   - `meow`    喵提醒 (Meow)
 *
 * Everything about the plugin (channels, triggers, copy) lives in this plugin's
 * own settings entry, so the settings page is the single source of truth and an
 * uninstall leaves no state behind.
 *
 * The whole thing is written against the public DSH surface (Cordis contexts,
 * documented events, the `settings` / `credentials` services, Typert Remote) and
 * has no build step: this file is the ESM entry the Loader imports.
 */
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import z from "@deepseek-ai/schemastery";

// ---------------------------------------------------------------------------
// Identity and the host <-> client contract
// ---------------------------------------------------------------------------

const PACKAGE = "dsh-notify-ultra";
/** Settings entry id (declared by cordis.patch.yml) and state namespace. */
const NS = PACKAGE;
/** Cordis service key and Typert Remote namespace. */
const SERVICE_KEY = "notification";
const VERSION = "0.1.0";

/** Wire method id -> service method name. Ids are kebab-case on the wire. */
const METHODS = [
  ["get-overview", "getOverview"],
  ["save-settings", "saveSettings"],
  ["save-channel", "saveChannel"],
  ["delete-channel", "deleteChannel"],
  ["set-secret", "setSecret"],
  ["clear-secret", "clearSecret"],
  ["test-channel", "testChannel"],
  ["push-test", "pushTest"],
  ["list-deliveries", "listDeliveries"],
  ["clear-deliveries", "clearDeliveries"],
];

/**
 * 0.2.0-rc.1 strict codecs carry a `create()` FACTORY (the boundary calls
 * `codec.create().parse(value)`); a bare `schema:` value is ignored and
 * registration fails with "strict codec has no create() factory".
 */
const looseSchema = (label) => ({
  parse(value) {
    if (value === undefined || value === null) return {};
    if (typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}: expected an object`);
    return value;
  },
});
const resultSchema = {
  parse(value) {
    if (value === null || typeof value !== "object" || typeof value.ok !== "boolean") {
      throw new TypeError("expected an { ok, ... } envelope");
    }
    return value;
  },
};
const argParam = {
  name: "args",
  wire: "args",
  source: "json",
  codec: { mode: "strict", typeSymbol: `${PACKAGE}#Args`, create: () => looseSchema(PACKAGE) },
};
const INVOCATIONS = METHODS.map(([, method]) => ({
  id: `${PACKAGE}#${SERVICE_KEY}/${method}`,
  service: SERVICE_KEY,
  namespace: SERVICE_KEY,
  method,
  invocation: { kind: "direct" },
  parameters: [argParam],
  result: { mode: "strict", typeSymbol: `${PACKAGE}#${method}Result`, create: () => resultSchema },
}));
const TYPERT_MANIFEST = {
  package: PACKAGE,
  face: "host",
  schemas: [],
  model: {
    services: [
      {
        key: SERVICE_KEY,
        exportName: "NotificationRuntime",
        description: "Notification — pushes task-completion messages to other devices over custom HTTP APIs, Bark or Meow.",
        tags: [],
        members: METHODS.map(([, method]) => ({ kind: "method", name: method, signature: `${method}(args: object): Promise<object>` })),
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
  invocations: INVOCATIONS,
};

// ---------------------------------------------------------------------------
// Config (the plugin's own settings entry; every field volatile)
// ---------------------------------------------------------------------------

/**
 * Structured state is deliberately `z.any()`: the shape is owned by
 * `normalizeState()` below, so a stored value written by an older version can
 * never be rejected by a schema that forgot it.
 */
const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  channels: z.any().default([]).volatile(),
  triggers: z.any().default({}).volatile(),
  template: z.any().default({}).volatile(),
  delivery: z.any().default({}).volatile(),
});

const DEFAULT_TRIGGERS = {
  taskComplete: true,
  taskError: true,
  taskBlocked: false,
  taskCancelled: false,
  needsInput: true,
  goalComplete: true,
  subagentEnd: false,
  workflowEnd: false,
};

const DEFAULT_TEMPLATE = {
  lang: "zh",
  title: "{status} · {project}",
  body: "{session}\n{summary}",
  /** Prepend the channel name so a multi-channel setup is readable? not needed. */
};

const DEFAULT_DELIVERY = {
  /** Coalesce a burst of turn ends (steering, sub-agents) into one push. */
  debounceMs: 3000,
  /** Global floor between two pushes, so a storm cannot spam the device. */
  minIntervalMs: 5000,
  timeoutMs: 10000,
  retries: 1,
  summaryChars: 180,
  bodyChars: 400,
  /** Skip Sessions created by a sub-agent (`origin: 'subagent'`). */
  skipSubagentSessions: true,
  maxLog: 60,
};

const TRIGGER_KEYS = Object.keys(DEFAULT_TRIGGERS);
/** Push protocols this plugin speaks. `meow` is MeoW by ChuckFang; 喵提醒
 * (MiaoTixing) is a different service with a different API, so it is its own. */
const PROTOCOLS = ["custom", "bark", "meow", "miaotixing"];
const STATUS_LABELS = {
  zh: {
    taskComplete: "任务完成",
    taskError: "任务出错",
    taskBlocked: "任务受阻",
    taskCancelled: "任务已取消",
    needsInput: "需要你的确认",
    goalComplete: "目标达成",
    subagentEnd: "子任务完成",
    workflowEnd: "工作流完成",
    test: "通知测试",
  },
  en: {
    taskComplete: "Task finished",
    taskError: "Task failed",
    taskBlocked: "Task blocked",
    taskCancelled: "Task cancelled",
    needsInput: "Needs your input",
    goalComplete: "Goal complete",
    subagentEnd: "Sub-agent finished",
    workflowEnd: "Workflow finished",
    test: "Notification test",
  },
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Rebuild a value with null-prototype objects, safe across the settings realm boundary. */
function makeHostPlain(value) {
  if (Array.isArray(value)) return value.map(makeHostPlain);
  if (isObject(value)) {
    const out = Object.create(null);
    for (const key of Object.keys(value)) out[key] = makeHostPlain(value[key]);
    return out;
  }
  return value;
}

const asString = (v, fallback = "") => (typeof v === "string" ? v : fallback);
const asBool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const asNumber = (v, fallback, min, max) => {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

function truncate(text, limit) {
  const s = asString(text).replace(/\r\n?/g, "\n").trim();
  if (!limit || s.length <= limit) return s;
  return `${s.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function stripTrailingSlash(url) {
  return asString(url).trim().replace(/\/+$/, "");
}

function baseName(path) {
  const clean = asString(path).replace(/[/\\]+$/, "");
  if (clean === "") return "";
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || "";
}

function shortId(id) {
  const s = asString(id);
  if (s === "") return "session";
  const tail = s.split("-").pop();
  return `session-${tail}`;
}

function humanDuration(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60}m`;
}

function localStamp(now, withDate) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withDate ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}` : time;
}

/** Extract plain text from a Message content array (defensive: the shape is host-owned). */
function messageText(message) {
  const content = message && message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (isObject(block) && block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n\n");
}

/** `{token}` in a message template; unknown tokens are left untouched. */
function renderTemplate(template, tokens) {
  if (typeof template !== "string" || template === "") return "";
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(tokens, name) && tokens[name] !== undefined && tokens[name] !== null ? String(tokens[name]) : match,
  );
}

/**
 * `{token}` / `{token:url}` / `{token:json}` substitution for a custom request,
 * plus `{{secret}}` (and `{{secret:url}}` / `{{secret:json}}`). `:json` yields a
 * complete JSON value (quotes included), so `{"body":{body:json}}` is always
 * well-formed; the secret is never written into the settings entry when the
 * credentials service can hold it instead.
 */
function substituteRequestText(text, tokens, secret) {
  // Two alternatives — `{{name}}` then `{name}` — so a single-brace token never
  // swallows a brace that belongs to the surrounding JSON.
  const pattern = /\{\{\s*([a-zA-Z0-9_]+)\s*(?::\s*(url|json|raw))?\s*\}\}|\{\s*([a-zA-Z0-9_]+)\s*(?::\s*(url|json|raw))?\s*\}/g;
  return asString(text).replace(pattern, (match, bracedName, bracedFilter, plainName, plainFilter) => {
    const name = bracedName !== undefined ? bracedName : plainName;
    const filter = bracedName !== undefined ? bracedFilter : plainFilter;
    const raw = name === "secret" ? asString(secret) : tokens[name];
    if (raw === undefined || raw === null) return match;
    const value = String(raw);
    if (filter === "url") return encodeURIComponent(value);
    if (filter === "json") return JSON.stringify(value);
    return value;
  });
}

/** Collapse the blank lines a missing token leaves behind. */
function tidy(text) {
  return asString(text)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, all) => !(line.trim() === "" && (index === 0 || all[index - 1].trim() === "")))
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// State: read / normalize / write
// ---------------------------------------------------------------------------

function normalizeChannel(raw, index) {
  const src = isObject(raw) ? raw : {};
  const id = asString(src.id).trim() || `ch${index + 1}`;
  const protocol = PROTOCOLS.includes(src.protocol) ? src.protocol : "custom";
  const bark = isObject(src.bark) ? src.bark : {};
  const meow = isObject(src.meow) ? src.meow : {};
  const miaotixing = isObject(src.miaotixing) ? src.miaotixing : {};
  const custom = isObject(src.custom) ? src.custom : {};
  return {
    id,
    name: asString(src.name).trim() || `${protocol}-${id}`,
    protocol,
    enabled: asBool(src.enabled, true),
    secretRef: asString(src.secretRef).trim() || defaultSecretRef(id),
    /** Inline fallback used only when the credentials service is unavailable. */
    key: asString(src.key),
    bark: {
      server: stripTrailingSlash(bark.server) || "https://api.day.app",
      sendAs: bark.sendAs === "get" ? "get" : "post",
      subtitle: asString(bark.subtitle),
      sound: asString(bark.sound),
      group: asString(bark.group),
      icon: asString(bark.icon),
      image: asString(bark.image),
      level: asString(bark.level),
      url: asString(bark.url),
      copy: asString(bark.copy),
      badge: asString(bark.badge),
      ttl: asString(bark.ttl),
      isArchive: asBool(bark.isArchive, false),
      autoCopy: asBool(bark.autoCopy, false),
      call: asBool(bark.call, false),
    },
    meow: {
      server: stripTrailingSlash(meow.server) || "https://api.chuckfang.com",
      sendAs: meow.sendAs === "post" ? "post" : "get",
      msgType: meow.msgType === "html" ? "html" : "text",
      htmlHeight: asString(meow.htmlHeight),
      url: asString(meow.url),
      imgUrl: asString(meow.imgUrl),
    },
    miaotixing: {
      server: stripTrailingSlash(miaotixing.server) || "https://miaotixing.com",
      sendAs: miaotixing.sendAs === "post" ? "post" : "get",
      templ: asString(miaotixing.templ),
      option: asString(miaotixing.option),
    },
    custom: {
      method: ["POST", "GET", "PUT", "PATCH"].includes(asString(custom.method).toUpperCase()) ? asString(custom.method).toUpperCase() : "POST",
      url: asString(custom.url),
      headers: isObject(custom.headers) ? makeHostPlain(custom.headers) : {},
      contentType: asString(custom.contentType) || "application/json",
      body: asString(custom.body),
      /** Treat a non-2xx response as success anyway (imperfect APIs). */
      acceptAnyStatus: asBool(custom.acceptAnyStatus, false),
      /** Optional substring that must appear in the response body. */
      expectContains: asString(custom.expectContains),
      /** Extract from a JSON response (dot path) that must equal `expectEquals`. */
      expectPath: asString(custom.expectPath),
      expectEquals: custom.expectEquals === undefined ? "" : String(custom.expectEquals),
    },
  };
}

function defaultSecretRef(id) {
  const slug = asString(id)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `DSH_NOTIFICATION_${slug || "CHANNEL"}`;
}

function normalizeState(raw) {
  const src = isObject(raw) ? raw : {};
  const channels = Array.isArray(src.channels) ? src.channels.map(normalizeChannel) : [];
  // Guarantee one channel per id without ever rewriting an id the user saw.
  const seen = new Set();
  for (const channel of channels) {
    let id = channel.id;
    let n = 2;
    while (seen.has(id)) id = `${channel.id}-${n++}`;
    channel.id = id;
    seen.add(id);
  }
  const triggers = { ...DEFAULT_TRIGGERS };
  if (isObject(src.triggers)) for (const key of TRIGGER_KEYS) triggers[key] = asBool(src.triggers[key], DEFAULT_TRIGGERS[key]);
  const template = { ...DEFAULT_TEMPLATE };
  if (isObject(src.template)) {
    template.lang = src.template.lang === "en" ? "en" : "zh";
    if (typeof src.template.title === "string") template.title = src.template.title;
    if (typeof src.template.body === "string") template.body = src.template.body;
  }
  const delivery = { ...DEFAULT_DELIVERY };
  if (isObject(src.delivery)) {
    delivery.debounceMs = asNumber(src.delivery.debounceMs, DEFAULT_DELIVERY.debounceMs, 0, 120000);
    delivery.minIntervalMs = asNumber(src.delivery.minIntervalMs, DEFAULT_DELIVERY.minIntervalMs, 0, 600000);
    delivery.timeoutMs = asNumber(src.delivery.timeoutMs, DEFAULT_DELIVERY.timeoutMs, 1000, 120000);
    delivery.retries = asNumber(src.delivery.retries, DEFAULT_DELIVERY.retries, 0, 5);
    delivery.summaryChars = asNumber(src.delivery.summaryChars, DEFAULT_DELIVERY.summaryChars, 0, 2000);
    delivery.bodyChars = asNumber(src.delivery.bodyChars, DEFAULT_DELIVERY.bodyChars, 0, 4000);
    delivery.skipSubagentSessions = asBool(src.delivery.skipSubagentSessions, DEFAULT_DELIVERY.skipSubagentSessions);
    delivery.maxLog = asNumber(src.delivery.maxLog, DEFAULT_DELIVERY.maxLog, 0, 500);
  }
  return { enabled: asBool(src.enabled, true), channels, triggers, template, delivery };
}

function readState(ctx) {
  const st = ctx.get("settings");
  if (st === undefined) return normalizeState({});
  try {
    const rows = st.describe();
    if (!Array.isArray(rows)) return normalizeState({});
    const row = rows.find((r) => r && r.ns === NS);
    const user = row && isObject(row.user) ? row.user : {};
    return normalizeState(user);
  } catch {
    return normalizeState({});
  }
}

function writable(ctx) {
  const st = ctx.get("settings");
  if (st === undefined || typeof st.replace !== "function") return false;
  try {
    const rows = st.describe();
    const row = Array.isArray(rows) ? rows.find((r) => r && r.ns === NS) : undefined;
    return row === undefined ? true : row.applies === undefined || row.applies === "live";
  } catch {
    return false;
  }
}

/**
 * Full-snapshot write: `replace()` resets every volatile field first, so a
 * partial section would silently fall back to schema defaults.
 */
async function writeState(ctx, next) {
  const st = ctx.get("settings");
  if (st === undefined || typeof st.replace !== "function") throw new Error("settings service unavailable");
  const section = normalizeState(next);
  await st.replace(NS, makeHostPlain(section));
  return section;
}

// ---------------------------------------------------------------------------
// HTTP delivery
// ---------------------------------------------------------------------------

class PushError extends Error {}

async function httpSend(request, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
      redirect: "follow",
    });
    const text = await response.text();
    return { status: response.status, ok: response.ok, text, latencyMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
  }
}

/** Retry only transport failures and retryable statuses; never double-send a 4xx. */
function isRetryable(error, result) {
  if (result !== undefined) return result.status >= 500 || result.status === 429 || result.status === 408;
  return true && !(error instanceof PushError);
}

function readJsonPath(value, path) {
  if (path === "") return undefined;
  let cursor = value;
  for (const part of path.split(".")) {
    if (part === "") continue;
    if (isObject(cursor) || Array.isArray(cursor)) cursor = cursor[part];
    else return undefined;
  }
  return cursor;
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Protocol request builders
// ---------------------------------------------------------------------------

const BARK_STRING_FIELDS = ["subtitle", "sound", "group", "icon", "image", "level", "url", "copy", "action"];
const BARK_NUMERIC_FIELDS = ["badge", "ttl", "volume"];
const BARK_FLAG_FIELDS = ["isArchive", "autoCopy", "call"];

/** GET /{key}/{title}/{body}. Bark's server `url.QueryUnescape`s each segment, so
 * `encodeURIComponent` is required: a literal `+` would otherwise become a space
 * and a literal `/` would break routing entirely. */
function buildBarkRequest(channel, secret, message) {
  const cfg = channel.bark;
  const deviceKey = asString(secret).trim() || asString(channel.key).trim();
  if (deviceKey === "") throw new PushError("Bark device key is not configured");
  const base = stripTrailingSlash(cfg.server) || "https://api.day.app";
  const params = {};
  for (const field of BARK_STRING_FIELDS) {
    const value = asString(cfg[field]).trim();
    if (value !== "") params[field] = value;
  }
  for (const field of BARK_NUMERIC_FIELDS) {
    const value = asString(cfg[field]).trim();
    if (/^\d+$/.test(value)) params[field] = value;
  }
  for (const field of BARK_FLAG_FIELDS) if (cfg[field] === true) params[field] = "1";

  if (cfg.sendAs === "get") {
    const path = [deviceKey, message.title, message.body].map((part) => encodeURIComponent(String(part))).join("/");
    const query = new URLSearchParams(params).toString();
    return { method: "GET", url: `${base}/${path}${query === "" ? "" : `?${query}`}`, headers: {}, body: undefined };
  }

  const payload = { device_key: deviceKey, title: message.title, body: message.body, ...params };
  return {
    method: "POST",
    url: `${base}/push`,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  };
}

/**
 * MeoW (喵) by ChuckFang: `GET /{nickname}/{title}/{msg}` or `POST /{nickname}`.
 * The identifier is a registered *nickname*, not a device key. The service always
 * answers HTTP 200 and reports the real outcome in the JSON body.
 */
function buildMeowRequest(channel, secret, message) {
  const cfg = channel.meow;
  const nickname = asString(secret).trim() || asString(channel.key).trim();
  if (nickname === "") throw new PushError("MeoW nickname is not configured");
  const base = stripTrailingSlash(cfg.server) || "https://api.chuckfang.com";
  const query = new URLSearchParams();
  if (cfg.url !== "") query.set("url", cfg.url);
  if (cfg.imgUrl !== "") query.set("imgUrl", cfg.imgUrl);
  if (cfg.msgType === "html") {
    query.set("msgType", "html");
    if (/^\d+$/.test(asString(cfg.htmlHeight).trim())) query.set("htmlHeight", asString(cfg.htmlHeight).trim());
  }
  const suffix = query.toString() === "" ? "" : `?${query.toString()}`;

  if (cfg.sendAs === "post") {
    return {
      method: "POST",
      url: `${base}/${encodeURIComponent(nickname)}${suffix}`,
      headers: { "content-type": "application/json;charset=UTF-8" },
      body: JSON.stringify({ title: message.title, msg: message.body }),
    };
  }
  const path = [nickname, message.title, message.body].map((part) => encodeURIComponent(String(part))).join("/");
  return { method: "GET", url: `${base}/${path}${suffix}`, headers: {}, body: undefined };
}

/**
 * 喵提醒 MiaoTixing: `GET|POST /trigger?id={喵码}&text=…`. `type=json` is always
 * requested so the business result can be judged from the body, since the HTTP
 * status is 200 even for failures.
 */
function buildMiaotixingRequest(channel, secret, message) {
  const cfg = channel.miaotixing;
  const id = asString(secret).trim() || asString(channel.key).trim();
  if (id === "") throw new PushError("喵提醒 喵码 is not configured");
  const base = stripTrailingSlash(cfg.server) || "https://miaotixing.com";
  const params = new URLSearchParams({ id, text: `${message.title}\n${message.body}`, type: "json" });
  if (cfg.templ !== "") params.set("templ", cfg.templ);
  if (cfg.option !== "") params.set("option", cfg.option);
  if (cfg.sendAs === "post") {
    return {
      method: "POST",
      url: `${base}/trigger`,
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
    };
  }
  return { method: "GET", url: `${base}/trigger?${params.toString()}`, headers: {}, body: undefined };
}

/** Decide whether a response counts as "delivered" for one channel. */
function judgeResponse(channel, result) {
  if (channel.protocol === "bark") {
    // Bark returns the JSON code and the HTTP status as the same number.
    const parsed = parseJson(result.text);
    if (isObject(parsed) && parsed.code !== undefined && Number(parsed.code) !== 200) {
      throw new PushError(`bark ${parsed.code}: ${asString(parsed.message, truncate(result.text, 160))}`);
    }
    if (!result.ok) throw new PushError(`HTTP ${result.status}: ${truncate(result.text, 160)}`);
    return;
  }
  if (channel.protocol === "meow") {
    // MeoW answers 200 even when it refuses, so the body is the only truth.
    const parsed = parseJson(result.text);
    if (isObject(parsed)) {
      const code = parsed.status !== undefined ? Number(parsed.status) : parsed.code !== undefined ? Number(parsed.code) : NaN;
      const detail = asString(parsed.msg, asString(parsed.message, truncate(result.text, 160)));
      if (Number.isFinite(code) && code !== 200) throw new PushError(`MeoW ${code}: ${detail}`);
      if (parsed.data === false) throw new PushError(`MeoW refused: ${detail}`);
      return;
    }
    if (!result.ok) throw new PushError(`HTTP ${result.status}: ${truncate(result.text, 160)}`);
    return;
  }
  if (channel.protocol === "miaotixing") {
    const parsed = parseJson(result.text);
    if (isObject(parsed) && parsed.code !== undefined && Number(parsed.code) !== 0) {
      throw new PushError(`喵提醒 ${parsed.code}: ${asString(parsed.msg, truncate(result.text, 160))}`);
    }
    if (!result.ok) throw new PushError(`HTTP ${result.status}: ${truncate(result.text, 160)}`);
    return;
  }
  const custom = channel.custom;
  if (!custom.acceptAnyStatus && !result.ok) throw new PushError(`HTTP ${result.status}: ${truncate(result.text, 160)}`);
  if (custom.expectContains !== "" && !result.text.includes(custom.expectContains)) {
    throw new PushError(`response does not contain ${JSON.stringify(custom.expectContains)}`);
  }
  if (custom.expectPath !== "") {
    const parsed = parseJson(result.text);
    if (parsed === undefined) throw new PushError("response is not JSON, but an expected JSON path is configured");
    const got = readJsonPath(parsed, custom.expectPath);
    if (String(got) !== custom.expectEquals) {
      throw new PushError(`response ${custom.expectPath} = ${JSON.stringify(got)}, expected ${JSON.stringify(custom.expectEquals)}`);
    }
  }
}

function buildCustomRequest(channel, secret, message, tokens) {
  const cfg = channel.custom;
  const url = substituteRequestText(cfg.url, tokens, secret).trim();
  if (url === "") throw new PushError("custom API URL is not configured");
  if (!/^https?:\/\//i.test(url)) throw new PushError("custom API URL must be http:// or https://");
  const headers = {};
  for (const key of Object.keys(cfg.headers)) {
    const value = substituteRequestText(cfg.headers[key], tokens, secret);
    if (key.trim() !== "") headers[key] = value;
  }
  let body;
  if (cfg.method !== "GET") {
    let text;
    if (cfg.body !== "") text = substituteRequestText(cfg.body, tokens, secret);
    else if (cfg.contentType.includes("json")) text = JSON.stringify({ title: message.title, body: message.body, source: PACKAGE });
    else text = "";
    if (headers["content-type"] === undefined && headers["Content-Type"] === undefined) headers["content-type"] = cfg.contentType;
    body = text;
  }
  return { method: cfg.method, url, headers, body };
}

export function buildRequest(channel, secret, message, tokens) {
  if (channel.protocol === "bark") return buildBarkRequest(channel, secret, message);
  if (channel.protocol === "meow") return buildMeowRequest(channel, secret, message);
  if (channel.protocol === "miaotixing") return buildMiaotixingRequest(channel, secret, message);
  return buildCustomRequest(channel, secret, message, tokens);
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

const RETRY_DELAY_MS = 700;

class NotificationRuntime extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, SERVICE_KEY);
    this.ctx = ctx;
    /** sessionId -> live bookkeeping for the notification copy. */
    this.sessions = new Map();
    /** recent deliveries, newest first (in-memory only). */
    this.log = [];
    /** pending coalesced pushes keyed by trigger+session. */
    this.pending = new Map();
    /** every live timer, cleared on dispose. */
    this.timers = new Set();
    this.stats = { sent: 0, failed: 0, skipped: 0 };
    this.lastSentAt = 0;
    this.seq = 0;
  }

  dispose() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }

  // -- state ---------------------------------------------------------------

  state() {
    return readState(this.ctx);
  }

  session(id) {
    let record = this.sessions.get(id);
    if (record === undefined) {
      record = { id, title: "", cwd: "", origin: undefined, parentSessionId: undefined, running: false, turn: 0, turnStartedAt: 0, lastText: "", model: "", lastError: "" };
      this.sessions.set(id, record);
      if (this.sessions.size > 500) {
        for (const key of this.sessions.keys()) {
          if (key !== id) {
            this.sessions.delete(key);
            break;
          }
        }
      }
    }
    return record;
  }

  // -- event intake --------------------------------------------------------

  onSummary(summary) {
    if (!isObject(summary) || typeof summary.sessionId !== "string") return;
    const record = this.session(summary.sessionId);
    if (typeof summary.cwd === "string" && summary.cwd !== "") record.cwd = summary.cwd;
    if (summary.origin === "subagent") record.origin = "subagent";
    record.parentSessionId = typeof summary.parentSessionId === "string" ? summary.parentSessionId : record.parentSessionId;
    record.running = summary.running === true;
  }

  onStatus(sessionId, running) {
    if (typeof sessionId !== "string") return;
    this.session(sessionId).running = running === true;
  }

  onRemoved(sessionId) {
    if (typeof sessionId === "string") this.sessions.delete(sessionId);
  }

  onSessionEvent(session, event) {
    if (!isObject(event) || typeof event.type !== "string") return;
    const sessionId = isObject(session) && typeof session.id === "string" ? session.id : undefined;
    if (sessionId === undefined) return;
    const record = this.session(sessionId);
    const data = isObject(event.data) ? event.data : {};
    if (isObject(session.header) && typeof session.header.cwd === "string" && session.header.cwd !== "") record.cwd = session.header.cwd;

    if (event.type === "turn/start") {
      record.turn = typeof data.turn === "number" ? data.turn : record.turn + 1;
      record.turnStartedAt = typeof event.time === "number" ? event.time : Date.now();
      return;
    }
    if (event.type === "assistant/message") {
      const text = messageText(data.message);
      if (text !== "") record.lastText = text;
      if (isObject(data.message) && isObject(data.message.source) && typeof data.message.source.model === "string") {
        record.model = data.message.source.model;
      }
      return;
    }
    if (event.type === "turn/end") {
      const reason = isObject(data.reason) && typeof data.reason.kind === "string" ? data.reason.kind : "completed";
      const startedAt = record.turnStartedAt;
      const endedAt = typeof event.time === "number" ? event.time : Date.now();
      const durationMs = startedAt > 0 && endedAt > startedAt ? endedAt - startedAt : 0;
      record.turnStartedAt = 0;
      record.lastError = isObject(data.reason) && isObject(data.reason.error) ? asString(data.reason.error.message) : "";
      this.handleTurnEnd(sessionId, reason, durationMs);
    }
  }

  handleTurnEnd(sessionId, reason, durationMs) {
    const state = this.state();
    if (!state.enabled) return;
    const record = this.session(sessionId);
    if (record.origin === "subagent" && state.delivery.skipSubagentSessions) return;

    let trigger;
    if (reason === "completed") trigger = "taskComplete";
    else if (reason === "error" || reason === "max-tokens") trigger = "taskError";
    else if (reason === "blocked") trigger = "taskBlocked";
    else if (reason === "aborted" || reason === "interrupted" || reason === "forked") trigger = "taskCancelled";
    else trigger = "taskComplete";
    if (state.triggers[trigger] !== true) {
      this.stats.skipped += 1;
      return;
    }
    this.schedule(trigger, sessionId, { durationMs, reason });
  }

  onNeedsInput(sessionId, kind, detail) {
    const state = this.state();
    if (!state.enabled || state.triggers.needsInput !== true) return;
    const id = typeof sessionId === "string" ? sessionId : "unknown";
    const record = this.session(id);
    if (record.origin === "subagent" && state.delivery.skipSubagentSessions) return;
    this.schedule("needsInput", id, { kind, detail });
  }

  onGoalChanged(payload) {
    const state = this.state();
    if (!state.enabled || state.triggers.goalComplete !== true) return;
    const change = isObject(payload) ? payload.change : undefined;
    if (!isObject(change) || change.operation !== "complete") return;
    const agent = isObject(payload.agent) ? payload.agent : undefined;
    const sessionId = agent !== undefined && typeof agent.id === "string" ? agent.id : "unknown";
    const record = this.session(sessionId);
    if (record.origin === "subagent" && state.delivery.skipSubagentSessions) return;
    const goal = isObject(change.goal) ? change.goal : {};
    this.schedule("goalComplete", sessionId, { summary: asString(goal.objective) });
  }

  onSubagentEnd(info) {
    const state = this.state();
    if (!state.enabled || state.triggers.subagentEnd !== true) return;
    const payload = isObject(info) ? info : {};
    const sessionId = asString(payload.sessionId) || asString(payload.childSessionId) || `subagent-${++this.seq}`;
    this.schedule("subagentEnd", sessionId, { summary: asString(payload.label) || asString(payload.description) });
  }

  onWorkflowEnd(info, result) {
    const state = this.state();
    if (!state.enabled || state.triggers.workflowEnd !== true) return;
    const payload = isObject(info) ? info : {};
    const outcome = isObject(result) ? result : {};
    const sessionId = asString(payload.sessionId) || `workflow-${++this.seq}`;
    this.schedule("workflowEnd", sessionId, { summary: asString(payload.name) || asString(outcome.stopReason) });
  }

  onAgentError(payload) {
    const state = this.state();
    if (!state.enabled || state.triggers.taskError !== true) return;
    const agent = isObject(payload) && isObject(payload.agent) ? payload.agent : undefined;
    const sessionId = agent !== undefined && typeof agent.id === "string" ? agent.id : "unknown";
    const error = isObject(payload) && payload.error !== undefined ? payload.error : undefined;
    const message = error instanceof Error ? error.message : asString(isObject(error) ? error.message : error);
    const record = this.session(sessionId);
    if (record.origin === "subagent" && state.delivery.skipSubagentSessions) return;
    // A turn failure usually reports itself through `turn/end` too; both paths
    // schedule under the same coalescing key, so the device still sees one push.
    this.schedule("taskError", sessionId, { summary: message });
  }

  // -- coalescing ----------------------------------------------------------

  schedule(trigger, sessionId, extra) {
    const state = this.state();
    const key = `${trigger}\u0000${sessionId}`;
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      this.timers.delete(existing.timer);
      Object.assign(existing.extra, extra);
    }
    const entry = existing ?? { trigger, sessionId, extra: { ...extra } };
    this.pending.set(key, entry);
    const delay = Math.max(0, state.delivery.debounceMs);
    entry.timer = setTimeout(() => {
      this.timers.delete(entry.timer);
      this.pending.delete(key);
      void this.fire(trigger, sessionId, entry.extra);
    }, delay);
    this.timers.add(entry.timer);
    if (typeof entry.timer.unref === "function") entry.timer.unref();
  }

  async fire(trigger, sessionId, extra) {
    const state = this.state();
    if (!state.enabled) return;
    if (state.triggers[trigger] !== true) return;
    const wait = Math.max(0, this.lastSentAt + state.delivery.minIntervalMs - Date.now());
    if (wait > 0) {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        void this.fire(trigger, sessionId, extra);
      }, wait);
      this.timers.add(timer);
      if (typeof timer.unref === "function") timer.unref();
      return;
    }
    const message = await this.compose(trigger, sessionId, extra);
    if (message === undefined) return;
    this.lastSentAt = Date.now();
    await this.deliver(message, state);
  }

  async compose(trigger, sessionId, extra) {
    const state = this.state();
    const record = this.session(sessionId);
    const labels = STATUS_LABELS[state.template.lang] ?? STATUS_LABELS.zh;
    let title = record.title;
    if (title === "") {
      const query = this.ctx.get("sessionQuery");
      if (query !== undefined && typeof query.readTitle === "function" && sessionId !== "unknown") {
        try {
          const snapshot = await withTimeout(query.readTitle(sessionId), 1500);
          if (isObject(snapshot) && typeof snapshot.title === "string") {
            title = snapshot.title.trim();
            record.title = title;
          }
        } catch {
          // A missing title is not a delivery failure.
        }
      }
    }
    const now = Date.now();
    const tokens = {
      status: labels[trigger] ?? trigger,
      session: title !== "" ? title : shortId(sessionId),
      project: baseName(record.cwd) || "DSH",
      summary: truncate(extra?.summary !== undefined && extra.summary !== "" ? extra.summary : record.lastText, state.delivery.summaryChars),
      cwd: record.cwd,
      model: record.model,
      turn: record.turn > 0 ? String(record.turn) : "",
      duration: humanDuration(extra?.durationMs),
      reason: asString(extra?.reason),
      error: truncate(record.lastError, state.delivery.summaryChars),
      time: localStamp(now, false),
      date: localStamp(now, true),
      trigger,
    };
    const titleText = truncate(tidy(renderTemplate(state.template.title, tokens)) || tokens.status, 120);
    const bodyText = truncate(tidy(renderTemplate(state.template.body, tokens)), state.delivery.bodyChars);
    if (titleText === "" && bodyText === "") return undefined;
    // Custom request templates address the finished message as {title} / {body}.
    tokens.title = titleText || tokens.status;
    tokens.body = bodyText;
    return { trigger, sessionId, title: titleText || tokens.status, body: bodyText, tokens };
  }

  // -- delivery ------------------------------------------------------------

  async secrets(state) {
    const credentials = this.ctx.get("credentials");
    const map = new Map();
    for (const channel of state.channels) {
      let secret = asString(channel.key);
      if (credentials !== undefined && typeof credentials.resolve === "function" && channel.secretRef !== "") {
        try {
          const resolved = await credentials.resolve(channel.secretRef);
          if (isObject(resolved) && typeof resolved.value === "string" && resolved.value !== "") secret = resolved.value;
        } catch {
          // Fall back to whatever the channel carries inline.
        }
      }
      map.set(channel.id, secret);
    }
    return map;
  }

  async deliver(message, state) {
    const targets = state.channels.filter((channel) => channel.enabled);
    if (targets.length === 0) {
      this.stats.skipped += 1;
      return [];
    }
    const secrets = await this.secrets(state);
    const results = await Promise.all(
      targets.map((channel) => this.sendOne(channel, secrets.get(channel.id) ?? "", message, state)),
    );
    return results;
  }

  async sendOne(channel, secret, message, state) {
    const request = {
      id: `${Date.now().toString(36)}-${(++this.seq).toString(36)}`,
      time: Date.now(),
      trigger: message.trigger,
      sessionId: message.sessionId,
      channelId: channel.id,
      channelName: channel.name,
      protocol: channel.protocol,
    };
    try {
      const built = buildRequest(channel, secret, message, message.tokens);
      let attempt = 0;
      let result;
      for (;;) {
        try {
          result = await httpSend(built, state.delivery.timeoutMs);
        } catch (error) {
          if (attempt < state.delivery.retries && isRetryable(error)) {
            attempt += 1;
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          throw new PushError(error instanceof Error ? error.message : String(error));
        }
        try {
          judgeResponse(channel, result);
          break;
        } catch (error) {
          if (attempt < state.delivery.retries && isRetryable(undefined, result)) {
            attempt += 1;
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          throw error;
        }
      }
      this.stats.sent += 1;
      this.record({ ...request, status: "ok", httpStatus: result.status, latencyMs: result.latencyMs, response: truncate(result.text, 200), title: message.title, body: message.body });
      return { channelId: channel.id, channelName: channel.name, ok: true, status: result.status, latencyMs: result.latencyMs };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.stats.failed += 1;
      this.record({ ...request, status: "fail", error: reason, title: message.title, body: message.body });
      this.log0("warn", `push to "${channel.name}" failed: ${reason}`);
      return { channelId: channel.id, channelName: channel.name, ok: false, error: reason };
    }
  }

  record(entry) {
    this.log.unshift(entry);
    const max = this.state().delivery.maxLog;
    if (max === 0) this.log.length = 0;
    else if (this.log.length > max) this.log.length = max;
  }

  log0(level, message) {
    try {
      const logger = this.ctx.logger;
      if (logger !== undefined && typeof logger[level] === "function") logger[level](`${PACKAGE}: ${message}`);
    } catch {
      // Logging must never break a delivery.
    }
  }

  // -- remote methods ------------------------------------------------------

  /** The channel as the client may see it: never the secret, not even a mask. */
  async publicChannel(channel) {
    const secret = await this.secretStatus(channel);
    const { key, ...rest } = channel;
    return { ...rest, hasInlineKey: asString(key) !== "", defaultSecretRef: defaultSecretRef(channel.id), secret };
  }

  async getOverview() {
    const state = this.state();
    const credentials = this.ctx.get("credentials");
    const channels = [];
    for (const channel of state.channels) channels.push(await this.publicChannel(channel));
    return {
      ok: true,
      version: VERSION,
      writable: writable(this.ctx),
      credentialsAvailable: credentials !== undefined && typeof credentials.resolve === "function",
      enabled: state.enabled,
      triggers: state.triggers,
      template: state.template,
      delivery: state.delivery,
      channels,
      deliveries: this.log.slice(0, Math.max(1, Math.min(200, state.delivery.maxLog || 60))),
      stats: { ...this.stats },
    };
  }

  async saveSettings(args) {
    const current = this.state();
    const next = {
      ...current,
      enabled: args.enabled === undefined ? current.enabled : args.enabled === true,
      triggers: args.triggers === undefined || !isObject(args.triggers) ? current.triggers : { ...current.triggers, ...pick(args.triggers, TRIGGER_KEYS) },
      template: args.template === undefined || !isObject(args.template) ? current.template : { ...current.template, ...pick(args.template, ["lang", "title", "body"]) },
      delivery: args.delivery === undefined || !isObject(args.delivery) ? current.delivery : { ...current.delivery, ...pick(args.delivery, Object.keys(DEFAULT_DELIVERY)) },
    };
    const saved = await writeState(this.ctx, next);
    return { ok: true, enabled: saved.enabled, triggers: saved.triggers, template: saved.template, delivery: saved.delivery };
  }

  async saveChannel(args) {
    const current = this.state();
    const incoming = isObject(args.channel) ? args.channel : {};
    const index = current.channels.findIndex((channel) => channel.id === asString(incoming.id));
    const existing = index >= 0 ? current.channels[index] : undefined;
    const channel = normalizeChannel(incoming, index >= 0 ? index : current.channels.length);
    // The client never receives the secret, so an absent one here means
    // "unchanged" — a stored credential or an inline fallback stays put.
    if (asString(incoming.secretRef).trim() !== "") channel.secretRef = asString(incoming.secretRef).trim();
    if (existing !== undefined && asString(incoming.key) === "") channel.key = existing.key;

    const secret = args.secret;
    if (typeof secret === "string" && secret !== "") {
      const stored = await this.storeSecret(channel, secret);
      if (stored.inline) channel.key = secret;
      else channel.key = "";
    } else if (secret === "") {
      await this.clearSecret({ id: channel.id, channel });
      channel.key = "";
    }
    if (channel.protocol === "custom" && !/^https?:\/\//i.test(channel.custom.url)) {
      return { ok: false, error: "custom channel URL must start with http:// or https://" };
    }

    const channels = current.channels.slice();
    if (index >= 0) channels[index] = channel;
    else channels.push(channel);
    const saved = await writeState(this.ctx, { ...current, channels });
    const stored = saved.channels.find((c) => c.id === channel.id) ?? channel;
    return { ok: true, channel: await this.publicChannel(stored) };
  }

  async deleteChannel(args) {
    const current = this.state();
    const id = asString(args?.id);
    const channel = current.channels.find((c) => c.id === id);
    if (channel === undefined) return { ok: false, error: `channel "${id}" not found` };
    await writeState(this.ctx, { ...current, channels: current.channels.filter((c) => c.id !== id) });
    await this.clearSecret({ id, channel });
    return { ok: true, id };
  }

  async setSecret(args) {
    const current = this.state();
    const id = asString(args?.id);
    const channel = current.channels.find((c) => c.id === id);
    if (channel === undefined) return { ok: false, error: `channel "${id}" not found` };
    const value = asString(args?.secret);
    if (value === "") return this.clearSecret({ id, channel });
    const stored = await this.storeSecret(channel, value);
    if (stored.inline) {
      const channels = current.channels.map((c) => (c.id === id ? { ...channel, key: value } : c));
      await writeState(this.ctx, { ...current, channels });
    }
    return { ok: true, id, ref: channel.secretRef, ...stored };
  }

  async clearSecret(args) {
    const current = this.state();
    const id = asString(args?.id);
    const channel = isObject(args?.channel) ? normalizeChannel(args.channel, 0) : current.channels.find((c) => c.id === id);
    if (channel === undefined) return { ok: false, error: `channel "${id}" not found` };
    const credentials = this.ctx.get("credentials");
    if (credentials !== undefined && typeof credentials.unset === "function" && channel.secretRef !== "") {
      try {
        await credentials.unset(channel.secretRef);
      } catch {
        // Nothing stored, or a read-only source shadows the ref — either way the
        // inline fallback is the only copy left, so clear that too.
      }
    }
    return { ok: true, id: channel.id, cleared: true };
  }

  async secretStatus(channel) {
    const credentials = this.ctx.get("credentials");
    const status = { ref: channel.secretRef, configured: false, source: undefined, writable: false, inline: channel.key !== "" };
    if (credentials !== undefined && typeof credentials.describe === "function" && channel.secretRef !== "") {
      try {
        const info = await credentials.describe(channel.secretRef);
        if (isObject(info)) {
          status.configured = info.configured === true;
          status.source = typeof info.source === "string" ? info.source : undefined;
          status.writable = info.writable === true;
        }
      } catch {
        // Describing is best-effort.
      }
    } else if (channel.key !== "") {
      status.configured = true;
      status.source = "inline";
    }
    return status;
  }

  async storeSecret(channel, value) {
    const credentials = this.ctx.get("credentials");
    if (credentials !== undefined && typeof credentials.set === "function" && channel.secretRef !== "") {
      try {
        await credentials.set(channel.secretRef, value);
        return { stored: "credentials", inline: false };
      } catch (error) {
        this.log0("warn", `credentials.set failed, storing inline: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { stored: "inline", inline: true };
  }

  async testChannel(args) {
    const state = this.state();
    const id = asString(args?.id);
    const channel = state.channels.find((c) => c.id === id);
    if (channel === undefined) return { ok: false, error: `channel "${id}" not found` };
    const labels = STATUS_LABELS[state.template.lang] ?? STATUS_LABELS.zh;
    const tokens = {
      status: labels.test,
      session: asString(args?.session) || shortId("session-test"),
      project: "DSH",
      summary: asString(args?.summary) || (state.template.lang === "en" ? "If you can read this, the channel works." : "如果你收到这条消息，说明该通道可用。"),
      cwd: "",
      model: "",
      turn: "",
      duration: "",
      reason: "test",
      error: "",
      time: localStamp(Date.now(), false),
      date: localStamp(Date.now(), true),
      trigger: "test",
    };
    const message = {
      trigger: "test",
      sessionId: "test",
      title: truncate(tidy(renderTemplate(state.template.title, tokens)) || labels.test, 120),
      body: truncate(tidy(renderTemplate(state.template.body, tokens)), state.delivery.bodyChars),
      tokens,
    };
    const secrets = await this.secrets({ ...state, channels: [channel] });
    const result = await this.sendOne(channel, secrets.get(channel.id) ?? "", message, state);
    return { ok: true, result };
  }

  async pushTest(args) {
    const state = this.state();
    if (!state.enabled) return { ok: false, error: "notifications are disabled" };
    const labels = STATUS_LABELS[state.template.lang] ?? STATUS_LABELS.zh;
    const tokens = {
      status: labels.test,
      session: asString(args?.title) || "DSH",
      project: "DSH",
      summary: asString(args?.body) || (state.template.lang === "en" ? "Manual test push." : "手动测试推送。"),
      cwd: "",
      model: "",
      turn: "",
      duration: "",
      reason: "test",
      error: "",
      time: localStamp(Date.now(), false),
      date: localStamp(Date.now(), true),
      trigger: "test",
    };
    const message = {
      trigger: "test",
      sessionId: "test",
      title: truncate(tidy(renderTemplate(state.template.title, tokens)) || labels.test, 120),
      body: truncate(tidy(renderTemplate(state.template.body, tokens)), state.delivery.bodyChars),
      tokens,
    };
    const results = await this.deliver(message, state);
    return { ok: true, results };
  }

  listDeliveries(args) {
    const limit = asNumber(args?.limit, 50, 1, 500);
    return { ok: true, deliveries: this.log.slice(0, limit), stats: { ...this.stats } };
  }

  clearDeliveries() {
    this.log.length = 0;
    this.stats = { sent: 0, failed: 0, skipped: 0 };
    return { ok: true };
  }
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

const name = PACKAGE;
const inject = ["typert", "settings"];

function apply(ctx) {
  const runtime = new NotificationRuntime(ctx);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => ctx.typert.register(TYPERT_MANIFEST), `${PACKAGE}: typert manifest`);
    ctx.effect(() => () => runtime.dispose(), `${PACKAGE}: timers`);
  } else {
    ctx.typert.register(TYPERT_MANIFEST);
  }

  try {
    // This plugin ships its own settings page; the auto-generated form would be
    // a second, poorer copy of it.
    ctx.get("settings")?.configure?.({ auto: false });
  } catch {
    // A policy already registered by another instance of this plugin is fine.
  }

  const listen = (event, handler) => {
    try {
      const off = ctx.on(event, handler);
      return typeof off === "function" ? off : undefined;
    } catch (error) {
      runtime.log0("warn", `cannot listen on ${event}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const registerListeners = () => {
    const offs = [];
    const on = (event, handler) => {
      const off = listen(event, handler);
      if (off !== undefined) offs.push(off);
    };

    on("session/event", (session, event) => {
      try {
        runtime.onSessionEvent(session, event);
      } catch (error) {
        runtime.log0("warn", `session/event: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    on("api-session/added", (summary) => {
      try {
        runtime.onSummary(summary);
      } catch {
        /* contained */
      }
    });
    on("api-session/status", (sessionId, running) => {
      try {
        runtime.onStatus(sessionId, running);
      } catch {
        /* contained */
      }
    });
    on("api-session/removed", (sessionId) => {
      try {
        runtime.onRemoved(sessionId);
      } catch {
        /* contained */
      }
    });
    on("goal/changed", (payload) => {
      try {
        runtime.onGoalChanged(payload);
      } catch {
        /* contained */
      }
    });
    on("subagent/end", (info) => {
      try {
        runtime.onSubagentEnd(info);
      } catch {
        /* contained */
      }
    });
    on("workflow/end", (info, result) => {
      try {
        runtime.onWorkflowEnd(info, result);
      } catch {
        /* contained */
      }
    });
    on("agent/error", (payload) => {
      try {
        runtime.onAgentError(payload);
      } catch {
        /* contained */
      }
    });
    // Waterfall events: observe and always continue the chain untouched.
    on("approval/request", (request, next) => {
      try {
        runtime.onNeedsInput(isObject(request) && isObject(request.agent) ? request.agent.id : undefined, "approval", request);
      } catch {
        /* contained */
      }
      return next();
    });
    on("user-questions/request", (request, next) => {
      try {
        runtime.onNeedsInput(isObject(request) && isObject(request.agent) ? request.agent.id : undefined, "question", request);
      } catch {
        /* contained */
      }
      return next();
    });

    return () => {
      for (const off of offs) {
        try {
          off();
        } catch {
          /* contained */
        }
      }
    };
  };

  if (typeof ctx.effect === "function") ctx.effect(registerListeners, `${PACKAGE}: listeners`);
  else registerListeners();
}

export { Config, apply, inject, name };
