# 冲突独立详情

更新：2026-11-03。只开发源码与文档，未编译、类型检查、测试、调用接口、启动浏览器或服务、执行迁移、部署或发布。R-006 保持未完成。

## 接口与访问

新增 `GET /v1/conflicts/{conflict_id}`，内部操作 `conflict.read`。ID 使用已有同步标识符约束，允许旧非 ULID 标识，不接受 `.`/`..`；客户端按一个路径段编码。只接受路由 ID，不接受查询参数、正文、写入键、版本或条件缓存/Range 请求。成功返回 200 和 private/no-store，缺少或不可见返回同一 404 / CONFLICT_NOT_FOUND。

沿用可信请求上下文、context.read 策略和入口审计；新操作的审计资源为 conflict:{id}，来源引用指向该冲突。SQL 同一语句核对 tenant/workspace/project、父项目未删除及合法分类，再沿用 conflictClassification/visibleConflicts 对保存分类与来源当前分类的限制。restricted 项目或内容需要 data.restricted.read，已删除或不可见来源不通过新详情泄露其复制值。入口 allowed 只表示授权决定，不证明详情已交付或冲突已解决。

## 完整封套与精度

封套字段固定为 schema_version=1、scope、trace_id、source_refs 与 data。scope 仅含三层范围，source_refs 为单个 conflict/原 ID；不返回原请求键、指纹、ETag、写入权限提示或回执。共享 `parseConflictReadEnvelope` 校验所有字段、范围、ID、来源、trace、状态与 JSON 文本后返回新对象。

data 包含冲突 ID、entity_type/entity_id/field、状态、双方值、记录 actor/trace/source_refs 和已记录的决策元数据。base_version/local_version/server_version/version 均为无前导零的十进制字符串，保留 PostgreSQL BIGINT 精度；前三者允许零，冲突自身 version 必须为正，最大 9223372036854775807。这些字符串不自动转换成写入 expected_version。

`local_value_json`、`server_value_json`、`resolved_value_json` 是 PostgreSQL JSONB 的完整文本表示，客户端不重新解析并序列化显示，以免大整数或高精度小数被舍入。JSONB 本身已经规范化顺序和格式，此接口不声称恢复原提交文本。每项另有对应的 `*_value_state`：

| 保存状态 | `*_value_state` | `*_value_json` |
| --- | --- | --- |
| 保存了 JSON null | recorded | 字符串 `"null"` |
| 保存了 JSON 对象、数字、字符串等 | recorded | 完整 JSON 文本字符串 |
| SQL NULL，未保存该值 | not-recorded | JSON null |

共享解析只用 JSON.parse 检查文本语法，保留原文本返回。消费者自行解析时必须自行决定数值精度策略；此接口不会把未保存值替换为保存的 null。

`decision_state=none` 对应 open，决策字段为空；记录 actor 在此时可以是报告冲突的 actor，不标注为决策人。resolved 且有 resolution_event_id 的记录为 recorded，要求 resolution、actor、client、时间和选中值齐全；resolved 且没有事件引用为 legacy，缺失字段保持 null，不补造事件、时间、来源应用状态或原请求回执。历史事件引用不等于已确认某个原请求键，也不证明选择的值已写入源实体。

## 大小与等待

完整成功封套最多 2 MiB UTF-8，错误正文最多 16 KiB。SQL 输出前限制完整详情投影并预留 16 KiB 封套空间；超限返回 HTTP 413 / CONFLICT_READ_TOO_LARGE，不截断任一值。SQL 文本开销导致接近上限的记录可能被保守拒绝；共享解析再次检查完整封套。存储损坏返回 CONFLICT_READ_INVALID，存储不可用返回 CONFLICT_STORAGE_UNAVAILABLE。

SDK `getConflict(conflictId, options?)` 使用 bounded-json 和 `WcpConflictReadOptions` 的 timeout_ms/signal，默认本地 30 秒，Fetch 自身期限独立生效。固定范围/ID/trace，校验成功 200、追踪头、媒体类型、UTF-8、完整字节数和完整结果；有限错误不回显上游正文，不自动重试或降级到列表。

CLI `conflicts get` 支持网络 `--json`/`--json-file`，只含 conflict_id，不接受写键；嵌入调用只接受单个 --json，文本最多 16 KiB，固定原上下文后清除继承写条件。两条路径复用 SDK 本地预算和完整解析。未新增输出文件或 outbox 行为。

MCP `get_conflict({conflict_id})` 沿用 context.read 发现/调用，固定原请求，清除继承写条件，成功核对 200/trace 并复用完整解析。2 MiB 为内层业务 JSON，二次转义、JSON-RPC 外层、发送、准备并发及独立期限没有新增保证。

Web 新增 `/conflicts/detail?conflict=...`，使用独立 GET 和 30 秒有界读取；不依赖列表成功。显示原版本字符串、JSON 文本、缺失标记和旧决策状态，并可查看冲突审计。目录和详情失败均保留按 ID 查找入口；目录链接在新标签页打开详情，保留原页决策表单。新页只查看，不自动解决、不生成键、不重建原请求，也不改变已有解决表单的行为。

这些限制不覆盖数据库内部 JSON 构造、查询成本、进程总分配或自定义 transport 已分配对象；停止等待不证明底层查询被取消。后续源码增量已将原列表改为 [冲突元数据分页](conflict-registry-runtime.md)，比较面板独立读详情；完整决策恢复继续待开发。

## 依赖与待补证据

复用 005/013 以及已有分类迁移，无新表、依赖或迁移；016–048 仍未执行。SDK/CLI/MCP/Web 源码已衔接，真实 SQL、父项目/来源可见性、旧 ID、边界精度、JSON null/SQL NULL、旧决策、超限/超时、原 trace、跨范围和页面导航均缺运行证据。Mock/fixture、旧列表消费者及原解决请求的独立恢复不在本增量中宣称完成。

后续源码增量新增 [冲突决策原请求回执](conflict-receipt-runtime.md)。独立详情本身仍不确认原键；只有提供保存的完整原请求并成功核对回执才能确认该决定。查找区在详情失败时也保留回执入口，旧表单原请求保存/恢复仍待完善。
