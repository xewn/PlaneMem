# WaveMate 0.24.1 与 PlaneMem MCP 协接契约

## 目标

本文件冻结指定离线客户端产物 `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1`
与 PlaneMem 的唯一当前客户端协接方式。WaveMate 作为 MCP 消费方，PlaneMem 的 `/mcp` 作为
Streamable HTTP MCP 服务端；两边只通过 HTTP、JSON-RPC、固定 scope headers 和本文件声明的
配置管理 API 协作。

## 版本和来源

| 项目 | 固定值 |
|---|---|
| WaveMate 产物 | `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1` |
| 离线可执行文件 | `offline-package/WaveMate.exe` |
| 客户端版本 | `0.24.1` |
| WaveMate MCP 管理 API | `http://127.0.0.1:3080/api/tauri/extension/mcp` |
| PlaneMem MCP URL | `http://127.0.0.1:3000/mcp`（本地 Compose）或发布环境对应 Service URL |
| transport | `streamable-http` |
| 配置 scope | `global` |
| server id | `planemem` |

产物必须同时存在 `release-manifest.json`、`offline-package/WaveMate.exe` 和源版本清单；三者
版本不一致时返回 `blocked`，禁止继续写入 MCP 配置。

## WaveMate MCP 配置输入

```json
{
  "id": "planemem",
  "serverName": "planemem",
  "transport": "streamable-http",
  "url": "http://127.0.0.1:3000/mcp",
  "headers": {
    "x-tenant-id": "<tenant-ulid>",
    "x-workspace-id": "<workspace-ulid>",
    "x-project-id": "<project-ulid>",
    "x-actor-id": "wavemate-0.24.1",
    "x-client-id": "wavemate",
    "x-capability": "context.read context.write"
  },
  "disabled": false,
  "scope": "global"
}
```

`tenant/workspace/project` 必须是同一授权 scope；`x-client-id` 固定为 `wavemate`；能力声明
只能来自 P6 Policy 已授予的集合。探针可以临时把 `url` 改成本地转发 URL 捕获请求，但完成后
必须恢复到直接 PlaneMem MCP URL，并复查 GET 配置结果。

## MCP 握手顺序

WaveMate 0.24.1 的实际顺序是：

1. `POST /mcp`，JSON-RPC `server/discover`，请求头带 `mcp-method: server/discover` 和协议版本；
2. `POST /mcp`，JSON-RPC `initialize`；
3. `POST /mcp`，JSON-RPC `notifications/initialized`；
4. 用户触发后才会出现 `tools/list`、`tools/call`、`resources/list` 或 `resources/read`；本项目的
   WaveMate UI 验证使用 0.24.1 自带 WebDriver 创建新会话并提交固定只读 prompt，不允许直接伪造
   MCP 请求来替代客户端证据。

PlaneMem 必须对前三步返回 HTTP 200 且 JSON-RPC 不含 `error`：

```json
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "schema_version": 1,
    "supportedVersions": ["2025-11-25", "2024-11-11"],
    "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
    "instructions": "PlaneMem authorized context tools and resources."
  }
}
```

`initialize` 继续返回 `serverInfo.name=planemem-mcp`、运行版本、协商后的
`protocolVersion` 和相同 capabilities。`notifications/initialized` 返回空 result。协议错误
（包括 `-32601`）会使 WaveMate 会话门禁失败，即使 HTTP 状态为 200 也不能判定成功。

## 公开工具和资源

- `tools/list` 必须声明 `context_search` 和 `context_index`，输入 Schema 与
  `docs/design/01-contracts` 和 P4 runtime 测试一致；
- `tools/call` 的每次写入都保留 scope、trace、audit 和幂等语义；
- `resources/list` 和 `resources/read` 只返回当前 scope 的 `wcp://context/` 资源；
- 未授权 scope、未知工具或未知资源返回 JSON-RPC 错误且不得产生业务副作用。

## 协接证据

每次真实探针必须保存：WaveMate 产物版本、MCP 配置快照（脱敏）、请求/响应摘要、
`server/discover`/`initialize`/`notifications/initialized` 计数、JSON-RPC 错误计数、trace_id、
scope、PlaneMem URL 和最终恢复配置。UI 探针还必须保存 WebDriver session 元数据（不得保存凭据）、
prompt 可见性、UI 完成状态、工具调用数和失败尝试。证据路径固定为
`artifacts/command-reports/wavemate-live-<run_id>/` 或 `artifacts/command-reports/wavemate-k3s-ui-<run_id>/`。

## 变更规则

WaveMate 版本、MCP transport、配置字段、scope header、协议版本或工具 Schema 任一变化，必须
同时更新本文件、P4/P8 独立测试、`tools/run-wavemate-live-probe.mjs`、发布门禁和根目录
`FILE_INDEX.md`。任何实现方不得读取 WaveMate 的私有数据库或修改离线产物目录。
