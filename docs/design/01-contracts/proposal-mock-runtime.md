# 建议生命周期开发 Mock

更新：2026-11-04。仅源码和文档，未编译、类型检查、测试、执行 Mock、调用接口或发布。

`@planemem/sdk` 导出 `MockProposalStore`、`MockProposalSeed`、`MockProposalSource` 和 `MockProposalSession`。一个 store 对应一个固定项目，从空建议目录开始；多个会话可共享同一 store。通过正常创建命令准备建议，再调用现有 SDK 浏览或审核。

## 路由与接线

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/v1/proposals/submission-context` | 返回当前配置身份及 `identity_preconditions: 1` |
| POST | `/v1/proposals` | 创建 proposed/revision 1 建议 |
| POST | `/v1/proposals/creation-receipt` | 只读核对原创建回执，不创建或重放命令 |
| GET | `/v1/proposals` | 按状态、类型、直接原建议及 before 分页 |
| GET | `/v1/proposals/{id}` | 读取正文、来源、审核结果及 sources_current |
| POST | `/v1/proposals/{id}/confirm` | 人工确认，版本匹配后变为 verified/revision 2 |
| POST | `/v1/proposals/{id}/reject` | 人工拒绝，版本匹配后变为 rejected/revision 2 |

可以直接把 `store.connect(session)` 作为 `WcpTransport`，也可使用 `new MockWcpServer({ proposals: { store, session } })`。后者可同时配置已有 sync Mock，路由相互独立；建议回执中的事件 ID 和游标不会自动进入同步 Mock。

以下为未执行的接线示例。`createUlid` 只在使用者实际运行示例时生成开发标识：

```ts
import { createUlid, parseCreateProposal } from '@planemem/contracts';
import { MockProposalStore, MockWcpServer, WcpClient } from '@planemem/sdk';
import type { MockProposalSession } from '@planemem/sdk';

const scope = {
  tenant_id: createUlid(), workspace_id: createUlid(), project_id: createUlid(),
};
const source = {
  id: createUlid(), revision: 1, classification: 'internal' as const,
  available: true, current: true, expires_at: null, dependency_version: 'initial',
};
const store = new MockProposalStore({ scope, context_sources: [source] });
const author: MockProposalSession = {
  identity: { ...scope, actor_id: 'draft-worker', client_id: 'dev-worker' },
  expires_at: new Date(Date.now() + 3600000).toISOString(), actor_type: 'service',
  project_readable: true, read_proposals: true, create_proposals: true,
  review_proposals: false, read_restricted: false, visible_context_item_ids: [source.id],
};
const writer = new WcpClient(new MockWcpServer({ proposals: { store, session: author } }), {
  ...scope, trace_id: 'trace_mock_author',
});
const draft = {
  kind: 'next_step' as const, title: 'Review the dependency', content: 'Check the pinned source before planning.',
  source_refs: [{ type: 'context-item', id: source.id, revision: 1 }],
  model_version: 'manual', prompt_version: 'development-example',
};
const originalDraft = parseCreateProposal(draft);
const created = await writer.createProposal(originalDraft, { idempotency_key: 'create-001' });
const reviewer = new WcpClient(store.connect({
  ...author, identity: { ...scope, actor_id: 'human-reviewer', client_id: 'dev-console' },
  actor_type: 'human', create_proposals: false, review_proposals: true,
}), { ...scope, trace_id: 'trace_mock_review' });
await reviewer.confirmProposal(created.data.proposal_id, 'Reviewed the pinned source', {
  expected_revision: 1, idempotency_key: 'review-001',
});
// The original create receipt remains proposed/revision 1; current detail is verified/revision 2.
await writer.getProposalCreateReceipt({
  identity: author.identity, request_key: 'create-001', draft: originalDraft,
});
await writer.getProposal(created.data.proposal_id);
```

## 身份和来源配置

项目范围必须为三项 ULID。每个会话明确提供 actor/client、标准 UTC 到期时间、human/service、项目可读性、读取/创建/审核能力、受限数据能力和可见本地来源 ID 集合；所有字段必填。连接时保存独立副本，修改调用者原配置不会改变既有会话；更换身份或能力时新建连接。请求范围必须完全匹配，可选预期身份头也必须匹配；这些头不能授予身份或权限。身份查询只返回配置身份，不证明创建权限或项目可读。

每个本地来源明确提供 revision、classification、available、current、expires_at 和 dependency_version。available=false 模拟归档/不可用；current=false 模拟过期、excluded 或依赖检查失败。expires_at 为 null 或标准 UTC 时间。dependency_version 是 1–255 个可见 ASCII 字符的开发标签，改变它模拟正文或依赖变化。这里没有真实 ContextItem 图遍历、内容摘要认证或 Policy 调用。

`store.setContextSource({...source, revision: 2, dependency_version: 'changed'})` 替换一个已经配置的来源，不允许新增 ID。它是开发场景控制入口，不能通过 WCP 请求调用。来源的可见性还受会话可见集合及 restricted 权限约束；建议及全部原建议链有任一来源不可见时，列表隐藏、详情和原回执重放拒绝。来源仍可见但变旧时，详情返回 sources_current=false，确认失败，仍可显式拒绝。

创建时固定本地来源版本和配置快照；同一 ID 的冲突版本拒绝。分类至少等于草稿、来源和直接原建议的最高分类。derived_from 要求原建议可读且 revision 匹配，最多 32 次派生；不会继承原审核结果。外部来源仍只保留引用，不进行真实性检查。内容中的共享注入模式会记录 provenance warning。

## 请求和状态

`getProposalCreateReceipt({identity,request_key,draft}, options?)` 通过只读 POST 查询既有创建命令，直接连接和 MockWcpServer 转发均适用。draft 必须是完整规范原草稿，包含默认分类/TTL等字段；不能用当前建议详情重建，因为分类可能被来源提高，审核状态也可能改变。查询接受共享1 MiB原请求/2 MiB完整响应限制，transport 的 max_response_bytes 可进一步缩小；拒绝 URL 查询参数、Idempotency-Key、If-Match、X-Expected-Version 和未知正文参数，不继承创建条件。

查询要求配置会话尚未过期、create_proposals=true、项目可读，原五项身份必须与会话相同；不额外要求 read_proposals 或人工审核权限。模拟身份仍来自 connect 配置，不能由请求头授予。按原 actor/client/键读取既有命令，缺失返回完整原 query 和 not-observed、无来源引用，不分配键或游标，也不证明原创建失败。已有键属于不同正文或审核命令时返回 IDEMPOTENCY_KEY_REUSED。

recorded 还核对当前建议及全部派生链/来源可见性、创建账号/客户端、创建时间/TTL、分类下限和不可变草稿字段；返回原 proposed/revision1、事件ID/时间/游标及 current_state=not-checked。来源仍可见但变旧、建议过期或后来已审核不改变历史创建语义；来源不可见或受限能力不足则拒绝。共享封套校验与完整返回复制继续生效，取消、会话到期、大小限制和其他错误均不修改建议、回执、容量计数或游标。查询本身不创建、审核、重提或把当前状态改回 proposed。

Mock 的事件ID/游标来自原内存创建回执，没有真实同步事件日志；因此这里只核对模拟存储的内部一致性，不提供 Gateway 历史事件、审计、JWT 或持久化证明。SDK 的等待期限/取消可用于此 transport，但同步内存计算不模拟网络等待及服务端取消。

创建及审核共用按原 actor/client 隔离的请求键空间；项目由 store 隔离。相同规范命令和键返回原回执、原事件 ID/游标，replayed=true，响应 trace 使用本次请求。JSON 对象字段顺序不影响比较，数组顺序保留。不同内容、操作、目标或版本复用键报 IDEMPOTENCY_KEY_REUSED。重放仍重新检查当前能力、项目及整条来源可见性，但不会因为原建议后来审核、过期或来源变旧而重新执行命令。

确认和拒绝要求 human 加 review_proposals；服务身份不能凭 review_proposals=true 审核。expected_revision、If-Match 和可选 X-Expected-Version 若同时提供须一致。首次审核核对当前版本并要求 proposed；确认还检查建议期限和全部固定来源，拒绝允许处理已过期或来源变旧的可见建议。目录支持共享 ProposalListQuery，默认 25、最多 100 条，可见性及筛选先于倒序分页；没有跨页快照。

配置和响应会复制数据。来源最多 1000 个，建议最多 1000 条、成功原命令最多 2000 条；建议正文/来源快照/命令记录的序列化累计预算为 16 MiB，来源配置另有数量及字段上限，这不是 JavaScript 总堆上限。单请求正文最多 1 MiB，返回最多 4 MiB，可通过 max_response_bytes 缩小；bounded-json 要求显式预算。超限整笔失败，不截断正文或丢弃旧请求键。

Mock 同步准备完整返回数据，检查取消/会话期限和限额后才修改内存；在此模型中返回预算不足不会提交。不模拟真实网络中断后的未知提交结果、进程崩溃、并发数据库事务或持久恢复，不能据此判断真实命令没有落库。没有 HTTP 服务、JWT 验签、Audit、模型生成、真实同步发布、ContextPack 物化或 Plane 写入。错误带本次 trace，配置失败使用固定配置 trace；运行和兼容证据仍待后续工作。
