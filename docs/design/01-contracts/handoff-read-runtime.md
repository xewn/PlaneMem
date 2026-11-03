# 单条交接当前状态读取

2026-11-02：仅源码与文档开发；未编译、类型检查、测试、启动服务、执行迁移或发布。无新增迁移，既有 016–044 保持未执行。

## 接口与权限

`GET /v1/handoffs/{handoff_id}` 对应 `session.handoff.read`，只接受路径中的 ULID，不接受查询参数或额外业务字段。HTTP 强制签名读取身份，以 `context.read` 授权；不要求已验证写入客户端。读取绕过写入幂等成功缓存，响应 `Cache-Control: private, no-store`，无 ETag。

一次 SQL 连接同 tenant/workspace/project 下的持久交接、原检查点和父会话，并检查父项目未删除、分类有效及 restricted 读取能力。只读 `wcp_session_handoffs`，不以 `wcp_handoffs` 历史投影补造可操作记录。不存在、关联缺失或不可见统一返回 HANDOFF_NOT_FOUND/404；无数据库或存储故障返回 SESSION_STORAGE_UNAVAILABLE/503；存储记录矛盾返回 SESSION_ACTIVITY_INVALID/500。

本接口不领取、不续接、不写业务状态、不检查保存的上下文包或访问外部记忆。普通策略审计仍沿用 Gateway 流程。

## 响应

封套 schema_version=1、trace_id 为本次读取，唯一外层来源为 `{type:'handoff',id:handoff_id}`。data 包含 schema_version、tenant_id/workspace_id/project_id、handoff_id、session_id、checkpoint_id、from_client、可选 target_client、status、可选 claimed_by/claimed_by_actor、version、created_at/updated_at、记录 trace_id/source_refs。

共享 parseHandoffReadQuery/parseHandoffReadEnvelope 校验确切目标、范围、来源、正安全整数版本、时间顺序及归属一致性。open 为未领取 version=1；claimed/expired 版本至少为 2；claimed 必须记录领取客户端，旧记录允许缺少领取账号但不补造。目标客户端与已记录领取者不得冲突。记录来源需包含原检查点且 type/id 唯一。响应不包含原请求键、业务回执、检查点笔记或包内容。

仅可信 authenticated_client=true 时返回 session_identity（tenant/workspace/project/actor/client）。handoff_permissions 包含 claim 和 write_sessions 布尔提示，写提示必须伴随可信身份；session.write 或 admin 可写并领取，单独 handoff.claim 可领取。提示不是授权凭据，实际写入和回执查询仍重新授权和校验原身份。可选 expectedIdentity 供工作台后续读取绑定原账号、客户端与范围。

## 客户端

- SDK `getHandoff(handoffId)`：发送前校验 ID，GET 不继承写入键或版本条件，共享校验返回封套。
- CLI `handoffs get`：JSON 仅 handoff_id，禁止 --key；远程支持 --json/--json-file，嵌入仅 --json。重复选项拒绝，嵌入读取清除继承键/版本；两种入口使用共享响应解析。
- MCP `get_session_handoff`：context.read，只读工具，只接受 handoff_id；不加入写入客户端门槛，清除继承键/版本，成功响应再次校验。
- Web `/handoffs/detail?handoff=...`：独立读取，不加载交接/检查点全量列表或其他看板指标。显示当前归属、版本、时间、原检查点及记录/读取 trace，并复用队列详情的领取与续接表单。旧领取无 actor 不开放新的工作台续接；已保存原请求仍可恢复和查询。

创建/领取成功、会话续接来源和队列条目可新标签页直达详情。表单 key 固定身份及会话/交接/检查点，不随当前版本变化；当前状态不能解除未知结果、替换原版本或键，也不能证明原创建/领取/续接成功。页面提供新标签页重新读取，保留原页恢复状态；没有自动领取、续接或回执查询。来源 URI 按文本展示，不作为可点击任意链接。

## 工作台原地刷新

2026-11-02 源码增量：独立详情页使用 LiveHandoffDetail 保留已挂载的领取/续接表单。显式“Refresh current handoff state”调用只读 server action，携带原可信身份前置条件，重新读取同一交接。刷新结果再次校验原范围、账号、客户端、父会话、检查点、发送方、目标和创建时间；版本倒退或同版本归属矛盾均拒绝。读取失败保留上次成功快照及其 trace，标为 Last-read，不用空数据覆盖。

当前快照、权限提示与原命令结果分别保留。刷新不会改写 state.request 中的原版本、参数或键，不将 claimed 状态变为原领取成功，也不将当前父子引用变为原续接成功。原地读取不卸载表单，不触发恢复重新导入；页面 key 仍固定身份和会话/交接/检查点。成功回执继续由原领取/续接响应解析。

同一独立详情页用同步互斥控制器协调刷新、领取、续接和回执查询。读取或操作进行中，其他操作及恢复文本操作暂不可用；原请求仍先保存读回再发送。写入尝试结束后提示显式读取当前状态，再开放下一次写入；没有发送的存储失败不标作已写。刷新失败时关闭写入入口，页面空闲时仍可导出/导入原请求和查询原回执；拒绝、失效或未知状态不清除恢复槽。实际权限仍在服务端重新检查。

确认绑定当前身份、目标、资格、权限、读取轮次及领取版本；状态更新或另一项操作开始会立即使旧确认失效，必须重新勾选。该确认机制也适用于既有队列中的两种表单；未发送的领取草稿可使用新读取的当前版本，已经保存的原请求始终使用其原版本。刷新从不自动领取、续接或查回执；领取成功后可在原页手动刷新，再审阅并准备续接。展示格式辅助函数移至无服务端依赖的模块，以供共享客户端详情使用，原服务端页面仍保留旧导出入口。

该增量不增加 API 或迁移，不修改业务事务和恢复格式；仅源码与文档，未编译、类型检查、测试或浏览器运行验证。

## 待运行证据

读取权限/跨范围/项目删除、旧领取归属兼容、数据库故障/损坏、HTTP 查询参数与缓存、各客户端响应绑定及浏览器恢复均尚无本轮运行证据。相关项登记在 R-004，用户要求仅开发，因此不执行验证命令。

## 交接目录分页关联

2026-11-03：目录已改为默认 25 条的筛选分页，详见 [交接目录分页](handoff-registry-runtime.md)。目录页外的明确选择仍可通过本文件描述的按 ID 入口独立读取；目录提示不替代原创建/领取/续接回执。仅源码，未编译、测试或运行。

## 当前详情不可读时的原请求恢复

2026-11-03：详情成功及错误视图均提供同标签页 `/handoffs/recover` 导航。恢复页只要求可信调用者元数据，明确加载已保存或导出的原领取/续接请求后复用原表单，原版本/键/身份不取自当前详情。不会把详情失败、存储空值或未观察到回执解释为原请求失败，也不自动领取/续接。正常详情的刷新互斥和写后重读规则不变；服务端仍检查原命令/回执访问，见 [独立交接恢复](session-command-context-runtime.md)。仅源码和文档，未编译、测试或运行。
