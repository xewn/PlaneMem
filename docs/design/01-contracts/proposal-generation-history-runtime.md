# 建议任务的生成记录历史 v1

更新：2026-11-04。本轮只开发源码和文档，未编译、类型检查、测试、执行 CLI、调用模型/网关、打开数据库、执行 SQL/迁移或发布。新增本地可选表的初始化源码，无依赖和 Gateway 接口变化。

## 入队与记录关联

`SqliteProposalQueue.enqueueGenerated(record, key)` 完整检查生成记录和原队列绑定，在一个 BEGIN IMMEDIATE 事务中建立/复用原草稿任务、保存完整记录、读回核对并提交。CLI `enqueue-generated` 在打开队列前仍先检查输入文件、目标绑定和请求键，再调用此入口。旧普通 enqueue 保持原行为，不自动附加记录。

返回 `{ job, record_sha256, attached_at, replayed }`。replayed 只表示这份记录与该任务的关联此前已存在，不表示远端提交重放。同键同草稿复用原任务；同键不同草稿拒绝。完整记录的对象键顺序不改变摘要，因此记录入队比较也忽略对象键顺序，但不忽略数组顺序、文本或任何字段。不会重写已有任务的原 payload/hash、状态、请求键、租约、尝试或远端回执。

同一任务可以保留多个不同生成记录；即使草稿内容相同，准备时间、模型响应或来源观察不同也会形成不同记录。相同任务/相同摘要再次入队，必须与已存完整内容一致，返回原 attached_at，不覆盖历史。不能用不同记录掩盖同键不同草稿。旧版本曾只入队草稿的任务，可显式用原键和对应完整记录补上关联，包括已提交或正在发送的任务；此操作不改变任务状态，不重发远端请求。

记录关联只证明本地所存内容的一致性，不认证模型执行、来源真实性、当前权限或最终人工审核结论。关联可在任务创建后补充，attached_at 是首次本地关联时间，不能当作生成时间或任务创建时间。

## 可选本地表

核心 proposal_queue_binding/proposal_jobs 继续使用 v1。新增 `proposal_generation_records`，仅首次明确 enqueueGenerated 时在上述事务中初始化：

| 字段 | 含义 |
| --- | --- |
| job_id | 原任务 ID |
| record_sha256 | 完整生成记录的规范摘要 |
| schema_version | 固定 1 |
| record_json | 完整、严格核验后的规范 JSON |
| attached_at | 首次关联的毫秒 UTC 时间 |

主键为 `(job_id, record_sha256)`，同时支持单任务摘要分页和精确取回；定义对 proposal_jobs 的外键，并在应用层重新核对父任务及其草稿，不依赖外键开关建立一致性。整个队列沿用唯一原网关/租户/工作区/项目/actor/client 绑定；每次取用记录都要与此绑定匹配。

普通队列初始化、enqueue/list/get/flush 和新历史只读命令均不创建此扩展。已存在扩展须是具有规定列、类型、非空和主键顺序的表；不自动升级或修复异形结构。失败时事务回滚新任务、记录及本次扩展初始化；基础队列的构造仍是独立初始化步骤，因此失败后可能留下一个空的核心 v1 队列。

新增记录使用 `serializeProposalGenerationRecord` 的规范键序保存。记录全文和两层摘要、原绑定、任务草稿的类型/内容/来源/模型/提示版本/分类/TTL 都重新核对。父任务 payload 检查原哈希及规范化结果，记录读回必须与待存规范字节和关联时间相同。读取前检查数据类型和字节数；父草稿最多 1 MiB、单条记录最多 2 MiB，完整记录自身仍有字段、深度及节点限制。

## 查询与取回

以下是命令说明，本轮未执行：

```text
pnpm proposal-worker generation-list --queue queue.sqlite --binding binding.json --id JOB_ULID --limit 10
pnpm proposal-worker generation-list --queue queue.sqlite --binding binding.json --id JOB_ULID --after RECORD_SHA256 --limit 10
pnpm proposal-worker generation-get --queue queue.sqlite --binding binding.json --id JOB_ULID --sha256 RECORD_SHA256
pnpm proposal-worker generation-get --queue queue.sqlite --binding binding.json --id JOB_ULID --sha256 RECORD_SHA256 --output new-record.json
```

两个命令均只打开已有队列，原生只读，不需要令牌、不联网。库 API 为 `listGenerations(jobId, { after?, limit? })` 和 `getGeneration(jobId, sha256)`；每次读取在独立只读事务快照中完成父任务、扩展和记录检查。不要求调用者创建扩展：父任务存在但无扩展或无关联时，目录返回空 records，单条返回 `PROPOSAL_GENERATION_RECORD_NOT_FOUND`；父任务不存在返回 `PROPOSAL_JOB_NOT_FOUND`。

目录按摘要升序，默认 10、最多 20 条，after 为完整小写 SHA-256，下一页使用 next_after。先检查所选页的元数据及累计记录字节，最多 32 MiB；超出预算整页失败，调用者可减少 limit。逐条完整核验后只返回摘要、首次关联时间、生成时间/trace、请求/返回模型、提示版本、分类及来源数量，不输出来源摘录或草稿正文。损坏返回 `PROPOSAL_GENERATION_HISTORY_CORRUPT`，不跳过损坏记录、不返回部分成功页、不自动修复或修改发送状态。此查询不是全队列审计，也不是跨页快照；并发新增且排序在游标之前的记录需要从首页重新查询。

单条默认返回 `{ job_id, request_key, attached_at, record }`，其中 record 为完整文件内容。指定 --output 时，先预检新路径，读取完整记录并关闭数据库后，复用独占临时文件/同步/完整读回/硬链接发布机制保存单独 record，可直接用于 inspect-generation 或原目标 enqueue-generated。stdout 只报任务、键、首次关联时间、摘要和文件状态。不会覆盖原路径；父目录须存在且文件系统支持硬链接。

关闭数据库或导出失败时退出 1，`PROPOSAL_GENERATION_HISTORY_EXPORT_FAILED` 保留已读完整 record 和任务定位、目标路径；进入保存后另有原保存阶段及临时文件信息。不要为恢复文件重新调用模型或使用新请求键创建另一份提交。

## 未知结果与剩余范围

enqueueGenerated 的事务失败返回 `PROPOSAL_GENERATION_ENQUEUE_FAILED`，包含原 request_key、record_sha256、已知 candidate_job_id、phase、rollback 和 mutation，且不自动重试。mutation=not-started 表示未进入该事务，rolled-back 表示在提交阶段之前已回滚；进入 commit 后发生错误统一保留 not-confirmed，不把一次后续回滚尝试当作原提交未发生的证明。可用原任务定位只读核对或显式使用原记录/原键重放，不因结果未知更换键、记录或重新请求模型。

本地记录没有认证签名、加密、保留清理或独立历史备份/导入；包含完整来源及生成文本，应随队列使用一致性备份保留 WAL。[生成调用持久请求](proposal-generation-request-runtime.md) 已在独立文件目录增加派发前日志、独占领取、失败/成功结果保存和取回；保留的领取标记阻止再次派发，不解决供应商未知调用的对账。受控恢复/备份、费用/质量评估、全局审计和真实并发/故障/存储运行证据仍缺。历史关联不会改变 flush 的既有草稿提交协议，也不自动确认建议。
