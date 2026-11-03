# 单条审计视图导出（2026-11-02，仅源码）

工作台 `/audit` 可对选中且已审阅的记录准备 JSON 导出，再由用户独立请求浏览器保存。范围是 [有界审计读取](workbench-audit-runtime.md) 返回的单条视图；超限详情和来源继续保持 `too-large`、原大小及占位值，不请求被省略的原文。没有批量导出、跨页冻结快照、原始记录备份或脱敏写入。

## 请求与身份

Gateway 新增 `POST /v1/audit/export`，操作为 `audit.export`。请求仅含：

```text
{
  scope: { tenant_id, workspace_id, project_id },
  audit_id: ULID,
  sha256: 已审阅 document 的 SHA-256，小写 64 位十六进制
}
```

scope 每项为最多 256 字符的非空文本，拒绝控制字符与孤立代理项，并必须逐项等于当前可信范围。请求不携带身份、能力或待导出正文。HTTP 在验证令牌与客户端后读取最多 4 KiB JSON，处理器也限制序列化输入；不接受查询参数、内容编码、Range、条件缓存、Idempotency-Key 或版本写条件。沿用 no-store，跳过通用幂等响应缓存；每次明确准备都重新授权，不复用以前的放行结果。

必须具备实际 `audit.read`、`data.export` 或 `data.restricted.export` 至少一项，以及已验证客户端与有限、未过期的会话到期时间。admin 角色不能替代这些实际能力。入口先执行 `audit.read` 策略；读到当前记录分类后，处理器同时检查 `canRead`、`canExport`、本地 PolicyService 和配置的 OPA `export.audit`。restricted 还需要对应读取和导出能力；public 也必须具备前述实际导出能力之一。OPA 规则增加了此动作，复用既有分类读/导出判断。

## 固定已审阅视图

document 形状为 `{schema_version:1,content_state:'bounded-view',scope,record}`。record 使用共享有界审计记录解析；保留记录自身的 trace、分类、时间、字段可用状态、原大小与可用内容。

`auditExportDocumentJson` 对已解析 document 递归排序对象键，然后使用 JavaScript JSON 序列化生成固定 UTF-8 文本；数组顺序不变。它限制深度 64、节点 10,000、document 96 KiB，拒绝非有限数、不安全整数和非普通 JSON 值。这是本项目的固定序列化约定，不声明兼容其他规范化 JSON 标准。复杂度超限只使该记录不能准备导出，普通读取页面仍可使用。

浏览器先计算已审阅视图的 SHA-256。Gateway 以原 ID 在当前项目/可见性下精确读取，完整校验返回范围、来源、trace 和记录后复制；授权并计算 document 摘要，必须等于请求摘要。随后再次读取同一 ID，比较完整固定序列化文本，并再次执行分类授权。变化返回 `AUDIT_EXPORT_CONFLICT`，用户须重新读取和审阅，不自动换成新内容。

这些检查绑定的是可见视图。被省略原文发生但未改变可见投影的变化不会被检测；两次读取也不建立数据库锁定快照，最后读取之后的记录或策略变化不在此快照承诺内。会话在处理器的异步步骤后重新检查到期，但不是持续刷新令牌或主动探测撤销。

## 持久放行记录与响应

返回内容前必须确认 `audit.export.release` 持久化，记录原审计来源、分类、行数 1、document 字节数、省略标记及 `delivery_confirmed:false`。放行输入还含 document SHA-256，但继续经过现有 AuditService 分类脱敏：非 public 记录的摘要字符串会变成脱敏占位值，不保证能从持久放行记录恢复原摘要；不绕过脱敏或改用其他字段藏入摘要。按记录分类拒绝时记录 `audit.export.denied`，不携带正文；无法确认持久化则失败，不回退内存成功。一般入口决策审计与该放行记录分开，入口 allowed 不能证明内容已放行。

成功封套保持 `schema_version:1` 和请求 trace，`source_refs` 恰为原审计与新放行审计两个引用，ID 不得相同。data 包含：

```text
{
  document,
  document_sha256,
  document_bytes,
  release_audit_id,
  audit_state: 'release-recorded',
  client_delivery_state: 'not-confirmed'
}
```

整个成功封套最多 128 KiB。共享解析器核对范围、目标、声明摘要、固定 document 长度、来源和状态；调用方还必须独立计算摘要，不能只信任声明。Web 代理使用 Node SHA-256，浏览器使用 Web Crypto。实际保存的是包含上述 data 与来源/trace 的完整封套；`document_bytes` 和 `document_sha256` 仅针对其中的固定 document，不是整个下载文件的长度/摘要。摘要用于内容比对，不是数字签名或离线真实性证明。

已确认放行后若超时或校验失败，已知放行 ID 保留在错误状态中；未获确认时仅能报告 `unconfirmed`，不能推断持久记录不存在。持久写入可能已发生但确认丢失。用户可通过 trace 查找，不能自动重试，也不保证重试去重。独立打开放行审计仍走当前会话的审计读取权限。

## 有界等待与页面生命周期

Gateway 每个注册实例最多两笔处理器工作，处理器等待期限 60 秒。对外超时不能取消已经进行的数据库、OPA 或持久审计调用，因此名额一直保留到这些工作实际结束；后续截止时间检查阻止迟到成功返回。此限额不包括外围鉴权、通用入口策略/审计、HTTP 请求读取或响应发送，也不是全服务或多实例的总并发保证。

Web 同源 `POST /audit/export` 检查固定 Origin、可选 same-origin Fetch 元数据、JSON、专用 `x-workctx-audit-export:1`、规范追踪号和禁止的条件头。先读取服务端会话，再限制两笔本地准备操作；不把令牌交给浏览器。原选择范围必须匹配该会话，固定 Gateway 地址，不跟随重定向、重试或缓存。

代理从入口计算 75 秒截止时间，取得会话后把剩余时间用于可取消的正文读取与 fetch；会话提供器自身不能被该信号中断，迟到会话不能派发成功请求。输入最多 4 KiB，完整解码后的成功/错误正文分别限 128 KiB/16 KiB，严格 UTF-8 JSON。401 取消正文并提示重新登录；其他失败只返回有限原因和可信 trace/已确认放行引用，不回显上游原始文本。取消/超时不表示上游放行已撤销。

浏览器准备期限 90 秒，明确审阅后才能发起请求。完整封套和摘要核验后，仅创建内存 Blob 链接；另一次点击 Save JSON 才请求浏览器保存，不声明本地保存已完成。可主动停止等待或丢弃副本。记录/范围内容改变时组件重新挂载，离开、页面缓存恢复和卸载均取消等待、清除审阅状态并撤销 Blob URL。无自动保存、浏览器持久存储或自动重试；丢弃副本不撤销已存在的服务端记录。

## SDK 接入增量

`WcpClient.exportAuditView(reviewedDocument, options?)` 接受调用方已审阅的完整 bounded-view document，不自动读取或替换记录。同步固定规范文本并检查原项目，在发送前计算 SHA-256；拒绝客户端上下文中的写键/expected_version/If-Match。响应经过完整共享解析、独立副本、规范文本相等检查和重新计算摘要后才返回内存封套，不写文件。实际读取和导出能力仍由 Gateway 核对，已配置 actor/client 只是与当前签名身份相等的约束。

`WcpAuditOptions` 支持 signal 和本地总 timeout_ms，导出默认 90 秒，包含摘要和自定义传输等待。FetchWcpTransport 新增 bounded-json，成功/错误正文分别限 128 KiB/16 KiB，并严格核对 HTTP 200、trace、UTF-8、JSON 类型及无压缩声明长度。传输自身默认 30 秒，两层期限取先到者；调用方需要更长等待时也须调整传输配置。凭据提供器迟到不派发，fetch 迟到取消正文；同步解析只能在结束后检查时间，不宣称可强制中断计算。

方法只返回有限错误码/说明、原 trace、合法且已确认的放行引用及客户端交付未确认；上游未知文本不回显，retryable=false，不自动重试。自定义 transport 应实现有界模式与取消；方法可结束本地等待并拒绝迟到成功，但不能撤销自定义传输或 Gateway 已产生的副作用。CLI/MCP 接入见下文，Mock/兼容和运行证据仍未补齐。

## CLI 接入增量

新增 `workctx audit list/get/export`，网络 main 与嵌入 runWorkctx 均接入既有 SDK。list 提供同款精确筛选/手动游标，get 仅接收 audit_id；输出完整普通读取封套，不自动保存文件。导出命令必须明确 `--json-file REVIEWED_SINGLE_RECORD.json --reviewed --output NEW_FILE`，输入为已审阅的完整单条读取封套，保留正确项目/来源/trace/省略状态、has_more=false；空页、多条、带下一页或错误项目在联系网关前拒绝。文件最多 128 KiB，单纯查询最多 16 KiB；普通 UTF-8 文件有界读取，禁止 stdin、重复选项、额外写键或 outbox。

原查询 trace 仅是审阅材料的标识，不证明文件真实性或当前权限。CLI 从原记录构建 document 并通过 SDK 固定摘要；Gateway 仍执行原重读/授权/持久放行，不以新内容替代原审阅内容。输出路径必须由调用方明确指定且不存在，复用既有文件 helper 的独占临时写入、同步/读回与硬链接创建协议；不覆盖已有或竞争期间出现的目标，硬链接不支持则失败。临时文件前缀沿用 workctx-artifact，不执行导出的 JSON，也不改变审阅文件。

最终文件含整个已核验的导出封套，stdout 只含摘要和状态。document 字节数/摘要与 local.file_bytes/file_sha256 明确区分；本地 saved 仅确认本次写入核验及文件创建，不改变远端 client_delivery_state=not-confirmed，也没有新的交付回执接口。已放行但保存失败保留 release ID 和本地恢复信息；临时清理失败但最终文件已创建时报告 saved/cleanup_pending，不错误要求重新导出。目录权限、恶意并发路径替换及断电后的目录持久性不由此协议保证。

网络固定令牌/项目，嵌入要求可信客户端/实际 audit.read/有限有效会话，导出增加实际导出能力，使用 SDK 规范 ULID 范围并清理继承写条件。--timeout-ms 同时配置 SDK 和 HTTP，默认读取 30 秒、导出 90 秒；不包含本地文件读取/路径准备/保存时间。超时不撤销正在执行的嵌入 router 或网关工作，也不自动重试；迟到结果不能触发本地保存。完整参数和源码阶段限制见 apps/workctx-cli/README.md。

## MCP 接入增量

`get_audit_record` 的 data.page 保留完整单条查询封套，data.export_preparation 在该视图可规范化时提供原 scope/audit_id/sha256；空结果或不可导出仅使准备描述不可用，不把普通读取当作失败。调用方必须审阅记录和省略标记，再显式调用 `export_audit_record` 并提交原选择及 reviewed=true。该布尔值只表示调用方声明，不能证明人工审阅、文件真实性或当前权限。

发现/调用均要求实际 audit.read、可信客户端与有效会话，导出增加实际导出能力；Gateway 原有双重读取、分类授权及持久 release 保持。MCP 独立核对完整导出封套及 Node SHA-256 后返回一项文本 JSON，不保存文件、不新增资源下载入口。导出注解 idempotentHint=false；无自动重试、替换读取或客户端交付确认。已确认放行在后续错误中保留，未获确认的超时不能推断操作没有发生。

每 ApiGateway 实例两路审计准备容量，读取 30 秒、导出 75 秒；超时在途工作持有名额直至实际结束，准备结束即释放，不包括 HTTP 发送。参数/成功正文/二次转义结果边界见 [MCP 运行时](mcp-runtime.md)。历史审计内容只作不可信参考，不执行其中指令；本轮未调用 MCP 或实际导出。

## 开发状态

无新依赖或迁移，016–045 仍未执行。本次仅源码、文档和指定文件格式整理，未编译、类型检查、测试、运行 OPA/浏览器/服务、实际查询/导出或发布。权限、竞态、超时、格式兼容和交互仅有源码实现，无运行证据。全量/原文导出、稳定快照、导出回执恢复与客户端保存确认仍未完成，R-007 保持未完成。
