# Canonical Event v1 与 CloudEvents AsyncAPI 消息目录

2026-11-05，TODO **P0-01**、T0.4、R-001 的源码增量。`canonical-events.json` 使用 AsyncAPI 3.0.0，提供当前默认 `CANONICAL_EVENT_TYPES` 全部 38 类事件的可复用 `components.messages`。这是完整消息封套目录，未声明部署服务、通道、发送/接收操作或消息总线绑定；不能从此文件启动生产消费者或推断已有 NATS JetStream 支持。

同日新增 `canonical-cloudevents.json`，为相同 38 类事件提供独立 CloudEvents 结构化消息组件。每条消息显式声明 `contentType: application/cloudevents+json` 并引用 `canonical-cloudevent-v1-catalog.json` 的同名锚点；该锚点同时约束外层 type 和 data.event_type。两个目录分别描述裸事件与包装后的完整对象，不是两个业务事件或两次投递。

## 文件与本地解析

| 包子路径（均属于 `@planemem/events`） | 用途 |
| --- | --- |
| `asyncapi/canonical-events.json` | AsyncAPI 消息组件，每项匹配一种 event_type |
| `asyncapi/canonical-cloudevents.json` | CloudEvents structured JSON 消息组件，每项匹配外层 type 与内层 data.event_type |
| `schemas/canonical-cloudevent-v1-catalog.json` | 完整结构化消息的 38 个类型锚点与根 oneOf 联合 |
| `schemas/canonical-cloudevent.json` | 原 CloudEvents 1.0 八字段封闭配置，data 为完整 CanonicalEvent |
| `schemas/canonical-v1-catalog.json` | 默认 v1 注册类型集合、逐类锚点和完整封套约束 |
| `schemas/canonical-event.json` | 原完整 CanonicalEvent 封套 |
| `schemas/event-types.json` | 原默认事件类型枚举资源 |
| `schemas/work-item-deleted.json` | 原删除事件补充约束 |
| `schemas/work-item-restored.json` | 原恢复事件补充约束 |

读取时保留 `asyncapi/` 和 `schemas/` 的相邻布局。裸事件目录需要注册其五份完整 Schema 的 `$id`，结构化目录需要下述七份；`planemem.local` 只作为资源标识，不是在线下载服务。裸事件目录根锚点为 `RegisteredCanonicalEventV1`，逐类锚点与事件名称完全一致，例如 `#WorkItemRestored`。其定义中的 `#` 引用裸事件目录根规则，`$defs` 自身不作为实例属性；不应把某个 `$defs` 片段单独复制后丢失原资源基址。

原裸目录的每个 AsyncAPI `payload` 使用 Multi Format Schema Object，`schemaFormat` 明确写为 `application/schema+json;version=draft-2020-12`，内部再引用完整资源锚点。它表示消息的全部 CanonicalEvent JSON，而不是其内层 payload。消费工具必须显式支持 2020-12、外部引用和锚点；不能按 AsyncAPI 默认 Schema Object 方言解释。该格式不在 AsyncAPI 3.0.0 的必需支持列表内，工具支持尚待后续验证；本轮未加载解析器、生成器或验证工具。

结构化目录使用同一个 Multi Format Schema 格式，但其中的 AsyncAPI payload 是整个 CloudEvent：业务 payload 位于 `data.payload`。其本地资源图为 `canonical-cloudevents.json → canonical-cloudevent-v1-catalog.json → canonical-cloudevent.json + canonical-v1-catalog.json → canonical-event.json + event-types.json → work-item-deleted.json / work-item-restored.json`。包括新目录共 **七份 Schema**；两个 AsyncAPI 文件不是 Schema 资源。注册各文件自己的 `$id`，不要覆盖为共同 ID 或从 planemem.local 下载。

## 选择消息格式

| 使用场景 | 消息目录 | 消息媒体类型 | 被引用的实例 |
| --- | --- | --- | --- |
| 原有裸 CanonicalEvent | `canonical-events.json` | `application/json` | event_id/event_type/occurred_at 等完整原封套 |
| 经 toCanonicalCloudEvent 转换的对象 | `canonical-cloudevents.json` | `application/cloudevents+json` | specversion/id/source/type/data 等完整结构化封套 |

目录选择不会自动执行转换。新目录不表示原 Webhook、同步或总线已经接受此媒体类型。外层 `datacontenttype=application/json` 只描述 data，不能用它替代整条消息的 contentType。

结构化 Schema 根 `RegisteredCanonicalCloudEventV1` 用 oneOf 选择 38 个逐类锚点；每个锚点直接引用基础 profile，再约束 `type=com.planemem.{事件名}.v1` 和内层同名 CanonicalEvent 锚点，没有回到根 oneOf 的递归。根联合适合尚未选类型的结构审查，消息组件直接引用具体类型。虽然完整 profile 的八字段要求来自复用 Schema，逐类定义仍约束同一个对象，不增加字段或改变原 data。

例如 `#WorkItemDeleted` 同时要求外层 type 为 `com.planemem.WorkItemDeleted.v1`、内层 event_type 为 `WorkItemDeleted`，并继承删除事件的 scoped work_item、project_id、仅 external_id 的 payload 约束。外层声明 WorkItemDeleted 而内层为 WorkItemUpdated 时，不能匹配任何根分支；二者同为 WorkItemUpdated 也不能匹配 WorkItemDeleted 组件。原通用 profile 的类型模式本身没有这种配对约束；使用逐类目录不能省略转换器对 id/time/subject/expected source 等其他关系的核验。

## 覆盖范围

| 分组 | 默认 v1 事件 |
| --- | --- |
| 项目（2） | ProjectCreated、ProjectUpdated |
| 工作项（6） | WorkItemCreated、WorkItemUpdated、WorkItemDeleted、WorkItemRestored、WorkItemStatusProposed、WorkItemStatusConfirmed |
| 计划/决定/风险（5） | PlanCreated、PlanRevisionCreated、DecisionRecorded、RiskRaised、RiskResolved |
| 资料（2） | ArtifactCreated、ArtifactUpdated |
| 会话/执行/工具（6） | SessionStarted、SessionEnded、AgentRunStarted、AgentRunCompleted、ToolCallStarted、ToolCallCompleted |
| 检查点/交接/包（4） | CheckpointCreated、HandoffCreated、HandoffAccepted、ContextPackIssued |
| 上下文条目（5） | ContextItemCreated、ContextItemUpdated、ContextItemArchived、ContextItemRestored、ContextItemConfirmed |
| 冲突（2） | ConflictDetected、ConflictResolved |
| 客户端（3） | ClientConnected、ClientEventRecorded、ClientDisconnected |
| 策略/批准（3） | PolicyDenied、ApprovalRequested、ApprovalCompleted |

裸事件的 canonical-v1-catalog 组合原四份资源：保留原顶层封闭字段、类型、必需字段和删除/恢复条件；event_type 进一步限定到默认注册枚举，aggregate_version 上限为 JavaScript 最大安全整数，occurred_at 要求 Z 后缀并沿原 date-time 格式。每个消息锚点再用 const 绑定确切事件名称，结构化目录继续复用这些锚点，不以名称或路由暗示权限。

除 WorkItemDeleted/Restored 外，原基础 Schema 的业务 payload 仍仅要求 object；不能声称这些消息已经有完整业务字段模型。删除/恢复结构继续来自原两个专用 Schema，恢复的 causation/event ID 相等、版本加一、外部 ID 语义以及删除历史匹配仍由现有运行时/处理器核对。其他生命周期同步投影有独立业务解析器，本目录不替换它们。

`event_id` 用于原事件去重身份，结构化 CloudEvents 的去重身份是 source/id 对；`aggregate_version` 描述聚合版本；可选 `correlation_id`、`causation_id` 与必需 trace_id 作用不同。裸事件目录默认内容类型为 application/json，结构化目录为 application/cloudevents+json；目录不添加协议头、伪造来源、补造关联 ID 或自动提取投递确认。保留 scope、source_refs、sensitivity 只是数据形状要求，不证明调用者有权读取或发布。

## 与现有运行时的关系

此次不改变 `validateEvent`、`EventTypeRegistry` 或内存 `EventConsumerLedger`。原 validateEvent 的缺字段、默认类型/版本、安全整数、UTC 和删除恢复规则继续执行；运行时没有加载这个 JSON 目录。原 JSON Schema 与手写校验器并非完全等价：基础 Schema 拒绝未知顶层字段并限制 client_id，而现有运行时在这些位置更宽松；date-time 格式断言需要消费工具配置，JavaScript Date.parse 的范围也不等同格式断言。目录不掩盖这些差异，也未以更改线上行为来强行对齐。

运行时允许显式注册额外类型/版本，这些自定义值不在默认 v1 目录中。未来新增/变更事件时需要协调更新运行时列表、枚举资源、目录锚点、消息组件与业务契约；仅修改一个列表不能宣称所有消费者兼容。去重/顺序/回放/失败重试、来源权限和业务效果必须由相应消费者实施，现有内存账本不能作为持久消息总线证据。

## CloudEvents 与未完成项

现有 CanonicalEvent 是项目自定义封套，使用 event_id/event_type/occurred_at 等字段；原目录描述裸封套，使用 application/json。独立 [CloudEvents 结构化配置](../../../docs/design/01-contracts/canonical-cloudevents.md) 提供双向转换和基础 Schema，本次新增的结构化 AsyncAPI 目录及类型配对 Schema 描述其输出。这里的 v1 指项目 schema_version=1，CloudEvents specversion 为 1.0，AsyncAPI 文档版本另为 3.0.0，都不代表已经发布。真实通道、传输、消费者接线和兼容运行证据仍属于后续范围。

P0-01 还缺完整 WCP OpenAPI、完整业务 payload 模型、独立完整 MCP schema、SDK/Mock 从机器契约派生或核对的接线、破坏性差异 CI 和运行兼容证据。P0-03 的真实总线另行开发，本目录没有虚构总线 subject、持久订阅、重试或 ACK 语义；CloudEvents 的 subject 只描述事件主体，不是总线地址。

参考标准：[AsyncAPI 3.0.0 固定版本规范](https://github.com/asyncapi/spec/blob/v3.0.0/spec/asyncapi.md)、[CloudEvents 1.0.2 固定版本规范](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md)。仅源码人工审阅、指定格式整理和 Git 文本检查；未执行校验器、生成器、编译、类型检查、测试、事件/消息系统/产品/数据库或发布，R-001/P0-01 保持未完成。
