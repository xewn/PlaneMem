# 冲突决策原请求回执

更新：2026-11-03。只开发源码与文档，未编译、类型检查、测试、调用接口、运行服务/浏览器、执行迁移、部署或发布。R-006 仍未完成。

## 原请求与绑定

新增 `POST /v1/conflicts/receipt` / `conflict.receipt`。它查询已有原决定及同步事件，不调用 resolve、不生成新键、不写冲突或自动重试。入口策略和审计仍执行；allowed 只表示此次入口授权。

输入只接受 `identity`、`request_key`、`command`。identity 是原提交时保存的 tenant_id/workspace_id/project_id/actor_id/client_id，必须与当前已验证、未过期且具有 conflict.resolve（或管理员角色）的上下文完全相同。identity 是相等前置条件，不是凭据；context.read 单独不足以查询回执。

command 必须保留原请求的完整有效输入，包括有效路由 conflict_id、有效 expected_version、resolution 和仅在 merge 时存在的 merged_value。有效 expected_version 是原 If-Match/上下文实际使用的数字版本，不能从当前冲突版本重新推导；必须是可安全加一的正整数。旧 ID 沿用冲突详情约束，允许非 ULID。额外原 body 字段全部保留，即使原处理器忽略过它们；不能删字段、补字段或改值以适配当前视图。原 command.idempotency_key 如存在必须与 request_key 相同；原身份字段如存在也须与 identity 相同。

示例是格式说明，不是已执行命令或可替代原请求的模板：

```json
{
  "identity": {
    "tenant_id": "original-tenant",
    "workspace_id": "original-workspace",
    "project_id": "original-project",
    "actor_id": "original-account",
    "client_id": "original-client"
  },
  "request_key": "the-original-key",
  "command": {
    "conflict_id": "the-original-conflict",
    "expected_version": 1,
    "resolution": "server"
  }
}
```

服务端复用原 `commandReceipt`：键摘要由原 actor/client/request_key 得出，参数指纹取规范原输入，覆盖有效 conflict_id/expected_version，仍去除 idempotency_key。回执查询不改动旧指纹格式，也不写入决策事务；后续恢复增量对写事务的保护另见 conflict-recovery-runtime.md。共享解析对完整原 JSON 做分离副本和键顺序规范化，保持数组顺序、字段存在性和 JSON 值；不会把原 local/server 选择补成当前复制值，也不会把缺省 merged_value 补成 null。

新查询接受有限 JSON：最多 1,000,000 字节 UTF-8，深度最多 64、访问节点最多 100,000；拒绝循环、稀疏数组、非有限数字、undefined、getter、非普通对象等会在 JSON 序列化时丢失的信息。JSON 数值遵循已有 JavaScript 命令语义；本接口不恢复原十进制文本，也不声称补齐任意精度写入。旧请求不满足新查询边界时只能保留未知状态，不能修剪后重新查询。

## 当前可见性与记录核验

使用一个只读 SQL 语句读取 scoped wcp_conflicts 和对应 wcp_sync_events。核对父项目未删除/合法分类、原三层范围、现有 visibleConflicts 的保存及当前来源分类，并限制原事件保存的 sensitivity。不可读、已删除来源或隐藏事件与缺失目标统一 CONFLICT_NOT_FOUND；权限改变不会通过回执旁路取出旧信息。

SQL 只输出最多 16 KiB 的校验元数据，不输出保存的 key/fingerprint 或复制值。服务器内部比较摘要与指纹，并核对事件的类型、ID、范围、aggregate ID/version、client、actor、时间、trace、实体/字段、选择和已保存 resolved_value。一致的 merge 还核对原 merged_value；SQL 内比较 JSONB，不把复制值加载进应用再比较。旧非 ULID conflict_id 的事件 aggregate_id 沿用原 writer 的 event_id 规则。

| 观察结果 | 响应 |
| --- | --- |
| 可见记录 open，且没有任何保存决策字段 | 200，status=not-observed |
| 已有完整绑定，但不是当前原身份/键的摘要 | 200，status=not-observed，不披露另一请求的键或结果 |
| 相同键摘要、不同原参数指纹 | 409，IDEMPOTENCY_KEY_REUSED |
| resolved 缺少键/指纹/事件绑定 | 409，CONFLICT_RECEIPT_LEGACY_UNVERIFIED |
| 原键/指纹及记录/事件元数据均一致 | 200，status=recorded |
| 损坏、矛盾、超限或缺少所需事件 | 500，CONFLICT_RECEIPT_INVALID |
| 存储未配置或不可读 | 503，CONFLICT_STORAGE_UNAVAILABLE |

not-observed 是这次数据库快照没有观察到匹配回执，不证明原提交失败、冲突未解决或允许生成新决定。未提交事务可能在此读取之后完成；查询没有锁住或取消原写入。旧记录无法核实也不等于原请求未成功。

## 响应与各入口

完整成功封套为 schema_version=1、请求 trace_id、source_refs 和 data，最多 2 MiB。data 总是携带原 identity/request_key/command，客户端对整个原请求做规范 JSON 比较；not-observed 没有其他结果字段或来源引用。recorded 的 receipt 包括 conflict_id、十进制字符串 version/server_cursor、resolution、event_id、actor/client、recorded_at、original_trace_id 以及 source_application=not-checked；source_refs 只引用匹配的 event。

查询结果不包含复制值、当前写用 ETag、原指纹、当前详情或源实体已应用保证。版本须精确等于原 expected_version+1；不能把历史版本当成新的写入前提。响应只回显查询者自己提交的完整原命令，不从数据库补出遗失的命令。

SDK `getConflictReceipt(original, options?)` 始终核对原三层范围与 SDK 范围，并核对 SDK 上下文中已提供的 actor/client 约束；完整原 actor/client 始终通过预期身份头交给 Gateway 对可信五字段身份完全核对。普通字符串账号可使用仅三层范围/trace 的 SDK 上下文，避免通用构造器的旧 ULID actor 限制，不修改原身份或放宽 Gateway 验证。清除继承写条件。默认本地 30 秒，可传 timeout_ms/signal；bounded-json 成功限 2 MiB、错误限 16 KiB，校验成功 200/trace/媒体类型/UTF-8 和完整封套，解析后再次检查期限。未知错误仅返回有限说明，不自动写入或重试。

CLI `conflicts receipt --json-file ORIGINAL.json` 现在通过专用入口，在网络/嵌入均复用提交端的有界正规文件读取：1 MB、严格 UTF-8、前后变化检查与完整原请求/范围解析。也支持内联 --json（解析前限 1 MB），可选 --timeout-ms（默认 30000），拒绝 --key、未知及重复选项。嵌入固定原上下文和完整请求、清除继承写条件、核对完整五字段身份/传输形状，并在读取/派发/返回时检查可信未过期 resolver，遵循 SDK 取消信号。文件 I/O 不包含在 SDK 本地期限内。网络旧 `--json -` stdin 兼容分支仍使用通用读取，不获得新文件预分配保证，也不接受 --timeout-ms；嵌入不支持 stdin。查询不入 outbox、不修改文件、不生成键或自动重试。新决定文件准备见 [固定原请求提交](conflict-submission-runtime.md)。

MCP `get_conflict_receipt` 使用相同输入，发现和调用要求已验证未过期的 resolver。固定请求副本后派发，核对 200/trace 和完整原请求封套；没有新增 MCP JSON-RPC 外层/二次转义/发送/容量/期限保证，内层限制不是全局分配保证。

Web `/conflicts/receipt` 允许有界导入或粘贴原请求，先审阅身份、键、版本、选择与完整原命令，再显式查询。一次加载后不编辑/替换原请求；失败、legacy 或 not-observed 均保留原输入，可再次查询或导出。查询通过当前服务端会话及预期身份头，双端完整解析，默认 30 秒有界上游读取；错误不回显原上游正文。详情、审计、登录和另一个回执入口均新标签页打开。导出只声称浏览器下载已请求，不声称保存完成。

目录/详情查找区在成功和失败时均提供新回执入口。回执页不依赖目录或当前详情成功，不扫描或改写浏览器存储，也不自动查询、生成键或提交决定。

## 剩余范围与证据

复用 005/013 及现有分类存储，无新依赖或 SQL 迁移；016–049 仍未执行。后续 [原请求保存与恢复](conflict-recovery-runtime.md) 已补 Web 提交前完整身份/原请求保存、浏览器事务保存/关闭标签页后恢复、旧标签页副本独立读取和固定原请求重发，并加固旧决策事务；未准备的编辑草稿、跨设备备份与真实恢复证据仍缺。没有原请求的旧表单状态不能由当前详情伪造恢复。

没有数据库内部 JSON 比较、查询成本、全进程分配或底层取消保证。真实 SQL/旧指纹兼容、原身份、并发提交、跨范围/权限、legacy、数值/大小、协议和网页交互均缺运行证据；Mock/fixture 与外部消费者仍待补齐。所有状态仅源码检查，未运行验证。
