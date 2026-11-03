# Intelligence worker：持久建议提交队列

更新：2026-11-04。本轮仅开发代码与说明，未编译、类型检查、测试、安装依赖、启动服务、迁移、部署或发布。

`SqliteProposalQueue` 把已经生成或人工撰写的建议保存到本地 SQLite，`flushProposalQueue` 再使用真实 HTTP 网关提交。新增独立 `generateProposalDraft`/`proposal-worker generate`，使用明确配置的模型接口把指定来源摘录生成可审阅草稿，详见 [模型草稿生成](../../docs/design/01-contracts/proposal-generation-runtime.md)。生成不会自动入队；提交不会重新生成正文、改写来源、确认或拒绝建议。原 `ProposalService` 保留为离线兼容辅助类，已标记 deprecated，不是网关的存储。

## 配置与命令

新增请求目录：`generation-requests --journal EXISTING_DIR --binding binding.json [--state all|prepared|attempted|generated|failed] [--after CURSOR] [--limit 10]` 按原绑定发现请求，返回状态、原键和摘要，不输出正文。默认 10、最多 20 条；每页最多扫描 64 个候选并使用 32 MiB 读取预算，空页仍可能有 next_cursor，须继续续页。游标绑定原目录/绑定/状态，改变条件从首页开始；并发新增或状态变化需要重新查询。目录总项数上限 10,000，损坏拒绝，详见 [目录边界](../../docs/design/01-contracts/proposal-generation-request-runtime.md#请求发现与分页目录)。本命令不打开队列、不调用模型、不修改日志。

新增生成结果补存：`generation-recover --journal EXISTING_DIR --binding binding.json --key KEY --file RETAINED_ERROR.json [--preview]` 读取保存失败的完整错误 JSON 或 recovery 对象。预览只读，正式补存只写缺失 outcome，须与目标的原请求和实际领取完全匹配；相同结果保留，矛盾结果拒绝，不重建领取、不调用模型。可从保留的完整 generation/failure 重建结果封套，原生成时间不变；退出码 0 表示本地恢复操作完成，失败的模型结果仍为 failed。输入上限 8 MiB，原记录限制保持，详见 [恢复规则](../../docs/design/01-contracts/proposal-generation-request-runtime.md#已保留结果的预览与补存)。

新增 [生成调用持久请求](../../docs/design/01-contracts/proposal-generation-request-runtime.md)：`generation-request --journal EXISTING_DIR --binding binding.json --key KEY --file PREPARATION_RECORD.json --provider provider.json` 保存原请求；`generation-run --journal EXISTING_DIR --binding binding.json --key KEY` 先独占保存领取标记再调用模型。`generation-status` 使用相同 journal/binding/key 查看状态；`generation-result` 再加 `--output NEW_RECORD.json` 导出完整成功记录，可沿原绑定 enqueue-generated。四个命令不打开队列。已有领取标记永不再次派发，成功结果可直接重放；失败或中断保留原标记，没有自动重试、过期回收或覆盖恢复。目录须预先存在，文件系统须支持硬链接，原文件须持续保留；不保证断电后的目录元数据持久性或供应商恰好执行一次。

新增 [完整生成记录与目标绑定](../../docs/design/01-contracts/proposal-generation-record-runtime.md)：`prepare-generation --record` 保存原绑定、选择、观察和完整输入；`generate-prepared` 单次生成并保存含原准备记录的完整结果。`inspect-generation --file RECORD.json` 离线核对后只显示元数据；`enqueue-generated --queue queue.sqlite --binding binding.json --file GENERATION_RECORD.json --key KEY` 在打开队列前检查原网关、项目、账号和客户端，避免误入其他目标。记录均限制 2 MiB，不包含凭据；摘要仅检查一致性，不认证来源或当前权限。

新增 [任务生成记录历史](../../docs/design/01-contracts/proposal-generation-history-runtime.md)：enqueue-generated 在同一事务保存任务和完整记录，相同记录重放保留首次关联时间，同键异草稿拒绝。`generation-list --queue queue.sqlite --binding binding.json --id JOB_ID [--after SHA256] [--limit 10]` 只读分页，默认 10、最多 20 条；`generation-get --queue queue.sqlite --binding binding.json --id JOB_ID --sha256 SHA256 [--output NEW_RECORD.json]` 取回完整记录，可导出新文件。两个命令不需要令牌；缺扩展不建表，损坏不返回部分记录。核心 v1 队列不变，可选关联表只在首次明确写入时初始化；本轮仅新增初始化源码，未执行 SQL 或打开库。

新增 [网关来源准备](../../docs/design/01-contracts/proposal-generation-sources-runtime.md)：`prepare-generation --binding binding.json --file selection.json --output new-sources.json` 先核对原身份，再按明确 ID/revision 读取当前可见且有效的 ContextItem，完整准备 generate 输入。版本冲突或任一来源失败时不保存部分结果；生成和提交仍分别显式执行。

需要仓库约定的 Node.js 24。依赖清单已补充 SDK 和现有版本的 tsx，本轮没有安装或运行。命令入口是根脚本 `pnpm proposal-worker`，包内入口为 `bin/proposal-worker.mjs`。

队列操作明确指定 `--queue` 和 `--binding`；独立 generate 使用 `--provider --file --output`，prepare-generation 使用 `--binding --file --output`，二者不打开队列。父目录须已存在，建议使用忽略入库的 `workers/intelligence/.local/`。绑定文件只接受以下字段，示例值需替换为真实配置：

```json
{
  "gateway_url": "https://gateway.example.com",
  "tenant_id": "01JAAAAAAAAAAAAAAAAAAAAAAA",
  "workspace_id": "01JBBBBBBBBBBBBBBBBBBBBBBB",
  "project_id": "01JCCCCCCCCCCCCCCCCCCCCCCC",
  "actor_id": "worker-service-subject",
  "client_id": "proposal-worker"
}
```

gateway_url 必须是 HTTP(S) origin，不包含账号密码、路径前缀、查询或片段；三个范围 ID 必须为 ULID。actor_id 对应已验证令牌的 sub，client_id 对应 azp（或 client_id）；二者及请求键使用 1–255 个可见 ASCII 字符。不要把令牌放进绑定 JSON。

默认可写模式首次打开将规范化后的网关、范围、actor/client 固定到数据库；以后任何一项不同都会报 `PROPOSAL_QUEUE_BINDING_MISMATCH`。刷新令牌可以继续使用原库，但身份不能改变。换项目或身份需要独立队列，不能用换库/换键来掩盖未知的提交结果。`list/get` 只读打开已有队列，不负责初始化；新队列可通过首次 `enqueue` 创建。

以下仅为使用示例，本轮未执行。先准备绑定 JSON、草稿 JSON 和本地父目录：

```text
pnpm proposal-worker enqueue --queue workers/intelligence/.local/queue.sqlite --binding workers/intelligence/.local/binding.json --file draft.json --key proposal-draft-001
pnpm proposal-worker list --queue workers/intelligence/.local/queue.sqlite --binding workers/intelligence/.local/binding.json --limit 25
pnpm proposal-worker get --queue workers/intelligence/.local/queue.sqlite --binding workers/intelligence/.local/binding.json --id JOB_ULID
pnpm proposal-worker retry --queue workers/intelligence/.local/queue.sqlite --binding workers/intelligence/.local/binding.json --id JOB_ULID
pnpm proposal-worker flush --queue workers/intelligence/.local/queue.sqlite --binding workers/intelligence/.local/binding.json --limit 25
```

草稿使用 [Proposal 创建字段](../../docs/design/01-contracts/proposal-runtime.md)，包含 kind/title/content/source_refs/model_version/prompt_version，可指定 classification/ttl_seconds。直接引用 context-item 时必须固定正整数 revision。绑定文件读取上限 16 KiB，草稿文件上限 1 MiB，实际字段仍受共享契约限制。

可选 derived_from 记录原建议 ID/revision，由网关在提交时核对同项目可见性、版本及关联深度。原版本冲突进入 blocked，worker 不自行刷新关联或来源；如需修改，先处理原任务的未知结果，再用新草稿和请求键入队。未使用关联的旧草稿保持原规范化输出字段顺序，不注入额外默认值；本轮未运行队列迁移或验证。

队列命令中只有 `flush` 联网，独立 `prepare-generation` 也会只读访问网关；两者从环境变量 `PROPOSAL_WORKER_ACCESS_TOKEN` 读取凭据。独立 `generate`/`generate-prepared` 和首次 `generation-run` 通过 `PROPOSAL_GENERATION_API_KEY` 调用配置模型，其他命令和已成功的 generation-run 重放不需要令牌。`retry` 只将原提交任务置为可重试，随后显式 flush 才会发送，不重置生成请求。`get` 会输出完整草稿，`list` 仅输出任务摘要和最小回执。列表按 job_id 倒序，默认 25、最多 100 条；下一页将 `next_before` 传为 `--before`。

返回值是 JSON。退出码 0 表示命令完成，1 表示参数/本地存储等命令失败，2 表示本次 flush 有 retry/blocked/lease_lost。flush 的成功退出不代表整库清空：它只处理开始时已经到期的最多 limit 个任务；未来重试、已有 blocked 和其他进程占用的任务不计入本次结果。

## 只读查询

`list/get` 使用 SQLite 原生只读打开方式，路径不存在时失败，不会创建空数据库。已有文件还须包含 v1 的两个必需表、任务列和唯一原绑定；在同一读取事务内检查 schema_version=1 及最多 16 KiB 的绑定文本，并精确比较规范化后的网关、项目和身份。缺表、无绑定或版本错误明确拒绝，绑定不符返回 `PROPOSAL_QUEUE_BINDING_MISMATCH`；缺列、文件损坏或读取权限问题也会失败，不回退到可写模式。

库调用可显式使用 `new SqliteProposalQueue(path, binding, { readonly: true })`。该模式只设置连接级 busy_timeout/query_only，不修改 journal_mode/synchronous、不创建表或索引、不补写绑定。SQLite 读取 WAL 队列仍可能需要访问 WAL/SHM 文件，不能据此保证目录完全没有文件系统活动。

只读实例调用 `enqueue/retry/claim/complete/fail` 返回 `PROPOSAL_QUEUE_READ_ONLY`；`flushProposalQueue` 在首次认领时拒绝，尚未取得令牌或发送请求。默认构造方式及 CLI `enqueue/retry/flush` 仍使用可写模式。只读打开检查结构和绑定，不扫描或认证全部任务；`list/get` 保持原分页、草稿及回执读取语义。本轮未打开 SQLite、执行命令或验证运行结果。

## 提交协议

worker 在每次尝试中取得一次令牌，并用同一令牌依次请求：

1. `GET /v1/proposals/submission-context`：验证响应的协议版本、trace 和网关确认的 actor/client/项目范围；不支持此协议的旧网关不会进入写入步骤。
2. `POST /v1/proposals`：发送数据库中的原始规范化草稿及固定 `Idempotency-Key`。网关继续执行权限、来源和持久命令校验。

两个请求均发送 `X-Expected-Actor-Id` / `X-Expected-Client-Id`。网关只将它们与已验证身份比较，不用它们建立身份；不一致返回 DENIED。submission-context 仅返回调用者自己的身份、范围和 `identity_preconditions: 1`，要求有效客户端身份，不表明 proposal.write 已授权或数据库已就绪。实际提交仍需 proposal.write 和对应来源可见性。

所有网关副本需要更新到支持此协议的代码；原 Proposal 的 018 及依赖迁移仍须由后续运维流程执行。本轮没有升级运行环境。

成功回执必须带匹配 trace、schema_version、revision=1、ETag、正整数 server_cursor 和对应 proposal 来源；data 必须是 proposed/revision=1 的有效创建回执。仅保存 proposal_id/status/revision/event_id/occurred_at/replayed，不保存响应中的额外内容。回执代表历史创建结果，即使建议后来已经审核，提交任务仍可通过历史回执完成；当前状态应另行读取详情。

## 重试与本地存储

状态为 queued → sending → submitted，失败进入 retry 或 blocked。可写模式的 SQLite 使用 WAL、FULL 同步和事务认领，租约 60 秒。令牌获取最多等待 5 秒，每个 HTTP 请求超时 20 秒；每次尝试有独立 trace。过期租约可由下一次 flush 回收；旧进程只能凭原租约令牌结算，失去租约后报告 lease_lost。并发请求仍携带同一个远端请求键。

临时/未知错误按 5 秒起的指数退避，最高 1 小时；flush 不驻留等待、不循环重发本次失败任务。权限、来源冲突、参数和请求键冲突等确定错误进入 blocked，修复外部条件后可显式 retry 原任务。无法修改已有任务正文或来源：需要新内容时创建独立草稿及请求键，并先处理原任务的不确定结果。

网络中断、无效 JSON/回执和其他未知写入结果设置 uncertain；回收 sending 任务也视为结果未知。此标记会跨重启及后续权限错误保留，直到收到有效创建回执。它不等于已成功，也不允许据此更换请求键。

草稿在入队时规范化并保存 SHA-256，读取/提交时重新检查；损坏或不再符合契约的草稿隔离为 `PROPOSAL_QUEUE_CORRUPT`，不重写、不发送，并继续处理本批其他任务。同键同草稿返回已有任务，同键不同草稿拒绝。校验和用于发现损坏，不是防篡改认证。

SQLite 文件及 WAL/SHM 包含完整建议内容和来源，不含令牌。使用适当的本地目录权限和一致性备份方式；当前没有加密、远端队列、后台调度或队列清理，模型生成适配器也没有运行验证。不要直接复制活跃数据库主文件后丢弃 WAL，或删除未知结果任务后另键重发。
