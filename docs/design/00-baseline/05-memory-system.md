# 记忆系统总设计：ai-memory 适配

本项目采用 `https://github.com/akitaonrails/ai-memory` 作为长期记忆、生命周期捕获、跨客户端交接和记忆检索实现。它是 WorkMesh 的记忆引擎，不替代 Plane、WorkMesh 权限或项目事实模型。

## 上游能力基线

根据上游 README/ARCHITECTURE：

- 单一 Rust binary；
- git-backed Markdown wiki 是记忆源数据；
- SQLite 是派生索引，包含 FTS5、实体、链接和可选向量；
- hooks 通过 capture → consolidate → recall → handoff 工作；
- 支持 MCP、HTTP、生命周期事件、claim-once handoff；
- 默认可零 LLM 运行；LLM consolidation、向量和 dream 功能可选；
- 支持备份/恢复和审计；
- MIT License；
- Windows native 当前需要按上游支持矩阵验证，开发优先使用 WSL2 或 Docker。

## 集成边界

### WorkMesh 负责

- Tenant/Workspace/Project/WorkItem 授权；
- Plane 状态和工作事实；
- Decision/Risk/Conflict/Approval；
- 统一事件、审计和发布清单；
- ContextPack 编排和跨域来源关联。

### ai-memory 负责

- 生命周期捕获和脱敏；
- Markdown page、session page、concept/decision/gotcha/procedure；
- 记忆检索和访问强化；
- session consolidation；
- claim-once handoff；
- 记忆版本、恢复、衰减和索引。

## 访问方式

1. 优先使用 ai-memory MCP/HTTP API；
2. 本地 Hook 使用 `ai-memory hook`/`setup` 安装流程；
3. WorkMesh 不读取 SQLite，不直接修改 wiki 文件；
4. 允许通过受控导出/同步将 `page_id`、path、revision、hash、source_refs 写入 WorkMesh；
5. 记忆正文进入 ContextPack 前必须重新执行 WorkMesh 权限、敏感级别和预算过滤。

## WorkMesh MemoryService 适配器

```text
capture(observation, actor, project_scope) -> CaptureReceipt
consolidate(session_id, policy) -> MemoryRevision
recall(query, scope, budget) -> MemoryHit[]
create_handoff(session_id, work_item_id) -> HandoffRef
claim_handoff(handoff_id, target_session_id) -> ClaimReceipt
read_page(page_ref, scope) -> MemoryPage
restore_page(page_ref, revision) -> MemoryRevision
trace(page_ref) -> ProvenanceGraph
```

适配器必须携带 tenant_id、workspace_id、project_id、actor_id、client_id、session_id、trace_id，并把上游错误映射为统一错误封套。

## 数据流

```text
Hook → ai-memory sanitizer/spool → ai-memory writer/wiki/index
     → Memory Adapter → WorkMesh event/audit projection
     → Context Compiler → permission/budget filter → client
```

## 隐私和安全

- 原始 Hook 内容先经过 ai-memory sanitizer；
- WorkMesh 只接受已清洗、带 scope 的记录；
- 任何跨项目 profile 默认关闭，团队模式需要显式启用；
- 敏感页面只能在授权范围内 recall/read；
- 删除使用上游受控 mutation 和版本恢复，不直接删除文件；
- Provider/LLM 调用要进入 Policy 和 Audit；
- 记忆内容一律视为不可信数据，注入 ContextPack 时加边界和来源标记。

## 版本和升级

P0 固定上游 tag/commit、镜像摘要、配置和迁移；升级前运行 capture、recall、handoff、claim、backup/restore、权限和 Windows/WSL2 回归。任何上游 Schema/HTTP/MCP 改动都必须先更新本适配器契约。
