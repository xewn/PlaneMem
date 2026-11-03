# 旧上下文索引持久读取（开发状态）

2026-11-02：本批只修改源码与文档，未编译、类型检查、测试、启动服务、执行迁移或发布。032 迁移只写文件；缺表/缺列时新路径返回存储不可用，不回退内存。

## 搜索与资源读取

`POST /v1/context/search` 仍接受 query/budget/use_vector，现要求令牌身份和 context.read，通过 PostgresLegacySearch 直接查询 wcp_context_hits。query 为 1–500 字符，budget 默认 20、范围 1–100，use_vector 默认 false。使用 simple 配置的词语 AND 搜索、ts_rank_cd 排序；不再是内存 includes，标点/词语片段的匹配行为会变化。需要字面包含或工作项/ContextItem 当前表搜索时使用 `/v1/search`。

每次限定 tenant/workspace/project、当前可见且未删除项目、命中 classification/deleted_at/expires_at。未配置存储或查询失败返回 SEARCH_STORAGE_UNAVAILABLE/503。损坏记录和超过安全整数范围的旧 revision 返回 SEARCH_RESULT_INVALID/500，不把 BIGINT 静默舍入。HTTP 缓存不复用旧成功结果，进程启动也不再加载整张命中表到资源缓存。

结果保留原 query/scope/hits/trace/source_refs，增加 backend=postgres、vector_used=false。命中增加 classification/expires_at；全文 score 由数据库计算，不采用原写入 score。use_vector=true 只表示请求尚未实现的向量能力，响应 degraded=true；健康信息的 vector_enabled 固定 false，原配置反映在 vector_requested。

`wcp://context/{context_id}` 的 MCP resources/read 改为数据库即时读取，返回 JSON 命中，保留原 revision/score/rank_source。读时检查项目、分类、删除、过期，不再读取 Markdown 缓存。resources/list 已增补数据库分页目录，只枚举当前可读且有效的旧命中；游标绑定范围与 restricted 权限，具体排序与其他资源种类见 [MCP 运行时](mcp-runtime.md)。搜索返回的 ID 也可编码成模板 URI。

## 索引写入与重试

`POST /v1/context/index` 要求令牌、已验证客户端、context.write、稳定请求键。新增 classification（默认 restricted）和 expires_at（UTC 或 null）。默认不把旧内容视为普通内部数据；没有 data.restricted.read 不能写 restricted。032 给历史命中补 restricted，不自动降低分类。

id 最多 255 字符，title 最多 1000，snippet 最多 65536，revision 为非负安全整数，score 有限，source_refs 最多 64；启用外部 capture 时预留一条来源槽位。plane: 前缀由 Webhook 投影独占，手工索引拒绝。过期和删除是本索引记录的状态，不是 source_refs 外部来源的实时证明。

写入在事务内按请求身份/键和索引 ID 串行，检查项目及原分类，再保存命中和 wcp_context_index_receipts。新键更新要求 revision 严格增加、分类不能降低、删除条目不能复活。相同键/规范化参数返回原持久回执；改参数复用键返回 IDEMPOTENCY_KEY_REUSED。重放检查当前及原回执的可读/到期状态，返回的是历史命中，不代表当前 revision；不会重新执行 capture 或覆盖索引。版本冲突返回 CONTEXT_INDEX_VERSION_CONFLICT/409。

回执重放按规范化字段重新核对原请求指纹，包含正文、分类、到期和原来源；仅允许额外保存一条 capture 返回的 ai-memory 来源。当前索引版本不能早于回执版本，损坏回执返回 SEARCH_RESULT_INVALID。到期检查使用持锁读取时的数据库时间。外部来源槽位限制仅用于首次写入，后续启用 provider 不会阻止已保存的 64 来源请求读取原回执。

持久化成功前不发布手工命中到进程缓存。Plane 事件写命中时保存事件敏感度，冲突更新不降低原分类且只接受更高 revision；旧记录已被回填 restricted 时不会由普通事件自动降级。内存辅助索引按范围/ID 替换高版本记录，不再堆积重复命中；它不再是旧搜索或旧资源的读取源。

## 外部记忆和剩余边界

2026-11-02 增补：手工索引状态读取、软删除、恢复及 SDK/CLI/MCP 管理入口已加入源码，依赖未执行的 033 迁移。版本与回执规则见 [旧索引管理](legacy-context-lifecycle-runtime.md)。

外部 MemoryHit 尚没有逐记录分类，旧搜索将其作为 restricted：无受限数据权限时不调用 recall，可选 provider 返回本地结果并标 degraded；MEMORY_REQUIRED 时拒绝。context.search 与 workitem.context 已复用 recallProjectMemory：召回前检查项目/记录可见性，召回后检查每条范围、标识、revision 和来源；异常时丢弃整批，必需 provider 则失败。最多接受 1000 条候选、单条 65536 字符和 64 来源，按 page_ref 去重后截取。外部命中标 rank_source=memory，不冒充本地 FTS。合并仍是本地优先截断，不是融合排名。

写入保留既有 memory capture，先检查本地冲突并持有事务锁；成功回执可防止提交后的重试重复 capture。**外部 capture 与本地事务不具备原子性**：外部成功而本地提交失败时仍可能留下孤立页面，重试可能再 capture。provider 缺少稳定请求键接口，尚需外部幂等/补偿工作流；本批不宣称外部 exactly-once。可选 provider 失败不会增加伪造来源；必需 provider 失败中止本地事务。

本地过期/删除不会级联删除已复制的外部记忆。旧 workitem.context/项目投影资源已增补持久读取和当前可见性检查，见 [Plane 观察状态](observed-state-runtime.md)；外部 handoff/claim 的授权与持久语义仍需统一。source_refs 不是自动继承分类或来源失效的关系，本批仅实现旧索引自身分类和有效期。索引元数据目录、管理页面和 MCP 有效资源分页已增补；索引正文编辑页面、外部补偿、pgvector、重建运维和性能证据仍未完成。
