# Bark & Meow HTTP push APIs — exact specification

Verified against official repos/docs and live probes (2025-xx). Sources listed at the end of each section.

---

# 1. Bark

**Authoritative sources**
- App + docs: <https://github.com/Finb/Bark> — `docs/params.md`, `docs/tutorial.md`, `docs/faq.md`, `README.md`
- Server implementation: <https://github.com/Finb/bark-server> — `docs/API_V2.md`, `route_push.go`, `router.go`, `apns/apns.go`, `database/bbolt.go`
- Rendered docs: <https://bark.day.app/#/en-us/>

## 1.1 Base URL

| Deployment | Base URL |
|---|---|
| Official public server | `https://api.day.app` (plain `http://` also works) |
| Self-hosted (bark-server) | `http://<host>:8080` (default `--addr 0.0.0.0:8080`) |

The device **key** is the first path segment on the V1 endpoints, or the `device_key` field on the V2 endpoint.

## 1.2 GET endpoint (V1 / "compat" style)

Path templates registered in `route_push.go`:

```
/{device_key}/{body}
/{device_key}/{title}/{body}
/{device_key}/{title}/{subtitle}/{body}
```

A bare `GET /{device_key}?title=..&subtitle=..&body=..` also works (query params are merged; covered by `push_test.go`).

Query parameters (all optional except the key; names are **case-insensitive**, the server lower-cases every key):

| Param | Type | Notes |
|---|---|---|
| `title` | string | first line, larger font |
| `subtitle` | string | between title and body |
| `body` | string | required in practice; empty ⇒ server substitutes `"Empty Message"` when alert is empty |
| `markdown` | string | markdown body; **overrides `body`** |
| `sound` | string | e.g. `minuet`; server appends `.caf` unless the value already ends in `.caf` |
| `group` | string | thread id (grouped notifications); also mutes per group |
| `icon` | string | icon URL (iOS 15+), cached on device |
| `image` | string | large image URL |
| `badge` | int | sets badge; `0` clears badge + notifications |
| `level` | string | `active` (default) \| `timeSensitive` \| `passive` \| `critical` |
| `volume` | string/int | 0–10, only with `level=critical` (default 5) |
| `call` | string | must be `"1"` — ring the sound for 30 s |
| `url` | string | URL/Scheme/Universal Link opened on tap |
| `action` | string | `none` (tap does nothing) or `alert` (action sheet); `url` wins if both |
| `copy` | string | text placed on the pasteboard (with `autoCopy=1`); defaults to body |
| `autoCopy` | string | must be `"1"` — copy on receipt. Legacy alias `automaticallyCopy` is also accepted by the app |
| `isArchive` | string | `"1"` ⇒ archive into app history; anything else ⇒ don't |
| `ttl` | int | history retention in seconds |
| `id` | string | notification identity; same id replaces the previous notification. **In JSON it must be a string** |
| `delete` | string | `"1"` ⇒ silent background push that deletes the notification with `id` |
| `ciphertext` | string | encrypted payload (app decrypts) |
| `iv` | string | IV for `ciphertext` |
| `device_keys` | array/string | batch push, JSON only |

`mode` is **not** a parameter in the current official API. The server forwards any unknown parameter into the APNs payload as a lower-cased custom key (stringified), where the app ignores it. If you saw `mode` somewhere it is not part of the Bark contract — implement only the list above.

Successful GET (public server, verified live with a real key):

```bash
curl "https://api.day.app/YOUR_KEY/Title/Body?sound=minuet&group=test&level=timeSensitive&isArchive=1"
```

## 1.3 POST /push endpoint (V2, JSON)

```
POST /push
Content-Type: application/json; charset=utf-8
```

Body fields (identical names to the query params above):

| Field | Type | Required |
|---|---|---|
| `device_key` | string | **yes** (single push) — otherwise `400 "device key is empty"` |
| `body` | string | effectively yes |
| `title`, `subtitle` | string | no |
| `device_keys` | array of strings (or one comma-separated string) | for batch |
| everything else | same names/types as the table above | no |

```bash
curl -X POST "https://api.day.app/push" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -d '{
    "device_key": "YOUR_KEY",
    "body": "Test Bark Server",
    "title": "bleem",
    "subtitle": "sub",
    "badge": 1,
    "sound": "minuet",
    "icon": "https://day.app/assets/images/avatar.jpg",
    "image": "https://example.com/pic.png",
    "group": "test",
    "level": "timeSensitive",
    "url": "https://mritd.com",
    "copy": "1234",
    "autoCopy": "1",
    "isArchive": "1",
    "ttl": 3600,
    "id": "task-42"
  }'
```

Other accepted forms:
- `POST /{device_key}` with `application/x-www-form-urlencoded` (`body=..&title=..&group=..`) — V1 parser.
- `POST /{device_key}` with `application/json` — the JSON body is parsed and the path key still applies.
- `POST /push` with `x-www-form-urlencoded` also works.

**Parser selection is by `Content-Type`**: `application/json*` ⇒ V2 body parser, anything else ⇒ V1 form/query parser.
**Precedence**: V1 ⇒ path > multipart > POST body > query; V2 ⇒ path > query > JSON body.

Batch (`device_keys`, requires bark-server ≥ v2.1.9; public server caps at 10 keys, self-hosted unlimited):

```bash
curl -X POST "https://api.day.app/push" -H 'Content-Type: application/json' \
  -d '{"device_key":"K1","device_keys":["K2","K3"],"title":"t","body":"b"}'
```

## 1.4 Responses (verified live on api.day.app)

Response envelope (`CommonResp` in `router.go`):

```json
{"code": 200, "message": "success", "timestamp": 1791429332}
```

```json
{"code": 200, "message": "success", "timestamp": 1791429678,
 "data": [{"code": 200, "device_key": "K2"},
          {"code": 400, "device_key": "K3", "message": "push failed: ..."}]}
```

`data` is only present for batch pushes; per-item `message` only appears on failure.

Errors (HTTP status == JSON `code`):

| HTTP | body `message` | cause |
|---|---|---|
| 400 | `device key is empty` | no key in path/body/query |
| 400 | `failed to get device token: failed to get [KEY] device token from database` | unknown key |
| 400 | `request bind failed: ...` / `url path parse failed: ...` | malformed body / bad percent-encoding |
| 400 | `batch push count exceeds the maximum limit: N` | too many `device_keys` |
| 404 | `Cannot GET /a/b/c/d` | route not found (e.g. 4 path segments) |
| 405 | `Method Not Allowed` | wrong method |
| 500 | `push failed: ...` | APNs rejected the push (also returned by `failed to ...` for invalid token handling: an APNs 410/BadDeviceToken clears the stored token) |

Live examples:

```
GET  /ping                    -> 200 {"code":200,"message":"pong","timestamp":...}
GET  /healthz                 -> 200 ok
GET  /info                    -> 200 {"version":"v2.0.0"}
DELETE /KEY/hello             -> 405 {"code":405,"message":"Method Not Allowed","timestamp":...}
POST /push {"body":"x"}       -> 400 {"code":400,"message":"device key is empty","timestamp":...}
```

## 1.5 Key format & constraints

- The key is an **opaque string**. `bark-server` issues it with `shortuuid.New()` ⇒ **22 characters**, base-57 alphabet `23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz` (no `0 O I l 1`). Older examples on 16 chars also exist in docs, so do **not** hard-code a length check; just pass it through.
- It must **not contain `/`** (it is a path segment). URL-encode it anyway.
- Registration (self-hosted / app): `POST /register` JSON `{"device_key":"...","device_token":"..."}` — `device_key` optional (server generates one), response `{"code":200,"message":"success","data":{"key":"...","device_key":"...","device_token":"..."}}`. Legacy `GET /register?devicetoken=..&key=..`. Device token must be ≤ 160 chars. `GET /register/{device_key}` checks existence.
- One key is effectively bound to the last device that opened the app ("同一个Key只能一台设备使用").
- APNs payload limit enforced: **4096 bytes**.

## 1.6 URL-encoding rules (GET form) — important

- Path segments are decoded with Go's `url.QueryUnescape` (`extractUrlPathParams`). Consequences:
  - `+` in a path segment is decoded as a **space** (`+` → ` `); encode literal `+` as `%2B`.
  - A literal `/` inside body/title breaks routing (`GET /key/a/b/c/` ⇒ 404). Encode as `%2F`.
  - `%` must be `%25`; `?`/`&`/`#` and all non-ASCII must be percent-encoded UTF-8.
  - Appendix of the official FAQ: “最好不管有没有特殊字符，无脑套一层URL编码”.
- Query-string params use normal URL encoding (space as `+`/`%20`); smart HTTP libraries handle this automatically.
- POST JSON: just use a normal JSON encoder (UTF-8, `\n` allowed literally).

## 1.7 Self-hosted servers

Yes — identical protocol. Official Go implementation: `docker run -dt --name bark -p 8080:8080 -v $PWD/bark-data:/data finab/bark-server` (or `ghcr.io/finab/bark-server`). The iOS app supports adding a custom server address, then registers against it and uses it for `/push`, `/:key/...`, `/register`, `/ping`, `/healthz`, `/info` exactly as above. Differences from the public server:

- No IP ban / rate limits (public server bans an IP 24 h on >1000 error requests per 5 min, >5×405 per 5 min, or >5 errors with UA `*Mozilla/5.0 (X11; Linux x86_64)`; also >1000 concurrent TCP connections).
- Batch `device_keys` limit of 10 applies to the public server only; self-hosted default is unlimited.
- Self-hosted needs its own APNs certificate/key (`--cert`/`--key` or the built-in defaults in the repo).
- `finab/bark-server` also supports MySQL via `-dsn`.

## 1.8 Ready-to-use curl set

```bash
K=YOUR_KEY
curl "https://api.day.app/$K/Hello%20World"                                   # body only
curl "https://api.day.app/$K/Title/Hello%20World"                             # title + body
curl "https://api.day.app/$K/Title/Subtitle/Hello%20World"                    # title + subtitle + body
curl "https://api.day.app/$K?title=Title&body=Hello&level=passive&isArchive=1"
curl -X POST "https://api.day.app/$K" -d 'body=Hello&group=test&autoCopy=1'
curl -X POST "https://api.day.app/push" -H 'Content-Type: application/json; charset=utf-8' \
     -d '{"device_key":"'$K'","title":"T","body":"B","badge":1}'
```

---

# 2. Meow

**“Meow/喵” is two different services — do not mix the protocols.**

| Service | Host | Identifier | Used by |
|---|---|---|---|
| **MeoW (喵)** by ChuckFang | `https://api.chuckfang.com` | **昵称 / nickname** | Certd “MeoW通知”, n8n `n8n-nodes-meow`, SeekMeow, MeoW App (HarmonyOS/iOS/Android) |
| **喵提醒 (MiaoTixing)** | `https://miaotixing.com` | **喵码 / MIAO_ID** (7 chars, e.g. `tDS0Se9`) | Unicall `miaotixing` provider, livemonitor, countless shell/python scripts |

So: when a tool says “MeoW 通知 → https://api.chuckfang.com/” it means service A (nickname). When a script says `miaotixing.com/trigger?id=喵码` it means service B. Neither is used as the other’s “喵码”.

**No open-source self-hosted MeoW server exists.** The GitHub projects named “meow” are unrelated (`TianmuTNT/meow` = Minecraft-over-WebSocket proxy, `cybozu-go/meows` = k8s helper); `fkccoding/meow-push-skill` is only a helper “Skill” for the chuckfang API (linked from that API’s own docs). Neither api.chuckfang.com nor miaotixing.com is self-hostable. If you need self-hosted push, use Bark (`bark-server`), ntfy, Gotify or PushDeer instead.

## 2.A MeoW by ChuckFang — api.chuckfang.com

Official doc: <https://www.chuckfang.com/MeoW/api_doc.html> (page embeds a machine-readable OpenAPI 3.1 spec plus JSON-LD).
Also exposes a web form at `https://api.chuckfang.com/` that calls exactly this API.

### Endpoints

| Method | Path | Body |
|---|---|---|
| GET | `/{nickname}/{msg}` | — |
| GET | `/{nickname}/{title}/{msg}` | — |
| POST | `/{nickname}` | `msg` required; `title`, `url`, `imgUrl` optional |
| POST | `/{nickname}/{title}` | same (path `title` optional; body `title` wins) |

Query parameters (work on GET and POST): `url`, `imgUrl`, `msgType` (`text` default \| `html`), `htmlHeight` (int px, default 200, only for `msgType=html`).
POST `Content-Type`s: `application/json`, `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain` (raw body = `msg`).

- Path identifier is the **nickname** (昵称), must not contain `/`. Register it via the MeoW app/site first; unregistered ⇒ 404.
- For JSON, **only `msg` is strictly required**; for form/multipart the spec marks both `title` and `msg` required.
- `url`/`imgUrl` may be given as query params or JSON body (`imgUrl` body wins). `msgType`/`htmlHeight` are **always query params**, never JSON fields.
- URL-encode all non-ASCII path/query values (UTF-8); `msgType`/`htmlHeight` stay raw.

### Examples

```bash
# GET, title omitted (title defaults to "MeoW")
curl "https://api.chuckfang.com/JohnDoe/Hello%20World"

# GET with title + jump link
curl "https://api.chuckfang.com/JohnDoe/System/Alert?url=https%3A%2F%2Fexample.com"

# GET with HTML rendering
curl "https://api.chuckfang.com/JohnDoe/System/%3Cb%3Ehi%3C%2Fb%3E?msgType=html&htmlHeight=300"

# POST JSON
curl -X POST "https://api.chuckfang.com/JohnDoe?msgType=html&htmlHeight=350" \
  -H 'Content-Type: application/json' \
  -d '{"title":"System","msg":"<p><b>Welcome</b></p>","url":"https://example.com","imgUrl":"https://example.com/icon.png"}'

# POST form
curl -X POST "https://api.chuckfang.com/JohnDoe" \
  -d 'title=System&msg=Hello&url=https://example.com'

# POST plain text
curl -X POST "https://api.chuckfang.com/JohnDoe/System" \
  -H 'Content-Type: text/plain' --data-raw 'plain body text'
```

### Response

**The HTTP status is always `200`.** The real result is the JSON body’s `status`:

```json
{"status": 200, "data": true,  "msg": "发送成功"}
{"status": 400, "data": false, "msg": "发送失败，标题不能为空"}
{"status": 403, "data": false, "msg": "敏感词，禁止发送"}
{"status": 404, "data": false, "msg": "发送失败，该昵称没有注册，一天之内累计3次输错对方昵称您的IP将被封禁"}
{"status": 429, "data": false, "msg": "非会员用户3秒内只能发送1条消息"}
{"status": 500, "msg": "服务器内部错误"}
```

Live-verified 404 and 429 bodies match the above exactly. The last two lines of the HTML page show `{"status":200,"message":"推送成功"}` — that `message` field name is a **documentation inconsistency**; the embedded OpenAPI spec, the service’s own web UI (`data.status === 200 && data.data === true`) and live responses all use **`msg` + `data`**. Implement `msg` as authoritative and, defensively, also read `message`.

Business codes: `200` ok · `400` bad params · `403` content policy · `404` nickname not registered · `429` rate limited · `500` server error.

### Limits / requirements

- Registration required (MeoW account + nickname in the app/site).
- Non-VIP sending limits: **1 per 3 s, 15 per minute, 60 per hour, 1000 per day** ⇒ business `429`.
- Do not send from shared public egress IPs: the same IP pushing to many nicknames can be treated as an attack; trusted IPs can be whitelisted by the developer.
- 3 wrong (unregistered) nicknames within a day ⇒ IP ban.
- The host is **not configurable** on the official service. (The n8n community node exposes a `baseUrl` credential — useful only if you put a proxy/mirror in front; default `https://api.chuckfang.com`.)

## 2.B 喵提醒 / MiaoTixing — miaotixing.com

Official developer docs: <https://www.showdoc.com.cn/miaotixing> (page “发送实时提醒”, item 喵提醒开发文档; the help site links to it).
Commercial WeChat-service-account reminder service by 深圳曼猫科技有限公司; identifier is the **喵码** (7 chars, e.g. `tDS0Se9`).

### Endpoints

| Purpose | URL | Method |
|---|---|---|
| Send reminder | `http://miaotixing.com/trigger` or `https://miaotixing.com/trigger` | GET, POST |
| Record a log (no notification) | `http(s)://miaotixing.com/log` | GET, POST |
| Heartbeat send [VIP] | `http://keepalive.miaotixing.com/send` | GET |
| Heartbeat state [VIP] | `http://keepalive.miaotixing.com/state` | GET |

`/trigger` parameters:

| Param | Required | Type | Notes |
|---|---|---|---|
| `id` | **yes** | string | 喵码, `tDS0Se9` |
| `text` | no | string | dynamic line shown under the title; URL-encode, `%0A` for newline |
| `type` | no | string | `plain` (default) \| `json` \| `jsonp` |
| `callback` | no | string | jsonp callback name, default `miaotixing_jsonpcallback` |
| `templ` | no | string | custom-template args, e.g. `prvPe94,10,调试,无响应` |
| `option` | no | string | `nosms`, `nophonecall` (comma-separated) |
| `app` | no | string | developer app id, e.g. `p123456` |
| `ts` | no | int | 10-digit unix seconds; ignored if \|now−ts\| > 60 s |

`/log` takes the same `id` / `text` / `type` / `callback`; recommended interval ≥ 10 s.
Heartbeat `/send`: `id`, `text`, `templ`, `option`, `app`, `expires` (1–30 min, default 5), `channel` (0–99); returns the literal string `done`; max 10 heartbeats/min per 喵码+channel. `/state`: `ids` (up to 100 喵码 or `喵码-channel`), 1 query / 30 s / IP.

### Examples

```bash
# simplest
curl "https://miaotixing.com/trigger?id=tDS0Se9&text=Hello"

# JSON response, newline via %0A
curl "https://miaotixing.com/trigger?id=tDS0Se9&text=line1%0Aline2&type=json"

# jsonp
curl "https://miaotixing.com/trigger?id=tDS0Se9&text=hi&type=jsonp&callback=mycb"

# log instead of notify
curl "https://miaotixing.com/log?id=tDS0Se9&text=job%20started&type=json"
```

### Response

HTTP status is always `200`. `type=plain` returns `完成`, or e.g. `发送失败：找不到该提醒单`.
`type=json`:

```json
{"code":0,
 "data":{"users":3,
         "success_sent":{"mptext":3,"sms":0,"phonecall":0,"email":2},
         "remaining":0,
         "warning":{"templ":{"code":0,"msg":""}}},
 "msg":"完成"}
```

`data.remaining` = seconds still to wait when inside the cooldown. On error, `data` is `[]` (verified live: `{"code":103,"msg":"发送失败：找不到该提醒单","data":[]}`); on a malformed id it is `{"code":-1,"msg":"发送失败：参数格式有误","data":{}}`. `type=jsonp` wraps the same JSON in `callback(...)`.

Error codes (official table): `-1` failed, `0` success, `101` parameter format error, `102` too frequent (see `data.remaining`), `103` reminder not found (bad 喵码), `104` disabled by owner, `105` owner has not followed the WeChat account, `106` owner account unusable, `107` owner not found, `108` owner registration incomplete, `109` same as 102 but content is queued in the buffer pool and re-sent within 1 min [VIP], `201` template not found, `202` too few template args, `203` template disabled/unauthorized.

### Limits / requirements

- Registration required: follow the WeChat service account 「喵提醒」 and create a 提醒单 to obtain a 喵码.
- Per-reminder cooldown; official advice is ≥ 10 s between sends; frequent sending can get the caller IP blocked. `102`/`109` report the remaining wait.
- Daily free quota (email reminder “至少 100 次/天”); SMS/voice are paid per use (user pays).
- Lite accounts (no phone number): `text` is ignored unless a `templ` is used.
- Host is **not configurable** — `miaotixing.com` and `keepalive.miaotixing.com` only (proxy or nothing).
- Unicall’s `textmiaotixing://MIAO_ID?type=json&app=..&option=nosms` URL is just that library’s own abstraction over `/trigger`, not a separate protocol.

---

## Source links

- Bark README: <https://github.com/Finb/Bark/blob/master/README.md>
- Bark params doc: <https://github.com/Finb/Bark/blob/master/docs/params.md> · EN: <https://github.com/Finb/Bark/blob/master/docs/en-us/params.md>
- Bark tutorial: <https://github.com/Finb/Bark/blob/master/docs/tutorial.md>
- Bark FAQ (URL-encoding, bans): <https://github.com/Finb/Bark/blob/master/docs/faq.md>
- Bark rendered docs: <https://bark.day.app/#/en-us/>
- bark-server API V2: <https://github.com/Finb/bark-server/blob/master/docs/API_V2.md>
- bark-server code: <https://github.com/Finb/bark-server/blob/master/route_push.go> · <https://github.com/Finb/bark-server/blob/master/router.go> · <https://github.com/Finb/bark-server/blob/master/apns/apns.go>
- MeoW (ChuckFang) API doc: <https://www.chuckfang.com/MeoW/api_doc.html>
- MeoW push Skill (linked from official doc): <https://github.com/fkccoding/meow-push-skill>
- Certd notification plugins (lists “MeoW通知 → https://api.chuckfang.com/”): <https://certd.docmirror.cn/guide/plugins/notification.html>
- n8n MeoW community node: <https://www.npmjs.com/package/n8n-nodes-meow>
- SeekMeow (independent MeoW API usage, `https://api.chuckfang.com/{昵称}/NodeSeek`): <https://github.com/sunnyhmz7010/SeekMeow>
- 喵提醒 help centre: <https://miaotixing.com/> · developer docs (ShowDoc): <https://www.showdoc.com.cn/miaotixing>
- Unicall 喵提醒 provider doc: <https://noblesnowfield.github.io/unicall-doc/providers/miaotixing>
