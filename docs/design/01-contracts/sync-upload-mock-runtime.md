# 同步上传与原事件回执内存 Mock

更新：2026-11-04。仅源码文档开发与人工审阅，未编译、类型检查、测试、执行 Mock/SDK/API、数据库或发布。全 WCP Mock 覆盖及 R-001 仍未完成。

## 开启与来源配置

在既有 [同步消费 Mock](sync-mock-runtime.md) 的 `MockSyncSeed` 中显式添加 `upload_sources`，才启用 `POST /v1/events:batch` 和 `POST /v1/sync/events/receipt`。省略该字段时两路由返回 MOCK_ROUTE_NOT_FOUND，旧下载场景保持。`upload_sources: []` 表示允许普通事件、没有可用的字段来源；不能从种子 changes 猜测原上传账本或客户端序号。

启用上传时 tenant/workspace/project 必须都是 ULID，以便新增事件满足完整 canonical event 契约；旧纯消费场景继续使用原范围解析。源码使用现有 `@planemem/events` 校验新增事件，无新增依赖。

每项 `MockSyncFieldSource` 精确包含：

| 字段 | 约束 |
| --- | --- |
| entity_type | work_item、context_item 或 session |
| entity_id | 有效同步标识；与 entity_type 共同唯一 |
| version | 1 到 MAX_SAFE_INTEGER-1 的安全整数 |
| classification | public/internal/confidential/restricted；session 固定 internal |
| available | 显式布尔值 |
| fields | 普通 JSON 对象，键限定为该实体的可提议字段；未配置字段视为不可用 |

work_item 字段为 title/status/priority/owner/progress/description/due_at，context_item 为 title/status/priority/content/layer/expires_at，session 为 status/parent_session_id。来源最多 1000 条，完整种子仍受 16 MiB 和共享 JSON 节点/深度约束。来源只在构造时复制，不能在外部修改；版本和字段是开发者提供的观察，不代表真实 Plane/数据库状态。

连接上新增可选 `upload_access: {read_restricted,include_own_uploads,visible_sources}`。两个开关必须是布尔值，visible_sources 是最多 1000 个无重复 `{entity_type,entity_id}`，必须引用已配置来源，允许为空。未启用上传的 store 不接受此配置。上传与回执要求 write_sync、可读项目、未过期会话及完整 upload_access；下载仍要求 read_sync。预期身份头只核对，不授权或替换会话身份。

## 上传、幂等与顺序

`uploadEvents(events,{idempotency_key,expected_identity})` 直接复用现有 SDK。正文严格只有 events；1–100 条完整共享事件快照、1 MiB 输入，重复事件 ID 或格式无效拒绝整批。上传要求原幂等键，拒绝查询参数、版本/缓存/范围/编码条件。只接受共享 SDK 可表达的合法事件；不模拟绕过 SDK 的非法 ID 批次返回。

批次键按 tenant/workspace/project/actor/client 与原键隔离，与真实网关先按 actor/client 派生 request key 的语义一致。同一身份同键完整原批次相同，返回原 accepted/rejected/next_cursor，不追加事件；输入规范 JSON 对象键顺序不影响比较，数组顺序、原字段存在状态和额外字段影响批次比较。同键异文返回 IDEMPOTENCY_KEY_REUSED。不同账号或客户端可独立使用相同键。

单事件另按完整发送身份和 event_id 查账本；使用 parseSyncUploadEvent 的规范内容比较，保留来源数组顺序，缺省 sensitivity=internal、source_refs=[]，忽略规范化丢弃的额外字段。同事件同文在新批次中复用原 server_event_id/cursor；同 ID 异文返回该事件的 EVENT_ID_REUSED。显式外层身份字段不匹配则 VALIDATION_ERROR，不能借额外字段冒充其他发送者。

client_cursor 独立于服务端高水位，按完整发送身份从零开始。新事件若给出序号，必须等于最后已记录客户端序号加一；否则返回 CURSOR_GAP 与 expected_cursor。无 client_cursor 的事件不推进客户端序号。已记录事件重放优先于序号判断；成功记录与已记录版本冲突都推进其客户端序号，校验/来源/游标拒绝不推进。安全整数空间耗尽拒绝，不输出不安全游标。

## 字段提议与追加事件

普通事件追加 ClientEventRecorded，仅保存原类型及 payload，不执行其中操作。FieldChangeProposed 必须提供已支持的实体类型/字段、有效实体 ID、明确 value、安全 base_version；缺失或不合法返回 VALIDATION_ERROR。来源未配置、不可用、会话不可见、restricted 无读取权限或字段缺失返回 SOURCE_UNAVAILABLE。base_version 高于来源当前版本返回 VALIDATION_ERROR。

原版本与当前版本相同，或版本较旧但 value 与当前字段规范 JSON 相同，记录 ClientEventRecorded；旧版本且 value 不同，记录 ConflictDetected 并返回 VERSION_CONFLICT、conflict_id 和投递信息。冲突是内存历史观察，不创建真实冲突服务对象、不更新来源字段或版本。已补[冲突生命周期Mock](conflict-mock-runtime.md)：上传批次同步保存双方原值，显式冲突权限可查询与解决，并追加同流历史事件；原上传回执保持。分类继承为原事件与来源的较高者；来源引用保留并追加 client-event 及关联实体。

新增 canonical event 保留原 trace、生成时间、原 client ID、payload 内的发送者和 client_event_id；actor_id 为 ULID 时才出现在事件顶层。每个实际记录占用新的服务端游标，外层下载项 accepted=true 表示流已接收该历史事件，不能误解为原字段提议已应用。冲突上传回执 accepted=false，两者语义不同。

所有候选新增事件先通过 canonical event 与同步页解析器，再与整个流的身份/数量/字节限制核对。上传响应通过共享 parseSyncUploadEnvelope 完整核验、复制、有界输出并再次检查取消/到期，随后在没有异步让出的同步步骤中写账本、批次回执、客户端序号和流。正常可报告失败不会保留部分批次；进程崩溃/内存耗尽不作恢复保证。只读回执、目录和下载不会追加事件。

## 原回执与下载可见性

`getSyncEventReceipt({identity,event})` 使用原完整事件，要求原五项身份等于模拟会话；不得携带批次键或写条件。仅本 store 的上传账本可产生 recorded，种子 changes 不产生回执。没有逐事件记录时返回 not-observed，包括曾被校验/游标/来源拒绝的事件；这不证明从未发送或可重发，也不返回旧批次拒绝理由。

已有记录先核对来源与分类可见性，不可见返回 NOT_FOUND；再核对规范原文，异文返回 EVENT_ID_REUSED。recorded 保留原 original_trace_id、recorded_at、server_event_id/cursor、accepted、必要 conflict_id，并固定 source_application=not-checked；外层使用本次 trace，回显调用方提供的完整原事件。此回显不证明服务器保存过所有额外字段或原 JSON 字节。

新增事件与原种子共享已有 changes 分页和 ack 高水位。upload_access.include_own_uploads=true 时，当前连接可下载由相同完整身份记录的新事件；仍必须通过来源/分类检查。也可以在新连接的 visible_event_ids 中显式列出已经生成的事件 ID，以表达其他读取者的可见场景，仍需 upload_access 和来源/分类能力。没有 upload_access 的旧连接不能看到新上传记录，即使显式列出 ID。原种子事件继续只按显式可见集合过滤。

include_own_uploads 只控制下载目录发现，不限制自己按完整原事件查询回执；回执使用相同来源/分类限制。新事件不会自动确认，末页仍可越过不可见尾部到全流高水位。重放旧批次返回其历史 next_cursor，不降低当前流高水位或任何消费者确认。

## 容量与错误

整个流含种子最多 10000 项、16 MiB JSON；上传账本最多 10000 次实际投递、1000 个原批次，保留的批次规范正文/结果及投递元数据累计最多 16 MiB（编码预算，不是进程内存上限）。来源种子独立受上述种子预算限制。超限 RATE_LIMITED，既有批次重放仍可读取。没有自动删除、回收或持久保存。

请求头和会话沿用既有有界复制；上传响应为共享 256 KiB 上限，原事件查询为共享输入 1 MiB+16 KiB、响应 2 MiB 上限，下载 4 MiB。调用方更小 max_response_bytes 优先；响应太大、取消或过期均在内存提交前拒绝。SDK 仍有自己的等待预算和第二次响应校验。本 Mock 不模拟已提交但网络丢响应，不能用其失败顺序证明真实网络未提交。

配置错误为 MOCK_SYNC_CONFIGURATION_INVALID；路由/请求/权限/项目错误沿用现有代码。账本完整输出无法表示为 SYNC_UPLOAD_INVALID / SYNC_EVENT_RECEIPT_INVALID，流无法完整表示为 SYNC_CHANGES_INVALID；对外均为固定文案、本次 trace、retryable=false，不暴露来源值。

## 接线示例与剩余工作

以下仅文档示例，未执行；scope 使用真实格式的三项 ULID，identity 使用同 scope 和明确 actor/client。

```ts
const store = new MockSyncStore({ ...seed, upload_sources: [] });
const server = new MockWcpServer({
  sync: {
    store,
    session: {
      ...session,
      upload_access: {
        read_restricted: false,
        include_own_uploads: true,
        visible_sources: [],
      },
    },
  },
});
const client = new WcpClient(server, { ...seed.scope, trace_id: 'trace_mock_upload' });
await client.uploadEvents([originalEvent], {
  idempotency_key: originalBatchKey,
  expected_identity: session.identity,
});
const receipt = await client.getSyncEventReceipt({ identity: session.identity, event: originalEvent });
const page = await client.getSyncChanges({ cursor: 0 }, { expected_identity: session.identity });
```

冲突详情/解决和原决定回执已接入独立契约。真实 Policy/认证/审计、动态来源版本变化、外部旧冲突导入、上传账本持久化和种子恢复、网络未知/重启恢复及其余 Mock 路由仍缺。未声明运行兼容性通过；批次重放/事件规范化、序号间隙、冲突与来源可见性、历史回执、同流下载/确认衔接、取消/容量和复制隔离均待后续获准后补运行证据。
