# 建议生成完整记录与目标绑定 v1

更新：2026-11-04。仅源码和文档增量；未编译、类型检查、测试、执行 CLI、调用模型/网关、打开数据库或发布。没有数据表、迁移、依赖和 Gateway 接口变化。

## 独立步骤

以下是使用说明，本轮未执行。文件父目录须已存在，所有输出路径必须是新文件。

```text
pnpm proposal-worker prepare-generation --binding binding.json --file selection.json --record --output preparation.json
pnpm proposal-worker inspect-generation --file preparation.json
pnpm proposal-worker generate-prepared --provider provider.json --file preparation.json --output generation.json
pnpm proposal-worker inspect-generation --file generation.json
pnpm proposal-worker enqueue-generated --queue queue.sqlite --binding binding.json --file generation.json --key proposal-generated-001
```

prepare-generation 使用 `PROPOSAL_WORKER_ACCESS_TOKEN` 读取明确选择的当前来源；`--record` 将完整准备结果保存成 v1 文件。generate-prepared 完整检查准备记录，再使用 `PROPOSAL_GENERATION_API_KEY` 单次生成并保存完整生成记录，不重新读取网关来源。inspect-generation 不需要凭据、网络或打开队列，完整检查后只输出摘要、绑定、来源观察、模型配置与标识，不输出任务、摘录、标题或正文。

enqueue-generated 在打开队列前完整核验记录，并比较规范化后的 gateway_url、tenant_id、workspace_id、project_id、actor_id、client_id，任一不符返回 `PROPOSAL_GENERATION_BINDING_MISMATCH`，不创建目标库。准备记录不能直接入队；参数错误和非法请求键也在打开前拒绝。通过后保存原草稿任务及完整记录，返回 job、record_sha256、attached_at 和关联 replayed。同键同草稿返回原任务，同键异草稿仍拒绝。只有后续显式 flush 才提交到网关，人工审核流程保持原有规则。

旧 prepare-generation 不带 `--record` 时仍仅保存生成输入；旧 generate 保存普通草稿，旧 enqueue 接受普通草稿。这条旧流程不包含记录绑定保护。不能将完整记录直接作为普通输入或草稿使用；完整记录流程不提供更换目标、修改原文本或自动重试选项。

## 文件结构

准备记录只包含 `schema_version: 1`、`kind: "proposal-preparation"`、`preparation` 和 `sha256`。preparation 保存原 schema_version、trace_id、prepared_at、binding、规范化 selection、全部 observations 与完整 input。

生成记录只包含 `schema_version: 1`、`kind: "proposal-generation"`、`preparation`、`provider`、`generation` 和 `sha256`。此处 preparation 为完整准备记录，包含内层摘要；provider 是带默认值的规范模型配置，不能带 api_key/token 等未知字段；generation 是完整生成结果，含请求/返回模型、响应 ID、时间、trace、提示版本、来源和标准草稿。记录文件不保存环境变量凭据；来源摘录和生成正文仍属于文件内容，应按其分类管理。

独立文件读取和规范 pretty JSON（两空格缩进、尾换行）均不超过 2 MiB；使用共享有限 JSON 快照，拒绝循环、非有限数、稀疏数组、访问器或非普通对象，限制节点数和深度。原选择 32 KiB、输入 512 KiB、草稿 1 MiB 与字段限制继续生效；检查完整记录，不截断字段以满足容量。

## 一致性规则

每个记录及结果封套拒绝缺失/未知字段；binding、selection、input、provider 和 draft 必须已经规范化并包含默认字段，检查时不默默修正文档。schema_version 固定为 1，时间使用完整毫秒 UTC，trace 使用对应生成步骤的前缀及 ULID。

selection.sources、observations 和 input.sources 必须等长、同序、逐项对应原 ID/revision；引用只能为固定 context-item/ID/revision。观察状态只能是 proposed 或 confirmed，分类与输入来源一致，检查时间和可空到期时间均完整保留。input 的类型、任务、TTL 必须与 selection 一致；总分类必须等于选择分类与所有来源分类的最高值。摘录保留原规范文本，不通过解析摘录标题来宣称重新认证原文。

generation 和 draft 的来源必须与 preparation.input 完整相同；草稿类型、分类、TTL 不变，固定提示版本为 proposal-draft/1，不得注入 derived_from。requested_model 等于 provider.model；returned_model 等于草稿 model_version，返回模型和响应 ID 使用原有有界可见 ASCII。provider 的分类上限必须允许输入分类。标题/正文继续使用共享建议创建契约。

每个 sha256 是该对象去除自身 sha256 后的规范 JSON 的 SHA-256 小写十六进制。规范 JSON 对象键按 JavaScript UTF-16 词典序排序，键与标量使用 JSON.stringify 编码，无多余空白；数组保持顺序。外层摘要包含完整内层准备记录及内层摘要。对象键顺序和文件缩进不影响摘要，数组排序或内容变化会影响摘要。检查先确认全部结构及关联，再检查两层摘要。

摘要只检查内容一致性，任何能重写文件的人也能重算摘要。记录不认证网关/供应商响应、模型实际执行、来源真实性或权限；不证明内容当前有效。不同步骤的时间不要求严格先后，避免把本机时钟调整当作内容损坏。多来源准备仍是逐条观察，不构成数据库快照；记录可长期保留历史观察，离线检查不因当前时间判定历史失效，使用者应评估其适用性，实际提交/确认仍由网关重新核验。

## 保存和恢复

联网前检查新输出路径，保存复用同目录独占临时文件、同步、完整字节读回、硬链接发布、发布后完整读回，不覆盖原文件；文件系统需支持硬链接，不宣称跨崩溃目录持久性。封装记录或保存失败均保留已完成的准备/生成结果；生成结果保存失败的恢复输出包含原 preparation、无凭据 provider、generation，已经封装成功时另含 record。output 始终带目标路径，进入文件保存后还保留阶段、发布状态和可能遗留的临时文件位置。不要仅因保存失败重新调用模型。

`inspectProposalGenerationRecord` 返回完整的独立副本；`createPreparedProposalRecord` 和 `createGeneratedProposalRecord` 封装并核验记录；`readGeneratedProposalDraft` 完整核验并比较目标后返回草稿。它们只处理本地数据，不执行生成、提交或审核。

队列核心 schema 保持 v1，新增 [任务生成记录历史](proposal-generation-history-runtime.md) 可选扩展：enqueue-generated 将完整记录与任务同事务保存，generation-list/get 支持只读核对及取回。普通 enqueue 不保存生成记录；旧任务可明确使用原记录和请求键补充关联。完整记录文件仍可独立保留，记录摘要不成为权限证明。[生成调用持久请求](proposal-generation-request-runtime.md) 已增加调用前日志、独占领取和已保存结果取回，不改变本文件记录格式；供应商未知调用对账/受控恢复、全局审计、费用与质量评估、自动调度及真实运行证据仍待后续开发。
