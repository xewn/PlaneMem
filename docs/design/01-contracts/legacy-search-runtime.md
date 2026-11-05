# 旧上下文索引持久读取（开发状态）

2026-11-05，TODO **P0-02**：新增 `searchLegacyContext` 和完整搜索结果共享解析；旧索引 Mock 搜索读取同一可变账本，响应写入/删除/恢复/到期，并使用显式正文评分和记忆场景。调用及权限/降级差异见 [搜索 SDK 与 Mock](search-sdk-mock-runtime.md)。完整解析用于 SDK/Mock，生产 Gateway 仍沿原拼装方式；未编译、运行或测试。

2026-11-05，TODO **P0-02**：新增类型化 `WcpClient.indexLegacyContext`，共享完整原正文写入回执解析；Mock 覆盖内容写入、目录、状态、删除和恢复，沿生产的单调版本/分类、删除保护及不同历史重放规则。用法与差异见 [旧索引 SDK 与 Mock](legacy-context-mock-runtime.md)。不改生产存储或 capture 协议，未编译、运行或测试，P0-02 未完成。

2026-11-05，TODO **P0-01**：补充 [context-index OpenAPI/Schema](../../../packages/contracts/openapi/README.md#旧索引内容与管理)，描述旧内容写入及目录/状态/删除/恢复五路。内容写入规范指纹与历史元数据回执的重放限制不同，当前删除/过期会拒绝旧正文重放；首次输入允许已经过期。capture在持锁事务内调用但不与外部原子提交，内置提供方trace路径create_only不等同原请求键幂等；可选失败没有degraded标志，配置provider仍须预留来源槽位。人工核对还区分MEMORY_PROVIDER_OFF未配置retryable=false与已配置但adapter disabled的true，已修正搜索/观察OpenAPI。仅源码契约文档，P0-01/R-001未完成、evidence为空；未编译、测试、运行校验器/生成器/接口/SQL或发布。

2026-11-05，TODO **P0-01**：新增 [search OpenAPI](../../../packages/contracts/openapi/search.json)和独立 [search Schema](../../../packages/contracts/schemas/search.json)，完整描述本接口query/budget/use_vector、fts与memory不同命中及完整封套，详见[机器契约边界](../../../packages/contracts/openapi/README.md#项目与旧索引搜索)。记忆未配置且可选时不降级，use_vector或配置记忆无权/失败才降级；内外来源按最终命中顺序拼接并保留重复，memory_used=true可无返回记忆条目。配置记忆且有restricted能力时独立父项目重查会拒绝隐藏项目或传播SQL错误，发生在可选记忆降级捕获之外。没有跨SQL/记忆的一致事务或完整结果共享解析，不改运行实现。P0-01/R-001未完成、evidence为空，未编译、测试、运行校验器/生成器/接口/SQL或发布。

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
