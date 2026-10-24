# WaveMate 0.24.1 真实客户端独立验证

## 验证边界

验证对象是 `E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1` 中的离线
WaveMate 0.24.1，以及本地或 k3s 暴露的 PlaneMem `/mcp`。验证只使用该产物，不调用其他
桌面客户端。WaveMate 进程可由探针启动，也可以复用已运行进程；探针不得修改 E 盘产物。

## 前置条件

1. 本机 Docker 已启动，`planemem-local` Compose runtime 的 Workctx `/health/ready` 为 200；
2. WaveMate 主机 API `GET http://127.0.0.1:3080/api/tauri/extension/mcp` 可访问；
3. 产物版本清单、`WaveMate.exe` 和 PlaneMem MCP URL 均存在；
4. 测试 scope 为合成 tenant/workspace/project，不能使用真实敏感内容。

## 标准命令

```powershell
pnpm run test:wavemate-live -- --live `
  --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 `
  --wavemate-url http://127.0.0.1:3080 `
  --planemem-url http://127.0.0.1:3000 `
  --run-id wavemate-live-current `
  --output artifacts/command-reports/wavemate-live-current
```

在三节点 k3s 隧道上执行真实 UI 工具调用时使用：

```powershell
pnpm run test:wavemate-ui-live -- --live `
  --artifact-path E:/dsh/dshdesktopRelease/artifacts/wavemate-intranet/0.24.1 `
  --wavemate-url http://127.0.0.1:3080 `
  --planemem-url http://127.0.0.1:38081 `
  --webdriver-url http://127.0.0.1:4445 `
  --run-id wavemate-k3s-ui-current `
  --wait-ms 90000 `
  --output artifacts/command-reports/wavemate-k3s-ui-current
```

握手探针流程：校验产物 → 读取当前 MCP 配置 → 临时写入转发 URL → 捕获和转发真实 MCP 请求 →
校验握手 → 恢复 PlaneMem 直连配置 → 写入结构化报告。UI 探针在同一流程中启用 WaveMate
0.24.1 自带 WebDriver，创建新会话，输入固定只读 prompt，等待 `tools/call` 响应和 UI 的
`已完成` 状态，记录 UI 文本、trace、scope 和完整 HTTP 摘要；即使首次尝试因上游模型过载失败，
也必须保留失败报告，再以新的 `run_id` 重试。

UI 探针现在会自动写出 `restore-verification.json`，恢复目标默认为本地 Compose
`http://127.0.0.1:3000/mcp`；恢复请求失败时，整个 UI 探针返回 `blocked`。本轮成功复测和上游过载负面复测分别归档在
`artifacts/command-reports/wavemate-k3s-ui-current2/`、
`artifacts/command-reports/wavemate-k3s-ui-current3/` 与
`artifacts/command-reports/wavemate-k3s-ui-current4/`。

## 独立测试矩阵

| ID | 场景 | 必须断言 | 失败状态 |
|---|---|---|---|
| WM-01 | 产物一致性 | manifest、可执行文件、源版本均为 0.24.1 | `blocked` |
| WM-02 | 配置写入 | `planemem`、`streamable-http`、固定 scope headers、`scope=global` 正确 | `blocked` |
| WM-03 | 服务发现 | `server/discover` 返回 supportedVersions、capabilities 且无 JSON-RPC error | `failed` |
| WM-04 | MCP 初始化 | `initialize` 和 `notifications/initialized` 均成功，协议版本可协商 | `failed` |
| WM-05 | 工具/资源可见性 | UI 触发后 `tools/list`、`tools/call`、`resources/list/read` 只访问授权 scope，且 UI 显示完成 | `failed` |
| WM-06 | 配置恢复 | 探针结束后 WaveMate 配置 URL 恢复为 PlaneMem 直连 URL | `failed` |
| WM-07 | 证据完整性 | report 含版本、trace_id、scope、请求/响应摘要、错误计数和 external_gates | `failed` |

WM-03、WM-04 是自动门禁；WM-05 必须在 WaveMate UI 中触发一次真实工具调用，并同时看到
代理捕获 `tools/call`、成功响应和 UI `已完成`。HTTP 200 携带 JSON-RPC error、配置未恢复或
scope header 缺失都不能通过。上游模型过载等客户端外部失败必须记录为独立失败证据，不能以握手
通过替代 UI 调用结果。

## 单测和契约测试

- `tests/p8/t8-wavemate-live.test.mjs`：配置行和流量摘要的离线单测；
- `tests/p8/t8-k3s-wavemate-evidence.test.mjs`：三节点 k3s 镜像、平台探针、WaveMate UI 工具调用和配置恢复证据；
- `tests/p4/t4-runtime.test.ts`：PlaneMem `server/discover`、`initialize`、tools/resources
  的服务端契约；
- `tests/contract/`：MCP scope、错误封套、版本和发布清单边界；
- `tools/run-wavemate-live-probe.mjs`：真实 WaveMate 0.24.1 握手验证和报告生成；
- `tools/run-wavemate-ui-live-probe.mjs`：真实 WaveMate 0.24.1 WebDriver UI 工具调用、代理流量和完成状态验证。

## 通过条件

- WM-01 至 WM-04、WM-06、WM-07 全部通过；
- 真实报告 `status=passed`、`jsonrpc_errors=0`、`server_discover>=1`、`initialize>=1`、
  `initialized_notification>=1`；
- UI 工具调用完成时，`tools_call>=1`、成功响应数与请求数一致、`jsonrpc_errors=0`、
  `prompt_visible=true`、`completed_visible=true`、`external_gates=[]`；未触发时必须保留失败或
  阻断证据，不得伪造调用结果；
- 报告归档后运行 `FILE_INDEX.md` 更新和 docs 相对链接检查。

## 故障定位

- 主机 API 不可达：检查 WaveMate 进程及 3080 端口；
- `server/discover` 为 `-32601`：检查 PlaneMem runtime 是否包含当前 MCP server/discover 实现；
- HTTP 200 但 `jsonrpc_errors>0`：检查响应 JSON-RPC error 和 protocol version 协商；
- 没有 `tools/call`：只说明未触发 UI 交互，不得把它写成协议失败；
- UI 显示模型过载或处理失败：保留该次失败报告，检查握手和工具列表仍为成功后，以新 `run_id`
  重试；只有 `tools/call`、成功响应和 `已完成` 同时出现才归档为通过；
- 配置未恢复：立即读取 WaveMate MCP 配置，手工恢复直连 URL 后保留失败报告。
