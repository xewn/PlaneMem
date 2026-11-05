# JetStream 事件总线（源码开发）

对应原始 TODO **P0-03：接入真实 NATS JetStream 事件总线**。本轮加入官方 Node 客户端、PostgreSQL 事务发送队列、发布确认、持久消费者、消费回执、重放起点和运行状态接线。新增依赖固定为 @nats-io/transport-node 与 @nats-io/jetstream 3.4.0，锁文件已更新。只开发源码；未编译、类型检查、测试、启动服务、执行迁移或发布，P0-03/R-001 未完成。

## 实际业务接入

`appendSyncEvent` 在原业务事务中同时写 `wcp_event_bus_outbox`：覆盖当前调用它的上下文条目、保存包、建议、同步上传和冲突解决。Plane 观察通过 `persistPlaneEventInTransaction` 在观察/索引事务结束前入队，保留完整原 CanonicalEvent，包括 sensitivity、actor/client 和来源；不从缺少这些字段的旧 wcp_events 行重新拼造事件。

队列保存完整原事件及 tenant/workspace/project/aggregate 组成的排序键，同 event_id 同 JSONB 内容可重放，不同内容拒绝事务。入队保留既有有限 JSON 约束并限 16 MiB；网络事件限 **1 MiB 减 4 KiB**，为 NATS 消息头预留空间。无法按总线契约发送的行保留为 rejected，阻塞同聚合的后续事件，其他聚合继续。

**050 迁移尚未执行。更新后的业务写入需要该迁移，即使后台发送尚未启用，也会持久入队。** 关闭发送保留积压，不丢弃事件、不切换内存。迁移不回填旧历史；会话/运行/检查点/交接、资料等尚未调用统一事件写入的路径不在本轮生产者覆盖内。

## 发布、重试和持久性

Gateway 使用独立 PostgreSQL 连接池与后台循环。每次以 SKIP LOCKED 取一条到期记录，并排除同聚合仍有较早未发布记录的候选；持有行锁等待最长 5 秒的 JetStream 发布响应。只有核对 stream/sequence 的确认回执才标记 published；数据库提交与 NATS 并非同一事务。

网络确认丢失或数据库提交失败，记录继续 pending，原 event_id 作为 Nats-Msg-Id 重试；退避从 1 秒递增，最高 60 秒。JetStream 去重窗口配置为 120 秒；超过窗口或确认丢失仍可能重复投递，不能宣称网络 exactly-once。消费者数据库回执承担业务去重。

流使用文件存储、Limits retention、无自动年龄淘汰、DiscardNew，默认最大 1 GiB，副本数显式 1 或 3。达到容量上限时发布失败并保留数据库积压，不自动删除旧事件。代码不更新不匹配的现有流配置、不执行 purge/delete。存储扩容、历史归档/保留策略和容量处置仍需后续实现。

数据库绑定 stream 名、subject 前缀和原始 stream creation time，防止删除重建后把新空流当成原历史。检测到替换时拒绝启动，需要明确恢复流程；该绑定本身不证明备份完整性，也不能检测同 creation time 的不完整外部恢复。

## 持久消费者与重放

`PlatformServerOptions.event_bus.consumers` 接受最多 16 个固定、互不重复名称的可信服务消费者。只配置环境变量时启动发布器，**不会自动新增业务消费者或改变已有投影方式**。消费者采用 durable pull、Explicit ACK、max_ack_pending=1、60 秒确认等待和无限次投递；处理期间每 10 秒发送 working。跨副本使用同一名称须绑定相同处理器和存储语义。

消息先按完整字节、UTF-8、CanonicalEvent、Content-Type 和 subject/范围核对；处理器收到独立副本。每条消费在 PostgreSQL 事务中锁住 consumer+event_id，检查原消费回执；同内容重复不再执行处理器，不同内容保留拒绝证据。处理器通过传入的 tx 完成数据库修改，原事件回执与修改一起提交，再执行双向 ACK。业务处理失败则事务回滚、延迟 NAK；ACK 不明时保留已提交回执，重复交付不重复执行该处理器。

处理器必须只用提供的事务执行数据库副作用；外部 HTTP、独立事务、发送邮件等不能获得这一原子保证。数据库语句分别受超时约束，任意处理器代码没有硬性总期限；stop 发出 AbortSignal，等当前处理结束后再关闭连接，不伪称外部副作用已取消。

无效消息或 event_id 异文先写 `wcp_event_bus_rejections`，然后 term；保存原 stream/sequence/subject、SHA-256、长度和限额内原字节。超限仅存摘要与长度。拒绝证据写入失败或位置不能可靠表示时不 term，继续等待重投。拒绝台账需要独立审阅/清理，目前没有管理 UI 或自动丢弃。

新消费者默认从保留历史首条开始；可显式提供 start_sequence。已有名称只允许相同投递配置，不自动删除、重置或覆盖游标。重建业务投影应使用**新的消费者名称和隔离的目标存储**，否则原处理器仍可能重复外部或非幂等操作；原名称继续按数据库回执去重。重放只覆盖流内保留历史，不补造缺失历史或缺失生产者事件。

## 配置和接线

环境配置默认 EVENT_BUS_ENABLED=false；显式 true 要求 DATABASE_URL、NATS_URL（逗号分隔端点），可选 NATS_TOKEN。支持 EVENT_BUS_STREAM、EVENT_BUS_SUBJECT_PREFIX、EVENT_BUS_REPLICAS 和 EVENT_BUS_MAX_BYTES。端点禁止嵌入凭据；更完整的 TLS/凭据回调通过显式 event_bus.connection 配置。启动失败不回退内存，普通断线由官方客户端重连。

Node 入口是 `@planemem/events/jetstream`，不从浏览器共用的 events 根入口导出。原始 CanonicalEvent JSON 的 subject 为：

```text
<prefix>.<tenant_id>.<workspace_id>.<project_id 或 _>.<event_type>
```

消费者 filter_subject 必须位于配置前缀内，具体权限仍由内部 NATS account/ACL 和可信处理器负责。这不是面向终端用户的订阅 API；受限事件不会借此绕过业务 API 的读取权限。

以下仅为**未执行的接线形状**；projectEventHandler 由拥有相应业务表的服务实现，必须使用传入事务。

```ts
import { createPlatformServer, type DurableEventConsumer } from '@planemem/api-gateway';

declare const projectEventHandler: DurableEventConsumer['handle'];
const server = createPlatformServer({
  event_bus: {
    connection: { servers: ['nats://nats:4222'] },
    stream: 'PLANEMEM_EVENTS_V1', subject_prefix: 'planemem.events.v1',
    replicas: 1, max_bytes: 1024 * 1024 * 1024,
    consumers: [{ name: 'project_projection_v1', handle: projectEventHandler }],
  },
});
// 本轮不调用 server.start() 或执行任何示例。
```

Compose 仅新增默认关闭的配置，并给现有 NATS 命令补监控端口参数，使其与原 healthcheck 地址相符；未启动或变更任何运行中的容器。独立单机 Compose 保持副本数 1；副本数 3 需要真正的 NATS 集群。

## 观察与剩余工作

`/health`、`/health/ready` 接入启用后的总线状态；连接、发布、消费者处理、采样失败及拒绝记录会使总线不就绪。`/metrics` 输出数据库积压/拒绝/最早积压时间、流消息/字节和消费者 pending/unacknowledged；每 30 秒后台采样，90 秒失效，失败不把旧数值当当前值。计数是集群队列视图，不能把多个 Gateway 副本相加；本进程 receipt/failure 指标会随进程重启清零。指标不包含事件正文或身份凭据。

剩余项：未接入的生产者和实际业务投影处理器、既有历史导入与全量恢复、拒绝审阅/重新调度、容量归档/保留策略、指标告警接线、AsyncAPI 实际传输绑定、CloudEvents 传输，以及真实 NATS/PostgreSQL 的兼容、重启、多副本、重复/乱序、恢复证据。旧 EventConsumerLedger 仍供离线 fixture，不是此生产路径的回退。

实现参考官方 [nats.js](https://github.com/nats-io/nats.js/tree/v3.4.0) 的 Node/JetStream 类型与消费者接口，以及 [JetStream consumers](https://docs.nats.io/nats-concepts/jetstream/consumers) 的 durable、ACK、起点和重投语义；未执行其示例。
