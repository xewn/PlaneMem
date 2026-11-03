# Intelligence worker：持久建议提交队列

更新：2026-11-04。本轮仅开发代码与说明，未编译、类型检查、测试、安装依赖、启动服务、迁移、部署或发布。

`SqliteProposalQueue` 把已经生成或人工撰写的建议保存到本地 SQLite，`flushProposalQueue` 再使用真实 HTTP 网关提交。新增独立 `generateProposalDraft`/`proposal-worker generate`，使用明确配置的模型接口把指定来源摘录生成可审阅草稿，详见 [模型草稿生成](../../docs/design/01-contracts/proposal-generation-runtime.md)。生成不会自动入队；提交不会重新生成正文、改写来源、确认或拒绝建议。原 `ProposalService` 保留为离线兼容辅助类，已标记 deprecated，不是网关的存储。

## 配置与命令

新增 [回执文件补存](../../docs/design/01-contracts/proposal-queue-reconciliation-runtime.md#已保留回执记录的补存)：`receipt-record-recover --file RETAINED_RECORD_OR_ERROR.json --output NEW_RECEIPT.json [--preview]` 接受原完整记录或保留record的导出失败JSON，先核对重复结果与原摘要，保留原时间/状态。preview只检查输入和新目标，正式执行只保存新文件，不覆盖已有路径、不访问旧错误路径或重新查询/结算队列；再次失败保留相同完整记录供后续补存。离线无令牌，缺record或未知事务错误不能重建成功记录，输入最多8 MiB+128 KiB。

新增 [完整回执记录](../../docs/design/01-contracts/proposal-queue-reconciliation-runtime.md#回执记录保存与离线核对)：`receipt` / `reconcile` 可加 `--output NEW_RECEIPT.json`，在队列正常关闭后独占保存原绑定、任务、完整原请求/回执、本地状态与摘要，已有文件不覆盖。`inspect-receipt-record --file RECEIPT_RECORD.json` 离线完整核验并输出元数据，无需令牌、不打开队列或联网。文件和格式化内容均限4 MiB；not-observed也可留档但不证明失败，摘要不认证远端结果。保存失败保留完整result/已构造record及保存阶段，原结算状态不改写；没有自动历史索引或文件导入结算。

新增 [原创建回执与显式结算](../../docs/design/01-contracts/proposal-queue-reconciliation-runtime.md)：`receipt --queue EXISTING.sqlite --binding binding.json --id JOB_ID [--timeout-ms 30000]` 原生只读查询原创建结果；`reconcile` 使用相同参数，只有远端 recorded、完整本地任务未变且非sending时才标记 submitted。not-observed、并发变化、过期发送租约都不据此重提或接管；已submitted须匹配同一历史回执。输出包含完整原建议，未知本地提交/关闭失败保留远端观察和原请求，没有自动保存文件或持久对账历史。两命令需原账号的 PROPOSAL_WORKER_ACCESS_TOKEN，existing模式不初始化缺失结构。仅源码，未执行命令或数据库。

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

队列命令 `flush` 提交已知未成功的草稿或查询未知结果，`receipt/reconcile` 只读查询网关，独立 `prepare-generation` 也会只读访问网关；这些命令从环境变量 `PROPOSAL_WORKER_ACCESS_TOKEN` 读取凭据。独立 `generate`/`generate-prepared` 和首次 `generation-run` 通过 `PROPOSAL_GENERATION_API_KEY` 调用配置模型，其他命令和已成功的 generation-run 重放不需要令牌。`retry` 只重新安排原任务；随后显式 flush 根据原 uncertain 标记决定创建或只查回执，不重置生成请求。`get` 会输出完整草稿，`list` 仅输出任务摘要和最小回执。列表按 job_id 倒序，默认 25、最多 100 条；下一页将 `next_before` 传为 `--before`。

返回值是 JSON。退出码 0 表示命令完成，1 表示参数/本地存储等命令失败，2 表示本次 flush 有 retry/blocked/lease_lost，或 reconcile 因 not-observed/sending/local-changed 未结算。receipt 退出0只表示查询完成，不证明原创建成功。flush 的成功退出不代表整库清空：它只处理开始时已经到期的最多 limit 个任务；未来重试、已有 blocked 和其他进程占用的任务不计入本次结果。

## 只读查询

`list/get` 使用 SQLite 原生只读打开方式，路径不存在时失败，不会创建空数据库。已有文件还须包含 v1 的两个必需表、任务列和唯一原绑定；在同一读取事务内检查 schema_version=1 及最多 16 KiB 的绑定文本，并精确比较规范化后的网关、项目和身份。缺表、无绑定或版本错误明确拒绝，绑定不符返回 `PROPOSAL_QUEUE_BINDING_MISMATCH`；缺列、文件损坏或读取权限问题也会失败，不回退到可写模式。

库调用可显式使用 `new SqliteProposalQueue(path, binding, { readonly: true })`。该模式只设置连接级 busy_timeout/query_only，不修改 journal_mode/synchronous、不创建表或索引、不补写绑定。SQLite 读取 WAL 队列仍可能需要访问 WAL/SHM 文件，不能据此保证目录完全没有文件系统活动。

只读实例调用 `enqueue/retry/claim/complete/fail/applyCreationReceipt` 或要求结算的 captureReceiptTarget 返回 `PROPOSAL_QUEUE_READ_ONLY`；`flushProposalQueue` 在首次认领时拒绝，尚未取得令牌或发送请求。默认构造方式及 CLI `enqueue/retry/flush` 仍使用可写模式。只读打开检查结构和绑定，不扫描或认证全部任务；`list/get` 保持原分页、草稿及回执读取语义。本轮未打开 SQLite、执行命令或验证运行结果。

## 提交协议

worker 每次领取取得一次令牌。对于没有未知结果标记的任务，用同一令牌依次请求：

1. `GET /v1/proposals/submission-context`：验证响应的协议版本、trace 和网关确认的 actor/client/项目范围；不支持此协议的旧网关不会进入写入步骤。
2. `POST /v1/proposals`：发送数据库中的原始规范化草稿及固定 `Idempotency-Key`。网关继续执行权限、来源和持久命令校验。

两个请求均发送 `X-Expected-Actor-Id` / `X-Expected-Client-Id`。网关只将它们与已验证身份比较，不用它们建立身份；不一致返回 DENIED。submission-context 仅返回调用者自己的身份、范围和 `identity_preconditions: 1`，要求有效客户端身份，不表明 proposal.write 已授权或数据库已就绪。实际提交仍需 proposal.write 和对应来源可见性。

对于 `uncertain=true` 或回收的过期 sending 任务，flush 只调用原创建回执查询，携带完整原身份、键和草稿。只有 recorded 才凭本次领取结算；not-observed 进入 retry 并保留未知标记，下次仍只查询，不回退创建。权限或内容冲突可进入 blocked，但未知标记保持；显式 retry 也不会解除它。详见 [未知结果门禁](../../docs/design/01-contracts/proposal-queue-reconciliation-runtime.md#flush-未知结果门禁)。

预检成功响应最多16 KiB，创建回执最多64 KiB，原回执查询最多2 MiB；错误响应最多16 KiB。全部使用完整有界 JSON 读取、严格 trace/内容类型核验和每请求20秒期限，禁止重定向；令牌最多等待5秒。取得令牌后核对原领取，创建前再核对一次，失去领取时不开始新的请求。这些检查不保证旧进程已停止或远端恰好执行一次。

所有网关副本需要更新到支持此协议的代码；原 Proposal 的 018 及依赖迁移仍须由后续运维流程执行。本轮没有升级运行环境。

成功回执必须带匹配 trace、schema_version、revision=1、ETag、正整数 server_cursor 和对应 proposal 来源；data 必须是 proposed/revision=1 的有效创建回执。仅保存 proposal_id/status/revision/event_id/occurred_at/replayed，不保存响应中的额外内容。回执代表历史创建结果，即使建议后来已经审核，提交任务仍可通过历史回执完成；当前状态应另行读取详情。

## 重试与本地存储

状态为 queued → sending → submitted，失败进入 retry 或 blocked。可写模式的 SQLite 使用 WAL、FULL 同步和事务认领，租约60秒；每次尝试有独立 trace。过期租约由下一次 flush 回收后只查询回执。结算匹配原租约令牌、键、规范正文/摘要和尝试次数，失去领取报告 lease_lost。旧版本进程不受新门禁约束，需另外协调停止。

临时/未知错误按5秒起的指数退避，最高1小时；flush 不驻留等待、不循环处理本次失败任务。未知任务的重试仅查询回执。权限、来源冲突、参数和请求键冲突等确定错误进入 blocked，修复外部条件后可显式 retry 原任务。无法修改已有任务正文或来源：需要新内容时创建独立草稿及请求键，并先处理原任务的不确定结果。

网络中断、无效 JSON/回执和其他未知写入结果设置 uncertain；回收 sending 任务也视为结果未知。此标记会跨重启及后续权限错误保留，直到收到有效创建回执。它不等于已成功，也不允许据此更换请求键。

领取前检查完整原绑定和14个已知任务列，先限制正文1 MiB、其他列合计16 KiB，再核对规范草稿、SHA-256、状态、时间、租约和计数。可定位的损坏任务隔离为 blocked/`PROPOSAL_QUEUE_CORRUPT` 并保守保留未知标记，不重写原草稿或发送；无法定位的无效任务 ID 终止本次操作。同键同草稿返回已有任务，同键不同草稿拒绝。校验和用于发现损坏，不是防篡改认证。

`processed` 统计本次领取或隔离的任务；`creation_attempts` 和 `receipt_queries` 分别统计进入创建、原回执查询调用的次数，不证明请求已到达远端。每项 `action` 为 create、receipt 或 none；none 可包含已做身份预检但未创建的情况。持久 attempts 是领取次数，包含查询、凭据失败及后续失去领取的尝试，不等于创建次数。没有自动解除未知标记或强制重提入口。

SQLite 文件及 WAL/SHM 包含完整建议内容和来源，不含令牌。使用适当的本地目录权限和一致性备份方式；当前没有加密、远端队列、后台调度或队列清理，模型生成适配器也没有运行验证。不要直接复制活跃数据库主文件后丢弃 WAL，或删除未知结果任务后另键重发。
