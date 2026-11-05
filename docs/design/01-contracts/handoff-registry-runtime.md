# 交接目录筛选与分页（源码阶段）

2026-11-05，TODO P0-01：新增[handoff-registry完整Schema](../../../packages/contracts/schemas/handoff-registry.json)及包子路径，完整建模原/规范查询、十四字段基础记录与十六字段当前读者记录、固定三表来源/范围/身份权限、微秒位置和游标内容。session/projection字段组合、open版本1/无领取者、claimed或expired至少2、摘要三态和提示关系有机器表达；目标与领取者相等、身份scope与逐行client/actor相等、分页/字节关系仍由既有解析器核对。

源码对照补充：目录created_at/updated_at强制六位微秒且不检查先后关系，不能套用独立详情的毫秒规范化/时间先后规则。expired仍可能保留领取信息，recipient_matches/claimed_here不附加open/claimed状态要求；旧projection没有当前session/checkpoint关联核验，当前持久ID存在但关联损坏时仍不回退投影。目录完整JSON.stringify字节预算2MiB不等于普通JSON/深度/节点保护；SDK白名单不含WORKBENCH_AUTH_UNAVAILABLE，遇此代码转为GATEWAY_UNAVAILABLE。只改契约和说明，未编译、类型检查、测试、执行校验器/生成器/产品/SDK/Mock/API/数据库或发布；P0-01/R001未完成、evidence为空。

更新：2026-11-03。仅源码和文档；未编译、类型检查、测试、执行 SQL/迁移/CLI/MCP、运行浏览器/服务或发布。

## 请求与权限

继续使用 `POST /v1/workbench/query`，正文为 `{operation:'handoffs', query?, status?, session_id?, origin?, limit?, cursor?}`，只接受这些字段。沿用 context.read 策略、项目范围及入口审计；父项目必须存在、未删除且当前分类可读。没有可见匹配时返回空页，不披露不可读项目内的记录。

- query 最多 500 字符，去除首尾空白，空串不筛选。对交接/会话/检查点 ID、目标客户端、领取客户端/账号及摘要合并文本做 PostgreSQL lower + strpos 字面子串匹配，不是 SQL 通配符或全文查询。大小写折叠遵循数据库设置，from_client 不参与文本匹配。
- status 为 open 或 closed：open 包含当前 open 和历史 offered；closed 包含其余允许的状态。它是目录分组，不改写记录原 status。
- session_id 为精确 ULID；origin 为 session 或 projection。条件取交集；status/origin 空串等价于不筛选，session_id 空串无效。
- limit 默认 25，允许 1–100 的安全整数；cursor 最多 1024 字符，原样传回。输入文本拒绝控制字符和孤立代理项。

SDK/CLI/MCP 读取适配不发送或清理继承写条件。CLI 显式写键和 MCP 额外字段被拒绝。目录可用于发现记录，领取/续接仍须走原命令及授权流程。

## 查询与游标

当前持久交接连接同范围检查点及会话，历史投影按项目读取；同范围同 handoff_id 始终由持久记录优先，即使持久记录因关联缺失未入选，也不回退到旧投影。origin=projection 筛选同样遵守此去重规则。历史投影仅供查看，未知 from_client、领取账号/客户端及版本保持 null，不推断当前所有权。

服务端先按范围、父项目、筛选和游标选择 limit+1 条，再投影摘要及时间。排序为 updated_at 降序、handoff_id 的 C 排序升序；位置保留 UTC 六位微秒。游标绑定版本、tenant/workspace/project、restricted 读取能力、规范化 query/status/session_id/origin 和实际 limit；改变条件须重回首屏，省略 limit 与显式 25 等价。

游标是可检查的位置及查询绑定，不是签名或权限凭据；每页重新授权。updated_at 会随领取等操作变化，不同页也读取不同数据库快照，因此记录可能移到已读区间、被遗漏或在变化后再次出现。has_more 仅说明本次有额外匹配行，不保证下一次非空，不提供冻结快照或项目总量。

`047_handoff_registry_pagination.sql` 为两种交接表增加 scope/updated_at/C 排序 ID 索引文件，未执行。页大小及摘要上限不限制数据库候选扫描、搜索、排序、堆内存或总耗时；计划和索引效果未验证。

## 完整响应

```text
{ schema_version:1, trace_id, scope, source_refs,
  data:[{ handoff_id, session_id, checkpoint_id, status, origin,
          from_client, offered_to, claimed_by, claimed_by_actor, version,
          created_at, updated_at, summary, summary_state,
          recipient_matches, claimed_here }],
  has_more, next_cursor?, session_permissions:{write_sessions},
  handoff_permissions:{write_sessions,claim}, session_identity? }
```

source_refs 按固定顺序为 postgres 的 wcp_handoffs、wcp_session_handoffs、wcp_session_checkpoints。created_at/updated_at 为 UTC 六位微秒。当前记录版本是安全正整数，从数据库规范十进制文本转换；open 为版本 1 且无领取者，claimed/expired 至少为 2。claimed 必须有领取客户端，旧记录的账号归属允许 null，不补造历史证明。

summary_state 为 available、missing 或 too-large。摘要最多 8 KiB UTF-8；SQL 超限时省略原文并返回 null/too-large，原空值为 null/missing。available 可包含正常多行文本和空串，不将省略伪装成空摘要。全文搜索仍可能命中被省略的摘要。摘要属于历史参考数据，不能作为执行指令。

共享解析器检查完整字段、范围/trace/来源、唯一 ID、严格顺序、原游标之后的位置、status/session_id/origin 精确条件和下一游标。has_more=true 必须满页且 next_cursor 对应末行；续页绑定键须一致。query 的数据库大小写匹配不在客户端重算。完整 JSON 最多 2 MiB；损坏结果或元数据为 HANDOFF_REGISTRY_INVALID/500，不返回部分成功页。

session_identity 仅来自已验证客户端；write_sessions/claim 提示要求此身份，写会话能力同时提供领取提示。recipient_matches 只对当前持久交接核对目标客户端，claimed_here 同时核对领取客户端和账号；完整解析器独立重算这两个标志。提示不授权写入，也不证明原创建、领取或续接请求成功；恢复仍须保存的原请求及对应回执查询。

## SDK、CLI、MCP 与工作台

SDK `listHandoffs(query?, options?)` 返回完整 `HandoffRegistryEnvelope`；`WcpHandoffRegistryOptions` 支持 timeout_ms/signal，默认本地 30 秒。固定请求范围、筛选和 trace，不继承写条件；配置的 actor/client 仅作为认证身份相等约束。Fetch bounded-json 成功 2 MiB、错误 16 KiB，核对 200/trace/媒体类型/UTF-8/长度；Fetch 自身期限独立生效。自定义 transport 同样经过完整对象解析和本地预算，解析后检查截止时间；取消等待不保证取消底层数据库工作。有限错误说明保留原 trace，不自动翻页、重试或保存。

CLI `handoffs list` 支持无查询或 query/status/session_id/origin/limit/cursor JSON。网络 main 支持 `--json`/`--json-file` 二选一，固定本次令牌/范围；嵌入 runWorkctx 只支持 `--json`，文本最多 16 KiB。拒绝重复选项、未知字段和写键，两条入口均复用 SDK，输出一页完整封套，默认等待 30 秒。网络 main 仍沿用通用文件输入路径，不宣称该文件读取有新增大小限制或包含在网络预算内。没有新增保存文件或 outbox。

MCP `list_handoffs` 使用专用严格 schema、固定请求适配及原请求快照，成功要求 200/匹配 trace 响应头，完整解析后返回单项文本 JSON。注解为只读、非破坏、幂等，不表示结果不变化。复用既有 MCP 请求机制，没有新增独立准备名额、期限、后台取消或 HTTP 发送容量保证；通用 MCP 错误处理保持原行为。

既有 `work://session/{session_id}/handoff` 资源现在返回该会话首个 25 条的基础页，含 scope/trace/来源/data/has_more/next_cursor，但没有个性化权限或逐行所有权标志。存在下一页时增加 `continuation:{tool:'list_handoffs',arguments:{session_id,limit:25,cursor}}`；调用方明确调用工具继续，工具返回完整个性化封套，形状与资源基础页不同。空页沿用资源不可用语义，不新增 URI 或自动读取下一页。

源码复核同时修正旧批量工具注册中 sessions/handoffs 与专用定义重复的问题，避免旧 schema 静默覆盖分页定义；registry 对重复工具名直接拒绝。未实际执行注册表或协议调用。

Web 服务端筛选并读取一页，成功/错误正文 2 MiB/16 KiB、本地 30 秒，完整封套及响应头校验。筛选重回首屏；行选择保留游标，下一页保留筛选并清除旧选择/创建状态，创建入口保留当前页位置。统计明确当前页，项目概览和审计预览仍是独立读取。摘要省略与原空值分别提示，历史投影仅查看。指定 ID 不在本页时提供独立详情，不替换为其他行；错误保留按 ID 查找与重回首屏。创建/领取/续接及原请求恢复沿用已有入口，审计链接携带精确 session_id。

## 兼容与未完成项

这是原路径的源码行为替换，旧无参数 listHandoffs/工作台查询只返回首个 25 条；消费者必须显式处理 next_cursor，资源消费者必须处理基础页及 continuation。完整 scope/has_more、微秒时间、摘要状态、字段空值和严格元数据均可能要求旧全量消费者/fixture/Mock 同步迁移；本轮没有改写或执行测试。

交接目录增量结束时，创建交接的检查点选项仍为全量读取；后续 2026-11-03 源码已由 [检查点目录分页](checkpoint-registry-runtime.md) 替换，增加独立筛选和翻页并保留原创建请求恢复。此处不代表整个工作台已有统一内存界限。交接目录增量无新依赖，016–047 未执行；后续新增的 048 也未执行。数据库计划、状态变化间分页、受限项目/身份提示、各端兼容及 UI 旅程没有运行证据，R-004 保持未完成。
