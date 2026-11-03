# 冲突原请求保存与恢复

更新：2026-11-03。仅源码与文档开发，未编译、类型检查、测试、启动服务/浏览器、调用接口、执行迁移、部署或发布。R-006 仍未完成。

## 独立身份

`GET /v1/conflicts/commands/context` 派发 `conflict.command-context`，要求 authenticated_client=true、有效未来 token_expires_at，以及 conflict.resolve 或管理员身份。策略和审计仍执行；context.read 单独不足以读取此身份。响应只含 schema_version=1、当前 trace_id、空 source_refs，以及 data.identity（tenant/workspace/project/actor/client）、标准 UTC expires_at、permissions.resolve_conflicts=true。

此读取不访问项目、冲突目录、当前详情或回执存储，不证明项目存在、目标可见或任何决定成功。采用两个固定路径段 commands/context，避免占用旧外部 conflict_id=command-context 的详情地址。拒绝查询参数、正文及写入/缓存/范围条件；预期 actor/client 请求头仅比较已经验证的令牌身份。缺失、过期或无权限拒绝，无法表示可信元数据报 CONFLICT_COMMAND_CONTEXT_INVALID（500）。完整共享解析限制 16 KiB。Web 使用完整有界响应、200/trace、到期检查和本地 30 秒期限；SDK/CLI/MCP 专用入口已按下节接入源码。

## SDK、CLI 与 MCP 身份入口

SDK `getConflictCommandContext(options?)` 返回完整 `ConflictCommandContextEnvelope`；`WcpConflictCommandContextOptions` 支持 timeout_ms（1–2147483647，默认 30000）和 signal。发出 GET 前固定当前 tenant/workspace/project/trace 与可选 actor/client 约束，丢弃继承的幂等键和写版本。未知选项、非法范围/trace/身份约束拒绝；没有自行解析令牌或生成可信角色。SDK 输出类型同时导出 ConflictCommandContextData/Envelope。

Fetch transport 的 bounded-json 成功和错误正文均最多 16 KiB，核对 200、媒体类型、UTF-8 与响应头 trace。共享解析再核对完整封套、空来源、范围、当前 trace、可选身份相等条件和未来 expires_at；解析后再次检查本地期限。错误只保留允许的错误码和固定说明，不透传任意上游错误正文。不会自动刷新会话、重试、查询回执、保存文件或执行冲突写入。自定义 transport 须遵守 bounded-json/signal 协定；共享解析限制已取得的完整对象，但不提供全进程分配或底层操作取消保证。

CLI `workctx conflicts identity` 只接受一个可选 `--timeout-ms`，拒绝正文、文件、写键、队列、多余位置参数、未知或重复选项。网络主入口在通用 JSON/文件/写键处理前分流，使用当前配置的项目范围与令牌，输出完整封套。嵌入 `runWorkctx` 使用同一 SDK，在派发前固定可信上下文、清除写条件，并核对 GET 路径、无正文、四个精确范围/trace 请求头及 bounded-json 参数；执行前后都要求 authenticated_client=true、未过期且有 conflict.resolve 或 admin。返回的五字段身份与标准化到期必须精确等于原上下文，不能接受同身份但伪造的延长有效期。不读取目录、详情或原请求文件，不进入 outbox。CLI 超时停止等待，不证明正在执行的路由/审计已取消。

MCP 新增 `get_conflict_command_context({})`。发现及调用均要求可信未过期 resolver，参数 schema 为空对象；继承的写条件被清除，固定 GET 路径与上下文副本。Gateway 和 MCP 复用 `conflictCommandContextData` 对原可信数据进行规范化。成功只接受 200 与原 trace 响应头，完整解析 16 KiB 内层封套，对五字段身份、到期及唯一 true 权限提示作独立比较，并在返回前重新检查有效期。工具标记只读，没有新增资源 URI、外层 JSON-RPC/转义/发送容量/期限保证；内层限制不能代替这些边界。

这些入口只用于了解当前调用身份或准备一个明确的新请求。恢复已有决策时必须保留先前保存的 identity、request_key、command，不得把当前返回身份覆盖进旧请求，不得根据身份查询成功推定原写成功或源实体已应用。

## 准备与保存

正常冲突决策面板先取得该身份，再把身份作为详情读取的相等前置条件。只有明确选中的、版本在旧数字命令范围内的记录可以准备新决定。表单初次加载只读取对应身份/冲突的浏览器数据库槽和旧标签页槽；发现原请求即冻结恢复，不用当前详情更新原版本或选择，也不自动查询或发送。槽不可读、损坏或两份原请求不同则不准备新请求；可显式重读，或在恢复页分别检查副本。异步加载结果在组件卸载/重新加载后不覆盖当前状态。

用户审阅版本与选择后点击准备，在浏览器 readwrite 事务中读取精确槽并核对旧标签页副本。只有两处都没有原请求时才在该事务回调中生成一次新 request_key；另一个新版标签页已经保存时恢复原请求，不生成竞争键。改变尚未准备的选项不会生成键。准备构成既有回执格式 `{identity, request_key, command}`，command 包含 conflict_id、expected_version、resolution 及仅 merge 的 merged_value。完整原请求规范 JSON 限 1,000,000 UTF-8 字节，保留原字段、数组顺序和字段存在性。单击准备不写 Gateway；已分配的完整原请求在组件内冻结，后续存储失败/超时也不替换键，可导出或明确重新保存。

槽键仍是 `planemem:conflict-original:v1:` 加上 JSON 数组 `[tenant_id,workspace_id,project_id,actor_id,client_id,conflict_id]`。新版保存使用 IndexedDB `planemem-conflict-originals` v1 的 `originals` store，键为上述字符串，值为完整规范 JSON 文本；不创建索引或扫描其他槽。读取先用 getKey 区分不存在与已存 undefined 等损坏值，再完整解析原身份和冲突 ID。未知 schema、非字符串值、损坏正文或不同原请求均失败，不修复/替换已有值。

显式保存及每次发送前均以同一 readwrite 事务检查现值，空槽只用 add，已有值必须与原请求完全一致。新增后在事务内排队 read-back 并完整比较，只有事务 complete 才视为保存完成；既有相同值经完整读取后也等待事务完成。存储中有异值、quota/权限/事务失败或本地期限结束时均阻止发送，保留内存、导出和只读回执。跨新版标签页的原请求分配/保存由同一 store 的写事务串行化；不把它扩大为网络提交互斥，同一原请求仍可能在不同标签页被明确重发，Gateway 原幂等规则继续生效。

旧 sessionStorage 精确槽只读，不再写入、清除或自动迁移。正常读取不会把旧值写入数据库；显式保存/准备/发送时，若旧值有效且数据库为空，复制完整旧原请求并等待提交，不重新生成键。旧值与数据库不同或损坏时不覆盖任一副本；浏览器保存完成后还会重读当前标签页旧槽，发生不一致即阻止本次发送。此兼容检查不是 sessionStorage 与 IndexedDB 的跨存储事务，也看不到其他旧版本标签页独有的 sessionStorage；旧标签页须先导出或显式保存，关闭后已经丢失的旧副本不能恢复。

每次操作独立打开并关闭连接，versionchange 时主动关闭；打开和业务事务各自有 10 秒本地等待预算，使用单调时间检查成功回调。被阻塞/迟到的打开会失败并关闭，迟到升级尝试中止；事务超时尝试 abort 后释放本地等待，不在迟到打开后派发原请求写入。超时不证明本地事务一定未提交，保留原键并在下次读取核对。同步 JSON 处理、浏览器后台冻结及系统资源等待不能被计时器强制中断；这不是硬实时或磁盘同步保证。只读打开可能初始化空数据库 schema，不写原请求记录。

提交完成的浏览器副本可在相同站点、浏览器 profile/存储分区中关闭和重开标签页后恢复。浏览器清理/驱逐、隐私模式结束、存储分区变化或用户删除仍可能移除数据，不是永久备份、加密保管或跨设备恢复；不自动请求浏览器持久权限。导出仅表示发起下载，用户需保留完整副本。未完成准备的编辑文字不持久化，不新增原请求删除/覆盖 UI。导航期间未完成的本地保存可以结束，但组件离开后不会再启动新的决策服务端动作；已经发出的动作结果仍可能未知。

## 固定原请求发送与回执

首次发送和重发均需要独立确认，沿用已有 `POST /v1/conflicts/{conflict_id}/resolve`：完整原 command 原样发送，原 request_key 放入 Idempotency-Key，原 expected_version 用于 If-Match，并把预期 actor/client 交给 Gateway 对已验证会话比较。旧 commandReceipt 摘要/指纹算法不变，不读取当前详情来补参数，不刷新版本，不自动更换键，不自动重试。

Web 上游写响应成功限 2 MiB、错误限 16 KiB，核对 200、媒体类型、UTF-8、trace 和 30 秒本地期限。旧写响应不携带完整原请求绑定；Web 现复用 conflict-submission-runtime.md 的完整旧封套/事件解析，校验后丢弃事件及复制值，只返回 unconfirmed，不把写响应、网络错误或审计失败当作原回执。然后用户必须明确点击既有 `POST /v1/conflicts/receipt` 查询。只有完整解析且匹配原请求的 recorded 才关闭发送按钮；not-observed、legacy、权限变化、指纹冲突及其他错误仍保留原请求。回执查询不要求浏览器存储可写。

读取和写入共用忙碌保护，避免同组件同时派发；重发前要再次确认。响应、重载或父页变化都不删除原请求。本增量没有清除/替换槽的 UI，避免把未知请求丢弃后生成新键。任何丢失的旧请求都不能从当前详情重建。服务端操作表单本身还受现有 Next 请求传输限制；1 MB 原 JSON 限制不是转义后 FormData 的接收容量承诺，传输失败保持未知。

## 独立恢复入口

`/conflicts/recover` 只先读取上述可信身份。用户输入原 conflict_id 后可分别选择“浏览器副本”或“旧标签页副本”，只读各自精确身份/记录槽；也可导入 UTF-8 文件/粘贴 JSON（原始文本与规范内容均受 1 MB 限制）。两处读取相互独立，数据库不可用时仍可读取旧副本；旧槽损坏/异值时仍可读取数据库副本，分别导出或查回执。不会枚举存储，不要求目录/详情或 context.read 成功。导入必须完全匹配当前可信五字段身份，保留 command 额外字段；加载只保留内存，不自动复制、覆盖或删除本地数据。恢复后初始结果总是未知，复用固定原请求组件进行导出、显式保存、查询及确认重发；保存/发送仍要求两处检查一致，不能通过独立加载绕过冲突。

`/conflicts/receipt` 仍是独立只读导入页，不写浏览器存储、不发送 resolve。目录与独立详情查找区在成功/失败时均提供恢复入口。

## 原写路径保护

决策事务先对同范围父项目取共享锁并核对未删除/合法分类/当前受限数据权限，再锁冲突。父项目不可读统一 CONFLICT_NOT_FOUND；保留原冲突来源可见性规则。写入前拒绝不能安全加一的 expected_version；数据库四种版本和回放 cursor 转换为 JS number 前校验非负/正整数安全范围，不静默舍入。

原请求回放继续先核对旧键摘要和参数指纹，随后检查原事件 sensitivity，拒绝不可读历史事件；验证 canonical event、事件/目标/范围、actor/client、聚合 ID/version、原 trace、来源、版本、选择和已保存值/所选值的一致性，再返回旧结果。不因回放重新生成事件。当前来源可见性仍按原冲突 SQL 语句读取，没有新增跨来源事务锁或全局快照保证。旧写路径仍读取复制 JSON；其 JS 数字语义和内存分配边界未升级为任意精度/全局容量保证。

## 剩余范围

未新增依赖或 SQL 迁移，016–049 仍未执行，浏览器数据库 schema 初始化也未实际运行。原请求关闭标签页后的同浏览器恢复已接入源码；未准备编辑草稿、跨设备备份/索引、任意精度写入、旧外部消费者/Mock/fixture 迁移和运行证据仍待补齐。专用身份、固定原请求提交及 CLI 新请求文件准备/同文件回执入口见 conflict-submission-runtime.md；SDK/MCP 持久备份仍不完整。正常准备、并发分配、旧槽兼容/损坏/异值、storage 被拒绝/配额/blocked/事务超时/迟到完成、组件离开、原身份变化、未知响应及恢复交互仅完成源码衔接，未执行验证。
