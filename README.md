# dsh-notify-ultra

一个 DSH（DeepSeek Harness）插件：**任务完成 / 出错 / 需要确认**时，通过任意轻量 HTTP/HTTPS 推送 API 把消息发到你的手机或其他设备。

- **Web 与 Desktop 通用** —— 一份 `dsh.client.platform: "web"` 声明同时覆盖两种形态；Desktop 本来就是同一套 Web 客户端。
- **四种协议**：自定义 API、**Bark**、**MeoW（喵 · ChuckFang）**、**喵提醒（MiaoTixing）**。
- **零依赖、零构建**：`lib/host.js` 与 `lib/client.js` 都是手写原生 JS，不需要 npm install / esbuild / JSX。
- **密钥托管**：钥匙存在 DSH 凭据服务里（`DSH_NOTIFICATION_<通道ID>`），不写进插件设置，也**永远不会下发给客户端**。

---

## 安装

```bash
# 从 GitHub 安装
dsh plugin --profile desktop add github:MrCashmere/dsh-notify-ultra

# 或从本地目录安装
dsh plugin --profile desktop add /path/to/dsh-notify-ultra
```

DSH 会把它链接进 profile，读取 `dsh.bundle` 并把 `dsh-notify-ultra` 追加到 `dsh.profile.bundles`。

> **装完需要重启 DSH。** 本地路径（`link:`）安装的插件无法在正在运行的进程里热加载，安装当场那个 entry 会报 "failed to import"。重启后正常加载（已用一份独立的临时 profile 冷启动验证：宿主半挂载成功、客户端 bundle 出现在启动清单里并被 HTTP 正常提供）。

装好后在 **设置 → 通知推送** 打开配置页（Web 与 Desktop 在同一个位置）。

卸载：

```bash
dsh plugin --profile desktop remove dsh-notify-ultra
```

## 触发条件

| 触发 | 默认 | 说明 |
| --- | --- | --- |
| 任务完成 | ✅ | 一个回合正常结束 |
| 任务出错 | ✅ | 回合以 error / 超出 token 上限结束 |
| 任务受阻 | ⬜ | 回合被拦截（例如工具调用被拒绝） |
| 任务被取消 | ⬜ | 你主动中断，或回合被放弃（默认关闭以免噪音） |
| 需要确认 | ✅ | DSH 正在等你回答问题或批准操作 |
| 目标达成 | ✅ | 会话中的目标被标记完成 |
| 子代理结束 | ⬜ | 一个子代理任务结束 |
| 工作流结束 | ⬜ | 一次 workflow 运行结束 |

## 发送策略

同一个会话在**合并窗口**（默认 3000 ms）内的多次结束只推一条；**全局最小间隔**（默认 5000 ms）做节流，避免连续轰炸。请求超时 10 s，失败重试 1 次（只重试传输错误、5xx、429、408）。某个通道失败**不会**影响其他通道。所有定时器都会在插件卸载时清掉。

> 喵提醒官方建议两次推送间隔 ≥ 10 秒，用它的话把「最小推送间隔」调到 10000。

## 推送通道

### 1. 自定义 API

方法 / URL / 请求头 / 请求体全部可写模板。占位符：

| 占位符 | 含义 |
| --- | --- |
| `{status}` `{session}` `{project}` `{summary}` | 状态词、会话标题、目录名、最后一条回复摘要 |
| `{cwd}` `{model}` `{turn}` `{duration}` `{reason}` `{error}` | 工作目录、模型、回合序号、耗时、结束原因、错误 |
| `{time}` `{date}` `{trigger}` | `HH:MM`、`YYYY-MM-DD HH:MM`、触发名 |
| `{title}` `{body}` | 渲染后的标题 / 正文（用于自定义请求模板） |
| `{{secret}}` | 该通道的密钥 |

过滤器：`{title:url}` 做 URL 编码，`{title:json}` 输出**完整的 JSON 值**（带引号，JSON 正文里必须用它）。未知占位符原样保留。

请求体留空时会自动生成 `{"title":…,"body":…,"source":"dsh"}`。

响应判定：默认非 2xx 即失败；可以勾选「忽略 HTTP 状态码」，或要求响应包含某个子串、要求某个 JSON 路径等于某个值（例如 `code` = `200`）。

### 2. Bark

服务器默认 `https://api.day.app`（自建填 `http://host:8080`），密钥是 Bark 的 device key。

- **POST**（推荐）：`POST {server}/push`，`{"device_key":…,"title":…,"body":…}`，可带 `subtitle sound group icon image level url copy badge ttl isArchive autoCopy call`。
- **GET**：`GET {server}/{key}/{title}/{body}?…`。

Bark 的响应体 `{"code":…}` 就是 HTTP 状态码，`code !== 200` 判为失败。Bark **没有** `mode` 参数，未知参数只会被丢进 APNs payload —— 本插件不会发它。

### 3. MeoW（喵 · ChuckFang）

服务器默认 `https://api.chuckfang.com`，标识符是你在 MeoW 注册的**昵称**（不是设备密钥）。

- **GET**：`GET {server}/{昵称}/{标题}/{内容}?url=&imgUrl=&msgType=&htmlHeight=`
- **POST**：`POST {server}/{昵称}`，JSON `{"title":…,"msg":…}`

⚠️ 该接口**永远返回 HTTP 200**，成功与否只看响应体的 `status`（200 成功，400/403/404/429/500 失败）。本插件会解析响应体，因此「昵称没注册」「3 秒限流」都会被如实记为失败。

### 4. 喵提醒（MiaoTixing）

和上面的 MeoW 是**两个不同的服务**，别混。服务器 `https://miaotixing.com`，标识符是提醒单的**喵码**（如 `tDS0Se9`）。

`GET|POST /trigger?id={喵码}&text={标题\n正文}&type=json`，可选 `templ`、`option`（`nosms,nophonecall`）。同样永远返回 HTTP 200，插件按响应体的 `code` 判定（0 成功，103 喵码不存在等即失败）。

## 文案模板

标题 / 正文模板同样支持上面的占位符，另外可选中文 / English 状态词。默认：

```text
标题：{status} · {project}
正文：{session}
      {summary}
```

## 记录

「记录」页保留最近若干次推送（默认 60 条，仅内存，重启清空）：时间、通道、成功 / 失败、耗时、内容。每个通道都有「测试」按钮，工具栏还有「发送测试推送」。

## 安全

- 密钥通过 `ctx.credentials` 保存，引用名可在通道里改（写一个已有的环境变量名也能读到）。
- 凭据服务不可用时，密钥才会作为内联兜底写入插件设置。
- 客户端**只**能拿到「是否已配置 / 来源 / 能否写入」，拿不到密钥本身，也不会拿到掩码。

## 开发

```bash
node tests/smoke.mjs         # 宿主侧 30 项：真实 HTTP 服务器校验四种协议的请求与判定
node tests/client-smoke.mjs  # 客户端 16 项：迷你 React 渲染配置页并模拟点击
node --check lib/host.js && node --check lib/client.js
```

`tests/` 只用 Node 内置模块，通过 `tests/resolve-hook.mjs` 把 `@deepseek-ai/*` 映射到本地桩件，因此不需要安装任何依赖。

四种协议的完整字段、响应码与实测记录见 [`bark-meow-api-report.md`](bark-meow-api-report.md)。

## License

MIT
