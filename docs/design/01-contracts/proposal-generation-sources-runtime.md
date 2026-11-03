# 从网关准备建议生成来源

更新：2026-11-04。仅源码和文档，未调用网关或模型、执行 CLI、编译、类型检查、测试、打开数据库或发布。

`prepareProposalGeneration(selection, binding, options)` 与 `proposal-worker prepare-generation` 从用户指定的 ContextItem 读取完整文本，准备兼容已有 `generate` 的输入文件。所有条目必须在当前读取时匹配用户选择的版本且来源链有效；失败不替换版本、不截断、不输出部分文件。

## 使用流程

绑定使用现有 worker 的 gateway_url、tenant_id、workspace_id、project_id、actor_id 和 client_id，不需要已存在的队列。凭据使用 `PROPOSAL_WORKER_ACCESS_TOKEN`；库调用使用 options.access_token，可选 signal/fetch。同一固定令牌用于全部读取，不在中途刷新到另一个身份。

selection.json 只接受 kind/task/sources/classification/ttl_seconds/timeout_ms。以下为未执行的形状示例；条目 ID 和 revision 应由使用者先在工作台或 API 查看并选择：

```json
{
  "kind": "next_step",
  "task": "根据选定材料提出下一步行动，区分当前事实与待确认事项。",
  "sources": [{ "item_id": "01JAAAAAAAAAAAAAAAAAAAAAAA", "revision": 1 }],
  "classification": "internal",
  "ttl_seconds": 604800,
  "timeout_ms": 60000
}
```

```text
pnpm proposal-worker prepare-generation --binding binding.json --file selection.json --output new-sources.json
pnpm proposal-worker generate --provider provider.json --file new-sources.json --output new-draft.json
pnpm proposal-worker enqueue --queue queue.sqlite --binding binding.json --file new-draft.json --key generated-proposal-001
```

三个步骤分别执行。prepare-generation 只读取网关和保存新文件，不调用模型；generate 只调用明确配置的模型，不打开队列；审阅来源和草稿后再 enqueue，之后显式 flush 提交。生成端仍按 provider.max_classification 检查数据分类上限；读取权限不自动表示允许把内容发送给任意模型供应商。

## 身份、版本和内容检查

首先读取 `GET /v1/proposals/submission-context`，核对协议版本、trace、空来源和完整原账号/客户端/项目范围。随后逐条 `GET /v1/context-items/{id}`。每个请求均携带固定项目范围及 X-Expected-Actor-Id/X-Expected-Client-Id；当前网关将预期头与已认证身份比较，它们不是授权依据。预检不证明 context.read、proposal.write 或存储可用，实际读取继续通过网关权限和项目/分类检查。

每条响应检查 schema_version、trace、条目 ID、tenant/workspace/project、实际版本、外层 revision/ETag、本条固定来源和其余来源引用的对应关系。实际版本不同返回 PROPOSAL_SOURCE_PREPARATION_VERSION_CONFLICT，并保留预期及当前版本；不转读历史版本或自行使用最新版。

来源必须处于 proposed 或 confirmed，sources_current=true 且 source_check.state=current、scope=local-context-items，检查时间为有效 UTC。根条目过期、excluded、依赖变化或无效来源链均拒绝；读取完成后再检查已经取得的根条目有效期。确认状态不会被自动提升：每段 excerpt 包含标题、读取时的状态和完整正文，沿用生成输入的首尾空白规范化，不承诺逐字节内容快照。非字符串内容明确拒绝，不把对象转换成伪造文本；超长正文整次失败，不隐式选片段。

input.sources 中每条引用固定为 context-item/原 ID/revision，分类取实际响应分类。生成请求总分类为用户指定分类与全部来源分类的最高值；默认用户分类为 internal。输入生成阶段继续复用既有共享校验，模型不能改变这些引用或降低分类。

逐条读取并非跨条目的数据库快照，也不锁定后续权限、状态或依赖；observations.checked_at 记录每个条目的原检查时间。文件是当时读取内容的副本，后续生成不再次联网检查。实际提交和确认仍由网关重新检查当前来源，不因准备成功而绕过权限或 freshness 检查。该流程没有外部链接抓取、历史正文读取或递归复制所有依赖正文。

## 限额、输出和恢复

选择文件最多 32 KiB，1–32 个不同条目，ID 复用既有 ContextItem 标识符规则、revision 为正安全整数。身份响应最多 16 KiB，每个来源响应最多 1 MiB；单条生成摘录含标题和状态最多 65536 字符，累计完整生成输入文件最多 512 KiB。每次读取后立即检查累计容量，超限不继续读取其余条目。

timeout_ms 默认 60000，允许 1000–120000。预检、全部来源读取和本地解析共用单调时钟期限，后续请求只使用剩余时间；单请求采用已有有界 JSON 传输，支持取消、响应大小限制和禁止重定向，不自动重试。身份失败、权限拒绝、来源缺失、版本冲突、内容/响应无效和超时都不保存部分输入。错误输出提供 trace、已知条目 ID、版本冲突信息及经过筛选的 cause_code，不回显原始响应或凭据。

成功结果包含 schema_version、trace_id、prepared_at、binding、规范 selection、observations 和 input。默认 `--output` 只保存可直接交给 generate 的 input，完整身份和读取观察位于 JSON 命令输出；此普通输入文件不强制绑定后续队列或目标项目。新增 `--record` 可保存完整准备记录，交给 generate-prepared，并经 enqueue-generated 核对原目标后入队，详见 [完整记录契约](proposal-generation-record-runtime.md)。两种文件都不是权限证明，网关仍检查固定来源。

输出预检发生在联网前；保存复用同目录独占临时文件、同步、完整读回、硬链接发布及发布后读回，不覆盖已存在路径。文件系统须支持硬链接；不宣称跨崩溃目录持久性。保存失败退出 1，错误 JSON 的 preparation 保留完整已准备结果，output 提供保存阶段、目标和可能的临时文件位置，便于恢复，无需为了找回相同文本重新读取。生成前应重新评估已保存内容是否仍适用。

完整准备结果文件与目的地绑定已接入独立记录流程；后台来源发现、自动刷新版本、历史来源恢复、持久生成任务及审计关联、真实权限/网络/文件系统运行证据仍待后续工作。本轮未增加 Gateway 路由、依赖、数据表或迁移。
