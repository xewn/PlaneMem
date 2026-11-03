# 旧上下文索引管理（开发状态）

2026-11-02：只修改源码和文档，未编译、类型检查、测试、启动服务、执行迁移或发布。新增 `033_legacy_context_lifecycle.sql` 只写文件，依赖 032 的分类、到期和删除字段。

## 入口

| REST | 策略能力 | SDK | CLI | MCP |
| --- | --- | --- | --- | --- |
| `GET /v1/context/index` | context.read | listLegacyContextIndexes | index list | list_context_indexes |
| `GET /v1/context/index/{id}` | context.read | getLegacyContextIndexStatus | index status | get_context_index_status |
| `POST /v1/context/index/{id}/delete` | context.write | deleteLegacyContextIndex | index delete | delete_context_index |
| `POST /v1/context/index/{id}/restore` | context.write | restoreLegacyContextIndex | index restore | restore_context_index |

所有入口要求令牌身份，写入还要求已验证客户端和稳定请求键。请求中的项目范围须与令牌一致；状态和回执均在当前项目、当前记录分类下读取，不可见或缺失统一返回 404。restricted 需要 data.restricted.read。HTTP 和 MCP 调用均经过现有策略、审计和限流，并绕过进程响应缓存。

状态查询只接受路径 ID，不接受 URL 查询参数；CLI/MCP 对应输入为 `{ "id": "note-1" }`。返回 ID、范围、revision、classification、expires_at、deleted_at、updated_at、数据库检查时间 checked_at，以及 state=active/expired/deleted 和 managed_by=manual/plane。时间统一为 UTC 毫秒字符串；state 按这些返回时间计算，代表该次读取时的状态。状态不含 title/snippet/source_refs，已删除或已过期记录也可供有权限的调用方管理。active 仅表示本地未删且未过期，不表示来源当前有效。

## 删除和恢复

输入为 `{ "id": "note-1", "expected_revision": 4, "reason": "内容已被新记录替代" }`；HTTP 路径提供 id 时可省略正文 id。reason 必填，最多 2000 字符，首尾空白规范化。expected_revision 为 0 到 MAX_SAFE_INTEGER-1；不能静默舍入 BIGINT。请求键可由 Idempotency-Key 头或正文 idempotency_key 提供，二者同时出现必须一致。可选 If-Match/If-Match-Version 必须与正文 expected_revision 一致，正文版本不能省略。

仅手工索引可操作；`plane:` 前缀由事件链路管理，修改会被拒绝。每次首次成功操作将 revision 加一并更新 trace/时间。删除只设置本地 deleted_at，正文仍保留；旧搜索和旧 MCP 资源读取按现有过滤立即排除该记录。已删除记录不能通过 context.index 写入复活。

恢复仅清除 deleted_at，保持正文、来源、分类和 expires_at；过期记录恢复后 state 仍是 expired，不会重新进入搜索。需要修正正文或到期时间时，在恢复后读取新 revision，再使用更高 revision 的 context.index 显式更新。删除活动或过期记录均允许；恢复未删除记录、删除已删除记录、原版本不匹配均返回 CONTEXT_INDEX_VERSION_CONFLICT/409。索引 ID 不能为 `.` 或 `..`，避免 URL 路径折叠。

## 事务与重试

删除/恢复与 context.index 共用范围/ID 事务锁，并锁定当前项目和记录。版本变化与 `wcp_context_index_mutations` 回执在一个事务中提交。表中保存原 actor/client、操作、请求键、规范化参数指纹、trace 和元数据回执，不复制索引正文。

请求键按 tenant/workspace/project/actor/client/**操作** 隔离，delete、restore 和原 context.index 各自拥有回执空间。相同操作/键但参数不同返回 IDEMPOTENCY_KEY_REUSED；同键同参数在权限仍允许时返回原回执，不再次改变版本或删除状态。回执包含 operation/request_key/expected_revision/reason/record，SDK/CLI 核对原请求、范围、版本、状态和日期一致性。损坏数据返回 SEARCH_RESULT_INVALID/500，存储不可用返回 CONTEXT_PERSISTENCE_UNAVAILABLE/503。

回执 record 是操作当时的元数据。删除成功后再恢复，重放原删除仍返回历史 deleted 回执，当前状态继续保持恢复后的状态。读取状态确认当前 revision 后才发起新的命令；网络结果未知时保留原操作、参数、身份和键重试。历史回执可在当前记录过期或删除后读取，因为它没有索引正文；项目删除或当前/历史分类不可读时仍拒绝，拒绝不代表原命令未提交。

CLI 示例（仅文档，未执行）：

```text
workctx index status --json-file index-query.json
workctx index delete --json-file index-delete.json --key index-delete-001
workctx index restore --json-file index-restore.json --key index-restore-001
```

SDK 写入方法接收 `LegacyContextMutation` 和 `{ idempotency_key }`；expected_revision 在业务输入中，区别于其他接口的 expected_version。

## 保留的边界

本地软删除不是数据清除，也不会调用外部 memory 删除/恢复。已 capture 的外部副本仍可能从外部 recall 返回；外部补偿、来源级联和数据留存工作尚未实现。恢复不证明外部来源有效，不延长保存包或其他已到期内容的寿命。尚未新增同步事件、索引正文编辑页面或 MCP resources/list 持久目录；旧投影组合读取的内存缓存问题仍按旧搜索文档追踪。

## 元数据目录与工作台增补

2026-11-02 开发增补，仍未编译、类型检查、测试、启动服务或发布。`034_legacy_context_directory.sql` 为 ID 排序增加索引并记录迁移号，仅写文件、未执行；目录查询正确性不依赖该性能索引，管理写入仍依赖 032/033。

`GET /v1/context/index` 接受 query（最多 500 字符，按 ID 忽略大小写做字面包含）、state（all/active/expired/deleted）、managed_by（all/manual/plane）、limit（默认 25，1–100）和 cursor。省略筛选时查询所有状态及来源；已删除优先于已过期，两类不会重叠。返回 data.scope、data.items 和可选 data.next_cursor。仅返回元数据，没有标题、正文或来源引用。

每次查询限定当前项目、项目/记录可见性和分类；按 ID 的 C 排序继续，只取当前页及一条额外记录判断续页，不返回隐藏记录计数。游标绑定项目范围、restricted 能力和规范化筛选；改变这些条件后须从第一页开始。游标不是授权凭据，使用时仍重查权限。页面中所有记录和到期筛选使用同一次数据库时间、毫秒精度，与状态契约一致。分页是当前视图，写入/恢复/到期可改变后续页成员，不提供一致性导出快照。

SDK `listLegacyContextIndexes(input)`、CLI `index list`、MCP `list_context_indexes` 共用查询和响应解析器；SDK/CLI 核对返回范围、页大小、重复 ID、状态/来源筛选和续页字段。MCP 元数据目录是独立工具，不表示 resources/list 已实现持久分页。

工作台 Context 页增加 Manage indexes，进入 `/context/index`；页面默认显示手工索引，可筛选状态、按 ID 查找和翻页。每条进入独立 `/context/index/detail?id=...`，显示状态、版本、分类、到期/删除/更新时间以及数据库读取时间。Plane 记录显示只读；手工记录依据网关返回的 index_permissions.write 显示可用操作，最终仍由提交时策略和数据库检查决定。

状态接口额外返回当前调用方自己的 index_identity（tenant/workspace/project/actor/client）。工作台将该身份、操作、原 revision、理由、确认和请求键保留在表单中；提交和刷新使用原项目及 x-expected-actor-id/x-expected-client-id 前置条件，账号、客户端或项目变化时拒绝改由新身份执行原请求。此身份信息不是授权凭据，身份仍由令牌确定。

理由变更或显式采用当前记录会生成新键并撤去确认。网络响应缺失、回执不匹配和未知结果锁定原请求；后续 401/403/404/409 不会解除已有未知状态。原地刷新只更新读到的状态和权限，不替换原版本、身份、理由或请求键。只有核对匹配的原回执后才确认成功，回执保持历史含义；随后须刷新并显式准备下一请求。草稿仅保留在当前打开页面，关闭或完整重载会丢失；页面不自动跳转、不以读取到 deleted/active 推断原写入已成功。
