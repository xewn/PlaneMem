# CanonicalEvent 的 CloudEvents 结构化配置

2026-11-05，TODO **P0-01** / T0.4 / R-001 的源码增量。新增 `@planemem/events` 导出的 `toCanonicalCloudEvent(event, {source})`、`fromCanonicalCloudEvent(value, {source})`，以及 `schemas/canonical-cloudevent.json` 包子路径。两个函数同步接收对象、返回独立普通 JSON 副本；不会发送消息或调用原事件处理器。

这是 PlaneMem 对 CloudEvents 1.0 structured JSON 的封闭配置，只覆盖默认 38 类 schema_version=1 的 CanonicalEvent。依据固定版本 [CloudEvents 1.0.2](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md) 和 [JSON Event Format](https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/formats/json-format.md)，外层 `specversion` 为 `1.0`；1.0.2 是规范修订号，内层 schema_version 和 AsyncAPI 3.0.0 也是不同版本维度。本轮未运行标准兼容验证。

## 字段映射

| 外层字段（全部必填） | 固定值或原事件映射 |
| --- | --- |
| specversion | `1.0` |
| id | 原 event_id |
| source | 调用者显式提供的稳定来源 URI |
| type | `com.planemem.{event_type}.v1`，保留事件名称大小写 |
| datacontenttype | `application/json` |
| subject | `encodeURIComponent(aggregate_type) + '/' + aggregate_id` |
| time | 原 occurred_at，不重写时间或小数精度 |
| data | 完整原 CanonicalEvent，包含 payload、scope、source_refs、trace 和 sensitivity |

`CANONICAL_CLOUDEVENT_CONTENT_TYPE` 为 `application/cloudevents+json`，指完整外层的序列化媒体类型，不能用来标记原裸 CanonicalEvent。`datacontenttype` 只描述 data；data 是 JSON 对象，不是二次编码的字符串。原 [AsyncAPI 消息目录](../../../packages/events/asyncapi/README.md) 仍描述裸 CanonicalEvent，不能直接把目录的消息改用这个媒体类型。

正向转换要求 source 是 1–2048 个 ASCII 字符的绝对 URI：有 scheme 和非空后续内容，仅接受 URI 字符、完整百分号转义，拒绝空白/控制字符，并可由 `URL` 构造器解析。返回值保留原 source，不使用解析器的规范化结果；例如 `urn:planemem:producer:plane`。相对 URI 虽可用于通用 CloudEvents，本配置不接收。反向转换必须提供预期 source，以原字符串精确比较；大小写、百分号形式或尾斜线不同不会合并。source 不从不可信事件自行选取，也不通过网络访问。

调用方需要为实际来源选择稳定且合适的范围，并保证同一 source/id 对应同一事件。转换器不登记唯一性、不验证来源身份或租户授权。旧内存 EventConsumerLedger 仍只按 event_id 去重；不能直接当作跨来源 CloudEvents 去重存储。

## 输入与错误边界

完整结构化对象经 JSON 序列化后最多 **1 MiB**（`MAX_CANONICAL_CLOUDEVENT_BYTES`），包括新加的外层；裸事件刚好达到此限额也可能在包装后超限。复用 `syncJsonSnapshot` 的普通有限 JSON、最多 64 层及 100000 节点限制；拒绝访问器、隐藏或 symbol 字段、非普通原型、稀疏数组、循环、undefined、非有限数和不成对的 UTF-16 代理字符（包括键）。转换先复制再检查，不返回调用者对象。此限额是序列化字节量，不是内存占用或 CPU 时间保证。

内层顶层字段封闭；默认 `validateEvent` 负责必填字段、38 类注册类型、schema_version、安全聚合版本、来源引用、分类、payload 对象和删除/恢复的现有规则。本配置额外限定 ID 恰为 26 字符、client_id 若存在必须非空。普通业务 payload 的完整模型仍待补齐，不能把成功转换当作所有业务入口已认可该事件。

时间为本项目 RFC3339 UTC 子集：0001–9999 年的有效公历日期，精确 `T`/`Z`，小时 00–23、分秒 00–59，可无小数或有 1–9 位小数。手工检查闰年与月天数；不接受时区偏移、闰秒或 Date.parse 宽松归一化日期。原时间文本及精度不变。这些限制只作用于新转换器，不修改旧 validateEvent 的接受范围。

反向转换只接受恰好八个外层字段，逐一匹配 id/type/source/subject/time 和两个固定字段。拒绝额外扩展、dataschema、data_base64、缺省或 null 的 profile 必填字段，不忽略后继续解包。CloudEvents 标准本身允许更多形式，本函数不是通用 CloudEvents SDK。

任一失败抛出 `ContractError`，固定代码 `CLOUDEVENT_VALIDATION_FAILED`、固定消息、空 details 和 retryable=false，不回显 payload 或底层异常。从已复制内层中读到非空、最多 1024 字符且无控制字符的 trace_id 时保留它；复制、外层形状或 trace 不满足条件时使用 `trace_unknown`。trace 仅用于关联，不代表认证。

函数不解析原始 JSON 文本，不证明原文本无重复键或保留其数字词法。已有对象遵循 JavaScript JSON 数字精度，payload 的超大精确整数应由业务模型定义字符串表达；不要在解析后声称恢复了原始整数精度。传输层若接收文本，仍须限制原字节量、检查 UTF-8、媒体类型及自身的重复键策略。

## Schema 与接线范围

新增 JSON Schema 2020-12 根锚点 `CanonicalCloudEventV1`；本地加载此文件和原五份事件 Schema，保留相邻布局及资源 `$id`。`data` 复用 canonical-v1-catalog，继续限定默认类型、完整封套和删除/恢复结构；新增外层必填/封闭字段、source 词法、时间和 ID 长度。相等关系、source 的 URL 解析、业务语义、时间日历、完整字节/节点/深度和 Unicode 标量要求由转换器执行，不能只用 Schema 宣称同等验证。日期与 URI 的 format 断言还取决于消费工具配置。

不增加传输通道、HTTP binary 模式、批量格式、认证、持久总线、投递 ACK、自动重试或权限行为；现有 Webhook、同步、SDK 和消费者未自动切换到此格式。AsyncAPI 的结构化消息引用与真实传输接线、完整 payload、完整 WCP/MCP schema、SDK/Mock 消费机器契约和破坏性差异 CI 仍须按 TODO 后续完成。

本次只做源码文档人工审阅、指定格式整理和 Git 文本检查；未编译、类型检查、测试、运行校验器/生成器/事件/产品/API/数据库或发布。P0-01/R-001 保持未完成，evidence 为空。
