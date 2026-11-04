# 生成调用持久请求 v1

更新：2026-11-04。仅源码与文档；未编译、类型检查、测试、执行 CLI、调用模型/网关、打开数据库或发布。实现位于 `workers/intelligence/src/generation-request.ts`、`generation-journal.ts`、`generation-journal-read.ts`、`generation-recovery.ts`、`generation-catalog.ts` 和 `main.ts`，不增加依赖或数据库结构。

## 使用与状态

以现有完整 preparation 记录和无凭据 provider 配置保存请求，再显式执行。以下为说明示例，本轮未执行；journal 及输出父目录须已存在：

```text
pnpm proposal-worker generation-request --journal journal --binding binding.json --key generation-001 --file preparation-record.json --provider provider.json
pnpm proposal-worker generation-run --journal journal --binding binding.json --key generation-001
pnpm proposal-worker generation-status --journal journal --binding binding.json --key generation-001
pnpm proposal-worker generation-result --journal journal --binding binding.json --key generation-001 --output new-generation-record.json
```

generation-request 不调用模型。相同键、完整准备记录和规范 provider 配置重放保留首次 request_id、created_at 和当前状态；同键异文报 IDEMPOTENCY_KEY_REUSED，绑定不同报 PROPOSAL_GENERATION_BINDING_MISMATCH。键为 1–255 个可见 ASCII 字符，在一个 journal 目录内唯一，不按项目或身份另分空间；不要用凭据作为请求键。创建新键是显式新生成，不能作为未知调用的自动恢复。

| 状态 | 保存内容 | 再次 generation-run |
| --- | --- | --- |
| prepared | 原请求，无 attempt | 凭据/参数检查后竞争独占领取 |
| attempted | 原请求与 attempt，无完整 outcome | 拒绝再次派发 |
| generated | 原请求、attempt、完整成功 outcome | 返回已有摘要，无需凭据，不调用模型 |
| failed | 原请求、attempt、完整失败 outcome | 拒绝再次派发 |

attempted 可能是调用仍在执行、进程中断、已保存标记但尚未发送，或结果保存未确认，不能直接判定模型失败。即使 failed 标记 provider_dispatch=not-sent 也不回收领取；当前没有生成重试命令、超时租约、自动重新派发或供应商结果查询。提交队列的 retry 只影响提交草稿，不影响这些文件。

首次 generation-run 从 PROPOSAL_GENERATION_API_KEY 取得凭据；缺失/无效凭据、无效调用选项或已取消的 signal 在领取前拒绝。领取后取消或其他失败保留标记。库调用可传 api_key、fetch、signal，但它们不写入日志。只有领取发布并完整读回成功的调用才能进入单次 generateProposalDraft；竞争失败或发布不确定都不调用模型。其单次期限、分类限制、固定来源、响应边界和不自动重试语义沿用原生成适配器。

generation-status 完整核验三个关联文件后只返回状态、请求/领取 ID、摘要、原绑定、provider、时间及筛选后的失败信息，不输出摘录或草稿正文。它是一次状态观察，不等待正在进行的生成；并发完成时可能仍看到先前状态，稍后可再次读取。缺请求报 PROPOSAL_GENERATION_REQUEST_NOT_FOUND，损坏、孤立结果或读失败报 PROPOSAL_GENERATION_REQUEST_INVALID，不修复原文件。

generation-result 仅允许完整成功结果，导出普通 v1 generation 记录至新文件，可继续 inspect-generation、enqueue-generated 和原提交队列流程；原网关、项目、actor/client 绑定检查继续生效。生成请求键与提交队列键是两个不同操作的标识；提交重放继续沿用其原提交键。旧 generate/generate-prepared 不使用此 journal，重复调用仍会调用模型。

退出码：0 表示命令完成；generation-run 保存失败 outcome 时为 1，其他参数/存储/已有领取拒绝也是 1。generation-status 成功读取 failed 状态仍为 0，表示查询完成。generation-recover 成功预览、补存或保留一个 failed 结果也为 0，表示本地恢复操作完成，不能据此认为模型生成成功。生成 journal 不使用提交 flush 的退出码 2。这些命令都不打开 SQLite、不自动提交或人工确认建议。

## 文件格式与核验

目录使用 realpath 解析。文件前缀为 `generation-` 加原键 UTF-8 SHA-256 小写十六进制；后缀分别为 `.request.json`、`.attempt.json`、`.outcome.json`，顺序只追加，不覆盖。读取拒绝符号链接和非普通文件，检查打开前后文件身份/长度，以有界缓冲读取严格 UTF-8 JSON。

所有格式固定 schema_version=1，必需字段齐全且拒绝未知字段：

- request：kind=proposal-generation-request、request_id、request_key、created_at、完整 preparation、规范 provider、sha256。provider 不含凭据，分类上限须允许输入分类；完整记录内的原 binding 须与调用 binding 相同。
- attempt：kind=proposal-generation-attempt、request_id、request_sha256、attempt_id、started_at、sha256。
- outcome：kind=proposal-generation-outcome、request_id、request_sha256、attempt_id、finished_at、record、failure、sha256。成功 record 为完整 generation，failure=null；失败 record=null，failure 只含 code、trace_id、provider_dispatch。二者必须恰有一个非空。

ID 使用 ULID，时间为完整毫秒 UTC，不用时间推断发送、完成次序或过期。失败 trace 只能是 trace_generation_ 加 ULID 或 null，dispatch 为 attempted/not-sent/unknown；只保留本地筛选后的错误代码和这些字段，不保存原供应商正文、错误对象或调用配置。outcome 必须对应原 request 摘要和 attempt；成功记录的 preparation/provider 必须与请求完整一致。

request/outcome 文件最多 3 MiB，attempt 文件最多 8 KiB；格式核验还检查 compact 和两空格缩进加尾换行的 JSON 大小。内层 preparation/generation 继续受 2 MiB 限制，其他原有字段/输入限制不变；超限拒绝，不截断。共享有限 JSON 快照拒绝访问器、循环、非有限值等，限制节点及深度。

每个 sha256 计算该对象移除自身 sha256 后的规范 JSON：对象键按 JavaScript UTF-16 顺序排序，键和标量使用 JSON.stringify，数组顺序保留，没有额外空白。外层包含完整内层记录及摘要。摘要检查一致性，不能证明文件未被主动篡改、供应商实际执行、来源真实性、当前权限或新鲜度。

## 保存失败与持久性边界

复用新文件发布器：同目录独占临时文件、写入、文件同步、完整字节读回、独占硬链接发布、发布后完整读回。无覆盖回退；文件系统不支持硬链接时失败。没有回收 attempt，也不会删除已发布文件。临时清理失败可返回 cleanup_pending/temporary_path，完整目标仍保留。

保存失败报 PROPOSAL_GENERATION_REQUEST_SAVE_FAILED，带 phase=request/attempt/outcome、output_path 和 recovery 中完整原请求、已创建的候选 attempt、可用的完整 outcome/生成结果/筛选后的失败信息。已进入写入器时另有阶段、发布状态与临时路径；封装结果失败也保留已生成正文。恢复输出可能含完整来源与草稿，应按其原分类保管。

错误里的 provider_dispatch_scope=this-invocation 只描述本次调用。attempt 发布失败的 not-sent 不代表其他领取者没有调用模型；recovery.attempt 可能是竞争失败的候选，不能覆盖目录内真正的领取标记。先用原键和绑定查看 journal；成功结果可直接导出。未确认写入不等于未发布，也不能因结果保存失败重新请求模型。导出失败用 PROPOSAL_GENERATION_REQUEST_EXPORT_FAILED 保留完整 record 和目标信息，原 journal 不变。

排重依赖同一目录内原请求及领取文件持续保留。不要删除/替换标记、回滚到旧备份、换目录或新键来重发未知请求。文件同步不保证父目录元数据跨断电/系统崩溃持久化；断电丢失目录项、文件外部删除或备份回滚可能丢失领取。当前仅在原标记保留的前提下保守阻止再次派发，不承诺供应商恰好执行一次，也不提供对外部篡改的排他保护。

## 已保留结果的预览与补存

generation-run 已返回完整结果但保存失败时，可以将完整错误 JSON 保存为 UTF-8 文件，通过 generation-recover 补存。只读预览和实际补存均使用原 journal、绑定与键；以下示例未执行：

```text
pnpm proposal-worker generation-recover --journal journal --binding binding.json --key generation-001 --file retained-error.json --preview
pnpm proposal-worker generation-recover --journal journal --binding binding.json --key generation-001 --file retained-error.json
pnpm proposal-worker generation-result --journal journal --binding binding.json --key generation-001 --output new-generation-record.json
```

输入接受完整 PROPOSAL_GENERATION_REQUEST_SAVE_FAILED 封套（details.phase=outcome、retryable=false），或直接使用其中的 recovery 对象。完整封套必须包含 code/message/details/trace_id/retryable/recovery，拒绝额外顶层字段；message/trace 只检查类型，details 只用于确认 phase，不据其路径、发送状态或文字创建文件。实际目的地始终由命令的 journal 和原键计算。输入不改变原请求、配置、来源、键或领取。

recovery 必须含完整 request 和 attempt，只允许附加 outcome、generation、failure；至少有一项结果，generation 与 failure 不能同时出现。完整 request/attempt/outcome 和内层记录均重新核验字段、摘要和关联。如果同时保留 outcome 与 generation/failure，二者须完整一致，不能静默忽略矛盾内容。无结果的领取竞争失败封套不能用于补存。

没有 outcome 但保留完整 generation 时，使用原 preparation/provider 封装 generation 记录，再封装 outcome；只有筛选后的 failure 时封装失败 outcome。原 generation.generated_at、trace、模型/来源/正文保持不变；新 outcome.finished_at 表示本次本地封装时间，不补造原来未保存的完成时间。仍然受原 2 MiB 记录和 3 MiB outcome 限制，超限不截断。完整输入文件、compact JSON 和规范 pretty JSON 各不超过 8 MiB；扩大输入预算只为容纳错误封套中重复的完整请求、结果和生成正文，不放宽原记录字段限制。

目标必须已保存完全相同的 request 和实际胜出的 attempt，包括 ID、摘要、内容及时间。缺请求、缺领取、竞争失败的候选领取或被重建为另一份请求均拒绝；不会从恢复文件重新创建这些前置文件。存在 outcome 时，完整 outcome 输入要求整份相同；从 generation/failure 重建时比较完整结果及请求/领取关系，忽略本次新封装时间，保留目标首次保存的 finished_at 和摘要。已有不同成功/失败结果均冲突，不覆盖、合并或将失败改成成功。

--preview 只读取，返回 preview=true、action=create/retain、当前 state，以及 result_state、result_record_sha256、result_failure、result_finished_at、outcome_sha256 和 outcome_origin=preserved/reconstructed，不输出正文。当前 state=attempted 与 result_state=generated 可以同时出现，表示预计补存一个成功结果。实际操作重新读取和比较；预览不锁定目录、不授权更换结果，也不是后续写入一定成功的保证。无 outcome 的输入在实际运行时重新封装，因此其候选 finished_at/摘要可能不同；已有完整 outcome 的时间和摘要保持。

正式补存只独占发布缺失的 outcome。写入失败或并发发布后重新读取全部关联文件：发现相同完整结果即返回 action=retain、replayed=true；不同结果报冲突，不再次写入。无法确认结果时保留规范 request/attempt/outcome，报原 SAVE_FAILED，details.operation=recover、provider_dispatch_scope=this-invocation、provider_dispatch=not-sent；可以保留该封套并用原命令再次补存。这只说明恢复操作没有调用模型，不表示原生成请求没有发送。临时文件可能仍保留，恢复不自动清理它们。

输入错误报 PROPOSAL_GENERATION_REQUEST_RECOVERY_INVALID；目标请求/领取不同报 RECOVERY_MISMATCH；结果不同报 RECOVERY_CONFLICT（均带 PROPOSAL_GENERATION_REQUEST_ 前缀）。损坏的目标日志继续拒绝，不以恢复内容覆盖损坏文件。原恢复文件由用户保留，命令不修改或删除它。

库入口为 inspectGenerationRecovery(value, binding, key) 和 recoverGenerationRequest(directory, binding, key, value, { preview? })。本功能只补存已经保留的本地结果，没有供应商调用、队列提交或人工审核。输入摘要与绑定核验不认证来源；应使用自己保留并审阅过的输出。恢复无法判定原生成进程是否仍在运行，不撤销原进程；若它随后完成，将与恢复争用同一个不可覆盖 outcome，异文保留冲突而不是丢弃原有结果。

## 请求发现与分页目录

不知道原请求键时，可用 generation-requests 只读浏览。这里查询 journal 内生成请求；generation-list 仍查询提交队列中某个任务关联的生成记录，二者范围不同。以下仅为命令说明，本轮未执行：

```text
pnpm proposal-worker generation-requests --journal journal --binding binding.json --limit 10
pnpm proposal-worker generation-requests --journal journal --binding binding.json --state attempted --limit 10
pnpm proposal-worker generation-requests --journal journal --binding binding.json --state attempted --after RETURNED_CURSOR --limit 10
```

库入口为 listGenerationRequests(directory, binding, { state?, after?, limit? })；parseGenerationCatalogQuery 校验输入。state 为 all/prepared/attempted/generated/failed，默认 all；limit 默认 10，范围 1–20。游标只接受返回的有界 base64url 格式，绑定规范目录路径、当前目录设备/文件标识、原 gateway/project/actor/client 及状态筛选；改变范围或状态须从首页查询，limit 可以调整。游标用于查询一致性，不是认证签名或权限证明。

目录按请求键 SHA-256 升序扫描，不按创建时间。只发现规范小写 `generation-<64 hex>.request.json` 文件，逐份检查完整请求字段、内层记录、原绑定、摘要以及文件名与原键的对应关系。其他绑定的有效请求不返回，且不读取其 attempt/outcome；同绑定候选则复用按键状态查询的完整核验，再应用状态筛选。只有单独 attempt/outcome、临时文件或不规范文件名时不会被发现；本功能不是全目录孤立文件审计。绑定仅过滤本地记录，不代替操作系统访问控制或网关授权。

返回 schema_version、binding、state_filter、limit、items、scanned、read_budget_used、next_cursor、stopped 和 consistency=per-request。items 是已有状态摘要加 key_sha256，含原 request_key/ID、请求及记录摘要、原绑定/provider、领取/完成时间和筛选后的失败信息，不含来源摘录或草稿正文。可用返回的原键继续 generation-status/result/recover；查询不会自动生成或提交。

每次最多枚举 10,000 个目录项，包含无关文件及临时文件；超过时整页报 PROPOSAL_GENERATION_REQUEST_CATALOG_LIMIT，可用已知键直接查询，不要求删除日志。分页正文读取最多处理 64 个候选，累计预算 32 MiB；每次读取前按文件大小加一个增长探测字节预留，缓冲也按该大小有界分配，文件身份/长度变化拒绝。request/outcome 各 3 MiB、attempt 8 KiB 和全部内层限制仍有效。目录页复用已完整读取的请求，避免为状态核验再次读取正文。

达到条数、候选或字节上限时，stopped 分别为 limit/scan-limit/byte-limit；没有更多已枚举候选时为 end。字节不足以完成当前候选时不推进该候选，游标停在上一份已完整检查的请求，下一页重新读取。scanned 包含其他绑定和状态不匹配的请求；read_budget_used 是读取预留量，包含探测字节和本页未完成候选已读取的部分。items 可以为空但 next_cursor 非空，应继续续页；只有 next_cursor=null 才表示本次枚举位置已经到末尾。

所扫描候选损坏、请求消失、文件名与键不一致、同绑定结果损坏或目录访问失败时，报 PROPOSAL_GENERATION_REQUEST_CATALOG_INVALID，不返回已积累的部分页，也不暴露其他绑定的原键/正文。游标格式或范围不匹配报 CATALOG_CURSOR_INVALID（同前缀）。不创建目录、索引或队列表，不修复原文件、覆盖标记、调用模型或自动领取；成功目录查询退出 0，失败退出 1。

目录枚举和逐请求读取不是事务快照，跨页也没有快照：并发新增且排序在已过游标之前的请求需要从首页发现，已经越过游标的请求后来改变状态也需要重新查询。每条结果仅反映该次读取观察，不证明未知调用完成、不提供全量总数、也不保证未扫描部分完整。已有标记的重发保护保持不变。

已补 [生成请求日志完整备份](proposal-generation-journal-backup-runtime.md)：按原绑定保留完整请求/领取/结果，两轮读取与目录集合核对变化，支持离线核验和完整失败副本补存；不调用模型或重建活跃日志。两轮观察不等于事务快照，备份缺领取也不是重发资格。

仍缺供应商未知调用对账/结果取回、缺失请求/领取的整套恢复、与队列联合备份/保留策略、全局审计、费用与质量评估、真实并发/故障和文件系统运行证据。没有保留完整结果时不能靠恢复命令推断或重造模型输出。P7-01 与 R-009 保持未完成。
