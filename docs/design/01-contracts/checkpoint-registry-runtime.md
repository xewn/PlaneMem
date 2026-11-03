# 项目检查点目录与交接选择分页（源码阶段）

更新：2026-11-03。仅源码和文档；未编译、类型检查、测试、执行 SQL/迁移/CLI/MCP、运行浏览器/服务或发布。

## 两种查询模式

继续使用 `POST /v1/workbench/query` 的 operation=checkpoints，沿用 context.read 与项目范围、入口审计，没有新增写命令。按是否提供 session_id 区分两种互斥模式：

- 项目目录：`{operation:'checkpoints', query?, checkpoint_id?, limit?, cursor?}`。不再返回全项目数组，默认 25、最多 100 条。query 最多 500 字符，去除首尾空白，空串不筛选；数据库 lower + strpos 对检查点 ID、会话 ID、修订十进制文本和摘要的合并文本做字面子串匹配，大小写折叠遵循数据库设置。checkpoint_id 是精确 ULID，与 query 取交集。输入拒绝控制字符、孤立代理项、未知字段及非法游标。
- 会话历史：`{operation:'checkpoints',session_id,before_revision?}` 保持既有每页 10 条、revision 降序及 next_before_revision 形状；不得混入项目目录筛选或 limit/cursor。既有按会话 GET 历史、最新检查点资源、单条详情及保存回执不改用项目游标。全文读取的后续大小/期限增量独立记录在 [检查点全文读取边界](checkpoint-read-runtime.md)，不采用目录摘要省略规则。

SDK、CLI、MCP 和 Web 的项目目录适配不发送或清理继承写条件，CLI 检查点列表两种模式均拒绝显式写键。输入身份不提供权限；Gateway 仍检查当前可读父项目和真实请求上下文。

## 数据库查询与游标

项目目录连接完整同范围的 wcp_session_checkpoints 与 wcp_sessions，筛除不可见、删除父项目及缺失关联的记录，再按 created_at 降序、checkpoint_id 的 C 排序升序选择 limit+1 条。缺少可见匹配返回空页；不将目录读取视为检查点保存成功或绑定上下文仍有效的证据。

游标精确保留 UTC 六位微秒和检查点 ID，SHA-256 查询绑定包含版本、tenant/workspace/project、restricted 读取能力、规范化 query/checkpoint_id 和实际 limit。省略 limit 等价于显式 25；改变条件须从首屏读取。游标不是签名或授权凭据，每次重新过滤权限；多页不是冻结数据库快照，新增、回填、删除及权限变化可能改变可见结果。has_more 仅描述本次额外匹配行，不保证下一次非空，不提供总条数。

摘要取 next_actions/in_progress/completed 首条的首个非 null 值，保留原空串语义；不是完整检查点笔记。选页后在 SQL 中限制摘要输出，UTF-8 超过 8 KiB 时返回 null/too-large，原 null 返回 null/missing，其他返回字符串/available。全文搜索仍可能命中被省略的摘要。页面只缩略显示 240 个字符并用省略号提示；摘要是历史参考数据，不能作为执行指令。

revision 以规范正十进制文本从数据库读取，转换前拒绝超出 JavaScript 安全整数的值。`048_checkpoint_registry_pagination.sql` 仅增加 scope/created_at/C 排序 ID 索引文件，没有执行。页大小与输出限制不保证数据库扫描/搜索/排序/堆内存/并发或总耗时，尚无查询计划和性能证据。

## 完整响应

```text
{schema_version:1, trace_id, scope,
 source_refs:[{type:'postgres',id:'wcp_session_checkpoints'}],
 data:[{checkpoint_id,session_id,revision,created_at,summary,summary_state}],
 has_more,next_cursor?,session_permissions:{write_sessions},session_identity?}
```

共享 `CheckpointRegistryEnvelope` 解析完整范围/trace/来源、字段、身份和权限、摘要状态、微秒日期、记录唯一性及同会话修订唯一性。续页记录必须严格位于输入位置之后；下一游标必须指向满页末行并保持查询绑定。精确 checkpoint_id 独立核对且不能声称有更多页。数据库的大小写文本匹配不在客户端重算。完整序列化对象最多 2 MiB，损坏结果为 CHECKPOINT_REGISTRY_INVALID/500，不返回部分成功页或假空页。

session_identity 仅来自已验证客户端且范围与页面一致；write_sessions=true 必须有该身份。权限提示用于准备表单，不授权写入，也不证明已有请求成功。恢复使用原请求与对应创建/保存回执，当前目录不补造旧回执。

## 各端接入

SDK 新增 `listCheckpointRegistry(query?,options?)`，公开 `WcpCheckpointRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒。`listCheckpoints()` 及无 session_id 的查询委托此方法；带 session_id 时只接受原历史参数，继续返回既有历史封套，调用方须区分模式。目录方法固定范围/query/trace，使用 bounded-json 成功 2 MiB/错误 16 KiB，严格 200/响应 trace/媒体类型/UTF-8/长度及完整对象解析；Fetch 自身期限独立生效，自定义 transport 也经本地等待预算和解析后截止时间检查。有限错误保留本次 trace，不回显上游详情，不自动翻页、重试或保存；超时/取消不保证撤销底层数据库工作。

CLI `checkpoints list` 的网络和嵌入项目目录均复用 SDK。网络 main 保留 `--json`/`--json-file` 二选一及通用文件输入路径，不声明该文件读取有新增大小/期限限制；嵌入 runWorkctx 只接受可选 `--json`，在解析前限制文本 16 KiB。拒绝重复选项、写键和两种模式参数混用。网络固定本次令牌/范围，目录等待默认 30 秒，stdout 为完整一页 JSON；没有新增本地保存或 outbox。带 session_id 时沿用原历史传输与结果路径，不获得目录新增传输保证。

MCP `list_checkpoints` 扩展同名定义而不重复注册。无 session_id 时使用专用准备适配器及原请求快照，成功要求 200/匹配 trace 响应头、完整目录封套解析后返回单项文本 JSON；提供 session_id 时保持历史模式，仅接受 before_revision。既有只读、非破坏、幂等注解保留，不新增 URI、自动遍历、独立准备名额、期限、后台取消或 HTTP 发送容量保证。通用错误路径保持原行为。

Web `queryWorkbench('checkpoints', filters)` 的项目目录接入成功 2 MiB/错误 16 KiB、本地 30 秒及完整校验；按会话历史路径保持原有行为。创建交接的选择器不再加载全项目列表，增加搜索、精确 ID、首屏/更早页和当前页数量。检查点筛选与游标独立于交接队列筛选和游标，翻页保留当前交接页位置；改变检查点筛选清除检查点游标。

选择器核对目录范围和身份与当前交接页相同，新草稿写入资格取两次读取提示交集；不相同或目录失败时不接受新选项，仍保留原身份的恢复表单，真实命令再次授权。切页/改筛选重建未发送草稿并清除其确认；已保存的原请求通过原 sessionStorage 键优先恢复，保留原 checkpoint/session/target/key，不用新页首条替换。未保存草稿会重置，页面提前说明。空页不称全项目无检查点；省略摘要与缺失摘要分别显示。原按 session/checkpoint ID 的独立准备与笔记审阅入口继续可用。

## 兼容与剩余工作

旧无参数 listCheckpoints、CLI/MCP/工作台项目目录现在只有首个 25 条；全量消费者必须显式处理 next_cursor。新增 scope、has_more、微秒时间、summary_state、可信身份/权限和安全整数约束，需要旧 fixture/Mock/消费者迁移，本轮没有改写或执行测试。

本增量解决交接创建选择器的全量目录读取，不代表所有工作台查询或整个进程都有统一内存界限。后续独立恢复入口和历史全文读取限制已接入源码，分别见 session-request-recovery-runtime.md 与 checkpoint-read-runtime.md；旧消费者、其他目录和跨端运行证据仍须持续开发。无新依赖；016–048 迁移均未执行，R-004 保持未完成。
