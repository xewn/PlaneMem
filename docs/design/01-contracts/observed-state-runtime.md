# Plane 观察状态持久读取（开发状态）

2026-11-02：仅修改源码、文档与迁移文件，未编译、类型检查、测试、启动服务、执行迁移或发布。读取依赖已有 009 运行时表及 032 可见性字段，删除观察新增 040 列与约束；016–040 均未执行。后续 Webhook 持久接收与重试边界见 [接收与重试](plane-inbox-runtime.md)。

## 工作项删除观察

Canonical WorkItemDeleted 在同一事务保存源事件、快照 deleted_at、同版本已删除索引及处理回执/审计。快照只含删除事件的 external_id，deleted_at 等于 occurred_at；不保留原标题/描述到当前快照。索引标题替换为删除提示、snippet 清空，分类维持当前与新事件中的较高等级；此前索引已删除或过期也可以接受更高版本的删除标记。历史事件仍保留，外部记忆副本与工作台本地工作项不在此事件中删除。

活动 state 的 data.schema_version=1，省略 deleted_at；删除 state 的 data.schema_version=2，必须为 WorkItem、deleted_at=observed_at、无 status，fields 恰好只有 external_id。外层 envelope 仍为 v1。旧的 v1 快照解析器会拒绝内层 v2，不能静默把删除记录当作活动观察。新版 SDK/CLI/Web 复用扩展的共享解析器；MCP state 返回相同版本化标记，工具说明明确区别。

直接 state 查询只在同一 SQL 中核对删除源事件、快照和索引的版本/时间/范围一致后返回标记；已删除索引仅为读取删除元数据放行，不作为活动内容，不要求它尚未过期。项目与分类权限仍检查；父项目已删除、不可见或记录缺失仍为 404。context 在初次读取确认可见删除标记后返回 OBSERVED_RECORD_DELETED（410），在外部记忆召回之前停止；共享上下文解析器也拒绝嵌入 v2 删除观察。和其他快照读取一样，不保证读取完成后的状态不再变化。

删除属于版本流的一部分。重复事件仍使用持久回执，不重写投影；新事件不能跳过版本缺口，删除后的普通更新被拒绝为 PLANE_RECORD_DELETED，数据库 upsert 也阻止普通更新将删除快照改回活动。更多 WorkItemDeleted 可以按正常下一版本推进删除标记；显式恢复必须使用下节 WorkItemRestored，不能改事件键或手工恢复 plane: 索引绕过。

工作台 state 页面显示 Deleted observation、删除源时间和来源；勾选 Include context 得到 410 时提示取消勾选读取标记，不自动召回或改读其他记录。队列目录、详情和版本诊断识别 WorkItemDeleted；对删除后的较高普通版本，诊断返回 deleted_stream 且不提供 next_version。040 仅写文件，启动代码会检查 deleted_at 列；项目删除、原生删除/恢复事件映射与外部副本清理仍未完成。

## 工作项恢复观察

WorkItemRestored 通过同一签名 Canonical 入口接收。必须含项目、causation_id、稳定 external_id、新的非空 title/status 和 restored_from={event_id,aggregate_version}；引用只允许这两个键。causation_id 等于引用的删除事件 ID，恢复事件使用不同 ID，版本为删除版本加一。字段使用本次完整活动观察，不合并删除前历史内容。

持久处理没有已提交基线时必须保持 AGGREGATE_VERSION_GAP，不能把恢复当作新流起点；缺口同样等待。到达紧邻版本后，最新源事件必须是引用的 WorkItemDeleted，且 external_id 一致，否则 PLANE_RESTORE_PRECONDITION_FAILED。在 aggregate/别名/索引锁内，额外锁定删除快照和索引，核对源事件范围、版本、时间、字段、来源、删除标记与索引 revision；索引必须未过期。缺失快照/索引不会被重新创建。离线领域投影也要求已有匹配删除观察，失败不推进账本；持久等待与索引约束由 Gateway 实现。

成功写入在同一事务追加恢复事件，快照与索引清除 deleted_at、保存新版本和新字段，并保存回执与审计。索引保留原 expires_at，分类取原值与事件值中的较高等级；恢复不延长寿命、不降低分类、不改历史。后续活动读取仍受父项目、当前权限和到期限制。

恢复快照为内层 schema_version=1，顶层可选 restored_from 明确来源，并与 fields.restored_from 和当前版本交叉校验。该标记只由源类型 WorkItemRestored 生成；后续普通更新不带顶层标记，即使业务 fields 仍含同名值。再次删除使用内层 v2。SDK/CLI/MCP 复用共享解析器；Web 显示 Restored observation、原删除事件/版本与本地边界。版本诊断允许恢复进入 next_version/gap 比较，但不读取 payload 或核验恢复前置条件。恢复成功回执只代表历史处理，不能证明当前仍可读。

此功能只开发自有 Canonical 恢复观察，不调用 Plane 恢复 API、不恢复外部记忆副本或工作台本地工作项。无新增迁移，沿用未执行的 040；没有编译、类型检查、测试、启动或发布。

## 入口与身份

### 当前工作项观察目录（2026-11-02，仅源码）

GET `/v1/plane/work-items` → `workitem.observed.list`，要求可信 Bearer 身份、项目范围及 context.read；无请求键、无写入或外部记忆调用。查询参数只有 query（默认空）、state（active/deleted/all，默认 active）、limit（1–100，默认 25）、cursor；拒绝未知字段、重复参数和无效值。项目缺失或不可读返回 404，可读项目没有匹配记录返回空页；存储不可用返回 OBSERVED_STATE_UNAVAILABLE/503，损坏的已选元数据返回 OBSERVED_STATE_INVALID/500。即使误带请求键也重新读取，不使用成功响应缓存。

query 最长 500 个 UTF-16 单元，拒绝控制字符及孤立代理项后去除首尾空白；全空白等价于无检索词。匹配 external_id、aggregate_id 或当前显示的活动标题摘要的字面子串，只忽略 ASCII 英文字母大小写，不做 Unicode 大小写折叠、重音/字形归一化或分词。百分号、下划线和其他符号都是普通字符，不是通配符；不使用 LIKE 模式。删除行只按两个 ID 匹配，不查询旧标题、描述、历史事件正文或外部记忆。SQL 与共享响应解析器使用相同折叠规则，返回条目必须符合检索词。

外层 envelope v1，source_refs=[]。data 为 `{schema_version:1, scope, checked_at, items, next_cursor?}`；条目含 external_id、aggregate_id、plane_version、source_event_id、event_type、state、title、status、classification、observed_at、deleted_at。它是当前观察元数据，不是事件历史或工作台本地工作项。title/status 是最多 2000/255 个 Unicode 字符的显示摘要，完整字段另读 state；无有效标题时使用 external_id。删除条目 title/status=null，deleted_at=observed_at，不返回旧正文或来源引用。恢复条目 event_type=WorkItemRestored，来源细节另读 state。时间是源观察时间，不保证早于查询时间或代表实时同步。

同一 SQL 快照先核对可读父项目、事件类型/范围/字段/版本/时间、观察身份以及同版本索引。活动索引必须未删除且未过期，删除标记可在原索引过期后继续发现；缺失或不一致的关联行不进入目录。可见性取父项目和索引分类，输出较高等级。数据库内先过滤再取 limit+1，只返回 limit 条与下一页游标，不返回总数或隐藏计数。

按 external_id 的 UTF-8 `COLLATE "C"` 升序分页；共享解析器用 Unicode 标量比较保持非 BMP 标识顺序一致。游标 v2 绑定范围、actor/client、restricted 读取能力、规范化后的 query、state 和 limit；改变筛选、页大小或身份必须从第一页开始。旧 v1 游标拒绝并要求重新查询。游标不是授权凭据，每页重新校验权限。各页没有冻结快照保证；新增、删除、恢复、过期或权限变化可能让记录在翻页期间出现或消失。

SDK `listObservedWorkItems`、CLI `observed list`、MCP `list_observed_work_items` 和 Web `/work-items/observed/list` 使用相同契约；CLI 拒绝 --key。工作台 q 表单映射到 API query，检索或状态筛选提交清除旧游标。详情链接携带合法 list_query/list_state/list_cursor 作为往返导航信息，切换 Include context、重新读取或清空 ID 时保留；返回路径由固定目录地址构造，不接受任意 URL，也不把导航参数发送给单条状态接口。列表不预取详情、不触发 Plane 查询或队列操作。检索增补无新迁移，仍只有未执行的 041 排序索引，未开发子串检索专用索引；性能证据缺失。016–041 均未执行，未编译、类型检查、测试、启动或发布。

| 入口 | 返回 |
| --- | --- |
| GET `/v1/projects/{project_id}/state` | 当前项目的持久 Plane 观察快照 |
| GET `/v1/work-items/{work_item_id}/state` | 单个持久 Plane 工作项观察快照 |
| GET `/v1/work-items/{work_item_id}/context` | 同一类观察快照及摘要/可选外部记忆 |
| MCP `get_project_context`、`get_work_item_state`、`get_work_item_context` | 对应 HTTP 读取 |
| MCP 项目根地址/current-state、work-item 根地址/context | 对应命令的 JSON envelope |

表内单条 HTTP 路径均要求 Bearer token 和三层 scope，复用 context.read 策略、审计与限流；不能再用自报 actor/client/capability 请求头建立读取身份。单条读取无查询参数，命令仅接受对应 ID。项目 path ID 必须等于当前授权项目；工作项支持 Plane external_id 或事件 aggregate_id，不能把工作台 wcp_work_items.id 当作通用别名。跨项目、不可见、缺失或无完整持久快照返回 NOT_FOUND。

SDK 已接入 getObservedProjectState、getObservedWorkItemState、getObservedWorkItemContext；CLI 对应 observed project、observed work-item、observed context，后两者输入 work_item_id。项目命令默认当前项目，显式指定其他项目在客户端拒绝。客户端不写入、不要求请求键，CLI 拒绝 --key；网关自身仍兼容误带键的读取并跳过响应缓存。

共享契约 ObservedSnapshot/ObservedWorkItemContext 核对 scope、请求 ID、实体类型、authority、正安全整数版本、规范 UTC 时间、字段与外部 ID/状态一致性及来源。SDK 和 CLI 另核对外层 trace/source_refs 与正文；上下文解析器核对首条本地摘要对应同一快照及版本，后续命中为同范围 memory/restricted，无重复外部 ID，汇总来源来自实际命中。错误响应不当作可用记录，返回 GATEWAY_RESPONSE_INVALID。服务端持久快照解析和 Plane 外部 ID 校验复用同一契约；没有为旧响应伪造缺少的 scope/版本/来源。

所有这些命令绕过进程内幂等响应缓存，HTTP 响应仍为 private, no-store。MCP 根工作项资源也通过 workitem.state 授权命令读取，不再直接返回 PlaneProjection Map。

## 工作台入口

Web 新增 `/overview/observed` 读取当前项目，以及 `/work-items/observed?item=…` 按外部 ID 或 aggregate ID 查找工作项；概览、工作项列表与本地详情提供入口。本地详情仅携带记录中的 external_id 作为查找值，不能保证它对应 Plane 标识，也未建立两类记录的自动同步。

工作项页面默认只读取 state。用户勾选 Include context 后提交 `with_context=1`，才调用 context 路由；该路由可能使用保存的标题召回外部记忆。入口链接禁用预取，页面不自动回退到另一种读取；上下文失败时可取消选项后重试。表单在缺失、拒绝、认证或请求错误时仍保留。查询拒绝重复参数、未知参数、无效 ID 和非 1 的上下文选项；项目页面不接受查询参数。

Web 服务端在同一次会话读取中生成请求路径和范围头，用实际请求 scope/trace 解析响应，核对共享快照/上下文契约及外层来源。页面展示观察版本、来源事件时间、分类、来源和原始字段；不将来源时间称为数据库提交时间或实时刷新时间。上下文显示本地摘要、外部记忆标记和降级状态，不将 legacy context_pack 称为保存包。字段和来源 URI 按文本输出，不执行 HTML 或自动跳转。

早期工作台接入只新增源码和文档；本次删除观察另依赖未执行的 040 迁移。未编译、类型检查、测试、启动服务或浏览器验证。

## 一次读取的约束

PostgresObservedState 在同一条查询中关联 wcp_projection_states、源事件、对应 plane: 索引及当前项目。要求范围一致、索引 revision/事件 aggregate_version/快照 plane_version 一致、源事件 payload/时间与快照一致、项目未删除，并按当前项目与索引分类过滤 restricted。活动观察要求索引未删除且未过期；删除标记只按上文一致性条件读取元数据。索引缺失或版本不一致不回退内存，也不临时生成无权限依据的记录。

沿用 wcp_context_hits 的当前 classification 作为旧观察快照的可见性依据，返回新增 classification 字段。032 对历史索引默认 restricted；本批不降级旧分类、不补造来源，也不声称已检查本地工作台记录或外部 Plane 的当前权限。工作台本地投影与 Plane 观察快照是两个明确入口，尚未建立自动相互同步。

响应保留 schema_version、scope、entity_kind、external_id、aggregate_id、authority=plane、plane_version、observed_at、source_event_id、source_refs、status 和 fields。来源取持久源事件的完整引用。BIGINT plane_version 仅在正安全整数范围内转换为 number，超界拒绝；损坏/别名歧义返回 OBSERVED_STATE_INVALID（500），存储不可用返回 OBSERVED_STATE_UNAVAILABLE（503）。观察时间表示保存的来源时间，不代表实时从 Plane 拉取或可直接作为写入前置条件。

## 上下文和外部记忆

workitem.context 的本地摘要直接从本次读取的快照产生，不再混用内存索引中的另一版本。原 context_pack 字段保留兼容，但它仍是摘要命中集合，不是可持久绑定的 ContextPackReceipt；新增 backend=postgres、memory_used、vector_used=false。最多返回 1 条本地摘要及 19 条外部记忆。

context.search 与 workitem.context 复用 recallProjectMemory。调用前已有当前项目/记录可见性检查；未分类的外部记忆只向 data.restricted.read 调用者召回。可选 provider 未授权或失败时保留本地数据并标 degraded；MEMORY_REQUIRED 时未配置、权限不足或召回失败均返回错误。工作项上下文在未配置 provider 时沿用 degraded=true。

整批外部结果先核对 scope、ID、revision、正文与来源结构，任一记录异常不保留部分结果；最多接受 1000 条候选、单条 65536 字符和 64 条来源，页面标识须满足 1–255 字符的同步标识约束。按 page_ref 去重后截取，统一标记 rank_source=memory、classification=restricted。召回使用同一个可信项目范围，不代表已验证外部证据，也没有清理本地删除记录的外部副本。

## 写入和恢复边界

Webhook 和内存领域投影接受 ProjectCreated/ProjectUpdated（aggregate_type=project）及 WorkItemCreated/WorkItemUpdated/WorkItemStatusConfirmed/WorkItemDeleted/WorkItemRestored（aggregate_type=work_item）。WorkItemStatusProposed 和其他领域事件不会被当作观察结果。HTTP 已改为持久 inbox 接收和数据库版本顺序检查，版本缺口保留等待，不补造缺失观察事件；删除/恢复的自有 Canonical 入口已开发，完整原生 Plane 删除/恢复事件映射和项目删除仍待开发。

持久化前核对事件、快照与索引的 scope、ID、源事件、字段、来源和版本。数据库投影只允许更高版本覆盖；旧事件不能倒退当前快照。新增接收表保存待处理事件，并按范围/aggregate/别名取得数据库锁；事件、快照、索引、成功回执和处理审计同事务提交，HTTP 不再提前更新内存。启动恢复改为继续扫描持久 pending 记录，不再全量回放内存投影。人工重放、缺口补拉、自动重建与运行证据仍待开发；详见 [接收与重试](plane-inbox-runtime.md)。
