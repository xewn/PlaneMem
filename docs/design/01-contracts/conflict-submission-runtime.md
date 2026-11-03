# 固定原冲突请求提交

更新：2026-11-03。仅源码与文档，未编译、类型检查、测试、执行示例、运行服务/浏览器、执行迁移、部署或发布。R-006 仍未完成。

## 原请求与写入

新增 SDK `submitConflictDecision(original, options)`、CLI `conflicts submit` 和 MCP `submit_original_conflict`，共同接受已保存的 [原请求格式](conflict-receipt-runtime.md)：identity、request_key、完整有效 command。它们沿用 `POST /v1/conflicts/{conflict_id}/resolve`，没有新 Gateway 写路由、幂等算法或数据库字段。

每次发送前固定原请求副本；完整原 command 作为正文，包括有效 conflict_id、expected_version、resolution、适用 merged_value 以及原来存在的额外字段。原 key 进入 Idempotency-Key，原 expected_version 进入 If-Match；不会从当前详情补参数、修改版本/选择、生成键或自动重试。预期 actor/client 头仅约束服务端已经验证的身份，原请求不是凭据。Gateway 的父项目/来源可见性、旧键/指纹与持久事件检查仍执行。

SDK 始终要求原三层范围等于客户端范围，并检查客户端上下文中已提供的 actor/client 约束。未提供这两项时仍发送原请求的完整预期身份，Gateway 必须对可信五字段身份完全核对。这个安排同时用于 getConflictReceipt，解决通用 SDK 构造器的 actor_id 仅接受 ULID、但可信 OIDC sub 可能是普通字符串的适配问题；不放宽通用 RequestContext 或 Gateway 身份验证。普通字符串账号可用三层范围与 trace 构造 WcpClient，完整原账号保留在 original.identity 中。SDK 现有范围格式约束仍适用。

## 完整写响应与未知结果

共享 `parseConflictSubmissionResponse` 完整检查旧写封套及 ConflictResolved 事件：schema、当前请求 trace、冲突 ID/选择、原 expected_version+1、revision/ETag、正安全 cursor、事件 ID/类型/范围/聚合规则、原 actor/client、标准 UTC 时间、事件 trace、来源一致性、事件目标字段、基础/双方版本和 resolved_value 字段存在性。merge 额外与原 merged_value 做完整规范 JSON 比较。事件 trace 在重放时可与当前请求 trace 不同；非 ULID 冲突 ID 沿用原 writer 的 event_id 聚合规则，非 ULID 账号只保留在事件 payload.actor_id。

不完整、未知字段、超限、来源不一致、身份/版本/选择/merge 不符均拒绝整份响应。成功正文最多 2 MiB，JSON 有限值、复杂度和深度规则沿用原回执解析；数字仍是 JavaScript JSON 语义，不是任意精度写入。local/server 原命令没有复制值，解析不能据此独立证明选中内容等于某个历史来源。

即使解析通过，旧写响应也没有完整原键绑定，因此客户端只返回本地规范化的 `ConflictSubmissionEnvelope`：schema_version=1、当前 trace、空 source_refs，data 包含 status=unconfirmed、完整 original、next_action=check-original-receipt、source_application=not-checked。original 是调用者的固定副本，不是从数据库找回的原命令；不输出复制值、事件或新的可写版本。此结果不等同于 recorded，不证明源实体应用。必须显式调用既有原请求回执接口，只有匹配的 recorded 可确认绑定。

Web 固定原请求提交已接入同一完整解析，保留现有保存/读回、忙碌保护、再次确认和显式查询流程。任何写入错误、响应损坏或本地超时仍保留原请求；不能因错误声明原决定失败，也不能换键/版本继续。

## SDK

`WcpConflictSubmissionOptions` 必须有 reviewed=true，可选 timeout_ms（1–2147483647，默认 30000）与 signal，拒绝其他字段。reviewed 是调用者对明确提交的确认，不代替服务端授权，也不证明调用者已完成持久备份。

发送仅使用原请求生成的八个范围/身份/trace/写条件头，不继承客户端上下文中的其他写条件。Fetch bounded-json 核对 200、媒体类型、UTF-8 与响应头 trace，成功最多 2 MiB、错误最多 16 KiB；完整解析之后再次核对本地期限。有限错误映射保留相关错误码、当前 trace 和固定说明，retryable=false，指向保留原请求与显式回执查询；不会自动查回执、重新读取身份或重发。signal/期限停止本地等待，不保证已发送事务取消。

调用者应先持久保存 original，再明确发送。SDK 自身不写文件/outbox，不创建新请求或备份。通用 `resolveConflict` 兼容保留，其旧响应处理和原请求保存职责没有由新方法自动接管；外部消费者仍需迁移。

## CLI

新命令格式（仅文档示例，未执行）：`workctx conflicts submit --json-file original-conflict.json --reviewed`，可选 `--timeout-ms 30000`。网络和嵌入均只接受已存在的原请求文件，拒绝 --json、stdin、--key、队列选项、未知/重复参数及多余位置参数。通用主入口在其他 JSON/文件/键处理前分流，因而不会误用旧无界 JSON 文件读取。

文件读取复用已有正规文件检查、限定大小分配、分段读取、额外字节和前后文件属性比较；原始文件最多 1,000,000 字节，UTF-8 严格解码，再检查完整规范原请求与当前三层范围。文件不可读/变化/超限报 CONFLICT_REQUEST_FILE_UNAVAILABLE；参数、格式或原身份/外层条件不匹配在派发前拒绝。不会创建、修改、删除或替换原文件。此读取没有锁住之后的文件变更，也不保证操作系统持久存储；调用者必须保留相同原副本。

网络使用文件原 actor/client 作为令牌相等前置条件。嵌入调用还独立要求可信未过期 resolver，核对原五字段身份；已有外层 key/version 若存在必须等于原值。适配器核对固定 POST 路径、八个头、完整正文和 bounded-json 参数后才派发，并在返回时再次检查权限有效期。两者共用 SDK 的完整响应解析；SDK 本地期限在文件读完后开始，不是文件打开/磁盘读取期限。

stdout 返回完整规范化 unconfirmed 封套；退出码 0 只表示这次响应已解析，不表示原回执已确认。失败不会删除文件或排队重试。另行明确运行 `conflicts receipt` 查询原请求；not-observed 仍不是失败证明。旧 `conflicts resolve` 保留原兼容行为，不自动转换成此文件流程。

## MCP

`submit_original_conflict({original, reviewed:true})` 是写工具；发现与调用要求 authenticated_client=true、未过期、conflict.resolve 或 admin。入参只允许这两个字段；original 使用共享完整回执格式并保留 command 额外字段。不会要求顶层新 idempotency_key，也不会从继承上下文补出新原请求。外层 Idempotency-Key/If-Match 若存在必须匹配原值，否则派发前拒绝；原 identity 与可信上下文完全匹配。

准备后复制完整请求；协议核对成功 200/原 trace，结果解析使用调用前保存的副本，不从被执行层修改后的对象恢复参数。结果只输出上述 unconfirmed 封套，需后续明确使用 get_conflict_receipt。reviewed=true 不代表客户端已经保存文件，工具不会代替调用者持久备份。没有新资源 URI、MCP 外层编码/转义/发送容量/期限或全局内存保证。原 resolve_conflict 兼容保留；不能把新工具结果当成旧格式完整事件。

## CLI 新请求文件准备

`workctx conflicts prepare --json-file decision.json --output original-conflict.json` 新增显式的新决定准备入口；可选 `--timeout-ms`（1–2147483647，默认 30000）。网络与嵌入均先拒绝已有输出目标、读取有界正规 UTF-8 命令文件，然后只调用既有冲突身份入口取得当前可信 identity。输入是完整 command 对象，必须明确 conflict_id、expected_version、resolution，以及仅 merge 时存在的 merged_value；安全整数规则与原提交相同，额外原字段保留。命令中的身份字段若存在必须匹配可信身份。不会读取当前冲突来更新版本或补选中值。

该入口只为新决定生成一次 `workctx-conflict-` 前缀的 ULID 请求键。拒绝原请求封套的 identity/request_key/command 字段及已有 idempotency_key、命令行 --key、内联 JSON、stdin、未知或重复选项；嵌入也拒绝继承写键/版本。既有原请求必须交给 submit/receipt，不能再次 prepare。输入文件与完整规范原请求分别限 1,000,000 字节；身份成功响应由既有 SDK 完整校验，准备和保存前再检查到期。身份读成功不证明冲突可见、版本当前或可写；后续提交仍由 Gateway 重新授权。

输出只包含标准 `{identity, request_key, command}`，可直接作为 submit、receipt 或 Web 导入输入。父目录必须存在，已有文件、目录或链接均拒绝；目标预检查在身份请求前进行，最终创建也不覆盖竞争者。复用既有保存实现：同目录独占临时文件、请求 0600 权限、分段写入、文件同步、长度/SHA-256 读回核对、关闭、独占硬链接创建最终路径，再清理自身临时文件。临时名称沿用 `.workctx-artifact-*.part`；不支持硬链接的文件系统明确失败，不回退为覆盖式重命名。

最终路径再次通过有界读取和完整原请求解析，与内存中的原请求做规范 JSON 比较。成功 stdout 是本地准备报告：schema_version/trace_id/scope/空 source_refs，data.status=prepared、local_state=saved-and-read-back、decision_dispatch_state=not-sent，含路径、原身份/键/冲突 ID/版本/选择和 next_action=review-original-file。它不是提交封套或回执，不含选中值；不会自动提交或查询。退出 0 仅表示该次保存和读回完成。后续需审阅原文件，再明确运行 submit --reviewed；任何已提交后的未知状态仍须保留同一文件查回执。

保存失败返回 CONFLICT_PREPARATION_SAVE_FAILED 及保存阶段、目标和适用临时路径；最终读回失败返回 CONFLICT_PREPARATION_READBACK_FAILED/local_state=published-unconfirmed，保留已创建目标，不删除或重建。仅清理确认归属自己的临时路径；清理失败提示 cleanup_pending。输入文件从不修改。文件 sync/读回不是目录项掉电持久性、Windows ACL、路径永久不变或跨设备备份保证；没有磁盘 I/O 期限。timeout-ms 只用于身份读取；令牌到期不会删除已经保存的原请求。

不扫描其他文件、不维护全局草稿索引，也不阻止调用者为相同冲突选择另一个新文件名；未知旧请求应复用已有副本，不能以新文件名准备新键。准备失败时没有发送任何冲突决定；身份查询及其入口审计仍可能发生。SDK/MCP 通用持久备份另行开发；Web 原请求的浏览器事务保存与关闭标签页后恢复见 [保存与恢复](conflict-recovery-runtime.md)，未准备的编辑文字仍不持久化。

以下只展示分步用法，不会自动串行执行，示例均未运行：

```text
workctx conflicts prepare --json-file decision.json --output original-conflict.json
workctx conflicts submit --json-file original-conflict.json --reviewed
workctx conflicts receipt --json-file original-conflict.json
```

decision.json 示例为 `{"conflict_id":"原冲突 ID","expected_version":1,"resolution":"server"}`；版本必须来自用户审阅的记录，示例中的 1 不是默认值。输出文件不能手工替换原键、身份或版本来恢复未知结果。

## 剩余范围

无新增依赖/SQL 迁移，016–049 仍未执行。CLI 新请求准备/文件创建和同文件提交/回执入口、Web 原请求浏览器事务保存已接入源码；SDK/MCP 持久备份适配、未准备编辑草稿/跨设备备份、任意精度写入、消费者/Mock/fixture 迁移和运行证据仍缺。原指纹兼容、普通字符串账号、受限来源、过期后提交、丢失响应/审计失败、文件及浏览器存储边界/保存并发/异常清理和完整响应校验均仅源码衔接，未执行验证。
