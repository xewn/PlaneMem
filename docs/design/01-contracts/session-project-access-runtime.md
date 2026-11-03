# 会话活动与历史回执的项目可见性

更新：2026-11-02。仅源码和文档开发；没有编译、类型检查、测试、服务运行、迁移执行或发布。无新迁移，016–044 仍未执行。

## 边界

会话、检查点、交接和运行/工具明细属于三层 tenant/workspace/project 范围。相同 project_id 或 session.write/context.read 不替代父项目可见性：父项目必须同 tenant/workspace、未删除、classification 属于 public/internal/confidential/restricted；restricted 还要求本次可信上下文含 data.restricted.read。无效分类不放行，admin 显示提示不替代该能力。

新增 Gateway session-project-access.ts。visibleSessionProject 生成参数化 SQL 条件，嵌入实际读取语句；不能将查询结果缓存为权限。lockSessionProject 在调用方写事务内共享锁定可见父项目，再执行会话/交接锁和回执读取。read_restricted 仅由 Gateway 从已验证 capability 计算，业务正文不能授予该权限，回执和实体不保存该标记。

## 活动读取

session.run.read、session.tool.read 在同条 SQL 中过滤可见父项目，再输出对应明细及会话版本。项目不可见、已删除或会话不在范围内统一 SESSION_NOT_FOUND，不披露原记录是否存在。

session.runs.list / session.tools.list 改为单语句：外层读取可见父会话，LEFT JOIN LATERAL 在该会话内按原分页顺序读取 limit+1 条明细。工具页同时检查原 run_id 是否属于当前会话，避免先读父会话/运行后再另行取明细。可见会话无结果时返回空页；不存在或不可见的父会话返回错误。工具记录继续要求同一会话的有效父运行。

每页父会话摘要、run_id 存在性和明细来自同一语句快照。分页之间仍为实时读取，并非冻结会话的完整导出；翻页时权限、状态和新增记录可能变化。游标、页大小、排序和公开响应形状不变，不增加记录总数或不可读数据计数。

## 只读历史回执

进度命令、检查点和续接回执在同条查询中取得可见父会话，再左连接原请求记录。父会话不可见或不存在返回 SESSION_NOT_FOUND；只有可见父会话存在而没有匹配成功记录时才返回 not-observed。权限拒绝不伪装成不存在历史记录；拒绝或 not-observed 都不是换键依据。

进度命令仍用原 actor/client/键摘要、操作和会话定位历史成功，核对原指纹及历史快照。检查点回执要求检查点与父会话范围一致，只返回原标识、修订号和可选包 ID，包状态仍是 not-checked。续接仍用原已认证 actor/client/原键，在可见原父会话下关联该项目的原键记录；其他父会话占用同一键仍返回冲突。legacy-unverified 保持原语义，不给旧记录补造来源。

查询不更新项目、会话或历史，不创建/结束会话、不领取交接、不验证包当前可用性。trace、空来源及最小响应形状保持不变；存储错误仍是存储不可用。开始、交接创建和领取回执此前已有项目过滤，本增量补齐较早的进度、检查点和续接查询。

## 写入与重放

PostgresSessionStore.mutateSession 对 run.start/run.finish/tool.call/tool.finish/end 先共享锁定可见父项目，再锁会话。原成功回执重放同样检查本次项目权限。项目锁持有到事务结束，并发修改项目删除/分类与本次写入按数据库锁序排定；这不保证请求结束后权限继续不变。

appendCheckpoint 也先锁项目再锁会话；回执重放及最新修订查询绑定会话与三层范围。ContinuationService.createCheckpointAsync 在持久适配器提供 appendCheckpoint 时每次进入该边界，不再提前返回进程内成功快照。无存储的域内离线实现和旧非原子适配器兼容路径保留，不能视为具备该持久项目边界。

旧 updateHandoff 路径（含续接内部调用）先锁项目，再核对同范围交接→检查点→会话并锁交接。持久 findSession/findCheckpoint/findHandoff 读取也检查项目；getCheckpointAsync 每次使用持久读取并移除不可见/缺失缓存条目。无包续接沿用外层会话事务，有包续接沿用已有包授权/事务，并在内部写入时再次应用项目边界。

进度写入、检查点、旧无键领取和续接要求已验证客户端。正文显式 actor_id/client_id 必须与可信 context 一致；续接和旧领取使用可信身份生成写入，不允许自报另一主体。带键领取和普通开始沿用各自已有的严格身份解析。

## 客户端与证据

公开请求形状没有新增权限字段。Web、SDK、CLI 和 MCP 继续使用原身份、参数、版本和键，Gateway 判断当前项目权限。权限消失后，已有未知结果仍保留原请求；重新具备读取条件后再查询，不能根据 404、403、空列表或当前终态推断原请求失败。活动端点仍需 context.read；回执和写入遵守各自 session.write/领取策略。

以上为源码行为描述，仍缺项目删除/分类变更与并发写入的锁行为、restricted 能力变化、旧键重放、跨项目错误关联、活动空页和筛选运行、已有缓存后的拒绝、续接事务回滚及客户端保留未知状态的运行证据。没有新索引或迁移，未运行验证命令。
