/**
 * dsh-notify-ultra — Client half.
 *
 * Static client bundle: a `window.__ModuleLoader__.load({ id, factory })` CJS
 * factory, exactly like every other `dsh.client.platform: "web"` package. The
 * same bundle is what the DSH Desktop app renders (Desktop mounts the web
 * client), so one implementation serves both.
 *
 * It contributes one Settings page ("通知推送") that talks to the host half
 * through the plugin's Typert Remote namespace.
 */
window.__ModuleLoader__.load({
  id: "dsh-notify-ultra",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
    var h = React.createElement;

    // ---------------------------------------------------------------------
    // Remote contract — must mirror lib/host.js
    // ---------------------------------------------------------------------

    var PACKAGE = "dsh-notify-ultra";
    var SERVICE_KEY = "notification";
    var CLIENT_NS = "dsh-notify-ultra";
    var METHODS = [
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
    var METHOD_MAP = {};
    for (var i = 0; i < METHODS.length; i += 1) METHOD_MAP[METHODS[i][0]] = METHODS[i][1];

    var looseSchema = function () {
      return { parse: function (value) { return value === undefined || value === null ? {} : value; } };
    };
    var resultEnvelopeSchema = {
      parse: function (value) {
        if (value === null || typeof value !== "object" || typeof value.ok !== "boolean") throw new TypeError("expected an { ok, ... } envelope");
        return value;
      },
    };
    var argParam = {
      name: "args",
      wire: "args",
      source: "json",
      codec: { mode: "strict", typeSymbol: PACKAGE + "#Args", create: looseSchema },
    };
    var INVOCATIONS = METHODS.map(function (pair) {
      return {
        id: PACKAGE + "#" + SERVICE_KEY + "/" + pair[1],
        service: SERVICE_KEY,
        namespace: SERVICE_KEY,
        method: pair[1],
        invocation: { kind: "direct" },
        parameters: [argParam],
        result: { mode: "strict", typeSymbol: PACKAGE + "#" + pair[1] + "Result", create: function () { return resultEnvelopeSchema; } },
      };
    });

    // ---------------------------------------------------------------------
    // Copy
    // ---------------------------------------------------------------------

    var ZH = {
      nav: "通知推送",
      title: "通知推送",
      intro: "任务完成、出错或需要你确认时，把一条消息推送到手机或其他设备。",
      loading: "加载中…",
      callFailed: "调用失败",
      save: "保存",
      cancel: "取消",
      saved: "已保存",
      refresh: "刷新",
      enabled: "总开关",
      enabledHint: "关闭后不再产生任何推送。",
      testPush: "发送测试推送",
      tabChannels: "通道",
      tabTriggers: "触发",
      tabTemplate: "文案",
      tabLog: "记录",
      channelsHint: "每条消息会推送到所有启用的通道；某个通道失败不会影响其他通道。",
      addChannel: "新增通道",
      noChannels: "还没有通道，先新增一个。",
      protocol: "协议",
      protocolCustom: "自定义 API",
      protocolBark: "Bark",
      protocolMeow: "Meow（喵 · ChuckFang）",
      protocolMiaotixing: "喵提醒（MiaoTixing）",
      channelName: "名称",
      channelEnabled: "启用",
      secret: "密钥 / Token",
      secretConfigured: "已保存",
      secretMissing: "未设置",
      secretHint: "密钥保存在 DSH 凭据服务里，不写入插件设置。留空表示不改动。",
      secretClear: "清除密钥",
      secretRef: "凭据名",
      secretRefHint: "读取密钥所用的凭据名（可改成已有的环境变量名）。",
      test: "测试",
      testing: "测试中…",
      edit: "编辑",
      remove: "删除",
      removeConfirm: "确定删除这个通道？",
      server: "服务器地址",
      deviceKey: "设备密钥（Bark device key）",
      meowNickname: "昵称（nickname）",
      barkSendAs: "请求形式",
      barkPost: "POST /push（推荐，正文不限长）",
      barkGet: "GET /{key}/{title}/{body}",
      barkSubtitle: "副标题 subtitle",
      barkSound: "铃声 sound",
      barkGroup: "分组 group",
      barkIcon: "图标 icon",
      barkImage: "图片 image",
      barkLevel: "级别 level",
      barkUrl: "点击跳转 url",
      barkBadge: "角标 badge（整数）",
      barkTtl: "有效期 ttl（秒）",
      barkCopy: "复制内容 copy",
      barkArchive: "自动保存 isArchive",
      barkAutoCopy: "自动复制 autoCopy",
      barkCall: "持续响铃 call",
      meowSendAs: "请求形式",
      meowGet: "GET /{昵称}/{标题}/{内容}（推荐）",
      meowPost: "POST /{昵称}（JSON）",
      meowMsgType: "内容类型 msgType",
      meowText: "纯文本 text",
      meowHtml: "HTML（会员）",
      meowHtmlHeight: "HTML 高度 htmlHeight(px)",
      meowUrl: "点击跳转 url",
      meowImgUrl: "图片 imgUrl",
      meowHint: "标识符填你在 MeoW 注册的昵称；该接口始终返回 HTTP 200，成功与否看响应体里的 status。",
      miaotixingSendAs: "请求形式",
      miaotixingGet: "GET /trigger（推荐）",
      miaotixingPost: "POST /trigger",
      miaotixingId: "喵码（MIAO_ID）",
      miaotixingTempl: "模板 templ",
      miaotixingOption: "选项 option",
      miaotixingOptionHint: "例如 nosms、nophonecall，多个用逗号分隔。",
      miaotixingHint: "标识符填提醒单的喵码（例如 tDS0Se9）；官方建议两次推送间隔 ≥10 秒。",
      customMethod: "请求方法",
      customUrl: "请求 URL",
      customUrlHint: "支持占位符，例如 https://example.com/push?title={title:url}",
      customHeaders: "请求头（每行一条 Name: Value）",
      customContentType: "Content-Type",
      customBody: "请求体",
      customBodyHint: "JSON 里用 {title:json} / {body:json} 可保证转义正确；{{secret}} 会替换为上面的密钥。",
      customAcceptAny: "忽略 HTTP 状态码（非 2xx 也算成功）",
      customExpectContains: "响应需包含（留空不检查）",
      customExpectPath: "响应 JSON 路径（留空不检查）",
      customExpectEquals: "该路径应等于",
      placeholders: "可用占位符",
      triggers: "触发条件",
      triggersHint: "只有打开的条件才会推送。",
      delivery: "发送策略",
      debounceMs: "合并窗口(ms)",
      debounceHint: "同一会话在这个窗口内的多次结束只推一条。",
      minIntervalMs: "最小推送间隔(ms)",
      minIntervalHint: "全局节流，避免连续轰炸。",
      timeoutMs: "请求超时(ms)",
      retries: "失败重试次数",
      summaryChars: "摘要截断字数",
      bodyChars: "正文截断字数",
      skipSubagent: "忽略子代理会话",
      skipSubagentHint: "由子代理创建的会话结束时不推送。",
      maxLog: "记录条数上限",
      lang: "状态词语言",
      langZh: "中文",
      langEn: "English",
      templateTitle: "标题模板",
      templateBody: "正文模板",
      logHint: "仅保留在内存中，重启后清空。",
      clearLog: "清空记录",
      noLog: "还没有推送记录。",
      colTime: "时间",
      colChannel: "通道",
      colStatus: "结果",
      colLatency: "耗时",
      ok: "成功",
      fail: "失败",
      stats: "累计：成功 {sent} · 失败 {failed} · 跳过 {skipped}",
      notWritable: "设置只读",
      credentialsOn: "密钥由凭据服务托管",
      credentialsOff: "凭据服务不可用，密钥将直接写入设置",
      triggerTaskComplete: "任务完成",
      triggerTaskCompleteHint: "一个回合正常结束。",
      triggerTaskError: "任务出错",
      triggerTaskErrorHint: "回合以错误或超出 token 上限结束。",
      triggerTaskBlocked: "任务受阻",
      triggerTaskBlockedHint: "回合被拦截（例如工具调用被拒绝）。",
      triggerTaskCancelled: "任务被取消",
      triggerTaskCancelledHint: "你主动中断或回合被放弃。默认关闭，避免噪音。",
      triggerNeedsInput: "需要确认",
      triggerNeedsInputHint: "DSH 正在等待你回答提问或批准操作。",
      triggerGoalComplete: "目标达成",
      triggerGoalCompleteHint: "会话里的目标被标记为完成。",
      triggerSubagentEnd: "子代理结束",
      triggerSubagentEndHint: "一个子代理任务结束。",
      triggerWorkflowEnd: "工作流结束",
      triggerWorkflowEndHint: "一次 workflow 运行结束。",
      testResultOk: "测试成功（{status}，{latency}ms）",
      testResultFail: "测试失败：{error}",
      pushResult: "已推送到 {ok}/{total} 个通道",
      requiredName: "请填写名称",
    };

    var EN = {
      nav: "Notification",
      title: "Notification",
      intro: "Push a message to your phone or another device when a task finishes, fails, or needs you.",
      loading: "Loading…",
      callFailed: "The call failed",
      save: "Save",
      cancel: "Cancel",
      saved: "Saved",
      refresh: "Refresh",
      enabled: "Master switch",
      enabledHint: "When off, nothing is pushed at all.",
      testPush: "Send a test push",
      tabChannels: "Channels",
      tabTriggers: "Triggers",
      tabTemplate: "Message",
      tabLog: "History",
      channelsHint: "Every message goes to every enabled channel; one failing channel never blocks the others.",
      addChannel: "Add channel",
      noChannels: "No channel yet — add one to get started.",
      protocol: "Protocol",
      protocolCustom: "Custom API",
      protocolBark: "Bark",
      protocolMeow: "Meow (ChuckFang)",
      protocolMiaotixing: "MiaoTixing (喵提醒)",
      channelName: "Name",
      channelEnabled: "Enabled",
      secret: "Key / token",
      secretConfigured: "stored",
      secretMissing: "not set",
      secretHint: "The secret lives in the DSH credentials service, never in this plugin's settings. Leave blank to keep it.",
      secretClear: "Clear secret",
      secretRef: "Credential ref",
      secretRefHint: "Credential name used to resolve the secret (an existing environment variable name works too).",
      test: "Test",
      testing: "Testing…",
      edit: "Edit",
      remove: "Delete",
      removeConfirm: "Delete this channel?",
      server: "Server URL",
      deviceKey: "Device key (Bark device key)",
      meowNickname: "Nickname",
      barkSendAs: "Request form",
      barkPost: "POST /push (recommended, unlimited body)",
      barkGet: "GET /{key}/{title}/{body}",
      barkSubtitle: "subtitle",
      barkSound: "sound",
      barkGroup: "group",
      barkIcon: "icon",
      barkImage: "image",
      barkLevel: "level",
      barkUrl: "url",
      barkBadge: "badge (integer)",
      barkTtl: "ttl (seconds)",
      barkCopy: "copy",
      barkArchive: "isArchive",
      barkAutoCopy: "autoCopy",
      barkCall: "call (ring continuously)",
      meowSendAs: "Request form",
      meowGet: "GET /{nickname}/{title}/{msg} (recommended)",
      meowPost: "POST /{nickname} (JSON)",
      meowMsgType: "msgType",
      meowText: "plain text",
      meowHtml: "HTML (paid plan)",
      meowHtmlHeight: "htmlHeight (px)",
      meowUrl: "url",
      meowImgUrl: "imgUrl",
      meowHint: "The identifier is the nickname you registered with MeoW. This API always answers HTTP 200 — success is decided by `status` in the body.",
      miaotixingSendAs: "Request form",
      miaotixingGet: "GET /trigger (recommended)",
      miaotixingPost: "POST /trigger",
      miaotixingId: "MIAO_ID (喵码)",
      miaotixingTempl: "templ",
      miaotixingOption: "option",
      miaotixingOptionHint: "e.g. nosms, nophonecall — comma separated.",
      miaotixingHint: "The identifier is the reminder's 喵码 (e.g. tDS0Se9). The service asks for at least 10s between pushes.",
      customMethod: "Method",
      customUrl: "Request URL",
      customUrlHint: "Placeholders allowed, e.g. https://example.com/push?title={title:url}",
      customHeaders: "Headers (one Name: Value per line)",
      customContentType: "Content-Type",
      customBody: "Request body",
      customBodyHint: "In JSON use {title:json} / {body:json} so escaping is always correct; {{secret}} becomes the key above.",
      customAcceptAny: "Ignore the HTTP status (treat non-2xx as success)",
      customExpectContains: "Response must contain (blank = no check)",
      customExpectPath: "Response JSON path (blank = no check)",
      customExpectEquals: "…must equal",
      placeholders: "Available placeholders",
      triggers: "Triggers",
      triggersHint: "Only the checked conditions produce a push.",
      delivery: "Delivery policy",
      debounceMs: "Coalesce window (ms)",
      debounceHint: "Turn ends inside this window for one session collapse into one push.",
      minIntervalMs: "Minimum interval (ms)",
      minIntervalHint: "Global throttle so a burst cannot spam the device.",
      timeoutMs: "Request timeout (ms)",
      retries: "Retries on failure",
      summaryChars: "Summary length",
      bodyChars: "Body length",
      skipSubagent: "Ignore sub-agent sessions",
      skipSubagentHint: "Do not push when a session created by a sub-agent ends.",
      maxLog: "History size",
      lang: "Status wording",
      langZh: "中文",
      langEn: "English",
      templateTitle: "Title template",
      templateBody: "Body template",
      logHint: "In-memory only; cleared on restart.",
      clearLog: "Clear history",
      noLog: "No push yet.",
      colTime: "Time",
      colChannel: "Channel",
      colStatus: "Result",
      colLatency: "Latency",
      ok: "ok",
      fail: "failed",
      stats: "Total: {sent} sent · {failed} failed · {skipped} skipped",
      notWritable: "Settings read-only",
      credentialsOn: "Secrets live in the credentials service",
      credentialsOff: "Credentials service unavailable — secrets are stored inline",
      triggerTaskComplete: "Task finished",
      triggerTaskCompleteHint: "A turn ended normally.",
      triggerTaskError: "Task failed",
      triggerTaskErrorHint: "A turn ended with an error or hit the token limit.",
      triggerTaskBlocked: "Task blocked",
      triggerTaskBlockedHint: "The turn was blocked (a denied tool call, for instance).",
      triggerTaskCancelled: "Task cancelled",
      triggerTaskCancelledHint: "You interrupted it, or the turn was abandoned. Off by default to avoid noise.",
      triggerNeedsInput: "Needs input",
      triggerNeedsInputHint: "DSH is waiting for your answer or your approval.",
      triggerGoalComplete: "Goal complete",
      triggerGoalCompleteHint: "A goal in the session was marked complete.",
      triggerSubagentEnd: "Sub-agent finished",
      triggerSubagentEndHint: "One sub-agent run settled.",
      triggerWorkflowEnd: "Workflow finished",
      triggerWorkflowEndHint: "One workflow run settled.",
      testResultOk: "Test delivered ({status}, {latency}ms)",
      testResultFail: "Test failed: {error}",
      pushResult: "Pushed to {ok}/{total} channels",
      requiredName: "A name is required",
    };

    var TRIGGERS = [
      ["taskComplete", "triggerTaskComplete", "triggerTaskCompleteHint"],
      ["taskError", "triggerTaskError", "triggerTaskErrorHint"],
      ["taskBlocked", "triggerTaskBlocked", "triggerTaskBlockedHint"],
      ["taskCancelled", "triggerTaskCancelled", "triggerTaskCancelledHint"],
      ["needsInput", "triggerNeedsInput", "triggerNeedsInputHint"],
      ["goalComplete", "triggerGoalComplete", "triggerGoalCompleteHint"],
      ["subagentEnd", "triggerSubagentEnd", "triggerSubagentEndHint"],
      ["workflowEnd", "triggerWorkflowEnd", "triggerWorkflowEndHint"],
    ];

    var PLACEHOLDERS = [
      ["{status}", "任务完成 / Task finished"],
      ["{session}", "会话标题"],
      ["{project}", "工作目录名"],
      ["{summary}", "最后一条回复摘要"],
      ["{cwd}", "完整工作目录"],
      ["{model}", "模型名"],
      ["{turn}", "回合序号"],
      ["{duration}", "本回合耗时"],
      ["{reason}", "结束原因"],
      ["{error}", "错误信息"],
      ["{time}", "HH:MM"],
      ["{date}", "YYYY-MM-DD HH:MM"],
      ["{title}", "渲染后的标题（仅自定义 API 请求模板）"],
      ["{body}", "渲染后的正文（仅自定义 API 请求模板）"],
      ["{{secret}}", "通道密钥（仅自定义 API 请求模板）"],
    ];

    // ---------------------------------------------------------------------
    // Styles — theme tokens with light/dark-safe fallbacks
    // ---------------------------------------------------------------------

    var STYLE_ID = "dsh-notify-ultra-styles";
    var CSS = [
      ".dshn-root{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary,#1f2328);font-size:13px;line-height:1.55;}",
      ".dshn-head{display:flex;flex-direction:column;gap:4px;}",
      ".dshn-title{font-size:16px;font-weight:600;margin:0;}",
      ".dshn-intro{color:var(--dsw-alias-label-secondary,#6b7280);margin:0;}",
      ".dshn-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      ".dshn-spacer{flex:1;}",
      ".dshn-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1,#e5e7eb);}",
      ".dshn-tab{appearance:none;background:none;border:0;border-bottom:2px solid transparent;padding:6px 10px;cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280);font-size:13px;}",
      ".dshn-tab[data-active='1']{color:var(--dsw-alias-label-primary,#1f2328);border-bottom-color:var(--dsw-alias-brand-primary,#2563eb);font-weight:600;}",
      ".dshn-card{border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);padding:12px;display:flex;flex-direction:column;gap:10px;}",
      ".dshn-cardHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      ".dshn-cardTitle{font-weight:600;font-size:13.5px;}",
      ".dshn-muted{color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dshn-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;}",
      ".dshn-field{display:flex;flex-direction:column;gap:4px;min-width:0;}",
      ".dshn-label{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dshn-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dshn-input,.dshn-select,.dshn-area{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;padding:6px 8px;}",
      ".dshn-area{min-height:88px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}",
      ".dshn-inputMono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;}",
      ".dshn-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#f9fafb);color:inherit;border-radius:8px;padding:5px 10px;cursor:pointer;font:inherit;}",
      ".dshn-btn:hover{border-color:var(--dsw-alias-brand-primary,#2563eb);}",
      ".dshn-btn[disabled]{opacity:.5;cursor:not-allowed;}",
      ".dshn-btnPrimary{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff;}",
      ".dshn-btnDanger{color:var(--dsw-alias-state-error-primary,#dc2626);}",
      ".dshn-btnSm{padding:3px 8px;font-size:12px;}",
      ".dshn-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:1px 8px;font-size:11px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);}",
      ".dshn-chipOk{color:var(--dsw-alias-state-success-primary,#16a34a);border-color:currentColor;}",
      ".dshn-chipWarn{color:var(--dsw-alias-state-warn-primary,#d97706);border-color:currentColor;}",
      ".dshn-chipErr{color:var(--dsw-alias-state-error-primary,#dc2626);border-color:currentColor;}",
      ".dshn-chipOff{color:var(--dsw-alias-state-idle-primary,#9ca3af);}",
      ".dshn-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer;user-select:none;}",
      ".dshn-switch input{accent-color:var(--dsw-alias-brand-primary,#2563eb);}",
      ".dshn-row{display:flex;align-items:center;gap:8px;justify-content:space-between;}",
      ".dshn-tr{display:grid;grid-template-columns:64px 1fr 70px 60px;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l1,#f1f3f5);}",
      ".dshn-trHead{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:none;}",
      ".dshn-pre{white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;}",
      ".dshn-note{border-radius:8px;padding:8px 10px;font-size:12px;border:1px solid transparent;}",
      ".dshn-noteErr{color:var(--dsw-alias-state-error-primary,#dc2626);border-color:var(--dsw-alias-state-error-primary,#dc2626);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#dc2626) 8%,transparent);}",
      ".dshn-noteOk{color:var(--dsw-alias-state-success-primary,#16a34a);border-color:var(--dsw-alias-state-success-primary,#16a34a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 8%,transparent);}",
      ".dshn-inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
      ".dshn-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;}",
      ".dshn-list{display:flex;flex-direction:column;gap:8px;}",
    ].join("");

    function adoptStyles() {
      if (typeof document === "undefined") return function () {};
      var existing = document.getElementById(STYLE_ID);
      if (existing !== null) return function () {};
      var style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-plugin", PACKAGE);
      style.textContent = CSS;
      document.head.appendChild(style);
      return function () {
        try {
          style.remove();
        } catch (error) {
          /* contained */
        }
      };
    }

    // ---------------------------------------------------------------------
    // Remote plumbing
    // ---------------------------------------------------------------------

    function msgOf(error) {
      if (typeof error === "string") return error;
      if (error && typeof error === "object" && typeof error.message === "string") return error.message;
      return "";
    }

    function createCall(t, getRemote) {
      return async function call(method, payload) {
        var remote = getRemote();
        if (remote === null) throw new Error(t("callFailed"));
        var remoteMethod = METHOD_MAP[method];
        if (remoteMethod === undefined) throw new Error("unknown method: " + method);
        var envelope = await remote[remoteMethod](payload || {});
        if (envelope === null || typeof envelope !== "object" || envelope.ok !== true) {
          throw new Error(msgOf(envelope && envelope.error) || t("callFailed"));
        }
        var value = envelope.value;
        if (value === null || typeof value !== "object" || value.ok !== true) {
          throw new Error(msgOf(value && value.error) || t("callFailed"));
        }
        return value;
      };
    }

    function resolveRemoteHandle(ctx) {
      var remote = ctx && ctx.remote;
      if (remote !== undefined && remote !== null && typeof remote === "object") {
        try {
          var handle = remote[SERVICE_KEY];
          if (handle !== undefined && handle !== null) return handle;
        } catch (error) {
          /* contained */
        }
      }
      try {
        var reflect = ctx && ctx.reflect;
        if (reflect !== undefined && typeof reflect.get === "function") {
          var projected = reflect.get("remote." + SERVICE_KEY);
          if (projected !== undefined && projected !== null) return projected;
        }
      } catch (error) {
        /* contained */
      }
      return undefined;
    }

    // ---------------------------------------------------------------------
    // Small UI atoms
    // ---------------------------------------------------------------------

    function Field(props) {
      return h(
        "label",
        { className: "dshn-field" },
        h("span", { className: "dshn-label" }, props.label),
        props.children,
        props.hint !== undefined && props.hint !== "" ? h("span", { className: "dshn-hint" }, props.hint) : null,
      );
    }

    function TextInput(props) {
      return h("input", {
        className: "dshn-input" + (props.mono ? " dshn-inputMono" : ""),
        value: props.value === undefined || props.value === null ? "" : String(props.value),
        placeholder: props.placeholder || "",
        type: props.type || "text",
        onChange: function (event) {
          props.onChange(event.target.value);
        },
      });
    }

    function NumberInput(props) {
      return h("input", {
        className: "dshn-input",
        type: "number",
        min: props.min,
        max: props.max,
        value: props.value === undefined || props.value === null ? "" : String(props.value),
        onChange: function (event) {
          var raw = event.target.value;
          props.onChange(raw === "" ? props.fallback : Number(raw));
        },
      });
    }

    function TextArea(props) {
      return h("textarea", {
        className: "dshn-area",
        value: props.value === undefined || props.value === null ? "" : String(props.value),
        placeholder: props.placeholder || "",
        rows: props.rows || 4,
        onChange: function (event) {
          props.onChange(event.target.value);
        },
      });
    }

    function Select(props) {
      return h(
        "select",
        {
          className: "dshn-select",
          value: props.value,
          onChange: function (event) {
            props.onChange(event.target.value);
          },
        },
        props.options.map(function (option) {
          return h("option", { key: option[0], value: option[0] }, option[1]);
        }),
      );
    }

    function Toggle(props) {
      return h(
        "label",
        { className: "dshn-switch" },
        h("input", {
          type: "checkbox",
          checked: props.checked === true,
          onChange: function (event) {
            props.onChange(event.target.checked);
          },
        }),
        h("span", null, props.label),
      );
    }

    function Button(props) {
      return h(
        "button",
        {
          type: "button",
          className: "dshn-btn" + (props.variant ? " dshn-btn" + props.variant : "") + (props.small ? " dshn-btnSm" : ""),
          disabled: props.disabled === true,
          onClick: props.onClick,
        },
        props.children,
      );
    }

    function Chip(props) {
      return h("span", { className: "dshn-chip" + (props.tone ? " dshn-chip" + props.tone : "") }, props.children);
    }

    function Note(props) {
      return h("div", { className: "dshn-note dshn-note" + (props.tone === "error" ? "Err" : "Ok") }, props.children);
    }

    // ---------------------------------------------------------------------
    // Channel editor
    // ---------------------------------------------------------------------

    function channelDefaults() {
      return {
        bark: {
          server: "https://api.day.app",
          sendAs: "post",
          subtitle: "",
          sound: "",
          group: "DSH",
          icon: "",
          image: "",
          level: "",
          url: "",
          copy: "",
          badge: "",
          ttl: "",
          isArchive: false,
          autoCopy: false,
          call: false,
        },
        meow: { server: "https://api.chuckfang.com", sendAs: "get", msgType: "text", htmlHeight: "", url: "", imgUrl: "" },
        miaotixing: { server: "https://miaotixing.com", sendAs: "get", templ: "", option: "" },
        custom: {
          method: "POST",
          url: "",
          headers: {},
          contentType: "application/json",
          body: '{"title":{title:json},"body":{body:json},"source":"dsh"}',
          acceptAnyStatus: false,
          expectContains: "",
          expectPath: "",
          expectEquals: "",
        },
      };
    }

    /** Fill in any sub-object the host did not send, so the editor never crashes. */
    function hydrateChannel(channel) {
      const defaults = channelDefaults();
      const draft = JSON.parse(JSON.stringify(channel));
      draft.bark = Object.assign({}, defaults.bark, draft.bark);
      draft.meow = Object.assign({}, defaults.meow, draft.meow);
      draft.miaotixing = Object.assign({}, defaults.miaotixing, draft.miaotixing);
      draft.custom = Object.assign({}, defaults.custom, draft.custom);
      if (draft.custom.headers === null || typeof draft.custom.headers !== "object") draft.custom.headers = {};
      return draft;
    }

    function emptyChannel() {
      return Object.assign({ id: "ch" + Date.now().toString(36), name: "", protocol: "bark", enabled: true, secretRef: "" }, channelDefaults());
    }

    /** One-line summary of where a channel actually sends. */
    function channelSummary(channel, t) {
      if (channel.protocol === "bark") {
        const bark = channel.bark || {};
        return (bark.server || "") + (bark.sendAs === "get" ? " (GET)" : " /push (POST)");
      }
      if (channel.protocol === "meow") return (channel.meow || {}).server || "";
      if (channel.protocol === "miaotixing") return ((channel.miaotixing || {}).server || "") + "/trigger";
      return (channel.custom || {}).url || "";
    }

    function headersToText(headers) {
      if (headers === null || typeof headers !== "object") return "";
      return Object.keys(headers)
        .map(function (key) {
          return key + ": " + headers[key];
        })
        .join("\n");
    }

    function textToHeaders(text) {
      var out = {};
      String(text || "")
        .split("\n")
        .forEach(function (line) {
          var index = line.indexOf(":");
          if (index <= 0) return;
          var name = line.slice(0, index).trim();
          var value = line.slice(index + 1).trim();
          if (name !== "") out[name] = value;
        });
      return out;
    }

    function ChannelEditor(props) {
      var t = props.t;
      var draft = props.draft;
      var setDraft = props.setDraft;
      var [secret, setSecret] = React.useState("");
      var [headersText, setHeadersText] = React.useState(headersToText(draft.custom ? draft.custom.headers : {}));
      var patch = function (changes) {
        setDraft(Object.assign({}, draft, changes));
      };
      var patchBark = function (changes) {
        patch({ bark: Object.assign({}, draft.bark, changes) });
      };
      var patchMeow = function (changes) {
        patch({ meow: Object.assign({}, draft.meow, changes) });
      };
      var patchMiaotixing = function (changes) {
        patch({ miaotixing: Object.assign({}, draft.miaotixing, changes) });
      };
      var patchCustom = function (changes) {
        patch({ custom: Object.assign({}, draft.custom, changes) });
      };
      var isNew = props.isNew;

      return h(
        "div",
        { className: "dshn-card" },
        h(
          "div",
          { className: "dshn-cardHead" },
          h("span", { className: "dshn-cardTitle" }, isNew ? t("addChannel") : t("edit") + " · " + (draft.name || draft.id)),
          h("span", { className: "dshn-spacer" }),
          h(Button, { small: true, onClick: props.onCancel }, t("cancel")),
          h(
            Button,
            {
              small: true,
              variant: "Primary",
              disabled: props.busy,
              onClick: function () {
                props.onSave(draft, secret, headersText);
              },
            },
            t("save"),
          ),
        ),
        h(
          "div",
          { className: "dshn-grid" },
          h(Field, { label: t("channelName") }, h(TextInput, { value: draft.name, onChange: function (value) { patch({ name: value }); } })),
          h(
            Field,
            { label: t("protocol") },
            h(Select, {
              value: draft.protocol,
              onChange: function (value) {
                patch({ protocol: value });
              },
              options: [
                ["bark", t("protocolBark")],
                ["meow", t("protocolMeow")],
                ["miaotixing", t("protocolMiaotixing")],
                ["custom", t("protocolCustom")],
              ],
            }),
          ),
          h(Field, { label: draft.protocol === "bark" ? t("deviceKey") : draft.protocol === "meow" ? t("meowNickname") : draft.protocol === "miaotixing" ? t("miaotixingId") : t("secret"), hint: t("secretHint") }, h(TextInput, { mono: true, type: "password", value: secret, placeholder: draft.secretConfigured ? t("secretConfigured") : t("secretMissing"), onChange: setSecret })),
          h(Field, { label: t("secretRef"), hint: t("secretRefHint") }, h(TextInput, { mono: true, value: draft.secretRef || "", placeholder: draft.defaultSecretRef || "", onChange: function (value) { patch({ secretRef: value }); } })),
        ),
        h(Toggle, { checked: draft.enabled !== false, label: t("channelEnabled"), onChange: function (value) { patch({ enabled: value }); } }),
        isNew !== true && draft.secretConfigured === true
          ? h(
              "div",
              { className: "dshn-bar" },
              h(Button, { small: true, variant: "Danger", disabled: props.busy === true, onClick: props.onClearSecret }, t("secretClear")),
            )
          : null,

        draft.protocol === "bark"
          ? h(
              "div",
              { className: "dshn-grid" },
              h(Field, { label: t("server"), hint: t("deviceKey") }, h(TextInput, { mono: true, value: draft.bark.server, onChange: function (value) { patchBark({ server: value }); } })),
              h(Field, { label: t("barkSendAs") }, h(Select, { value: draft.bark.sendAs, onChange: function (value) { patchBark({ sendAs: value }); }, options: [["post", t("barkPost")], ["get", t("barkGet")]] })),
              h(Field, { label: t("barkSubtitle") }, h(TextInput, { value: draft.bark.subtitle, onChange: function (value) { patchBark({ subtitle: value }); } })),
              h(Field, { label: t("barkSound") }, h(TextInput, { value: draft.bark.sound, onChange: function (value) { patchBark({ sound: value }); } })),
              h(Field, { label: t("barkGroup") }, h(TextInput, { value: draft.bark.group, onChange: function (value) { patchBark({ group: value }); } })),
              h(Field, { label: t("barkLevel") }, h(Select, { value: draft.bark.level, onChange: function (value) { patchBark({ level: value }); }, options: [["", "—"], ["active", "active"], ["timeSensitive", "timeSensitive"], ["passive", "passive"], ["critical", "critical"]] })),
              h(Field, { label: t("barkIcon") }, h(TextInput, { value: draft.bark.icon, onChange: function (value) { patchBark({ icon: value }); } })),
              h(Field, { label: t("barkImage") }, h(TextInput, { value: draft.bark.image, onChange: function (value) { patchBark({ image: value }); } })),
              h(Field, { label: t("barkUrl") }, h(TextInput, { value: draft.bark.url, onChange: function (value) { patchBark({ url: value }); } })),
              h(Field, { label: t("barkBadge") }, h(TextInput, { value: draft.bark.badge, onChange: function (value) { patchBark({ badge: value }); } })),
              h(Field, { label: t("barkTtl") }, h(TextInput, { value: draft.bark.ttl, onChange: function (value) { patchBark({ ttl: value }); } })),
              h(Field, { label: t("barkCopy") }, h(TextInput, { value: draft.bark.copy, onChange: function (value) { patchBark({ copy: value }); } })),
              h("div", { className: "dshn-field" }, h("span", { className: "dshn-label" }, "选项"), h(Toggle, { checked: draft.bark.isArchive === true, label: t("barkArchive"), onChange: function (value) { patchBark({ isArchive: value }); } }), h(Toggle, { checked: draft.bark.autoCopy === true, label: t("barkAutoCopy"), onChange: function (value) { patchBark({ autoCopy: value }); } }), h(Toggle, { checked: draft.bark.call === true, label: t("barkCall"), onChange: function (value) { patchBark({ call: value }); } })),
            )
          : null,

        draft.protocol === "meow"
          ? h(
              "div",
              { className: "dshn-list" },
              h(
                "div",
                { className: "dshn-grid" },
                h(Field, { label: t("server") }, h(TextInput, { mono: true, value: draft.meow.server, onChange: function (value) { patchMeow({ server: value }); } })),
                h(Field, { label: t("meowSendAs") }, h(Select, { value: draft.meow.sendAs, onChange: function (value) { patchMeow({ sendAs: value }); }, options: [["get", t("meowGet")], ["post", t("meowPost")]] })),
                h(Field, { label: t("meowMsgType") }, h(Select, { value: draft.meow.msgType, onChange: function (value) { patchMeow({ msgType: value }); }, options: [["text", t("meowText")], ["html", t("meowHtml")]] })),
                draft.meow.msgType === "html" ? h(Field, { label: t("meowHtmlHeight") }, h(TextInput, { value: draft.meow.htmlHeight, placeholder: "200", onChange: function (value) { patchMeow({ htmlHeight: value }); } })) : null,
                h(Field, { label: t("meowUrl") }, h(TextInput, { value: draft.meow.url, onChange: function (value) { patchMeow({ url: value }); } })),
                h(Field, { label: t("meowImgUrl") }, h(TextInput, { value: draft.meow.imgUrl, onChange: function (value) { patchMeow({ imgUrl: value }); } })),
              ),
              h("span", { className: "dshn-hint" }, t("meowHint")),
            )
          : null,

        draft.protocol === "miaotixing"
          ? h(
              "div",
              { className: "dshn-list" },
              h(
                "div",
                { className: "dshn-grid" },
                h(Field, { label: t("server"), hint: "miaotixing.com" }, h(TextInput, { mono: true, value: draft.miaotixing.server, onChange: function (value) { patchMiaotixing({ server: value }); } })),
                h(Field, { label: t("miaotixingSendAs") }, h(Select, { value: draft.miaotixing.sendAs, onChange: function (value) { patchMiaotixing({ sendAs: value }); }, options: [["get", t("miaotixingGet")], ["post", t("miaotixingPost")]] })),
                h(Field, { label: t("miaotixingTempl") }, h(TextInput, { value: draft.miaotixing.templ, onChange: function (value) { patchMiaotixing({ templ: value }); } })),
                h(Field, { label: t("miaotixingOption"), hint: t("miaotixingOptionHint") }, h(TextInput, { value: draft.miaotixing.option, placeholder: "nosms,nophonecall", onChange: function (value) { patchMiaotixing({ option: value }); } })),
              ),
              h("span", { className: "dshn-hint" }, t("miaotixingHint")),
            )
          : null,

        draft.protocol === "custom"
          ? h(
              "div",
              { className: "dshn-list" },
              h(
                "div",
                { className: "dshn-grid" },
                h(Field, { label: t("customMethod") }, h(Select, { value: draft.custom.method, onChange: function (value) { patchCustom({ method: value }); }, options: [["POST", "POST"], ["GET", "GET"], ["PUT", "PUT"], ["PATCH", "PATCH"]] })),
                h(Field, { label: t("customContentType") }, h(TextInput, { mono: true, value: draft.custom.contentType, onChange: function (value) { patchCustom({ contentType: value }); } })),
              ),
              h(Field, { label: t("customUrl"), hint: t("customUrlHint") }, h(TextInput, { mono: true, value: draft.custom.url, onChange: function (value) { patchCustom({ url: value }); } })),
              h(Field, { label: t("customHeaders") }, h(TextArea, { rows: 3, value: headersText, onChange: setHeadersText, placeholder: "Authorization: Bearer {{secret}}" })),
              draft.custom.method !== "GET" ? h(Field, { label: t("customBody"), hint: t("customBodyHint") }, h(TextArea, { rows: 4, value: draft.custom.body, onChange: function (value) { patchCustom({ body: value }); } })) : null,
              h(
                "div",
                { className: "dshn-grid" },
                h(Field, { label: t("customExpectContains") }, h(TextInput, { mono: true, value: draft.custom.expectContains, onChange: function (value) { patchCustom({ expectContains: value }); } })),
                h(Field, { label: t("customExpectPath") }, h(TextInput, { mono: true, placeholder: "code", value: draft.custom.expectPath, onChange: function (value) { patchCustom({ expectPath: value }); } })),
                h(Field, { label: t("customExpectEquals") }, h(TextInput, { mono: true, placeholder: "200", value: draft.custom.expectEquals, onChange: function (value) { patchCustom({ expectEquals: value }); } })),
              ),
              h(Toggle, { checked: draft.custom.acceptAnyStatus === true, label: t("customAcceptAny"), onChange: function (value) { patchCustom({ acceptAnyStatus: value }); } }),
            )
          : null,

        props.data !== null && props.data.credentialsAvailable === false
          ? h(Note, { tone: "error" }, t("credentialsOff"))
          : null,
      );
    }

    // ---------------------------------------------------------------------
    // Page
    // ---------------------------------------------------------------------

    function NotificationPage(props) {
      var t = props.t;
      var call = props.call;
      var state = React.useState({ loading: true, error: "", data: null });
      var view = state[0];
      var setView = state[1];
      var tabState = React.useState("channels");
      var tab = tabState[0];
      var setTab = tabState[1];
      var formState = React.useState(null);
      var form = formState[0];
      var setForm = formState[1];
      var editorState = React.useState(null);
      var editor = editorState[0];
      var setEditor = editorState[1];
      var busyState = React.useState("");
      var busy = busyState[0];
      var setBusy = busyState[1];
      var noticeState = React.useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];

      var load = React.useCallback(
        async function load() {
          try {
            var data = await call("get-overview");
            setView({ loading: false, error: "", data: data });
            setForm({
              enabled: data.enabled === true,
              triggers: Object.assign({}, data.triggers),
              template: Object.assign({}, data.template),
              delivery: Object.assign({}, data.delivery),
            });
          } catch (error) {
            setView({ loading: false, error: msgOf(error) || t("callFailed"), data: null });
          }
        },
        [call, t],
      );

      React.useEffect(function () {
        void load();
      }, [load]);

      var run = async function (label, operation) {
        setBusy(label);
        setNotice(null);
        try {
          var result = await operation();
          await load();
          return result;
        } catch (error) {
          setNotice({ tone: "error", text: msgOf(error) || t("callFailed") });
          return undefined;
        } finally {
          setBusy("");
        }
      };

      if (view.loading) return h("div", { className: "dshn-root" }, h("p", { className: "dshn-muted" }, t("loading")));
      if (view.data === null) {
        return h(
          "div",
          { className: "dshn-root" },
          h("h2", { className: "dshn-title" }, t("title")),
          h(Note, { tone: "error" }, view.error || t("callFailed")),
          h(Button, { onClick: function () { void load(); } }, t("refresh")),
        );
      }

      var data = view.data;
      var setFormField = function (group, changes) {
        setForm(Object.assign({}, form, { [group]: Object.assign({}, form[group], changes) }));
      };
      var save = function (label) {
        return run(label, function () {
          return call("save-settings", { enabled: form.enabled, triggers: form.triggers, template: form.template, delivery: form.delivery });
        }).then(function (result) {
          if (result !== undefined) setNotice({ tone: "ok", text: t("saved") });
          return result;
        });
      };

      var startNew = function () {
        setEditor({ draft: emptyChannel(), isNew: true });
        setTab("channels");
      };
      var startEdit = function (channel) {
        var draft = hydrateChannel(channel);
        draft.secretConfigured = channel.secret && channel.secret.configured === true;
        setEditor({ draft: draft, isNew: false });
        setTab("channels");
      };
      var saveChannel = function (draft, secret, headersText) {
        if (String(draft.name || "").trim() === "") {
          setNotice({ tone: "error", text: t("requiredName") });
          return;
        }
        var payload = JSON.parse(JSON.stringify(draft));
        delete payload.secret;
        delete payload.secretConfigured;
        delete payload.hasInlineKey;
        delete payload.defaultSecretRef;
        if (payload.protocol === "custom") payload.custom.headers = textToHeaders(headersText);
        var args = { channel: payload };
        if (secret !== "") args.secret = secret;
        void run("channel", function () {
          return call("save-channel", args);
        }).then(function (result) {
          if (result !== undefined) {
            setEditor(null);
            setNotice({ tone: "ok", text: t("saved") });
          }
        });
      };

      var tabs = [
        ["channels", t("tabChannels")],
        ["triggers", t("tabTriggers")],
        ["template", t("tabTemplate")],
        ["log", t("tabLog")],
      ];

      return h(
        "div",
        { className: "dshn-root" },
        h("div", { className: "dshn-head" }, h("h2", { className: "dshn-title" }, t("title")), h("p", { className: "dshn-intro" }, t("intro"))),

        h(
          "div",
          { className: "dshn-bar" },
          h(Toggle, {
            checked: data.enabled === true,
            label: t("enabled"),
            onChange: function (value) {
              setForm(Object.assign({}, form, { enabled: value }));
              void run("master", function () {
                return call("save-settings", { enabled: value });
              });
            },
          }),
          data.writable === false ? h(Chip, { tone: "Warn" }, t("notWritable")) : null,
          data.credentialsAvailable === true ? h(Chip, { tone: "Ok" }, t("credentialsOn")) : h(Chip, { tone: "Warn" }, t("credentialsOff")),
          h(Chip, { tone: "Off" }, t("stats").replace("{sent}", String(data.stats.sent)).replace("{failed}", String(data.stats.failed)).replace("{skipped}", String(data.stats.skipped))),
          h("span", { className: "dshn-hint" }, t("enabledHint")),
          h("span", { className: "dshn-spacer" }),
          h(
            Button,
            {
              disabled: busy !== "",
              onClick: function () {
                void run("push-test", function () {
                  return call("push-test", {});
                }).then(function (result) {
                  if (result === undefined) return;
                  var ok = (result.results || []).filter(function (entry) { return entry.ok === true; }).length;
                  setNotice({ tone: ok > 0 ? "ok" : "error", text: t("pushResult").replace("{ok}", String(ok)).replace("{total}", String((result.results || []).length)) });
                });
              },
            },
            t("testPush"),
          ),
          h(Button, { disabled: busy !== "", onClick: function () { void load(); } }, t("refresh")),
        ),

        notice !== null ? h(Note, { tone: notice.tone }, notice.text) : null,

        h(
          "div",
          { className: "dshn-tabs" },
          tabs.map(function (entry) {
            return h(
              "button",
              {
                key: entry[0],
                type: "button",
                className: "dshn-tab",
                "data-active": tab === entry[0] ? "1" : "0",
                onClick: function () {
                  setTab(entry[0]);
                },
              },
              entry[1],
            );
          }),
        ),

        tab === "channels"
          ? h(
              "div",
              { className: "dshn-list" },
              editor !== null
                ? h(ChannelEditor, {
                    t: t,
                    draft: editor.draft,
                    isNew: editor.isNew,
                    busy: busy !== "",
                    data: data,
                    setDraft: function (draft) {
                      setEditor({ draft: draft, isNew: editor.isNew });
                    },
                    onCancel: function () {
                      setEditor(null);
                    },
                    onSave: saveChannel,
                    onClearSecret: function () {
                      void run("clear-secret", function () {
                        return call("clear-secret", { id: editor.draft.id });
                      }).then(function (result) {
                        if (result === undefined) return;
                        setEditor({ draft: Object.assign({}, editor.draft, { secretConfigured: false }), isNew: editor.isNew });
                        setNotice({ tone: "ok", text: t("saved") });
                      });
                    },
                  })
                : null,
              data.channels.length === 0 && editor === null ? h("p", { className: "dshn-muted" }, t("noChannels")) : null,
              h(
                "div",
                { className: "dshn-bar" },
                h(Button, { variant: "Primary", onClick: startNew, disabled: editor !== null }, t("addChannel")),
              ),
              h("p", { className: "dshn-hint" }, t("channelsHint")),
              data.channels.map(function (channel) {
                var configured = channel.secret && channel.secret.configured === true;
                return h(
                  "div",
                  { key: channel.id, className: "dshn-card" },
                  h(
                    "div",
                    { className: "dshn-cardHead" },
                    h("span", { className: "dshn-cardTitle" }, channel.name || channel.id),
                    h(Chip, { tone: "Off" }, channel.protocol === "bark" ? t("protocolBark") : channel.protocol === "meow" ? t("protocolMeow") : channel.protocol === "miaotixing" ? t("protocolMiaotixing") : t("protocolCustom")),
                    configured ? h(Chip, { tone: "Ok" }, t("secretConfigured")) : h(Chip, { tone: "Warn" }, t("secretMissing")),
                    channel.enabled === true ? h(Chip, { tone: "Ok" }, t("channelEnabled")) : h(Chip, { tone: "Off" }, "off"),
                    h("span", { className: "dshn-spacer" }),
                    h(
                      Button,
                      {
                        small: true,
                        disabled: busy !== "",
                        onClick: function () {
                          void run("test", function () {
                            return call("test-channel", { id: channel.id });
                          }).then(function (result) {
                            if (result === undefined) return;
                            var inner = result.result || {};
                            setNotice(
                              inner.ok === true
                                ? { tone: "ok", text: t("testResultOk").replace("{status}", String(inner.status)).replace("{latency}", String(inner.latencyMs)) }
                                : { tone: "error", text: t("testResultFail").replace("{error}", String(inner.error || "")) },
                            );
                          });
                        },
                      },
                      busy === "test" ? t("testing") : t("test"),
                    ),
                    h(Button, { small: true, onClick: function () { startEdit(channel); } }, t("edit")),
                    h(
                      Button,
                      {
                        small: true,
                        variant: "Danger",
                        disabled: busy !== "",
                        onClick: function () {
                          if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(t("removeConfirm"))) return;
                          void run("delete", function () {
                            return call("delete-channel", { id: channel.id });
                          });
                        },
                      },
                      t("remove"),
                    ),
                  ),
                  h("span", { className: "dshn-hint dshn-code" }, channelSummary(channel, t)),
                );
              }),
            )
          : null,

        tab === "triggers" && form !== null
          ? h(
              "div",
              { className: "dshn-list" },
              h("p", { className: "dshn-hint" }, t("triggersHint")),
              h(
                "div",
                { className: "dshn-card" },
                TRIGGERS.map(function (entry) {
                  return h(
                    "div",
                    { key: entry[0], className: "dshn-row" },
                    h("div", null, h("div", null, t(entry[1])), h("div", { className: "dshn-hint" }, t(entry[2]))),
                    h(Toggle, {
                      checked: form.triggers[entry[0]] === true,
                      label: "",
                      onChange: function (value) {
                        setFormField("triggers", { [entry[0]]: value });
                      },
                    }),
                  );
                }),
              ),
              h(
                "div",
                { className: "dshn-card" },
                h("span", { className: "dshn-cardTitle" }, t("delivery")),
                h(
                  "div",
                  { className: "dshn-grid" },
                  h(Field, { label: t("debounceMs"), hint: t("debounceHint") }, h(NumberInput, { value: form.delivery.debounceMs, min: 0, max: 120000, fallback: 0, onChange: function (value) { setFormField("delivery", { debounceMs: value }); } })),
                  h(Field, { label: t("minIntervalMs"), hint: t("minIntervalHint") }, h(NumberInput, { value: form.delivery.minIntervalMs, min: 0, max: 600000, fallback: 0, onChange: function (value) { setFormField("delivery", { minIntervalMs: value }); } })),
                  h(Field, { label: t("timeoutMs") }, h(NumberInput, { value: form.delivery.timeoutMs, min: 1000, max: 120000, fallback: 10000, onChange: function (value) { setFormField("delivery", { timeoutMs: value }); } })),
                  h(Field, { label: t("retries") }, h(NumberInput, { value: form.delivery.retries, min: 0, max: 5, fallback: 1, onChange: function (value) { setFormField("delivery", { retries: value }); } })),
                  h(Field, { label: t("summaryChars") }, h(NumberInput, { value: form.delivery.summaryChars, min: 0, max: 2000, fallback: 180, onChange: function (value) { setFormField("delivery", { summaryChars: value }); } })),
                  h(Field, { label: t("bodyChars") }, h(NumberInput, { value: form.delivery.bodyChars, min: 0, max: 4000, fallback: 400, onChange: function (value) { setFormField("delivery", { bodyChars: value }); } })),
                  h(Field, { label: t("maxLog") }, h(NumberInput, { value: form.delivery.maxLog, min: 0, max: 500, fallback: 60, onChange: function (value) { setFormField("delivery", { maxLog: value }); } })),
                ),
                h(Toggle, { checked: form.delivery.skipSubagentSessions === true, label: t("skipSubagent"), onChange: function (value) { setFormField("delivery", { skipSubagentSessions: value }); } }),
                h("span", { className: "dshn-hint" }, t("skipSubagentHint")),
              ),
              h("div", { className: "dshn-bar" }, h(Button, { variant: "Primary", disabled: busy !== "", onClick: function () { void save("delivery"); } }, t("save"))),
            )
          : null,

        tab === "template" && form !== null
          ? h(
              "div",
              { className: "dshn-list" },
              h(
                "div",
                { className: "dshn-card" },
                h(
                  "div",
                  { className: "dshn-grid" },
                  h(Field, { label: t("lang") }, h(Select, { value: form.template.lang, onChange: function (value) { setFormField("template", { lang: value }); }, options: [["zh", t("langZh")], ["en", t("langEn")]] })),
                ),
                h(Field, { label: t("templateTitle") }, h(TextInput, { mono: true, value: form.template.title, onChange: function (value) { setFormField("template", { title: value }); } })),
                h(Field, { label: t("templateBody") }, h(TextArea, { rows: 4, value: form.template.body, onChange: function (value) { setFormField("template", { body: value }); } })),
                h("div", { className: "dshn-bar" },
                  h(Button, { variant: "Primary", disabled: busy !== "", onClick: function () { void save("template"); } }, t("save")),
                  h(Button, {
                    disabled: busy !== "",
                    onClick: function () {
                      void run("template-test", function () {
                        return call("push-test", {});
                      });
                    },
                  }, t("testPush")),
                ),
              ),
              h(
                "div",
                { className: "dshn-card" },
                h("span", { className: "dshn-cardTitle" }, t("placeholders")),
                PLACEHOLDERS.map(function (entry) {
                  return h(
                    "div",
                    { key: entry[0], className: "dshn-row" },
                    h("span", { className: "dshn-code" }, entry[0]),
                    h("span", { className: "dshn-hint" }, entry[1]),
                  );
                }),
              ),
            )
          : null,

        tab === "log"
          ? h(
              "div",
              { className: "dshn-list" },
              h("div", { className: "dshn-bar" },
                h("p", { className: "dshn-hint" }, t("logHint")),
                h("span", { className: "dshn-spacer" }),
                h(Button, { disabled: busy !== "", onClick: function () { void run("clear-log", function () { return call("clear-deliveries", {}); }); } }, t("clearLog")),
              ),
              data.deliveries.length === 0 ? h("p", { className: "dshn-muted" }, t("noLog")) : null,
              data.deliveries.length > 0
                ? h(
                    "div",
                    { className: "dshn-card" },
                    h(
                      "div",
                      { className: "dshn-tr dshn-trHead" },
                      h("span", null, t("colTime")),
                      h("span", null, t("colChannel")),
                      h("span", null, t("colStatus")),
                      h("span", null, t("colLatency")),
                    ),
                    data.deliveries.map(function (entry) {
                      var when = new Date(entry.time);
                      var pad = function (n) { return String(n).padStart(2, "0"); };
                      return h(
                        "div",
                        { key: entry.id, className: "dshn-tr" },
                        h("span", { className: "dshn-hint" }, pad(when.getHours()) + ":" + pad(when.getMinutes()) + ":" + pad(when.getSeconds())),
                        h("span", null, h("div", null, entry.channelName), h("div", { className: "dshn-hint dshn-pre" }, entry.title + (entry.body ? "\n" + entry.body : ""))),
                        h("span", null, entry.status === "ok" ? h(Chip, { tone: "Ok" }, t("ok")) : h(Chip, { tone: "Err" }, t("fail"))),
                        h("span", { className: "dshn-hint" }, typeof entry.latencyMs === "number" ? entry.latencyMs + "ms" : ""),
                      );
                    }),
                  )
                : null,
            )
          : null,
      );
    }

    // ---------------------------------------------------------------------
    // Plugin face
    // ---------------------------------------------------------------------

    var name = PACKAGE;
    var inject = ["slots", "remote", "locale"];

    function apply(ctx) {
      var locale = ctx.get("locale") || ctx.locale;
      if (locale !== undefined && typeof ctx.effect === "function") {
        ctx.effect(function () {
          try {
            return locale.register(CLIENT_NS, { zh: ZH, en: EN });
          } catch (error) {
            return function () {};
          }
        }, PACKAGE + ": dictionaries");
      }
      var t = locale !== undefined && typeof locale.bind === "function" ? locale.bind(CLIENT_NS) : function (key) { return key; };

      if (typeof ctx.effect === "function") ctx.effect(adoptStyles, PACKAGE + ": styles");
      else adoptStyles();

      var remote = null;
      if (typeof ctx.effect === "function") {
        ctx.effect(function () {
          var disposed = false;
          var dispose = function () {};
          var ready = ctx.remote.$mount({ package: PACKAGE, descriptors: INVOCATIONS }).then(function (value) {
            dispose = typeof value === "function" ? value : function () {};
            if (disposed) dispose();
            var handle = resolveRemoteHandle(ctx);
            if (handle === undefined) throw new Error(PACKAGE + ": the " + SERVICE_KEY + " Remote namespace did not mount");
            remote = handle;
          });
          void ready.catch(function () {
            /* the page reports the failure when it loads */
          });
          return function () {
            disposed = true;
            remote = null;
            dispose();
          };
        }, PACKAGE + ": remote");
      }

      var call = createCall(t, function () {
        return remote;
      });
      var slots = ctx.get("slots") || ctx.slots;
      if (slots === undefined) return;
      slots.inject("settings.section", function () {
        return slots.register({ name: "settings.section", id: PACKAGE, order: 12, label: function () { return t("nav"); } }, function () {
          return h(NotificationPage, { t: t, call: call });
        });
      });
    }

    exports.name = name;
    exports.inject = inject;
    exports.apply = apply;
    exports.NotificationPage = NotificationPage;
    return module.exports;
  },
});
