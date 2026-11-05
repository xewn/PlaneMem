# 检查点全文读取边界

2026-11-05，TODO P0-01：新增 [continuity-reads OpenAPI](../../../packages/contracts/openapi/continuity-reads.json) 与 [checkpoint-read Schema](../../../packages/contracts/schemas/checkpoint-read.json)，完整描述公开历史 GET 和指定详情 GET，工作台历史仍为独立封套。复用 session-activity-read 公共来源/标量；没有修改运行实现或既有解析器。

机器契约补充：历史第十一条位置 ID/修订/排序/唯一性会核对，payload 必须 null，笔记和日期不解析；前十条保存 trace/旧无 ID 包 hash 没有详情的 4096 UTF-16 单项上限。详情 state_hash/记忆 hash 不重算，记忆扩展保留并检查 JSON 深度最多 32，其来源只按 type/id 被包含，不要求来源 revision/URI 相等。历史不返回 state_hash/memory_ref/内部来源，详情固定 context_pack_state=not-checked。候选封套字节检查位于日期规范化之前，发送阶段没有再次独立核验；此处不新增全进程内存或 SQL 取消保证。HTTP 原存储错误可 retryable=true，专用 SDK 将有限错误净化为 false。P0-01/R-001 未完成、evidence 为空；未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

更新：2026-11-03。仅开发源码与文档；未编译、类型检查、测试、启动服务、调用接口、执行迁移或发布。R-004 仍未完成。

## 完整响应

| 入口 | 完整成功 JSON 的 UTF-8 上限 | 返回形状 |
| --- | --- | --- |
| GET /v1/sessions/{session_id}/checkpoints/{checkpoint_id} | 2 MiB | 原检查点详情封套，包含六类完整笔记及历史引用 |
| GET /v1/sessions/{session_id}/checkpoints | 8 MiB | 原项目范围封套，最多十条修订及 next_before_revision |
| POST /v1/workbench/query，operation=checkpoints 且有 session_id | 8 MiB | 原工作台历史封套，保留 session_identity/session_permissions |

成功只包含完整记录或完整一页。超限由 Gateway 返回 HTTP 413 / CHECKPOINT_READ_TOO_LARGE，不缩短笔记、不删减页内记录、不返回空页，不生成一个绕过失败页的下一页游标。历史仍按安全整数 revision 严格降序，每页最多十条，显式传回 next_before_revision。项目目录继续使用独立的 limit/cursor 和摘要省略契约。

这些是读取限制，不删除或改写已存记录。旧超大记录可能不能通过全文入口读取；已知其他检查点 ID 或修订位置时可以另行查询，不能把一次失败当作记录不存在、会话无历史或原保存失败。历史记录不是请求回执，也不证明引用仍有效。

## 服务端与共享解析

详情在同一 SQL 语句内核对项目可见性、父会话、检查点归属后生成 JSON；SQL 输出前检查字节数，超限只输出有限标记，不把超大笔记送回 Node。历史先选十条加一条位置记录，仅前十条构造笔记 JSON；合计超过预算时整页仅返回位置与超限标记，第十一条不输出全文。

SQL 正文预算保守预留 16 KiB 给封套、范围、追踪、来源及身份；数据库 JSON 文本开销可能比最终响应更大，因此接近上限也可能提前拒绝。共享解析器再次检查整个封套及所有笔记、来源、身份/范围、修订顺序和游标。工作台历史使用 parseCheckpointHistoryWorkbenchEnvelope 保留并验证权限提示，public GET 保留自身范围字段。两者不互换。

数据库内部 JSON 构造、查询扫描、整个进程分配以及已解析自定义 transport 对象不因此获得统一内存上限。原数据库查询超时策略没有扩展；客户端停止等待不能证明数据库查询已取消。

## SDK、CLI、Web 与 MCP

SDK getSessionCheckpoint(sessionId, checkpointId, options?)、listSessionCheckpoints(sessionId, input?, options?) 和 listCheckpoints(input?, options?) 的会话历史分支使用 bounded-json。WcpCheckpointReadOptions 提供 timeout_ms/signal，默认本地等待 30 秒；Fetch 自身配置的期限也独立生效。固定请求范围、目标、trace 和原身份前提，成功必须 200/匹配追踪头、合法 JSON 媒体类型、UTF-8 和完整长度，错误正文限 16 KiB。自定义 transport 同样经过等待预算、完整对象解析及解析后截止检查。错误为有限代码和本次 trace，不回显上游正文，不自动重试、翻页或保存文件。

CLI 网络 checkpoints get/history 以及带 session_id 的 checkpoints list 复用 SDK，默认 30 秒和相同字节上限，禁止写键。嵌入 CLI 对这三种完整结果复用共享解析；没有为嵌入调用新增独立期限。

Web 详情与工作台历史的网络读取使用对应成功上限、错误 16 KiB 和 30 秒本地期限；读取完成和解析后检查截止时间。超限、超时、缺失及不可用使用有限错误，不展示不完整笔记。历史笔记保留换行、空串及长文本换行。失败页保留按会话/检查点/已知修订号查找、最新历史及同标签页原请求恢复入口；没有通过失败响应猜测游标。独立恢复仍依赖可信身份和原请求，不从历史记录合成写版本或键。

MCP get_session_checkpoint、list_session_checkpoints 和 list_checkpoints 的会话历史分支固定原请求快照，成功核对 200/trace 后复用完整共享解析。这里的 2/8 MiB 是内层业务 JSON 上限；MCP 文本二次转义、JSON-RPC 外层和发送阶段没有新增字节、准备并发或期限保证。原资源读取也不因此获得独立网络读取上限。

## 待补证据

当前仅完成源码衔接。真实 PostgreSQL 查询与空父表/空历史、边界大小及转义差异、前瞻记录、巨大旧数据、慢响应/凭据/正文、取消、错误封套、原身份/游标不匹配、CLI/MCP 兼容、页面导航和恢复仍缺运行证据。旧 fixture/Mock 和消费者兼容继续列为待办。无新 API、依赖或迁移；016–048 迁移均未执行。
