# 项目概览读取（开发状态）

2026-11-05，TODO P0-01新增[完整机器Schema](../../../packages/contracts/schemas/workbench-overview.json)和包子路径，表达全部统计、五层汇总、brief/各组预览及七条来源封套；不新增HTTP路由，尚待统一查询其余模型齐备后建立完整OpenAPI。Schema标注真实日期/合计/唯一预览/读时过期关系需运行解释，brief正文保持任意已保存JSON，无服务端完整响应大小限制。

客户端边界补充：getProjectOverview仍用通用envelope及普通JSON传输，完整数据由共享解析器规范化且project_id需匹配当前上下文；外层未知字段/合法来源扩展会保留，未要求原trace精确相等或七条来源固定集合。普通Fetch默认30秒信号在取得凭据之后建立，没有工作项专用有界JSON的整段凭据等待/2MiB候选/16KiB错误/严格媒体类型保证。本轮仅契约及文档，未编译、测试、运行校验器/生成器/SDK/API/数据库或发布；P0-01/R001未完成、evidence为空。

2026-11-02：仅完成源码与文档修改，未编译、类型检查、测试、启动服务、执行迁移或发布；本批无新增迁移。

## 入口和范围

`POST /v1/workbench/query`，正文仅 `{"operation":"overview"}`，要求令牌身份和 context.read，不要求写客户端或请求键。未知字段返回 INVALID_INPUT。复用 workbench 的策略、审计、限流及 private, no-store 行为，绕过进程内幂等响应缓存。

以 tenant/workspace/project 范围内未删除且可见的项目为查询起点。项目缺失、已删除或不可见统一返回 NOT_FOUND / 404，不再伪造全零项目概览。工作项和上下文排除已删除记录及无权限读取的 restricted 数据；冲突沿用当前来源分类和冲突自身敏感度的可见性规则，既影响总数也影响预览。

单条 SQL 在同一数据库语句快照下返回汇总与预览。各表分别聚合，替代工作项 × 会话 × 冲突的大连接。read_at 为数据库语句时间，last_activity_at 保留原有最近工作项更新、无工作项时项目更新时间的语义，不表示全部表的最新活动。

## 返回字段与口径

响应仍为 WCP 封套，data 使用共享 WorkbenchOverview 类型。保留 project_id/project_name/external_id、全部工作项统计、active_sessions、open_conflicts 和 last_activity_at，新增 read_at 以及：

| 字段 | 含义 |
| --- | --- |
| total_context_items | 全部可见非归档上下文数量 |
| proposed_context_items | 保存状态为 proposed 的数量；不表示当前满足确认条件 |
| expired_context_items | 保存状态 expired，或 expires_at 已到数据库读取时间；两者只计一次 |
| context_layers | 固定 L0–L4，各层 count/proposed/expired 和 average_confidence；空层平均值为 null |
| project_brief | 优先级、更新时间、ID 排序选出的单份 confirmed、未到期 L0；可能为 null |
| proposed_context_preview | 按更新时间倒序、ID 升序最多三份 proposed 摘要 |
| expired_context_preview | 按同顺序最多两份已记录过期或时间到期摘要 |
| active_session_preview | 按启动时间倒序、ID 升序最多四份 running 会话及其运行/工具计数 |
| open_conflict_preview | 按 ID 降序最多三份可见 open 冲突摘要，不返回字段值副本 |

proposed 与 expired 可以重叠；排除状态为 excluded 的条目仍可能已到期，计入过期数。置信度是所有可见非归档条目保存值的均值，包含 proposed/expired/excluded；不能称为来源新鲜度，也不证明外部证据有效。brief 选择只检查保存状态及时间，递归来源新鲜度与审核条件仍在上下文详情和写入时检查。

共享 parseWorkbenchOverview 检查计数非负安全整数、工作项状态合计、五层上下文合计、均值范围、预览数量/重复 ID/状态与读时过期条件。不一致存储返回 WORKBENCH_OVERVIEW_INVALID / 500；数据库不可用返回 503。时间比较在客户端毫秒精度内保守校验，精确过期筛选以 SQL 为准。

## 使用与界面

- SDK `getProjectOverview()`；CLI `workctx overview`；MCP `get_project_overview`。均为只读，CLI 不接收业务 JSON 字段，无需 --key；SDK/CLI/Web 使用共享响应解析器。
- 工作台概览不再读取整份会话/冲突列表或从第一页上下文推断全局计数。概览读取加最多五条工作项预览、独立授权的审计预览；这些额外请求与概览汇总不是跨请求事务快照。
- 运行中会话只显示 running；Proposed Context 使用实际保存状态，不把 confirmed/excluded/expired 泛称为已批准。
- 页面置信度明确标注为已保存均值，空层显示“—”。工作项完成比例为 done / 全部工作项（含 cancelled）；移除由单个计数人为生成的趋势柱图及 LIVE 暗示。
- 查看入口导航至对应任务、上下文、会话、冲突或审计；原生 GET 刷新表单重新读取概览。brief 支持字符串和旧对象正文，页面最多展示 1200 字符，可打开完整详情。

统计和预览仅陈述保存记录，不承诺 Plane 实时状态、来源链当前有效、审批可执行或历史趋势。

## 附属读取失败隔离

2026-11-02 源码增量：概览汇总、最多五条工作项预览和审计预览分别处理读取结果。概览主查询失败仍显示页面错误；工作项或审计预览失败只影响对应面板，保留已取得的正式汇总。仅成功读取的空列表显示无记录；审计 403 显示权限受限，其他错误显示读取失败及可用 trace，不降级为空列表或权限受限。审计成功响应须为对象行数组，格式异常进入该面板的错误分支。

交接页复用正式概览中的 open_conflicts/total_context_items，不再以冲突或上下文列表长度作为全局数量。概览读取失败时两项显示 Unavailable；审计卡片名为 Audit events shown，仅表示返回预览的条数，不表示审计总数。交接队列、概览、审计和可选检查点选项属于独立请求，不构成跨请求事务快照；页面说明该边界。附属请求全部结束后统一渲染，此增量不引入流式加载、自动重试或轮询。

无 API、事务或迁移变更，仅源码和文档开发；未编译、类型检查、测试、运行服务或发布。
