# MCP 接口契约 v1

2026-11-04 项目文件目录增补：新增只读`list_artifacts({query?,classification?,limit?,cursor?})`，已验证未过期客户端且实际artifact.read才可发现/调用。默认20最多20，名称字面子串/ASCII大小写折叠、分类精确、ID倒序，完整next_query显式续页；每页使用当前可见性，非跨页快照。完整响应及权限核验、两笔容量/30秒期限、固定错误见 [项目目录客户端](artifact-registry-runtime.md#命令行与-mcp源码阶段)。不提供新资源、正文、写条件或自动分页；仅源码文档，未编译、测试、调用或发布。

2026-11-04 上传身份读取增补：新增只读工具 `get_artifact_upload_context({})`，发现与调用要求可信未过期客户端和实际artifact.write，admin不代替。返回完整身份/期限/上传上限/读取能力提示；不接受范围/身份/键或额外参数，不准备文件/命令或上传。独立两笔准备容量、30秒本地期限、成功/错误16 KiB、二次转义36 KiB；超时保留底层名额，核对完整原可信身份/期限/能力，错误固定且不重试。见 [CLI/MCP上传身份](artifact-persistence-runtime.md#cli-与-mcp-上传身份读取源码阶段)。仅源码文档，未编译、测试、调用或发布。

2026-11-04 工作项筛选增补：`list_work_item_projections` 新增 priority=P0..P3 和 owner 完整保存文本精确筛选，大小写和首尾空格均有意义，空值规范化为不筛选；MCP schema 建议省略不用的字段。与 query/status 组合，筛选和权限在分页前生效，返回整页再次核对筛选。续读保持原筛选；无新筛选的旧游标兼容，有新筛选时使用扩展绑定摘要。只读本地投影，未新增写操作/账号推断，见 [工作项投影](work-item-projection-runtime.md)。仅源码，未编译、测试、调用或发布。

2026-11-03 原消费者确认增补：acknowledge_sync 必填保存的 expected_identity/cursor，不接收键或版本；get_sync_cursor 可带原 expected_identity，只读当前确认位点/是否已有记录/身份/到期，不能当作原请求历史回执。两工具要求可信未过期 sync.read/admin，读写各自两笔准备容量、30 秒期限，成功 32 KiB/错误 16 KiB；确认派发后异常为 unknown，不自动重试或查询。get_sync_changes 可选原身份前置条件，固定下载和确认同一消费者。见 [原消费者确认](sync-cursor-runtime.md)，仅源码，未编译、测试、调用或发布。

2026-11-03 同步下载源码增补：get_sync_changes 保留 cursor/limit，要求可信未过期 sync.read/admin，以独立两笔准备容量/30 秒期限读取完整单页；成功限 4 MiB，错误限 16 KiB，二次转义结果另限。共享解析核对范围/trace/唯一事件/顺序/来源/续页，不截断、不自动翻页或 ack；Gateway 与 SDK 已接同一解析。旧确认入口尚未迁移，见 [同步变化分页](sync-changes-runtime.md)。仅源码，未编译、测试或调用。

2026-11-03 原同步工具源码增补：get_sync_command_context({}) 和 get_sync_event_receipt({identity,event}) 提供原身份/回执读取；upload_events 现必须传 `{expected_identity,events,idempotency_key}`，保存完整原批次，不继承补键或换身份。三者发现/调用要求可信未过期 sync.write/admin。读取共用两笔准备容量，上传另有两笔；均为 30 秒单调本地期限，超时保留底层名额。上传完整成功封套限 256 KiB，逐事件核对 accepted/rejected；派发后错误统一 unknown、retryable=false，不证明回滚。HTTP 小型 sync 封套余量同时支持原回执和上传。无自动重试、原请求持久保存或本地结算，旧调用需补原身份。见 [MCP 原同步工具](sync-mcp-runtime.md)，仅源码，未编译、测试或调用。

2026-11-03 固定原冲突请求提交源码增补：写工具 `submit_original_conflict({original,reviewed:true})` 固定已保存的完整 identity/request_key/command，要求可信未过期 resolver，外层写条件若存在须与原请求一致；不生成键或重建原参数。成功核对 200/trace 及完整旧决策响应，返回 unconfirmed 和原副本，必须后续明确 get_conflict_receipt 才能确认绑定。工具不提供调用者持久备份或自动重发；旧 resolve_conflict 保留，见 [固定原冲突请求提交](conflict-submission-runtime.md)，仅源码，未编译、测试或调用。

2026-11-03 冲突身份客户端源码增补：`get_conflict_command_context({})` 仅返回当前可信冲突操作 identity、expires_at 和 resolve_conflicts=true。发现及调用要求已验证未过期 resolver，清理继承写条件并固定原上下文，校验 200/trace/完整 16 KiB 内层封套以及原身份/到期一致性。不读目录/详情/回执、不生成键或自动提交，不能覆盖既有原请求身份；未增加 MCP 外层容量/期限保证。见 [冲突原请求保存与恢复](conflict-recovery-runtime.md)，未编译、测试或调用。

2026-11-03 独立恢复身份源码增补：`get_session_command_context({})` 只读当前已验证 identity、expires_at 和 permissions，不读取目录、生成键或查询原回执。要求可信未过期客户端和现有相关能力，完整结果与原上下文比对，不能据此替换保存的原请求身份。见 [独立恢复身份](session-command-context-runtime.md)，未编译、测试或实际调用。

2026-11-03 检查点目录源码增补：`list_checkpoints({query?,checkpoint_id?,limit?,cursor?})` 返回默认 25、最多 100 条的项目页；同名工具可改用仅 session_id/before_revision 获取原每页十条会话历史，两种模式不可混用。项目目录固定范围/筛选/页大小及微秒游标，摘要明确省略、完整封套校验；无新资源 URI 或自动遍历，见 [检查点目录分页](checkpoint-registry-runtime.md)。未编译、测试或实际调用。

2026-11-03 交接目录源码增补：`list_handoffs({query?,status?,session_id?,origin?,limit?,cursor?})` 返回一页完整封套，默认 25、最多 100 条；微秒 updated_at/ID 游标绑定原范围、筛选、受限数据能力与页大小，历史投影只读。既有会话 handoff 资源返回首个 25 条基础页及显式 continuation 工具参数，资源不含个性化权限/所有权标志。移除旧批量 sessions/handoffs 重复注册，新增重复名拒绝；详见 [交接目录分页](handoff-registry-runtime.md)。未编译、测试或实际调用。

2026-11-02 会话目录源码增补：新增 `list_sessions({query?,status?,client_id?,limit?,cursor?})`，沿用 context.read 工作台查询，默认 25、最多 100 条；固定筛选与 limit 显式续读 next_cursor。完整项目/trace/来源/身份元数据和微秒位置校验后返回一页，不自动遍历；无新资源 URI 或写操作。详见 [会话目录分页](session-registry-runtime.md)，未编译、测试或实际调用。

当前 HTTP 实现范围、鉴权、参数、分页与未完成项见 [MCP 运行时开发说明](mcp-runtime.md)。以下为完整目标契约，不表示全部已实现或已验证。

2026-11-02 管理快照源码增补：`get_admin_snapshot({})` 返回完整项目管理查询封套的单项文本 JSON。发现与调用要求可信有效客户端、admin 角色及实际 admin.read；计数按实际 audit.read/context.read，缺权限为 not-authorized，外部状态保持 not-checked。只读工具无额外参数、资源 URI、健康探测、文件保存或自动重试；完整解析、容量/期限/大小边界见 [管理快照](workbench-admin-runtime.md)。未编译、测试或实际调用。

2026-11-02 原回执源码增补：`get_artifact_receipt` 接收保存的 identity 与完整 command，身份必须匹配令牌项目/账号/客户端，发现与调用均要求已验证客户端和 artifact.write。command 严格区分 artifact.create/put-version，原 request_key 和版本不重写；返回匹配原请求的 recorded 历史公开快照或未知的 not-observed。只读查询不上传、下载或自动重试，移除继承写条件，不含外层当前 ETag。详见 [Artifact 原回执](artifact-persistence-runtime.md)；未编译、测试或运行。

## Resources

```text
work://project/{project_id}
work://project/{project_id}/current-state
work://project/{project_id}/overview
work://project/{project_id}/work-item/{item_id}
work://project/{project_id}/plan
work://work-item/{work_item_id}
work://work-item/{work_item_id}/context
work://work-item/{work_item_id}/timeline
work://work-item/{work_item_id}/decisions
work://work-item/{work_item_id}/risks
work://work-item/{work_item_id}/artifacts
work://session/{session_id}/checkpoint
work://session/{session_id}/handoff
memory://project/{project_id}/page/{page_id}
```

## Tools

2026-11-02 会话筛选源码增补：list_audit_records 可提供 session_id ULID，与其余筛选取交集并绑定分页游标，只匹配已记录会话字段。get_audit_record 仍只接受 audit_id；历史未关联记录不补入，入口 allowed 不代表会话命令完成。详见 [审计会话关联](workbench-audit-runtime.md)，未运行或测试。

2026-11-02 审计源码增补：`list_audit_records` 接受精确筛选和手动游标；`get_audit_record` 只接受 audit_id，返回 data.page 与 data.export_preparation。调用方审阅完整记录及省略标记后，`export_audit_record` 接受原 scope/audit_id/sha256 和 reviewed=true，复用 Gateway 重读授权及持久放行，独立核验后返回完整 JSON。发现与调用要求可信客户端、实际 audit.read、有效会话；导出增加实际导出能力。审阅标记不证明人工审阅，历史内容不作为指令执行；无自动保存/重试/替换读取或新增资源 URI。容量与大小边界见 [MCP 运行时](mcp-runtime.md)，仅源码、未编译测试或运行。

2026-11-02 Artifact 上传源码增补：`create_artifact`、`put_artifact_version` 只接收保存的 request={identity,command} 和规范 content_base64；实际 artifact.write、已验证客户端、有效会话和原身份相等是发现/调用前提。解码最多 4 MiB，原 request 最多 1 MiB，核对原长度/hash 后复用持久上传事务；原键/追加版本只取自 command，不接受外层写条件、不生成新键或自动重试。成功返回原历史上传封套，未知结果保留原请求并显式查 get_artifact_receipt。HTTP 在正文前鉴权，普通 JSON 限 1 MiB，writer 超限扩容至 8 MiB 前取得共用容量；小型未知长度查询不占上传名额。仅源码，未编译、测试、实际上传或运行，详细边界见 [MCP 运行时](mcp-runtime.md)。

2026-11-02 Artifact 下载源码增补：`download_artifact_version` 要求 artifact_id/version/sha256/size，来源为选中的历史元数据。实际 artifact.read、可信客户端和有效会话是发现及调用前提，仍需当前/历史导出权限与持久审计；正文限 4 MiB 和服务器配置上限中的较小值。完整封套及独立 SHA-256 核验后返回摘要文本与 application/octet-stream 内嵌 base64 resource；URN 仅为内容标识，不新增 resources/read 下载地址。服务端放行与客户端交付状态分开，不写客户端文件、不重试或退回当前版本。HTTP MCP 共用二进制下载容量至发送结束；详见 [MCP 运行时](mcp-runtime.md)。仅源码，协议/client 兼容性与运行证据待核对，未编译测试或实际下载。

2026-11-02 Artifact 源码增补：`get_artifact` 只接收 artifact_id，`get_artifact_version` 还要求正安全整数 version；发现工具必须具有 artifact.read，调用复用同一元数据 GET/策略/授权决定审计。结果不含存储键/正文/下载地址，content_state=not-checked；历史结果没有外层 ETag，不确认原上传回执。禁止额外身份/写入字段，清除继承写条件。未编译、测试或运行，见 [Artifact 读取](artifact-persistence-runtime.md)。

2026-11-02 源码增补：`get_session_checkpoint` 仅用 session_id/checkpoint_id 按 context.read 获取历史检查点详情，返回原笔记、引用、保存时间及固定 not-checked，不依赖列表页、不确认原请求键；未编译测试或运行验证，见 [检查点读取](checkpoint-context-runtime.md)。

2026-11-02 源码增补：`get_session_state` 接受唯一 session_id，以 context.read 返回当前 status/version/ended_at、scope、trace、来源和可信身份提示；当前状态不替代原命令回执。没有新增迁移，未编译、测试或运行验证，详见 [活动明细](session-activity-runtime.md)。

`get_project_context`、`get_work_item_context`、`create_work_item`、`update_work_item`、`record_checkpoint`、`create_handoff`、`accept_handoff`、`record_decision`、`record_risk`、`attach_artifact`、`search_project_context`、`memory_read_page`、`memory_query`、`resolve_conflict`、`request_approval`。

## Prompts

`resume_work`、`prepare_handoff`、`review_current_plan`、`analyze_blockers`、`summarize_recent_progress`、`prepare_status_report`。

## 安全规则

MCP server 不直接连接 Plane/数据库；每个 Resource/Tool 先做 scope check 和 capability check，再生成审计；ai-memory MCP 只能通过受控 Adapter 暴露，不能把内部管理工具直接暴露给普通客户端。

## 能力协商

客户端声明 MCP protocol version、resources/tools/prompts、上下文预算、是否支持 streaming、是否支持 local files 和 handoff claim。服务按声明降级为 REST/CLI/Markdown。

2026-11-02 源码增补：`get_session_handoff` 仅用 handoff_id 按 context.read 获取当前交接、归属及原会话/检查点引用，不需要写入客户端；不确认原请求结果或上下文有效性。未编译测试或运行验证，见 [单条交接读取](handoff-read-runtime.md)。

## 冲突独立详情源码增补（2026-11-03）

新增 get_conflict({conflict_id})，按 context.read 发现和调用，独立读取完整冲突详情。返回原三层范围、ID、trace/来源、十进制字符串版本和保持数值精度的 JSON 文本值；SQL NULL 与 JSON null 分开，旧决策缺失信息明确标记。内层业务封套限 2 MiB，失败不返回部分值；不自动解决、不确认原请求，也不证明已应用到来源实体。MCP 外层发送和独立期限没有新保证，见 [冲突独立详情](conflict-read-runtime.md)。仅源码，未编译或测试。
