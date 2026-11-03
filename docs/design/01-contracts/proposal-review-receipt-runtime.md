# 原审核回执只读查询

2026-11-04，仅源码和人工审阅。未编译、类型检查、测试、运行产品/接口/Mock、打开数据库或发布，无新增依赖、结构或迁移。

## 原请求和入口

`POST /v1/proposals/review-receipt` 对应 `proposal.review.receipt`，查询已有审核决定，不执行确认、拒绝或幂等写入重放。正文为完整 `{identity,request_key,proposal_id,decision,expected_revision,reason}`；identity 是原 tenant/workspace/project/actor/client，decision 精确为 confirm 或 reject。请求不含原网关地址，调用方按已保存的绑定选择网关。

共享解析拒绝缺失或额外字段、非 ULID 建议 ID、无效身份/键、非正安全版本及加一溢出。reason 沿用审核命令的非空、2000 字符与字符约束，必须已经规范化，查询不 trim 或补默认值。身份与原键保持可见 ASCII 约束。JSON 请求最多32 KiB，完整成功响应最多64 KiB；拒绝 URL 查询、非 JSON UTF-8、压缩正文、幂等键、版本头和缓存/范围条件。原 expected_revision 属于查询内容，不是修改前置条件。

需要未过期、已验证客户端，human 身份及 proposal.review 或 admin；管理员仍受 human 与当前受限来源可见性约束。可信原五项身份必须完全一致，不能从正文声明授予权限。HTTP 与项目内分发入口拒绝写入条件；普通策略及查询决策审计仍执行。“只读”指建议、命令和同步事件业务记录不变，不表示禁用审计。

## 同一快照核对

网关使用 repeatable read read only 事务，无行锁、写入、游标推进或结构初始化。先按已知原建议 ID 检查当前项目、建议、本地来源及最多32层派生链可见性；即使原命令尚未记录也不能绕过当前可见性。可见但已过期或来源变旧不阻止查询历史结果，也不证明当前可以再次确认。

复用原 actor/client/key 命令键和 `[decision,proposal_id,expected_revision,reason,undefined]` 指纹，尾部位置和原审核命令保持一致。不存在命令才返回 not-observed；同键异文返回 IDEMPOTENCY_KEY_REUSED。存在时核对建议 ID、最终状态、revision=expected_revision+1、原审核账号/客户端/理由/时间，以及已有 ApprovalCompleted 事件的范围、事件 ID、游标、trace、聚合版本、actor/client、时间、分类、完整来源和 payload。缺失、损坏或不匹配返回错误，存储错误不解释为未记录。返回前再次检查会话到期。

成功封套仅含 schema_version、trace_id、source_refs、data，data 完整回显原查询：

- `status: not-observed` 无 receipt、无来源。只表示此快照未观察到原命令，不证明失败、不取消在途请求，也不允许自动换键或重发。
- `status: recorded` 附 `{proposal_id,status,revision,event_id,occurred_at,server_cursor,current_state:'not-checked'}`，status 为 verified/rejected，与原决定对应。唯一 proposal 来源精确对应原 ID 和历史修订。没有外层 ETag，不声称当前来源、当前内容或任何后续物化有效。

客户端校验全部原查询回显、trace、字段、状态组合、事件 ID、规范 UTC 时间、正安全游标及来源。原请求始终保留，当前建议详情另行读取；旧缺失原请求不能凭当前状态补造。

## SDK、Mock 与 Web

SDK `getProposalReviewReceipt(original, {timeout_ms?,signal?})` 不继承构造器写条件，不自动重试。原三层范围和已提供的 actor/client 必须匹配，发送预期原身份头，默认本地等待30秒，成功响应64 KiB、Fetch错误16 KiB。自定义传输须支持 bounded-json/signal；完整结果解析后再检查期限，错误使用固定说明和 retryable=false。

`MockProposalStore` 与 MockWcpServer 同样接入该路径。配置会话需未过期human且review_proposals，原身份、项目/来源/派生链可见性在缺记录前检查；同键异文拒绝，recorded 核对内存原审核命令和建议审核字段。不改变建议、命令或游标，不要求额外read_proposals/create_proposals。Mock没有真实事件账本、数据库快照、网络、审计或持久恢复，返回定位信息仅属模拟，不能作为真实证据。

Web原审核页面及恢复页面中的 Check original review result 可独立执行，不要求浏览器先保存，也不要求发送确认。服务器先核对原网关与可信submission-context，再发送完整查询；每个网络请求30秒，浏览器动作等待30秒，超时不取消此前的在途审核。查询前撤销发送确认，查询期间锁定同一组件操作；迟到结果不应用。recorded 显示历史回执并收起发送表单；not-observed、拒绝或读取异常保留完整原请求，既有已确认历史回执不被后一次失败清除。不自动保存/清理原请求、持久化回执、导航或重发。

CLI/MCP审核专用查询适配、持久审核回执历史、审核原请求整批备份/清理、未准备审核草稿和运行权限/兼容证据仍未补齐。现有创建回执入口保持独立。
