# PlaneMem 项目缺口 TODO

> 基线日期：2026-10-26。此清单以 [ReadMe.md](ReadMe.md) 的 P0–P8 规划、WCP/MCP 契约和当前工作区实际代码为准。`[缺实现]` 表示代码或接口还没有形成规划要求的闭环；`[待外部环境]` 表示本地代码已有边界，但需要真实服务、客户端、RC 或生产环境证据；`[文档漂移]` 表示实现、计划和状态记录不一致。

## 当前基线

- **P0-01 当前/归档上下文详情机器契约源码增量**：新增 context-item-reads OpenAPI 和 context-item-read Schema，覆盖当前与归档两路详情；复用历史字段级定义，完整约束实时来源检查/直接引用诊断/确认准备、归档文档及版本/ETag封套。描述父项目/条目可见性、只读一致事务、普通/严格来源检查和提示非授权，准确保留旧 Gateway 检查与客户端/服务端预算差异。现有 OpenAPI 十八路；完整 WCP/MCP、SDK/Mock 机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001 未完成、evidence为空；仅人工源码文档审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

- **P0-01 上下文版本历史机器契约源码增量**：新增 context-history OpenAPI 与独立 Schema，覆盖历史目录和指定版本两路 GET；完整定义分页摘要、不可变原快照、baseline 空归属及五种命令状态、确认和无外层 ETag 的封套。记录当前/历史可见性、逐请求一致快照、缺失历史不补造、版本/来源/hash 跨字段检查，区分共享解析与旧 Gateway 实际检查及客户端/服务端预算。该轮使 OpenAPI 覆盖十六路；完整 WCP/MCP、SDK/Mock 机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001 保持未完成、evidence 为空；只源码文档人工审阅/指定格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

- **P0-01 指定版本文件下载机器契约源码增量**：新增artifact-download OpenAPI与Schema，覆盖固定历史版本内容GET；Schema根为已解码版本/hash/size请求，HTTP成功为原始octet-stream，不伪造内部Uint8Array/SDK结果为JSON。完整描述两次当前/历史导出权限、实际正文核验、先持久release再发送、编码范围/版本/hash/长度/审计和保护头；区分两笔容量与60秒仅发送期限、协议/配置大小、放行/发送完成与客户端收存，保留实际错误/retryable差异。该轮使OpenAPI覆盖十四路（文件九路），完整WCP/MCP、SDK/Mock机器契约接线及破坏性差异CI仍缺。P0-01/R-001未完成、evidence为空；仅源码文档人工审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/下载/产品/API/数据库或发布。

- **P0-01 文件创建/追加上传机器契约源码增量**：新增 artifact-upload OpenAPI 和 Schema，覆盖两个现有 multipart POST，复用原身份/创建追加命令及公开元数据，完整成功严格配对 false/verified-at-save 与 true/not-checked，单个版本来源/无外层 ETag。描述带 filename 的 JSON/原始字节两部件、原键/路径/版本绑定、原键回执优先及不可变对象读回/事务；准确区分两笔容量、120秒仅正文期限、配置字节限额和客户端4MiB/16KiB/180秒预算，保留实际错误/retryable差异。该轮使 OpenAPI 覆盖十三个接口，完整 WCP/MCP、SDK/Mock机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001未完成、evidence为空；仅源码文档人工审阅/指定格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/实际上传/产品/API/数据库或发布。

- **P0-01 文件上传身份/原回执机器契约源码增量**：新增 OpenAPI artifact-original.json 与同名独立 Schema，覆盖已有 GET upload-context 和只读 POST receipt；封闭完整原身份、创建/追加原命令、recorded/not-observed 回执及当前身份/到期/能力提示，复用原公开元数据。准确描述实际写能力/可信客户端、原文精确绑定、历史权限/快照、无外层 ETag、双 trace；未观察到不代表并发上传失败，身份不证明存储就绪或未来权限。记录旧 HTTP 三个禁止头、认证前 POST 1 MiB、ARTIFACT_UPLOAD_CONTEXT_INVALID 映射 400，客户端 4 MiB/16 KiB 与服务端期限/容量缺口分开。该轮使 OpenAPI 覆盖十一个接口；完整 WCP/MCP、SDK/Mock 机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001 未完成、evidence 为空；仅人工源码文档审阅/格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

- **P0-01 文件元数据读取 OpenAPI 源码增量**：新增 artifact-reads.json，覆盖当前文件目录、当前详情、历史版本目录、指定历史详情四路 GET；新增 artifact-read.json 的完整当前/历史封套与查询锚点，复用既有目录、公开元数据及历史封套定义。分别描述实际权限、客户端/到期检查差异、分页、当前外层 ETag/历史仅内层 ETag、双层 trace、错误和客户端/服务端限额；旧详情正文/条件头检查及统一期限/容量缺口保持明确。该轮使 OpenAPI 源码覆盖九个接口，完整 WCP/MCP、SDK/Mock 机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001 未完成、evidence 为空；仅人工源码文档审阅/格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/产品/API/数据库或发布。

- **P0-01 保存包生成/完整读取 OpenAPI 源码增量**：新增 context-pack-operations.json 与包子路径，覆盖现有 POST compile 和 GET context-pack；预算/TTL与完整成功引用已有两份Schema，描述头/正文稳定原键、规范参数/权限桶重放、显式/最新选择、json/markdown/mcp的JSON封套、ETag/原游标/双层trace及400/401/403/404/409/410/429/500/503。准确记录旧入口无专用期限/两容量/服务端统一2MiB限制，POST认证前通用1MiB解析、GET未专门拒绝正文/条件、条件头解析不构成CAS；这些边界尚未修复，客户端4KiB/2MiB/16KiB限制不冒称服务端保证。五个保存包接口现有OpenAPI源码，完整WCP/MCP、SDK/Mock机器契约接线及运行证据仍缺。P0-01/R-003未完成、evidence为空；仅源码文档人工审阅/格式/Git文本检查，未编译、类型检查、测试、运行校验器/生成器/保存包命令/API/产品/数据库或发布。

- **P0-01 CloudEvents 机器目录源码增量**：新增独立结构化 AsyncAPI 3.0.0 消息目录及 2020-12 类型配对 Schema，覆盖当前 38 类默认 v1；每个组件显式使用 application/cloudevents+json，完整消息引用同名锚点，同时约束外层 type 与内层 event_type 并继承原完整封套和删除/恢复结构。Schema 根 oneOf 联合覆盖所有类型，新增包子路径及本地七份 Schema 加载说明；裸事件目录保留 application/json。已补结构化 AsyncAPI 引用，真实通道/传输/消费者接线、完整业务 payload/WCP/MCP、SDK/Mock 机器契约消费和破坏性差异 CI 仍缺。P0-01/R-001 保持未完成、evidence 为空；仅源码文档人工审阅/格式/Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/事件/产品/API/数据库或发布。

- **P0-01 CloudEvents 源码增量**：新增独立 CloudEvents 1.0 structured JSON 双向对象转换与 2020-12 Schema，覆盖默认 38 类 v1 事件，data 保留完整原 CanonicalEvent。显式绝对 URI 来源及反向预期来源精确核对，id/type/time/subject 与原事件绑定；完整 1 MiB 普通有限 JSON、64 层/100000 节点、有效 UTC 日历及 Unicode 标量检查，复制后返回，不修改旧消费者。新入口不执行传输/认证/持久化，也不是支持任意扩展或 binary/batch 的通用 CloudEvents SDK。结构化格式的 AsyncAPI/传输及 SDK/Mock 接线、完整 payload/WCP/MCP、破坏性差异 CI 与运行证据仍缺。P0-01/R-001 保持未完成、evidence 为空；只源码文档人工审阅/格式与 Git 文本检查，未编译、类型检查、测试、运行校验器/生成器/事件/产品/API/数据库或发布。

- **P0-01 源码增量**：新增 AsyncAPI 3.0.0 事件消息组件目录和默认 v1 Schema 目录，覆盖当前注册的 38 类事件，每类以同名 const 锚点复用完整封套与原删除/恢复约束；新增 events 包显式资源子路径。2020-12 Multi Format Schema 需要消费工具支持，本轮仅人工源码审阅，未执行生成器/校验器或运行兼容检查。目录未声明未实现的服务器、通道、总线或投递承诺；CloudEvents 标准封装、普通业务 payload 完整模型、完整 OpenAPI/MCP schema、SDK/Mock 与机器契约接线及破坏性差异 CI 仍缺。P0-01/R-001 保持未完成、evidence 为空；未编译、类型检查、测试、运行事件/产品/API/数据库或发布。

- 执行约束（2026-11-05）：严格按本 TODO 的现有主项、完成条件及“推荐执行顺序”开发；每项新增工作明确关联 TODO 编号，源码进展与整项验收分开记录。仅开发源码和文档，每完成一个任务独立提交并推送 main；不编译、类型检查、测试、运行产品流程或发布。未覆盖全部完成条件的主项保持未勾选。

- **P0-02 源码增量**：管理快照 Mock 已接入现有 SDK getAdminSnapshot，新增独立 MockAdminStore/Seed/Session 和 MockWcpServer 可选 admin。单项目固定 1–2 个 read_restricted 快照场景，保留原读取时间/版本/计数，显式客户端认证/管理员角色/admin.read/项目可见性/audit/context/restricted 权限；无 audit/context 能力时计数为 not-authorized/null 并同步移除来源，两个 context 计数共同授权，缺场景拒绝连接。严格有界配置/请求/完整响应、原身份与取消到期前后检查；来源及 read-succeeded 仅为模拟协议投影，外部检查全部 not-checked，不调用其他 Mock、真实服务或数据库。该增量覆盖 P0-02 的管理快照 Mock 入口，全部 WCP 覆盖与兼容运行证据仍未齐，P0-02/R-011 保持未完成。仅源码文档人工审阅及格式/Git 文本检查，未编译、类型检查、测试、执行 SDK/Mock/产品/API/数据库或发布。

- P0/P6：审计 Mock 新增已审阅视图导出，通过可选 export_access 显式模拟普通/受限导出及策略决定，接入原 SDK exportAuditView。精确原项目/ID/摘要、有界规范视图、可见性与分类权限重查，独立两笔容量/75 秒/取消，返回完整 128 KiB 或更小限额；先完成响应/容量检查，再同步保存独立模拟放行。新增本地 getExportRelease 与带 simulation:true 的原身份/选择/分类/大小/省略状态/trace 元数据，最多 1000 条/16 MiB，不追加查询种子、保存正文或文件；重复成功准备产生独立记录，已记录后的停止等待不回滚。补齐审计导出 Mock 源码缺口，拒绝审计/动态数据与权限/HTTP/真实 Policy/持久化及运行证据仍缺，R-007 未完成且 evidence 为空。仅源码文档人工审阅及格式/Git 文本检查，未编译、类型检查、测试、执行 SDK/Mock/产品/API/数据库或发布。

- P0/P6：SDK 新增独立审计只读 Mock，通过 MockWcpServer 可选 audit 配置接入现有 listAuditRecords。单项目最多 1000 条/16 MiB 的完整固定投影，显式模拟身份/到期/项目与审计权限/restricted/可见 ID，先过滤再取微秒时间与 ID 倒序 200+1 页；支持五项精确筛选和 ID 定位。游标绑定 store、身份、到期、权限、可见集合与条件；保留 too-large 占位及原字节数，完整响应有界复制，独立两笔容量/30 秒/取消。来源字面量遵循现有协议，仅为模拟投影，不证明真实 PostgreSQL 或持久审计。补齐审计查询 Mock 源码缺口，导出放行 Mock、真实 HTTP/认证/持久化与兼容运行证据仍缺；R-007 未完成、evidence 为空。仅源码文档人工审阅及格式/Git 文本检查，未编译、类型检查、测试、执行 SDK/Mock/产品/API/数据库或发布。

- P5：Web历史页新增左右文件备份显式比较，各1–11份单备份或完整分卷，绑定当前完整原身份，支持双方独立预期根摘要；捕获全部文件引用/元数据和约束后，沿共享字节限额、原始字节长度/SHA-256、30秒/取消预算读取并复用既有SDK完整比较。SDK新增browser可用comparison子路径，Web仅增加已有workspace依赖/锁链接及Next源码依赖声明，未安装/引入新版本。报告含完整SDK差异和512 KiB以内来源元数据，组合4 MiB+512 KiB有限JSON；准确标明file-read-only/separate-file-reads而不读取浏览器历史。面板按共有/左右独有与精确请求键筛选、50条分页视图，保留全部观察与全部同键异文引用，可独立下载完整报告且不随筛选截断。输入代次同步变化/重试/失败撤销最新标签，旧报告和原选择保留，卸载/取消拒绝迟到结果；父级互斥撤销旧写确认，文件报告不因浏览器历史变更失效。下述Web比较接线缺口已源码覆盖，更大/流式集合、报告再导入及运行证据仍待补。R-003未完成、evidence为空；仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、渲染、执行浏览器/SDK/CLI/产品/文件流程/API/数据库、安装或发布。

- P4：CLI新增context compare-backups，重复from-backup-file/to-backup-file分别提供1–11份单备份或完整分卷，支持独立binding-file及双方预期根摘要。普通main/内嵌runWorkctx统一专用严格解析、无凭据路由或网络；同侧规范路径重复拒绝，跨侧同路径允许但分别读取。固定全部路径后共用默认30秒读取/SDK完整比较/有界结果期限，逐份稳定普通文件、双方各沿共享字节/集合上限，绑定8 KiB；输出完整SDK差异及512 KiB以内来源元数据，完整JSON限4 MiB+512 KiB。file-read-only/separate-file-reads明确非跨文件原子快照，不复制备份正文或写文件；成功0（包括差异/同键异文报告）、用法2、文件/核验/超时错误1且无部分stdout。超时后当前底层读取可能继续关闭，但不会开启下一份读取。下述CLI备份比较缺口已源码覆盖，Web比较接线、更大/流式集合及运行证据仍待补。R-003未完成、evidence为空；仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、执行CLI/SDK/浏览器/文件工作流/API/数据库或发布。

- P4：SDK新增独立compareContextPackReceiptBackups，两边各1–11份单备份或完整分卷集合，首次await前捕获所有有界字节与约束，共用默认30秒/signal顺序完整核验。要求原完整binding相同，可选独立binding和两边根摘要；观察摘要完整排序并集最多2000条，shared还核对完整规范文件，返回共有/各侧独有计数和集合相等，格式及根摘要不同不影响观察集合相等。按完整规范原请求分组列出任一侧或跨侧同键异文全部冲突及原文摘要/观察引用，重复观察去重仅用于比较，不覆盖历史。4 MiB有限JSON返回两侧摘要及完整差异元数据，不重复备份正文；错误无部分结果，不创建客户端、访问凭据/网络/存储或授予合并/恢复/移除/重发资格。CLI/Web比较接线、更大或流式集合及运行证据仍缺。R-003未完成、evidence为空，仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、执行SDK/CLI/浏览器/产品/API/数据库或发布。

- P5：ContextPack历史页增加当前页1–20条显式多选、完整所选审阅、既有备份格式子集导出和独立确认后的原子移除。preparePackReceiptSelection在首次await前捕获完整规范正文/绑定/排序摘要，拒绝重复；同一个readonly事务复读全部选中双槽并与原页正文精确一致，缺项/异文/损坏拒绝整份，再逐观察校验摘要并构造完整子集，不依赖整库100/1000条上限。新selection-panel承接目录行及原逐份审阅，所有选择/页/存储及审阅代次变化撤销旧移除资格，父级锁及同步ref防迟到确认；导出始终使用已审阅固定子集，纯导出成功且代次未变可保留资格但清除确认。移除复用全量预检/同文双槽删除/全部缺失读回，缺项单列、异文整批拒绝；未知保留可导出子集并要求重读。30秒操作/10秒存储期限和取消保持，不查询/重发/改服务器；跨页联合选择、自动保留/配额及运行证据仍缺。R-003未完成、evidence为空，仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、渲染、运行浏览器/产品/SDK/CLI/API/数据库或发布。

- P5：ContextPack历史页新增完整性概览，显式只读核验当前完整原绑定的全部双槽观察，最多1000条；单事务先计数拒绝不等/超限，再逐槽核对全部正文/摘要/键及目录孤项，事务后逐观察实算摘要，拒绝部分通过。共用快照读取也用于既有100条单备份/1000条分卷，其范围和格式保持。报告观察/请求键数、历史recorded/not-observed分布、时间范围、规范回执UTF-8字节量及完整绑定+有序观察摘要指纹；同键不同完整原请求列出全部冲突组，不选原文或授权重发。面板共用互斥/30秒操作/10秒存储期限及取消，存储代次/重新聚焦失效新鲜状态，迟到结果不采纳、失败保留旧报告。目录筛选不限制检查，无写入/删除/恢复/自动下载/服务器请求；内容字节不等于配额，检查仅当前绑定命名空间而非跨身份全库审计。跨范围审计、保留/配额、更大集合及运行证据仍缺；R-003未完成、evidence为空，仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、渲染、运行浏览器/产品/SDK/CLI/API/数据库或发布。

- P4：新增context recover-backup --result-file/--output新目录，普通/内嵌入口均接收prepare-backup或本命令成功/失败完整stdout，可选独立binding-file、expected-document-sha256及timeout-ms。64 MiB实际输入/16 MiB元数据，完整候选按单卷既有字节/节点预算核验全部观察、卷及清单摘要和顺序；冗余身份/条数/大小/输出计划与历史文件前缀状态核对，旧路径仅数据不访问。默认30秒只读准备，保存前复读显式结果和绑定实际字节；共用抽取的backup-output独占新目录/固定摘要文件名/卷先清单后/逐份及最终全套读回，保存不与计时器竞速。失败保留完整候选、阶段、已写文件且可继续补存，成功0、失败1、用法2；不查询/重发/恢复浏览器，不宣称认证或整套文件系统原子性。下述整套构造失败stdout恢复缺口已由本源码覆盖；流式集合、自动保留/配额及运行证据仍缺。R-003未完成、evidence为空，仅源码文档人工审阅及格式/Git文本检查，未编译、类型检查、测试、执行CLI/SDK/文件流程/浏览器/API/数据库或发布。

- P4：context recover-receipt接入extract-backup-receipt成功/保存失败的完整stdout；查询/补存输入仍限96 KiB，提取输出单独限256 KiB。闭合字段、固定状态、提取来源形状/数量/字节限制、完整回执摘要和local实际或候选摘要均核对，旧备份/绑定/输出路径只作历史元数据、不访问。沿可选独立原请求核对、输入复读、独占新文件保存与完整读回；保留原观察，失败输出可再次补存。新增recovery.input_status和backup_membership=not-checked，兼容旧补存输出，不重新证明原备份成员关系。下述单观察提取失败stdout补存缺口已由本增量覆盖；整套备份构造失败输出补存和运行证据仍缺。R-003未完成、evidence为空，仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/文件流程/浏览器/API/数据库或发布。

- P4：新增context extract-backup-receipt，普通/内嵌共用重复backup-file完整核验，按必填observation-sha256精确选一份，output只能新文件；可选binding-file/根expected-document-sha256/timeout-ms保持。未命中或任一卷核验失败不写入；选中原回执不改时间/键/身份/正文，保存前重读全部源文件及独立绑定文件核对实际长度/SHA-256，独占发布/sync/完整回执读回。失败保留候选、来源摘要和local阶段，不覆盖/删除旧文件、不查服务器；成功文件可交inspect-receipt、extract-original或网页导入，整套完整性仍只相对清单。核验时限与后续本地保存独立，保存失败1、成功0、用法2；失败stdout直接补存及运行证据仍待补。R-003未完成、evidence为空，仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/文件流程/浏览器/API/数据库或发布。

- P4：新增context prepare-backup，重复--observation-file或显式--empty，必填完整--binding-file、--format single|volumes及--output新目录。普通/内嵌均离线，30秒输入/构造预算内固定路径、稳定读取、调用SDK逐观察核验并整理100/1000条既有格式；构造后独占mkdir叶目录，固定摘要文件名，既有hard-link新文件发布/sync/读回、目录身份检查，分卷先清单后，末尾逐文件完整字节复查。保存不受输入计时器截断，不声明整套原子发布；成功saved-and-read-back退出0，保存失败stdout保留完整候选/计划摘要/阶段/历史已写文件且退出1，不覆盖已有路径或删除已写文件；用法2。无网络/凭据/浏览器访问/原请求发送，完整性仅所供观察；CLI批量构造/留存缺口已补源码，失败输出离线补存、流式集合/自动保留及运行证据仍缺。R-003未完成、evidence为空，仅人工源码审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/文件流程/数据库/API或发布。

- P0/P5：SDK新增prepareContextPackReceiptBackup，必填原binding/format，捕获0–100/1000份已有观察文本或UTF-8字节，32 KiB单文件/共享规范节点预算，核对绑定/摘要并拒绝重复；排序后保留同键不同观察，不合并或改时间。single输出既有单份备份，volumes按100条分卷加完整清单，空集合一空卷；输出完整规范raw/文件/根摘要与字节数，prepared-not-saved且仅supplied-observations-only。抽取与inspect共用字节复制/WebCrypto内部helper，30秒/signal、无部分结果及原核验错误语义保持，无客户端/网络/凭据/文件或浏览器访问。SDK构造/拆分缺口由本源码覆盖，CLI批量构造/导出、更大或流式集合和运行证据仍缺；R-003未完成、evidence为空，仅源码人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/文件流程/API/数据库或发布。

- P4：普通/内嵌CLI增加context inspect-backup，--backup-file重复1–11份，可选8 KiB完整--binding-file、--expected-document-sha256及--timeout-ms。认证/路由前独立读取稳定普通文件，共用30秒总等待和SDK单份/完整分卷核验，保持100/1000条、字节/节点/身份/逐层摘要和全局顺序限制。输出完整规范文件对象、输入路径/实际字节摘要及显式file-read-only，不重复raw、无部分结果；参数2/失败1/成功0，无网络/凭据/文件写入/浏览器库访问。超时可停止等待，当前底层读取可能继续至关闭，迟到不读下一份；文件集合非文件系统原子快照，内部完整性相对所供清单。CLI批量离线核验缺口已由源码覆盖，批量导出/构造/拆分、流式集合及运行证据仍缺。R-003未完成、evidence为空；只源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/文件工作流/API/数据库或发布。

- P0/P5：Web ContextPack单份备份/分卷纯格式提取contracts，旧Web模块重导出；SDK新增独立inspectContextPackReceiptBackup接收1–11份文本/UTF-8字节，单份100条或完整清单+最多10卷/1000条，原字节/节点上限保持。首次await前完整捕获输入/约束，复核结构、绑定、卷号/条数/全局摘要顺序与每观察/卷/清单实算SHA-256，可选完整expected_binding及根document摘要，30秒/signal和固定错误，无部分结果。返回完整规范文件及本地状态，不读凭据/文件/浏览器库、不联网或自动恢复；单份可为子集，完整仅相对清单。SDK批量离线核验缺口由本源码覆盖；CLI批量、SDK备份构造/拆分、流式集合、保留/配额及运行证据仍缺。R-003未完成、evidence为空；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行SDK/产品/浏览器/API/数据库或发布。

- P5：ContextPack分卷备份增加本页下载清单，绑定当前集合摘要，清单和各卷分别记录已请求状态与剩余数量；完整复核和下载调用返回后才计入，重复请求去重。显式下一份按钮每次只请求一个未请求文件，全部请求后保留逐份重下；成功准备/导入重置，失败保留集合及进度，审阅/恢复不标记下载。仅内存记录，不证明落盘、不持久化、不自动连续下载。R-003未完成、evidence为空；只源码文档人工审阅与格式文本检查，未编译、类型检查、测试、渲染、运行浏览器/产品/API/数据库或发布。

- P5：新增ContextPack历史分卷备份，单次双槽只读快照上限1000条，按摘要全局升序拆为最多10份既有100条格式，空历史一空卷。31 KiB document/32 KiB manifest固定完整绑定、总数、连续卷号/数量/各卷摘要；实算清单、各卷和每条观察摘要。整套导入2–11文件、每卷4 MiB+1 KiB、集合40 MiB+42 KiB，拒绝缺卷/额外卷/重复/清单不匹配/跨卷乱序与重复；文件名无身份作用。不改旧格式，显式分别导出/选择卷，选卷撤销旧比较和确认，复用单卷比较/恢复/移除，每卷独立提交不宣称整套原子恢复。沿30秒操作与10秒浏览器存储期限、取消/迟到抑制和跨标签存储代次，保留旧集合与审阅副本；不发送保存或查询请求。此前大历史分卷缺口已覆盖有界1000条范围，更大集合/流式分卷、CLI/SDK整批、筛选清理、自动保留、全库审计/配额及运行证据仍缺。R-003未完成、evidence为空；仅源码人工审阅及格式文本检查，未编译、类型检查、测试、渲染、运行浏览器/文件流程/数据库/API或发布。

- P0/P4：新增contracts/openapi/context-pack-save.json及包子路径，覆盖已有GET save-context与只读POST save-receipt，引用自包含原请求Schema。按实际源码描述三范围/Bearer/独立身份条件、双trace一致、重复与禁止头、JSON/4 KiB/Content-Length、16 KiB成功与错误状态/retryable；区分身份GET无项目查询/专用两槽期限，历史POST项目检查/两槽30秒/早期trace及connection close。源码OpenAPI缺口补齐这两条路径，全量接口和本地解析/自动一致性/真实客户端证据仍缺，R-003未完成、evidence为空；仅人工源码审阅及格式文本检查，未运行校验器、生成器、编译、类型检查、测试、API/SQL/产品或发布。

- P0：新增自包含context-pack-save.json及包子路径，根为完整历史查询封套，锚点覆盖身份/草稿/显式参数/身份封套/Gateway绑定/原文件/原查询/十字段历史记录/来源/document/file。闭合字段并联动recorded与not-observed来源数量，沿原数字/标识/时间/hash词法；不以格式代替完整绑定、WHATWG规范化、字节/UTF-16预算、时间/TTL关系、摘要或真实权限。原请求及历史回执独立Schema源码缺口补齐，OpenAPI/自动一致性和真实客户端证据仍缺，R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未运行Schema校验、生成器、编译、类型检查、测试、解析器/产品/API或发布。

- P4：runWorkctx新增context submit-save --json-file ORIGINAL --reviewed [--timeout-ms N]，固定宿主gateway_url、五字段身份/restricted与完整8 KiB原文件，复用save-identity核对后沿现有compile发送原参数/键；授权后复读全部原字节，变化或不可读拒绝。首次读文件在期限前，之后身份/授权/复读/保存/完整封套/hash共用总期限，单调复查与取消阻止迟到派发；实际router两提交容量与旧compile共享，底层结束才释放。派发前失败not-sent/not-checked，派发后失败started/unknown，不自动重试或换键，不写原文件。补齐内嵌原请求准备/审阅/提交/回执源码流程，独立Schema/OpenAPI和真实兼容证据仍缺，R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/文件流程/API/数据库或发布。

- P4：runWorkctx新增context prepare-save --key ORIGINAL_KEY --output NEW_ORIGINAL [--json-file DRAFT] [--timeout-ms N]，沿宿主第四参数gateway_url和复制的完整可信身份。与网络入口共用输出预检、4 KiB预算/TTL草稿、8 KiB完整原请求、规范摘要、独占保存/同步/完整读回；身份读取经原save-identity适配，复核五字段身份、restricted及会话期限，沿上下文两读容量并新增单调期限检查。文件I/O不计入身份查询超时，发布前复查到期，失败保留恢复路径，不发送保存包请求。内嵌原请求提交、独立Schema/OpenAPI和运行兼容仍待补，R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/文件流程/API/数据库或发布。

- P4：runWorkctx新增context save-receipt --json-file ORIGINAL [--timeout-ms N] [--output NEW_RECEIPT]，可选第四参数EmbeddedCliOptions.gateway_url必须由宿主实际router配置提供，新命令缺配置拒绝；旧三参调用保持。共享8 KiB完整稳定原文件及严格参数，核对含路径Gateway、五字段可信身份和restricted，要求schema/真实context.read/未过期会话，清除继承写条件。经SDK单次bounded-json POST适配到原context.pack.save-receipt，精确头/正文与16 KiB完整封套检查，授权审计后复查单调期限/取消/到期，独立每router两读容量保留到底层结束。复用网络回执输出，未指定output返回完整历史封套；输出预检后查询、查询结束后独占发布/读回，本地失败仍保留原观察/候选且退出1，用法2、成功观察含not-observed退出0。无HTTP、身份GET、编排保存或自动重查/重发。内嵌原请求准备/提交、独立Schema/OpenAPI与运行兼容仍待补，R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/文件流程/API/数据库或发布。

- P0/P2：MockContextPackStore新增原保存历史回执，原MockWcpServer路径识别接入SDK getContextPackSaveReceipt。要求显式compilations（空数组可查询空历史，省略仍未配置），完整4 KiB原查询/16 KiB封套及较小响应限额，固定五字段身份、当前restricted桶、原键/规范预算TTL和头条件。只从构造时提取的独立标量及保存状态读取：pending/未知键为not-observed，saved/已激活记录在可见性和原参数/桶相等后返回recorded；未绑定保存场景的种子包不自动拥有原命令回执。过期/来源变化/内容摘要损坏仍可观察历史元数据，不读正文/hash、不激活或重放。独立两笔回执容量、30秒/signal和固定错误，原种子/会话形状不变。此前Mock回执源码缺口已覆盖，嵌入CLI回执、独立Schema/OpenAPI、真实客户端兼容与运行证据仍缺；R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行Mock/SDK/API/数据库或发布。

- P5：ContextPack历史新增按完整备份批量移除。复用只读预览，只有当前无冲突且有identical记录才开放独立清理确认，恢复/清理勾选互斥；点击时冻结预览匹配摘要集合，预览缺失但后来新增的记录不加入。存储先重核整份备份及升序唯一子集，在create:false单一写事务预检全部选中双槽，同文才删、已缺失跳过、部分槽/异文整批拒绝；全部预检后成对删除并读回全部缺失，提交后返回removed/already_absent/total。缺库/空集合不建库，不改备份外或未选中历史、原请求或服务器包；取消/失败保持提交未知提示。沿完整备份/操作/存储代次资格及跨标签失效，备份始终保留可导出/重新比较恢复。此前批量清理缺口的有界备份子集已覆盖；大历史分卷、筛选集合清理、自动保留策略、CLI/SDK整批、全库审计/配额及运行证据仍缺。R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器清理/产品/API/数据库或发布。

- P5：ContextPack历史恢复新增显式差异预览，完整验证备份与每份摘要/原绑定后，在单一只读事务比较最多100个目标的正文/目录键和值；双缺失待新增，精确完整同文已存在，部分槽/异文/非字符串为冲突，返回全量计数和逐项结果，不暴露异常存储内容、不按列表筛选。缺库返回全部缺失且不建库，空备份零项。当前备份/父页操作/存储代次匹配的无冲突且有缺失预览才开放恢复确认；新操作、变更通知或返回页面撤销资格，比较期间变更或失败不交付部分结果，保留完整备份。实际恢复仍重核所有目标并原子添加/读回，比较不提供锁或替代写入核对。旧增量的恢复差异预览缺口由本增量源码覆盖；大历史分卷、CLI/SDK整批、批量清理、全库审计/配额及运行证据仍缺。R-003未完成、evidence为空；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

- P5：ContextPack历史新增按完整绑定隔离的跨标签失效提示，覆盖保存、单份移除、非空恢复的存储尝试及结束。提取共用有界BroadcastChannel，原提案适配保持；同页同步通知，跨页尽力通知，focus/可见恢复/持久页面恢复补充失效。撤销目录/续页与移除/恢复确认，保留已审阅观察、完整备份和已开始写入的真实结果；同步代次挡住旧处理器，目录读取与备份准备遇到变更不采纳迟到结果。通知无回执正文/请求键/摘要，不自动读写或证明提交，不保证无遗漏或跨页快照。旧增量中的跨标签通知缺口由本增量源码覆盖，运行证据仍缺；大历史分卷、CLI/SDK整批格式、恢复差异预览、批量清理和全库审计/配额待补。R-003未完成、evidence为空；仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

- P5：ContextPack网页历史新增完整整批备份/导入/审阅/导出/明确恢复。独立Web备份格式限100份共享历史文件、document4 MiB/file4 MiB+1 KiB，完整原绑定、摘要升序唯一项、外层及每份摘要实算；同一只读事务遍历规范绑定前缀内正文/目录两侧，损坏/孤立/超限整份拒绝，缺库空备份不建库，不按筛选或拼接分页。恢复在单一写事务先核对所有目标、缺失才添、同文保留、异文/部分槽拒绝，完整读回/提交才确认；空备份不建库、不删额外历史。父页操作代次绑定恢复确认，恢复尝试撤销旧目录，取消/失败保留完整备份且不否定已提交可能。大历史分卷、CLI/SDK整批格式接入、恢复差异预览、批量清理、跨标签通知、全库审计/配额及运行证据仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行浏览器备份恢复/API/数据库或发布。

- P5：ContextPack历史页新增单份副本显式移除，完整审阅勾选与操作代次绑定；换观察/筛选或读取/导入/本地操作撤销确认。存储预先验证完整原绑定和document摘要，在create:false的单一事务内比对完整正文/摘要双槽，仅精确相等才删除并读回缺失，已缺失返回not-present，部分槽/异文/损坏拒绝。准备/恢复提交面板不开移除；审阅副本始终保留可导出/显式再保存，本页写尝试撤销目录/续页，取消/失败保持结果未知提示。有界备份/恢复已有独立源码增量；批量清理、跨标签通知、配额/全库孤立槽审计与运行证据仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行浏览器删除/产品/API/数据库或发布。

- P5：ContextPack网页历史目录新增精确原请求键、recorded/not-observed及含首尾UTC观察日期筛选，完整五字段查询随最后扫描槽续页，每轮最多100份完整双槽/绑定/摘要检查、20条匹配，非匹配损坏也拒绝整页；空匹配可继续，展示扫描/匹配数，不自动扫描全库。编辑/清除条件同步撤销旧目录/续页，保留审阅副本，导入不受筛选影响，本页操作互斥/取消保持。单份移除和有界备份恢复已有独立源码增量；时间排序、批量清理、配额/全库孤立槽审计、自动留存和运行证据仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

- P4：新增ContextPack `context recover-receipt --result-file RESULT.json --output NEW_RECEIPT.json [--json-file ORIGINAL.json]`，main及嵌入离线补存完整查询stdout中已有的历史候选，也接本命令输出再次恢复。96 KiB稳定UTF-8/有限JSON、闭合封套、完整原文/回执/trace/source_refs及规范document和已有本地摘要一致性核对，不重造时间、不访问旧路径。新目标预检、输入实际字节复读、独占发布/同步/完整读回，本地失败保留候选和本次local状态退出1。批量恢复/备份清理、其他命令stdout导入、Mock/嵌入在线查询及运行证据仍缺；R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/文件流程/API/数据库或发布。

- P4：新增ContextPack `context extract-original --receipt-file RECEIPT.json --output NEW_ORIGINAL.json [--json-file ORIGINAL.json]`，普通与嵌入CLI均离线，复用32 KiB完整历史摘要/8 KiB独立原文绑定检查；预检新路径、发布前原回执实际字节重读、独占发布/同步/完整原文件读回。成功与本地失败均保留完整历史/原请求及独立local状态，失败退出1；不改身份/参数/键，不重查或重发，仍需独立审阅。查询stdout补存已有独立源码增量，原请求提取stdout导入、批量备份清理、Mock/嵌入在线查询及运行证据仍缺；R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/文件工作流/API/数据库或发布。

- P5：ContextPack原保存查询观察已接显式浏览器留存/历史文件导出及原请求导出，复用CLI共享32 KiB文件，保留查询完成时的本地观察时间和完整原文/回执。新独立IndexedDB正文/摘要双槽按原Gateway/五身份/restricted+document摘要寻址，缺失才原子添加、同文保留、异文或部分槽拒绝，完整读回后确认；not-observed不覆盖recorded。新增/context/packs/receipts按完整原绑定显示每页20份完整摘要核验结果及文件导入/明确保存，筛选扫描已另行扩展；导入不联网查询或替换当前保存确认，页内操作互斥、取消及迟到结果丢弃，失败保留可导出内容。原请求库保持独立，历史单份移除和有界备份恢复已有独立源码增量；查询后自动留存、时间排序、批量清理、全库孤立槽审计与运行证据仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/API/数据库或发布。

- P0/P4：新增ContextPack历史观察文件共享格式，28 KiB document/32 KiB file，含完整原请求（含Gateway）、本地观察时间、完整recorded/not-observed回执及规范document SHA-256。CLI context save-receipt可选--output新文件，路径预检后查询，查询预算结束后独占发布/同步/完整读回；stdout保留完整原请求/回执/候选与独立local状态，本地失败退出1、不重查或重发。新增context inspect-receipt --receipt-file [--json-file ORIGINAL]，main及嵌入离线有界稳定读取/摘要实算/可选原文精确匹配，不需登录或路由，不把历史文件当服务端签名或当前状态。浏览器持久回执/目录、CLI原请求提取与查询输出离线补存已有独立源码增量；批量备份清理、Mock/嵌入在线查询及运行证据仍待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/API/数据库或发布。

- P4：新增MCP get_context_pack_save_receipt，严格4 KiB原五身份/restricted/键/显式预算TTL与可信未过期context.read会话相等；身份只作约束，原MCP/Gateway目标由调用方保持。接入context-history专用执行器，十一类上下文读共用每Gateway两路容量/30秒，实际底层结束才释放；单只读POST、继承写条件清除、原查询独立复制、16 KiB完整响应/错误和HTTP状态/type/trace/无ETag核验，32 KiB+4096文本包装。发现/prepare/认证客户端门禁已接，不能通过通用prepare绕过执行器；recorded只历史元数据且正文/来源not-checked，not-observed不授权重发。Mock/嵌入CLI、完整MCP原文件工作流、回执持久化及运行证据仍待补；R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/API/数据库或发布。

- P5：原ContextPack准备/恢复共用面板新增显式历史回执查询，独立server reader/action固定配置Gateway含路径、原范围/账号/客户端/restricted/参数/键；当前会话检查后单次只读POST，30秒含session读取、独立两路在途容量到真实工作结束、16 KiB完整响应/HTTP状态/type/trace/无ETag及原查询校验。查询不依赖本地副本写入、不调用保存或自动重发；recorded显示历史元数据/固定包链接/完整封套，内容与来源not-checked，关闭同页发送入口。后续错误或not-observed不清除已确认保存/历史，异文回执拒绝，原请求保留。历史仅留当前页面，持久保存/备份清理、MCP/Mock/嵌入CLI及运行证据仍缺；R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行网页/API/数据库或发布。

- P0/P2/P4：新增原ContextPack保存回执共享契约、POST /v1/context-pack/save-receipt、SDK getContextPackSaveReceipt及CLI context save-receipt。按原完整身份/restricted/请求键/显式参数查询既有保存指纹与标量元数据，父项目当前可见且真实权限有效；4 KiB请求/16 KiB响应，独立两路读取/30秒handler期限，超时后底层实际结束才释放。recorded不检查正文和来源，not-observed只表示快照中未观察到，不授予重发资格。CLI使用完整8 KiB原文件并核对配置Gateway含路径/项目，只查询一次、不保存或改文件。Web/MCP/Mock适配、嵌入CLI、独立Schema/OpenAPI、历史回执持久化和运行证据仍待补；R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行客户端/接口/数据库或发布。

- P0/P4/P5：Web原8 KiB ContextPack保存请求模型迁入contracts共用，保持规范字段顺序、文件格式和浏览器槽键。CLI新增context prepare-save/inspect-save/submit-save：用户指定原键，可信身份和含路径Gateway绑定、独占新文件写入/同步/完整读回；离线只读审阅原文及规范/原字节摘要；显式--reviewed后按配置核对Gateway/三范围，同token GET身份/restricted再单POST，发出前再次稳定读取原文件。单网络流程默认30秒，2 MiB完整回执/SHA-256/HTTP ETag与restricted检查，错误自身实际派发标记保留unknown；不覆盖/删除原文件、换键或自动重试。准备/提交网络main，嵌入runWorkctx仅离线审阅；旧compile兼容，MCP/嵌入完整原请求提交、持久历史回执和恢复目录仍待补。R-003未完成、evidence为空；仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/网页/API/数据库或发布。

- P4：新增CLI context save-identity与MCP get_context_pack_save_context，复用既有身份GET和上下文读执行器；CLI 4 KiB可选JSON/稳定文件/网络stdin及成对原身份约束，MCP严格空参数/可信会话。完整16 KiB封套、原范围/五身份/期限/restricted提示核验，嵌入授权后复查，MCP HTTP状态/type/trace/无ETag与错误白名单。十类上下文读沿各自两路容量/30秒，超时保留名额至底层结束；只读元数据，不访问包或项目记录、不预留键/保存/覆盖原绑定。CLI/MCP持久原请求与完整恢复、独立Schema/OpenAPI及运行兼容仍待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/MCP/SDK/API/产品/数据库或发布。

- P5：网页保存改准备可信绑定/审阅固定原请求/显式发送，原Gateway规范基址、五身份、restricted桶及原预算/TTL/键组成8 KiB格式；独立IndexedDB原文+SHA-256双槽，仅缺失添加、同文保留、异文拒绝，发送前完整读回确认。新增/context/packs/recover，按当前原绑定每页20份完整核验目录及文件导入导出；载入不发请求，读不存在数据库不初始化。服务端同session/token先GET save-context核对原绑定再带原actor/client条件单POST，共用30秒期限及完整2 MiB回执摘要检查；跨登录身份/项目/网关/权限变化阻止发送。未知始终保留原请求，成功显示固定包链接且不删除副本，缓存失败不误导重发。旧无绑定表单不迁造身份，原helper三参兼容不构成恢复保证；浏览器清理/存储不可用、历史回执持久化/备份/清理及运行兼容仍待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/API/保存请求或发布。

- P0/P2：新增GET /v1/context-pack/save-context与context.pack.save-context，真实未过期context.read及认证客户端门禁、策略审计和handler复查，16 KiB共享完整身份/期限/权限提示封套、原范围及可选actor-client相等。HTTP原始头拒重复及写/缓存/Range/正文，内部ApiGateway同样约束头部；SDK getContextPackSaveContext固定原参数、单有界GET、30秒/signal/到期检查，Mock沿显式会话且独立于包/compilations/项目可见性。无包/来源访问、键预留/保存证明或旧请求自动改绑；Web浏览器原请求恢复与CLI/MCP身份入口见上方增量，完整CLI/MCP恢复仍待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行API/SDK/Mock/保存请求或发布，无依赖/数据库/迁移变化。

- P0/P2：MockContextPackStore新增可选compilations与根导出MockContextPackCompilation，显式actor/client/原键/规范参数/目标包/pending或saved，种子整体16 MiB/最多100包和100场景。单POST 4 KiB参数、16 KiB头，完整封套/原预算最大TTL/WebCrypto SHA-256/来源状态检查后激活pending包，读取与目录自动可见；同键保留原内容与时间，参数或restricted桶变化拒绝。保存与读取各两容量、30秒/取消，实际摘要结束释放；激活后较小输出限额/到期错误不回滚，SDK继续unknown。旧配置兼容，无任意编译/数据生成/真实授权来源/数据库/持久恢复，预置版本时间不随提交重写，目录跨页不是快照。R-003未完成、evidence为空；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行Mock/SDK/API/保存请求或发布。

- P5：网页compileWorkbenchContextPack改专用server helper，原函数签名保持；固定本次session/范围/Gateway/参数/键，单POST及30秒本地等待，完整2 MiB成功/16 KiB错误、HTTP/type/trace/ETag、共享预算/最大TTL及Node SHA-256核验。自有派发错误使提交后401/权限/4xx/到期仍保留unknown；表单原参数锁定，已核验过期/来源变化可显式另起新请求但不宣称原保存失败。重复表单字段拒绝，原键不trim改写；完整成功才跳转，缓存刷新失败不要求重发。当前session获取在期限外，跨重登录账号/客户端及原范围未固定，无本地恢复存储或取消远端保证；运行/兼容和身份恢复闭环仍待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、渲染/浏览器/API/保存请求或发布。

- P2/P4：MCP compile_context_pack接入专用保存执行器，发现/prepare/调用统一可信未过期实际context.read和完整身份；严格4 KiB参数/相等原键，保留可信context键回退，规范预算/期限、单次内部POST。完整2 MiB成功/16 KiB错误、原范围/trace/预算/最大TTL、HTTP状态/type/ETag、Node SHA-256及restricted核对，4 MiB+4096转义文本包装。独立每ApiGateway两笔保存/30秒期限，底层结束才释放；阶段/派发/unknown固定诊断，无自动重试/换键/读回/持久化。prepare现要求专用executor，旧不完整返回或无可信实际能力的替身须迁移。内部请求不可取消、授权等待超时后仍可能写入，恢复存储/Mock保存及运行证据待补；R-003未完成、evidence为空。仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行MCP/API/保存或发布。

- P2/P4：`context compile`的main/callGateway/runWorkctx接入SDK完整保存核验，单一4 KiB JSON/稳定文件、网络有界stdin、默认{}与30秒timeout-ms；预算/期限规范化，可选成对expected身份，--key/正文idempotency_key/嵌入原context键必须一致。嵌入实际未过期context.read及完整身份，严格单次POST/头/正文/2 MiB限额，授权审计后复查取消/到期，结果restricted过滤补查，独立每router两笔提交容量直到底层结束。完整回执/摘要及预算/最大TTL沿SDK，派发后任何失败保留unknown；不自动重试/换键/读回/保存文件。旧不完整返回及无可信身份嵌入替身需迁移，MCP专用保存核验、运行兼容及恢复存储待补；R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/API/保存请求或发布。

- P0/P2：SDK `compileContextPack` 改为专用单次 POST，捕获原范围、可选账号/客户端、幂等键及规范预算/期限，增加默认30秒总期限和取消。共享4 KiB严格参数解析、2 MiB完整封套、预算/最大有效期及WebCrypto SHA-256核验；提交后的任何失败保守标记结果未知，不自动重试或换键。保留原可选身份兼容，旧不完整自定义传输/模拟回执需迁移，非法输入改为Promise拒绝；没有键/请求TTL回显或HTTP头核对，也没有本地恢复存储。R-003未完成、evidence为空，真实客户端/重放/取消/摘要及兼容证据待补。仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行SDK/API/保存请求或发布。

- P5：保存包对比页新增q候选查找，256 UTF-16/拒绝控制及孤立代理项/trim空值省略，原单值白名单与24 KiB导航保持。完整两侧读取/摘要/共享报告之后按ID及两侧正文/排除原因码字面小写匹配，再叠加changes视图；报告总数/元数据/来源不受q影响，原候选两侧完整字段/位置保持。展示全部匹配/当前可见数，区别两包空、无匹配、匹配均未变隐藏；清q保留模式，显式显示全部匹配。选择/模式切换/反向/单包查看返回/失败重试保留q、两编号及原有限返回，不发API筛选或使用latest。无后端/共享协议/样式/数据库改动，R-003未完成、evidence为空；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、浏览器/API运行或发布。

- P5：保存包独立read页新增q包内文字与show=all/included/excluded显示筛选，q限256 UTF-16/拒绝控制和孤立代理项，空白trim后省略、all规范省略，未知/重复/数组条件失败。完整读取及摘要核验后才按保存ID/入选正文/排除原因码不区分大小写字面匹配，保留原入选序号/排除顺序，区别空包与无匹配，显示可见/原总数；原完整统计、来源和响应保持。筛选/清除/固定链接固定本次实际pack_id，latest不会在筛选时换包；选择/显式最新和失败重试保留显示条件与有限返回链。无后端/协议/样式/数据库改动，R-003未完成、evidence为空，真实导航/筛选/完整数据及浏览器运行证据待补；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、渲染、浏览器/API运行或发布。

- P0/P4：新增保存包目录OpenAPI 3.1.0局部文档和包子路径，复用本地目录Schema，记录Bearer/三范围头、分别可选HTTP原身份条件、trace选择、三单值查询、规范limit和禁止正文/写/缓存条件。完整200无ETag、错误五字段开放details，提前拒绝不保证x-trace-id头；区分429通用限流与目录容量、503认证/审计与存储/超时的retryable。扩展只描述预算/能力，实际授权/游标/跨字段/大小仍由原实现核对；全量OpenAPI、工具解析/自动一致性与运行兼容仍缺，R-003未完成、evidence为空。未改运行时、未执行校验器/生成器、编译、类型检查、测试、API/数据库或发布，仅源码文档人工审阅与格式文本检查。

- P0：新增自包含保存包元数据目录Schema及包子路径，提供输入/规范/CLI查询、游标词法、六字段记录、范围/来源标记/完整封套。默认页大小注解25、返回limit必填，成对可选CLI身份；精确筛选最多一条无续页，续页非空。普通JSON/字节/UTF-16预算、时间/用量关系、原请求/权限、唯一ID/排序/页大小和规范游标绑定仍沿原解析器与可信服务；结构不能证明完整内容/来源有效或跨页快照。无需加载完整包Schema，不新增生产导入/校验器依赖。OpenAPI、本地加载和自动一致性/运行兼容证据待补，R-003未完成、evidence为空；仅源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试或发布。

- P0/P2：既有MockContextPackStore新增GET /v1/context-packs，经原MockWcpServer路径识别接入SDK listContextPacks/contextPackPages；种子/会话形状及16 MiB/100包上限保持，构造时提取六字段独立元数据。4 KiB严格路径、可选pack_id/limit/cursor、默认25最大100，按项目/会话/可见ID/read_restricted过滤后版本/ID降序limit+1，空页正常；不逐包读正文/hash/来源，不排除过期/来源变化。规范游标绑定store/身份/权限/可见集合/条件，用WebCrypto计算64 KiB内绑定摘要，无内容摘要核验；相同场景续期可沿用，跨store/条件拒绝。完整256 KiB及调用方更小限额，保留metadata-only/not-checked、原scope/query/trace/排序/续页；与完整包共用两容量/30秒/signal，底层摘要结束才释放。独立目录Schema见上方增量，OpenAPI、自动一致性与运行证据待补，R-003未完成、evidence为空；仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行Mock/SDK/产品/API/数据库或发布。

- P2/P4：新增MCP list_context_packs，4 KiB可选pack_id/limit/cursor，默认25最大100；发现/prepare/协议调用和HTTP客户端要求沿原动态门禁，身份来自可信会话，必须实际未过期context.read与完整范围/账号/客户端，拒绝参数覆盖身份或写条件。内部GET原context.pack.list处理器执行父项目/read_restricted过滤，完整256 KiB元数据页/16 KiB错误、HTTP状态/type/trace/无ETag及原范围/查询/排序/续页核验，错误code/status一致且固定文本；文本包装512 KiB+4096。九类上下文工具共用每Gateway两容量和30秒期限，新增目录busy/timeout码，底层结束才释放；无正文/hash/来源读取、自动翻页/重试/换包/编译/写入。元数据不证明当前可读/来源有效，内部请求不可中止，无跨页快照，外层HTTP认证/发送不计期限。Mock目录、独立Schema/OpenAPI和运行证据待补，R-003未完成、evidence为空；仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P2/P4：新增CLI context list-packs，网络main/callGateway与嵌入runWorkctx复用SDK单页保存包目录。最多一个4 KiB JSON/稳定文件，默认{}，仅网络有界stdin；可选pack_id/limit/cursor及成对expected_actor_id/expected_client_id，默认30秒timeout-ms。嵌入核对完整原GET/头/无正文/256 KiB限额、可信未过期实际context.read，授权审计后复查取消/身份；原handler执行父项目/read_restricted过滤，六字段元数据不另推断分类。共享九类上下文读每router两容量、底层结束才释放；完整页复用scope/query/trace/排序/续页核验，无局部结果/自动翻页/重试/换包/编译/保存。过期/来源变化包仍可列出，文件/stdin/stdout在读取期限外、通用transport无HTTP状态/ETag头。MCP/Mock目录适配、独立Schema/OpenAPI和运行证据待补；R-003未完成、evidence为空，仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

- P0/P2：新增SDK listContextPacks及按需contextPackPages，固定原范围/trace/可选账号客户端约束，GET /v1/context-packs显式页大小和原筛选游标，无正文/写条件。复用共享4 KiB查询、2 KiB记录、256 KiB完整元数据页，验证原scope/query/trace/排序/续页及metadata-only/not-checked标记；默认30秒含凭据/读取/校验、signal取消、固定错误。分页创建时要求完整账号客户端，next才发请求、每页独立期限，max_pages默认100最大1000；yield前保存续页、仍有续页时超过上限明确报错，无预取/重试/缩页/去重。泛型transport无HTTP状态/头，Fetch沿原bounded-json及16 KiB错误，SDK不验HTTP ETag或错误状态映射；没有跨页快照/新并发限制/内容摘要核验。CLI/MCP/Mock目录适配、独立Schema/OpenAPI和运行兼容仍待补；R-003未完成、evidence为空，仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

- P0/P2/P4/P5：新增GET /v1/context-packs元数据目录及/context/packs网页，默认25、最多100条，精确pack_id筛选，按版本/ID降序游标分页。可信未过期客户端、实际context.read、父项目及read_restricted过滤；只读取六个保存标量，不读取正文、摘要或来源，不排除过期/来源变化记录。共享查询4 KiB、单条2 KiB、完整响应256 KiB，游标绑定身份/范围/角色能力/页大小/筛选；无跨页快照。Web完整响应/trace/无ETag/会话校验、显式重试/首屏、基础包跨页选择与独立读取/对比返回。每router两笔目录容量、30秒处理器期限，底层结束才释放；Web另有30秒读取期限，认证获取/渲染/发送不计入。复用016索引，无新增或执行迁移。SDK/CLI/MCP/Mock目录适配、独立Schema/OpenAPI及运行证据待补；R-003未完成、evidence为空。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、渲染、执行产品/API/SQL/数据库或发布。

- P5/P2：新增/context/packs/read独立保存包查看页，空页仅查找、pack必须完整ULID、latest=1显式读取且与pack互斥；不先查询context目录或条目详情。复用原Web完整2 MiB JSON/HTTP-ETag/trace/Node SHA-256/16 KiB错误与30秒读取，显示保存元数据、完整入选正文/字段、排除原因/来源及完整封套；支持实际编号固定链接、预填对比和原条件重试。context头/保存卡片/目录失败及compare两侧/失败恢复接入，return仅接受重建的context或compare内部地址，保留原筛选/对比方向/显示条件，不接受重复或外部/片段返回，导航不授权。latest重复读取可能换包、失效/过期仍失败；页面渲染/发送不计读取期限，无新API/写操作/自动回退重试。R-003未完成、evidence为空；仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、浏览器/产品/API/数据库执行或发布。

- P0/P2：新增context-pack-comparison.json及contracts包子路径，JSON Schema 2020-12描述SDK/CLI/MCP完整本地结果，网页内部组合另有锚点。复用相邻context-pack-read本地资源，需注册两份完整文件、不联网下载；封闭查询/CLI身份/候选状态、最多2000行及位置1000、固定十一元数据行类型顺序、来源/计数/8 MiB纯报告对应形状。区分MCP client与SDK/CLI额外DEL限制；跨字段相等、摘要、精确差异/统计/来源并集、字节/UTF-16/节点/权限/期限仍归原实现，结构通过不证明真实性。原读取Schema/TS/各客户端未改，自动一致性、依赖资源解析/OpenAPI及运行证据仍待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未执行Schema校验器/生成器、编译、类型检查、测试、产品/API/数据库或发布。

- P2：新增MCP `compare_context_packs`，严格4 KiB双不同from_pack_id/to_pack_id，身份来自可信上下文、拒绝外部身份/写条件。发现/prepare/调用及HTTP客户端门禁复用上下文读识别；两次原方向指定json读取沿原Gateway策略审计，完整2 MiB封套/16 KiB错误、HTTP状态/type/trace/ETag、Node SHA-256及入选restricted核对。共享比较8 MiB、完整两侧及差异组合12 MiB、转义MCP正文24 MiB+4096；八类上下文工具共用每Gateway两容量和一次30秒期限，底层结束才释放，无半份/自动换包/重试/编译/来源访问/写入。内部请求不可中止、外层授权审计/网络发送不计工具期限；两次读取不是同一快照。独立组合Schema及客户端/容量/超时/输出运行证据待补，R-003未完成、evidence为空。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P2：新增CLI `context compare-packs`，网络main/callGateway和嵌入runWorkctx复用SDK双保存包比较。恰一4 KiB JSON/稳定文件，网络支持有界stdin；必需不同from_pack_id/to_pack_id和expected_actor_id/expected_client_id，默认30秒总预算及可选timeout-ms。嵌入按原方向核对两次json GET、身份/实际未过期context.read和入选restricted，沿用每router两笔共享容量，底层结束才释放；保存包分支授权审计后复查取消/权限。完整两侧各2 MiB、差异8 MiB、组合12 MiB，无半份、换包、重试、写入。输入采集/stdout发送不计SDK期限，通用transport无HTTP状态/ETag头；MCP对比、独立组合Schema与运行兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

- P0/P2：新增SDK compareContextPacks(query, options?)及WcpContextPackComparisonResult，要求原完整scope/actor/client、4 KiB双不同ULID，清除写条件并固定两次json GET相等约束。复用原2 MiB完整封套/WebCrypto SHA-256读取、共享8 MiB差异模型，完整from/to/query/identity_constraints/comparison组合12 MiB，默认30秒总预算和signal覆盖两次读取/摘要/比较/复制，超时或取消不交付半份/迟到结果，finally清理。标记local/separate-reads/pack-hashes-checked/source not-checked，不回退latest/重试/编译/写入；根导出纯比较及类型，纯函数不验摘要权限。通用transport不提供HTTP状态/ETag头，无额外SDK并发限制；既有Mock原样支持两次显式读，CLI/MCP/独立对比Schema及SDK/Mock真实兼容运行证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

- P0/P5：新增共享context-pack-comparison与Web /context/packs/compare显式双包对比，4 KiB两不同ULID、每侧完整2 MiB原范围json封套；逐ID联合selected/excluded/absent与原列表位置，完整两侧、字段变化、来源顺序/预算/保存元数据及added/removed/changed/same统计。共享函数只比结构，Web固定原会话/范围/基址，两次完整HTTP/trace/ETag/Node SHA-256读取与比较共用30秒，8 MiB比较/12 MiB组合及原JSON复杂度限制，失败不交付半份、不回退latest。目录头和保存包入口、部分选择只预填、全部/变化筛选、反向比较、原ID重试及受限原目录返回已接入，沿原读拒绝过期/失效包。无新Gateway路径/写入，SDK/CLI/MCP与专用Schema及真实兼容/导航/显示运行证据待补，R-003未完成、evidence为空；只源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染、执行浏览器/产品/API/数据库或发布。

- P0/P2：新增自包含context-pack-read.json（JSON Schema 2020-12）及contracts包子路径，覆盖SDK/MCP查询、CLI成对可选身份、规范查询、完整scope/来源/入选与排除项/保存包/回执/rendered及json/rendered格式封套。按当前解析器区分外层与保存trace、封闭字段、安全整数/预算/数量、摘要/版本ETag形状，旧sections实体保持。普通JSON/UTF-16/字节、原请求绑定、合计预算/跨数组ID/来源并集、动态URI文本/摘要与权限来源仍须运行时核对。未引入生产JSON导入/依赖，自动Schema一致性/OpenAPI及运行兼容证据待补，R-003未完成、evidence为空；仅源码文档人工审阅/格式文本检查，未运行校验器/生成器、编译、类型检查、测试、产品/API/数据库或发布。

- P0/P2：新增MockContextPackStore/Seed/Session，经MockWcpServer可选context_packs接SDK getContextPack；独立单项目完整json种子16 MiB/100包，构造校验结构、读取核对WebCrypto SHA-256，显式权限桶/来源状态和原身份/到期/可见包集合。latest按可见version/ID降序选择后验hash/到期/来源，不回退旧包；json/markdown/mcp保留完整内容/来源/版本与具体URI，外层trace更新。4 KiB路径/16 KiB头/2 MiB完整输出及调用方更小限额，独立store两容量/30秒/取消，摘要未结束仍占槽。无自动生成/编译/写入/真实来源查询，与其他Mock独立；生产Schema、真实兼容、期限容量与多数据集接线运行证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

- P4/P0：MCP resources/list 接入专用完整读取处理器，可信未过期实际context.read/完整身份，内部kind/cursor输入8 KiB；独立每router两容量/30秒，超时底层结束才释放。候选副本256 KiB/最多101项，严格kind/ID、UTF-8 C顺序、去重及after排他位置；保留100候选/8包扫描与空页续游标。逐包完整2 MiB封套/原范围-ID-trace/JSON内ETag/来源预算/Node SHA-256/restricted核验，16 KiB固定错误，只有经核对的不可用包可跳过；最终完整目录封套1 MiB。v3游标绑定原scope/actor/client/actor_type/能力角色集合，旧游标从首屏重读。非包候选仅元数据发现，项目不可见仍空目录；不改SQL，外层审计/发送不计期限，内层无HTTP头或状态核验。模板/其他资源、Mock/Schema、真实兼容与SQL成本证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P4/P0：MCP 保存包资源URI接入context-resource专用处理器，4 KiB仅uri、原项目/ULID或latest单次解码，可信未过期实际context.read/完整身份与父项目可见性、嵌套原策略审计保持；完整2 MiB json包/JSON内ETag/范围/来源/预算及Node SHA-256/入选restricted核验。包和当前条目资源共用每router两容量/处理器30秒，超时底层结束才释放；错误16 KiB固定提示，原URI/MIME/contents/source_refs保持、包装6 MiB+8192。不声称内层HTTP头/状态或外层审计/发送期限，无自动换包/重试/编译。模板/候选目录专用边界、Mock/Schema及运行兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P4/P0：MCP get_context_pack 接入上下文专用读取执行器，4 KiB可选pack_id/format、工具Schema用ULID；发现/prepare/调用与HTTP客户端门槛要求可信未过期实际context.read/完整身份。2 MiB成功/16 KiB错误，HTTP状态/type/trace/ETag及共享原范围/包/完整内容/来源/预算/rendered校验，Node SHA-256核对摘要和入选restricted权限；七工具共享两容量/30秒，超时底层结束才释放，包新增BUSY/TIMEOUT/完整性错误。输出原封套文本及4 MiB+4096转义上限，无换包/重试/编译/来源访问；prepare须迁专用执行器。resources/read与发现目录、Mock/独立Schema和运行兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P4/P0：CLI context get 接入现有上下文专用读取执行器，网络main/callGateway和嵌入runWorkctx复用SDK完整封套/格式/SHA-256；4 KiB可选单JSON/文件/网络有界stdin，默认latest，可选成对expected身份与默认30秒timeout-ms。完整成功2 MiB/Fetch错误16 KiB，嵌入可信未过期实际context.read、完整身份/真实GET/头/空正文/限额和入选restricted核验，与原六类读取共用每router两笔容量；超时底层router结束才释放。原编译保持，读取不回退/重试/写入/保存；通用SDK只见JSON内ETag，不宣称HTTP头/状态核验。MCP/Mock/Schema适配及CLI权限/取消/输入/旧返回运行兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

- P0/P2：SDK getContextPack(input?, options?) 接入完整共享读取，新增 WcpContextPackReadOptions（timeout_ms/signal）与查询/完整封套类型导出；固定原项目/可选账号客户端约束/包与格式，4 KiB 查询、2 MiB 成功/Fetch16 KiB 错误、默认30秒总预算，核对 JSON 内版本/ETag/游标/完整内容/来源/rendered，并以 WebCrypto SHA-256 核对保存摘要。摘要不可用/不匹配、取消/超时明确错误，finally清理；不继承写条件、不自动回退/重试/编译。通用transport不暴露HTTP ETag/状态，非法输入改为Promise拒绝，自定义transport需支持bounded-json/signal及完整封套。CLI/MCP/Mock/独立Schema与运行兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/产品/API/数据库或发布。

- P0/P2/P5：新增 ContextPack 完整读取共享契约与 Web 专用读取，4 KiB 查询、2 MiB 成功/16 KiB 错误、原 30 秒期限；核对完整内容/来源/预算/原 ID 与项目/版本/游标/trace/HTTP ETag，并按现有编译器规则重算 SHA-256。显式空 ID 不回退 latest，保存 trace 保持，rendered 需匹配具体 URI 与全文；页面失败保留原包和目录选择重试。原编译/命令解析保持，来源实时有效性仍由 Gateway 负责。SDK/CLI/MCP/Mock/Schema 专用接入与运行兼容证据待补，R-003 未完成、evidence 为空。仅源码文档人工审阅与格式文本检查，未编译、类型检查、测试、运行产品/浏览器/API/数据库或发布。

### 2026-11-04 开发补充（未编译、未发布、未测试）

- P0/P2：MockContextHistorySeed可启用directory并要求全条目directory_record，完整投影与元数据/可用详情及同版历史核对，目录保留微秒，跨详情时间比对限原毫秒精度。精确筛选/原可见性先分页，文本搜索用显式query命中集合，未配置报错；共享v2游标绑定store/身份/到期/权限/可见集/筛选/页大小。MockWcpServer按operation=context衔接原SDK单页/迭代，与工作项共存；session可选directory_access仅三项显示提示，缺省false。五类读共用store两容量/30秒/取消，摘要未结束仍占槽；输入8 KiB/完整页2 MiB，种子仍16 MiB/1000条目/总1000历史，不补造详情/历史或数据库搜索。运行/真实兼容/微秒排序/权限/期限证据待补，R-003未完成、evidence为空。仅源码文档人工审阅和格式文本检查，未编译、类型检查、测试、执行Mock/SDK/产品/API/数据库或发布。

- P4/P0：MCP list_context_items并入原上下文读取执行器，发现/prepare/调用要求可信未过期实际context.read及完整身份，admin不替代，prepare必须用专用执行器。目录8 KiB严格输入、2 MiB完整成功/16 KiB错误、HTTP状态/type/trace/无ETag及原scope/query/来源/权限提示/完整记录/归档/排序/续页/restricted核验；六类工具共用每Gateway两笔容量与30秒期限，超时底层结束才释放，目录新增MCP_CONTEXT_DIRECTORY_BUSY/TIMEOUT。保留完整封套单text，包装4 MiB+4096，无自动翻页/缩页/重试/写入，资源容量独立；Mock目录及运行/真实客户端/权限/期限/旧调用兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P0/P4：CLI context list纳入原context-history专用读取，网络main/callGateway与嵌入runWorkctx统一SDK完整目录解析；输入8 KiB可省略、稳定文件或仅网络stdin，其他五类仍4 KiB必填，可选成对身份与默认30秒timeout-ms。目录2 MiB/Fetch错误16 KiB，原scope/query/trace/来源/权限提示/完整记录/归档/排序/续页核验；嵌入可信未过期实际context.read、完整身份、固定POST/正文/头及restricted检查，六类共用每router两笔容量，超时底层未结束仍占槽。不自动翻页/重试/缩页/保存，旧游标或换页大小重回首页。MCP/Mock目录适配与真实兼容/权限/期限/容量证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

- P0/P2：SDK listContextItems接入专用8 KiB查询/2 MiB完整封套及默认30秒timeout_ms/signal，固定原项目和可选actor/client，清除写条件；完整核对scope/query/trace/来源/权限提示/记录/归档/排序及续页，自定义transport结果同样复制解析，错误只给固定提示。新增contextItemPages，创建时固定完整身份/筛选/页大小，next才读取、逐页预算、yield前保存原续页；max_pages默认100/最多1000，到限仍有续页时下一next明确报CONTEXT_DIRECTORY_PAGE_LIMIT。无预取/重试/自动缩页/去重，不承诺跨页快照或权限凭据。CLI/MCP/Mock专用目录适配、旧自定义transport迁移和运行证据待补，R-003未完成、evidence为空。仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行SDK/产品/API/数据库或发布。

- P0/P4/P5：上下文目录新增共享8 KiB严格查询、2 MiB完整页/16 KiB错误、原scope/query/trace/来源/权限提示与记录/筛选/排序/续页校验，保留完整正文。Gateway规范安全数字与UTC微秒时间，C排序/比较，v2游标绑定页大小及原范围/权限/筛选，旧游标重回首屏；Web完整读取覆盖原30秒期限，校验HTTP/type/trace/无ETag并复核会话。网页支持1–100页大小，默认25规范省略，导航/历史/重试保留；失败可显式减半页大小回原筛选首屏。PG文本查询不由JS重算，不声称数据库分配/扫描上限，SDK/CLI/MCP/Mock专用目录适配及运行/兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行产品/浏览器/API/SQL/数据库或发布。

- P0/P2：既有MockContextHistoryStore条目可选current_detail完整当前/归档封套，MockWcpServer原context_history配置接入两详情GET，与历史/版本共用每store两笔容量及30秒/取消。种子总16 MiB/1000条目/1000历史限制保持，单详情2 MiB，核对当前范围/版本/归档/分类及已有同版历史保存字段与确认；缺详情或视图不符明确不可用，不造历史或来源观察。可选review_access={human,review_context}显式约束确认提示，缺省false并隐藏严格就绪，已过期提示降为false；正文/来源诊断/记录时间保持，外层trace随请求，独立完整返回。旧历史种子仍可使用，Mock真实兼容/取消/大小/权限证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

- P4/P0：MCP当前context-item资源接入专用读取处理器，4 KiB仅uri输入、原项目/单次解码本地ID与可信未过期实际context.read校验；父项目可见性及嵌套context.item.read策略/审计保留，2 MiB完整正文/版本/JSON内ETag/来源诊断/确认/restricted核对。处理器30秒、每router独立两笔资源容量，超时底层未结束继续占槽；转义正文加重复来源的包装封套限6 MiB+8192，错误16 KiB后映射固定提示。保持contents URI/MIME/完整文本和source_refs，无归档回退/重试/写入。目录/模板及其他资源保持，工具容量独立；不声称内层HTTP ETag或外层审计/网络发送期限。运行/旧资源调用兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P4/P0：MCP get_context_item/get_archived_context_item接入专用完整读取，发现/prepare/调用要求可信未过期实际context.read及完整身份，admin不替代；仅item_id的4 KiB输入、2 MiB完整成功/16 KiB错误、30秒期限，核对HTTP状态/type/trace/ETag、完整范围/版本/正文/来源诊断/确认及restricted权限。五种详情/历史/比较工具共用每Gateway两笔容量，超时到底层结束才释放；详情使用MCP_CONTEXT_ITEM_BUSY/TIMEOUT，历史错误码保留，详情转义输出最多4 MiB+4096，无视图回退/重试/写入。resources/read、Mock、包与目录仍待完善，运行与旧调用兼容证据待补，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行MCP/产品/API/数据库或发布。

- P4/P0：CLI context read/read-archived接入SDK完整详情读取，网络main/callGateway及嵌入runWorkctx统一4 KiB输入、2 MiB成功/Fetch16 KiB错误、默认30秒timeout-ms；支持成对expected_actor_id/expected_client_id，恰一JSON/稳定文件，网络stdin有界。嵌入实际context.read/到期/完整身份、原路径/头/大小/无正文及restricted校验，五种详情/历史/比较命令共用每router两笔容量，超时底层未结束仍占槽；无视图替换/自动重试/保存。JSON内ETag/版本/来源诊断沿共享解析，通用SDK不暴露HTTP ETag。旧不完整嵌入返回、CLI参数/错误/期限和运行兼容证据待补，MCP/Mock专用接入仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行CLI/SDK/产品/API/数据库或发布。

- P0/P2：SDK getContextItem/getArchivedContextItem新增可选WcpContextItemReadOptions（timeout_ms/signal），默认30秒，捕获原项目/可选actor/client约束且不继承写条件。共享4 KiB严格查询与2 MiB完整封套/正文/版本/JSON内ETag/来源诊断/历史确认校验，Fetch沿bounded-json完整读取及16 KiB错误；自定义transport返回普通JSON亦复制并完整核对。历史/比较/迭代复用提取的原fields/capture实现，公开行为保持；固定错误、取消后不交付迟到结果、finally清理，无重试/自动归档切换/写入。通用transport不暴露HTTP ETag，此处只核对正文ETag；CLI/MCP/Mock专用接入及运行兼容证据仍缺，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

- P0/P5：当前/归档ContextItem新增共享4 KiB严格查询与2 MiB完整封套解析，核对原条目/项目范围、版本/ETag、保存字段/完整来源及归档状态；当前条目保留旧confirmed记录的null确认，校验原确认版本/身份/理由与实时来源诊断索引/状态/确认就绪。Web两GET入口固定查询，完整UTF-8/HTTP/trace/ETag及16 KiB错误沿原30秒期限，会话前后到期复核、固定错误与原目标重试；不截断正文或把来源观察当写权限。目录/包和SDK/CLI/MCP读取仍待完善，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、运行产品/浏览器/API/SQL或发布。

- P5：上下文版本比较增加全部/只看变化显示、区段锚点与历史字段差异计数；严格show=all|changes，缺省/显式all规范省略，重复/未知/空值报错。选择表单、模式切换、反向与重试保留两版本及原history/return链；仅在完整读取、摘要和共享比较后过滤未变属性/记录行及正文/来源/确认区段，无差异和空表有说明，读取信息保持。局部导航换行、当前模式标记和锚点焦点；仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、渲染/浏览器/API运行或发布，R-003未完成。

- P0/P2：新增SDK contextHistoryPages(itemId, query?, options?)与WcpContextHistoryPagesOptions，创建时捕获完整项目/账号/客户端约束及原条目/页大小/初始位置，next才派发、无预取；每页沿256 KiB完整读取与默认30秒期限/取消，yield前保存严格递减续页位置。max_pages默认100/最多1000，到限仍有续页时下次next抛CONTEXT_HISTORY_PAGE_LIMIT，已交付页保留供显式继续；提前break不再读取，不承诺跨页快照或来源真实性。仅源码文档/人工审阅/格式文本检查，未编译、类型检查、测试、运行或发布；运行/并发/真实历史证据仍待补，R-003未完成。

- P0/P2：新增MockContextHistoryStore/Seed/Session及MockWcpServer context_history配置，固定单项目当前可见状态与原历史快照，最多1000条目/总1000版本/16 MiB；共享完整结构/分页/来源校验、请求指定版本SHA-256、明确权限/到期/可见集合，支持SDK历史与两版本比较。目录256 KiB/版本2 MiB、30秒/每store两并发，取消后底层摘要结束才释放；不造历史/摘要/确认，不写库。仅源码文档及格式文本检查，未编译、类型检查、测试、执行或发布；R-003未完成，运行/真实数据兼容与旧调用迁移证据待补。

- P4/P0：MCP list_context_item_history/get_context_item_version接入专用有界执行器，新增compare_context_item_versions；可信未过期实际context.read身份用于发现与调用，4 KiB严格输入、256 KiB目录/2 MiB版本/16 KiB错误、完整响应和SHA-256核对。两版本共享30秒预算，三工具每Gateway共用两笔容量，超时到底层结束才释放；比较输出原本地形状、16 MiB业务/32 MiB+4096转义上限，无自动分页/重试/写入。仅源码文档和格式/文本检查，未编译、类型检查、测试、运行或发布；R-003未完成，Mock源码接入见后续增量，运行证据待补。

- P4/P0：CLI context history/version统一复用SDK有界完整读取，新增context compare；三个入口采用4 KiB严格查询、成对账号客户端约束（对比必填）、默认30秒总期限及指定版本SHA-256核对。嵌入可信context.read及restricted权限、SDK实际请求核对、每router两笔容量保持到底层读取结束；不自动翻页/重试/保存，比较保留原方向和完整本地结果。仅源码文档及格式/文本检查，未编译、类型检查、测试、运行或发布；R-003未完成，MCP/Mock源码接入见后续增量，运行证据待补。

- P0/P5：SDK listContextItemHistory/getContextItemVersion增加可选timeout_ms/signal，已知平面查询/选项和上下文先捕获，固定范围及已有账号客户端条件，GET不继承写键/版本。目录256KiB、版本2MiB完整共享解析，Fetch沿用16KiB错误；版本WebCrypto SHA-256异步核对在原预算内，无能力或不匹配明确失败。新增compareContextItemVersions，要求完整project/actor/client约束、两个不同明确版本，顺序读取与解析/摘要/本地比较共用默认30秒总预算，无自动重试或部分结果。返回本地组合类型含原封套、方向、身份约束及snapshot-hashes-checked/not-checked来源状态。比较模型提取contracts并补独立结构解析，Web复用；本地函数不认证摘要/权限/来源。CLI/MCP/Mock专用接入见后续增量；R-003未完成、evidence为空，仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、执行SDK/产品/API/数据库或发布，独立提交push main带[skip ci]。

- P5：新增/context/history/compare，历史页可选当页两版或单版预填，完整选择必须同条目两个不同正安全版本；严格单值URL，保留原历史before/version及已验证浏览/搜索返回链，交换方向/查看单版/失败重试不跳最新。两次顺序历史读取共用捕获会话/范围/Gateway与30秒总期限，每份复用2MiB完整快照/16KiB错误及SHA-256核对，首读失败不发第二读、任一失败不展示部分对比。十项属性、正文/来源/历史确认及九项记录信息分组比较；文字保留空白、JSON忽略对象键序但保留数组顺序与重复，缺省/null/空串保持区别，完整值滚动展示并支持窄屏堆叠，不做行内合并或恢复。无后端/共享协议/写表单/依赖/数据库变更，R-003未完成、evidence为空。仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、浏览器渲染、执行产品/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P5：上下文历史目录/版本快照新增共享严格查询和完整响应校验，固定item/版本/分页边界，目录倒序且续页定位最后一条，快照核对范围/摘要字段/来源/历史确认。Web请求前保存查询，读取限目录256KiB、快照2MiB、错误16KiB，沿用原fetch起始30秒截止，核对HTTP/trace/媒体类型/完整UTF-8并计算快照SHA-256；会话过期复核、固定错误消息，失败不返回部分内容。目录没有范围回显，不声称摘要是来源真实性证明；当前正文/目录/包及SDK读取仍待后续完善。仅源码文档人工审阅及格式文本检查，R-003未完成、evidence为空；未编译、类型检查、测试、执行产品/API/数据库或发布，独立提交push main带[skip ci]。

- P5：上下文主页面/版本历史已补共享严格导航，单值已知URL、共享筛选、合法条目/包ID及正安全版本参数先校验，不静默截断或回退非法枚举。目录失败保留原条件GET重试或原筛选首屏，条目失败固定原ID重试，归档切换清游标并保留原包/条件；历史入口/分页/选版/版本链接/失败恢复保留同条目/context内部返回地址和有效搜索返回链。历史当前条目入口按当前归档状态另行读取，不用历史授予当前状态。无写表单/后端/数据库/依赖变化，仅源码文档人工审阅及格式文本检查；真实导航/权限/浏览器/错误恢复证据仍缺，R-003未完成、evidence为空。未编译、类型检查、测试、运行页面/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P1/P4/P5：工作项列表新增sort=updated_desc/due_asc，省略/空/显式updated_desc统一原默认，due_asc按保存due_at升序、null最后、同日期ID升序。Gateway用微秒日期及C排序ID续页，null区段不回到有日期区段；专用v5查询绑定/v2位置，默认旧v1–v4键和位置保持。SDK/CLI/MCP/Web/Mock同步，Mock预存两种有序目录及独立v3绑定/v2位置；网页排序提交重置分页，清除筛选保留排序，列表/卡片显示保存日期，详情返回/错误重试保留排序。无跨页快照或来源真实性承诺，真实微秒/null分页、旧游标兼容、SQL性能及客户端证据仍缺，R-002未完成且evidence为空。无新路由/schema/迁移/索引/依赖，仅源码文档人工审阅/格式文本检查，未编译、类型检查、测试、运行产品/SQL/Mock/浏览器或发布；独立提交push main带[skip ci]。

- P0/P1/P4/P5：工作项列表新增due=scheduled/unscheduled及due_from/due_before严格UTC日期区间（含起始、不含结束），null表示无日期，区间排除null；无日期与区间互斥，空字段表示省略、MCP必须省略不用字段。Gateway参数化筛选在权限之后LIMIT之前，带新条件用v4游标、无新条件保留v1–v3；SDK白名单/完整页校验、Mock过滤和独立v2绑定、CLI帮助/MCP schema/Web日期控件及原导航/错误恢复同步接通。固定保存日期，不自动按当前时钟判逾期或改变任务状态。共享匹配、UTC/闰年/边界、游标兼容/换条件拒绝、真实SQL性能及各客户端导航证据仍缺，R-002未完成、evidence为空。无新路由/迁移/数据库schema/依赖，仅源码文档人工审阅及格式文本检查，未编译、类型检查、测试、执行产品/API/Mock/浏览器/数据库或发布；独立提交push main带[skip ci]。

- P5：工作项列表/详情已补专用有界响应读取，规范请求8 KiB、完整成功2 MiB/错误16 KiB，现有30秒期限覆盖网络与完整解析；严格状态/type/trace/无ETag、封套/来源/可选范围及共享记录/分页核验，固定错误文案与到期会话复核。列表失败保留已验证原筛选/视图/位置/选择供显式GET重试，另可清除游标/选择从原条件第一页重读；非法参数仅固定入口，详情保留原目标/返回地址。权限仍由Gateway执行，未证明实时Plane状态或跨页一致性。真实Web/网关/会话/超限/期限及导航证据仍缺，R-001/R-002未完成、evidence为空。无新路由/schema/依赖，仅源码文档人工审阅及格式/文本检查，未编译、类型检查、测试、运行产品/API/浏览器/数据库或发布；独立提交push main带[skip ci]。

- P0/P4：MCP工作项列表/详情已补专用executeWorkItemReadTool，发现/prepare/HTTP客户端门槛/直接调用要求可信未过期实际context.read和有效完整身份/trace，admin不替代。参数8 KiB，共享列表/详情严格解析，成功2 MiB/错误16 KiB/转义结果4 MiB+4096；HTTP状态/type/trace/无ETag、完整条目/目标/筛选/可选范围/restricted核对，固定错误retryable=false。两工具每Gateway共用两笔容量/30秒，超时底层未结束保留槽，迟到不交付；复制原参数上下文并清除继承写条件，不自动分页/重试/保存。普通HTTP输入限额保持，无新REST/共享契约/数据库/schema/依赖；真实发现授权/完整返回/超限/期限/容量/旧客户端证据仍缺，R-001/R-002未完成且evidence为空。仅源码文档人工审阅，未编译、类型检查、测试、执行MCP/API/SDK/CLI/Mock/产品/数据库或发布；独立提交push main带[skip ci]。

- P0/P4：work-items list/get已补专用CLI适配，main/callGateway/嵌入runWorkctx复用SDK默认30秒、2 MiB完整成功、Fetch错误16 KiB和完整trace/记录/筛选校验。--timeout-ms可配置，原JSON/稳定文件/仅网络stdin最多8 KiB，列表可省略JSON、详情须item_id；拒绝重复/未知/写选项。可选成对expected_actor_id/expected_client_id仅作身份头，嵌入固定可信身份、实际context.read/到期/restricted检查、两笔容量超时后保留至底层结束。保留完整原cursor显式续页，不遍历/重试/保存；文件/stdin等待不计入SDK期限。兼容/真实传输/期限/输入/容量/退出码证据仍缺，R-001/R-002未完成且evidence为空。无生产路由/共享契约/数据库/schema/依赖变化，只源码文档人工审阅，未编译、类型检查、测试、执行CLI/SDK/MCP/Mock/API/产品/数据库或发布；独立提交push main带[skip ci]。

- P0/P4：工作项SDK列表/详情已接WcpWorkItemReadOptions，默认30秒、取消、2 MiB完整响应、Fetch错误16 KiB、原trace/可选身份头/完整共享结果及独立副本；不继承写条件。新增workItemPages和WcpWorkItemPagesOptions，创建固定参数、next才读取、无预取，yield前保存续页及有界重复游标检测；max_pages默认100、最多1000，到限仍有续页时明确WORK_ITEM_PAGE_LIMIT，原页可供显式继续。不保证跨页快照、不去重/重排/重试/保存。旧自定义传输的严格JSON/封套兼容、真实期限/取消/超限和遍历证据仍缺，R-001/R-002未完成且evidence为空。仅源码文档人工审阅，无Gateway/共享投影/数据库/schema/依赖变化，未编译、类型检查、测试、执行SDK/Mock/CLI/MCP/API/产品/数据库或发布；独立提交push main带[skip ci]。

- P0/P4：已补MockWorkItemStore及可选MockWcpServer work_items配置，固定项目1000条/16 MiB、单条256 KiB种子与完整模拟身份/期限/权限/可见集合，连接及返回复制。目录/详情沿现有SDK方法，状态/优先级/精确owner/assignment和JS小写搜索先过滤，微秒更新时间降序/Unicode标量ID升序；Mock独立游标绑定store/会话/权限/可见集合/筛选，页大小可变。正文8 KiB、头16 KiB、响应2 MiB、30秒及两并发，取消超时后底层摘要未结束仍占槽；返回模拟来源、保留原记录，不自动翻页或写入。动态工作项/权限/删除、数据库locale/排序兼容、真实授权/审计/持久化及运行证据仍缺，R-001/R-002未完成且evidence为空。仅源码文档人工审阅，无生产路由/schema/依赖变化，未编译、类型检查、测试、执行SDK/Mock/CLI/MCP/API/产品/数据库或发布；独立提交push main带[skip ci]。

- P0/P4/P5：已补工作项assignment=assigned/unassigned筛选，严格保存owner空串/非空语义，不修剪数据或推断实时Plane负责人；unassigned拒绝与非空精确owner组合。共享输入/整页返回核对、Gateway分页前C比较、SDK/CLI/MCP入口与Web分配下拉均接入；CLI网络白名单允许新字段，Web未分配清空并禁用精确owner，筛选/视图/翻页/详情返回保留条件。含assignment使用v3查询绑定，省略时原v1/v2游标兼容；换条件必须回首页。无写接口/数据库schema/迁移/依赖变化，R-002仍未完成且evidence为空，真实组合筛选/旧游标/客户端及浏览器证据待补。仅源码文档人工审阅，未编译、类型检查、测试、执行产品/SDK/CLI/MCP/Mock/API/浏览器/数据库或发布；独立提交push main带[skip ci]。

- P0：已补文件版本比较独立JSON Schema 2020-12及contracts显式子路径导出，根为SDK/CLI/MCP文本中的本地组合；共享三字段/CLI五字段查询、身份、完整元数据/历史封套、固定八字段行、来源位置状态和差异计数均有定义。缺失来源侧省略，same/changed必须两侧，来源顺序和重复保留；大小/权限/原query与scope/trace/版本/ETag关系、差异重算仍由运行时执行。自动一致性、真实客户端和权限/期限证据仍缺，R-001未完成且evidence为空。不改生产比较行为、旧实体、数据库或依赖，仅源码文档人工审阅，未编译、类型检查、测试、执行校验器/SDK/CLI/MCP/Mock/API/产品/数据库或发布；单独提交push main带[skip ci]。

- P0/P4：已补 MCP `compare_artifact_versions`，严格4 KiB查询、两个不同正安全版本，发现/调用均要求可信未过期实际artifact.read。固定身份顺序读取两份历史记录，共用30秒及每Gateway两笔容量，超时底层未结束仍占槽；每份2 MiB/错误16 KiB，完整scope/版本/trace/JSON/无ETag/restricted核对。共享八字段与来源位置比较省略缺失侧undefined，返回两份原封套及local/separate-reads/not-checked组合，8 MiB结果/16 MiB+4096转义限制，无部分结果、重试或内容读取。运行兼容、独立比较Schema和真实权限/超时证据仍缺，R-001未完成且evidence为空。仅源码文档人工审阅，无REST/存储操作/schema/依赖变化，未编译、类型检查、测试、运行产品/CLI/MCP/SDK/Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P4：已补CLI artifacts compare网络/嵌入及callGateway入口，4 KiB JSON仅artifact_id/from_version/to_version/expected_actor_id/expected_client_id，两个不同正安全版本，账号ULID及客户端沿SDK上下文规则；项目使用既有配置，身份只作相等约束。--json/--json-file二选一，网络支持有界stdin，嵌入不读stdin；默认30秒总读取/比较期限，拒绝key/output/重复未知参数。复用SDK固定两版本读取及本地组合结果，嵌入逐次核对可信未过期reader、原身份/路径/方法/顺序/完整头/2 MiB限额/空正文，清除继承写条件，成功返回前再查期限身份。首读失败不继续，任一失败不输出部分结果，无自动重试/下载/保存/新服务操作；原回执保存退出语义保持。R-001未完成，命令参数/文件/stdin/身份切换/超时/路由及输出兼容待运行证据；无新协议/schema/依赖/数据库变化，仅源码文档人工审阅，未编译/类型检查/测试/执行CLI、SDK、Mock、API、产品、数据库或发布。

- P0/P5：已补SDK compareArtifactVersions，严格4 KiB完整查询/两个不同安全版本，要求构造上下文含完整项目/actor/client相等约束；异步前复制查询/身份/选项，沿两次历史元数据读取、默认30秒统一可取消预算和每份2 MiB成功/Fetch16 KiB错误限制，不继承写条件。首读失败不发起第二读，任何失败不返回部分对比或自动重试，成功返回明确本地组合结果、原查询/身份约束及两份完整封套，保留方向/原trace，非新Gateway协议或一致快照。完整比较模型已提取至contracts并供Web复用，两份元数据各2 MiB普通JSON复制，八标量字段及完整按位置来源保持顺序/重复/缺省语义。共享函数也可本地比较已持有记录，但不认证身份/内容/来源；无下载/上传/回执/落盘/新服务路由/schema/依赖/数据库变化。R-001未完成，SDK取消/总期限/自定义transport/凭据切换约束和Web兼容尚无运行证据；仅源码文档人工审阅，未编译/类型检查/测试/运行SDK、Mock、API、产品、数据库或发布。

- P5：已补/artifacts/compare文件版本对比，严格单值artifact/from_version/to_version，文件或单边版本可预填但不读取，完整选择需两个不同正安全整数；保留比较方向，不自动选择最新。详情/历史单项入口带入基准，历史页两下拉可选当页实际版本，翻页重置选项，新标签页且链接不预取。两次指定历史读取共用捕获会话/项目/Gateway及30秒期限，逐份2 MiB/错误16 KiB，完整共享解析/trace/无ETag与前后到期检查，任一失败不显示部分对比。并排展示八项保存字段及完整来源位置差异，保留顺序/重复/缺省字段，单独说明hash/size仅为保存描述，不读取正文或验证来源可用性；无恢复/上传/回执或原请求改写。R-001保持未完成，URL/方向/权限/期限/大响应/重复来源/浏览器呈现待运行证据；无新协议/schema/依赖/数据库变化，仅源码文档人工审阅，未编译/类型检查/测试/浏览器渲染/运行产品、SDK、API、数据库或发布。

- P5：已补工作台当前/历史文件详情及原上传回执的专用有界响应读取，成功分别2 MiB/4 MiB、错误16 KiB，既有30秒请求期限覆盖正文和完整契约解析；严格200、JSON/UTF-8、长度及trace，当前ETag匹配封套，历史/回执不接受ETag。沿一次会话核对发送前、响应到达及成功返回时有效期，失效取消未读正文。已知错误码只映射固定消息，异常/超限不显示部分结果，回执失败保留原身份/命令/键/版本、不推断失败或自动重发。目录、准备、上传和下载入口保持原路径，无新协议/依赖/schema/数据库变化。R-001仍未完成，大小/期限/会话/响应头/代理兼容和原请求保留尚无运行证据；仅源码文档人工审阅，未编译/类型检查/测试/浏览器渲染/运行产品、SDK、API、数据库或发布。

- P5：已补工作台目录及详情的追加准备版本约束，入口携带artifact和expected_version，严格单值合法ID/正安全整数解析，拒绝孤立版本。准备页使用同一会话读取writer上下文及当前元数据，不匹配时提示ARTIFACT_PREPARATION_VERSION_CHANGED且不显示准备表单；客户端准备解析及生成原请求再次核对。重新读取保留原版本，明确读当前记录表单可在新标签页选择新基准；旧原请求/键/版本/恢复与上传检查保持。入口均新标签页且不预取，无新协议/schema/依赖/数据库变化。R-001仍未完成，URL、版本变化、权限/到期及浏览器行为尚无运行证据；仅源码文档人工审阅，未编译/类型检查/测试/浏览器渲染/执行产品、SDK、API、数据库或发布。

- P0：已补contracts/schemas/artifact-registry.json自包含2020-12结构定义和显式包子路径，根为完整项目目录封套，提供输入/规范回显/完整续页/摘要项/页面/封套锚点及静态空页和单项示例。输入可省略limit，规范输出必填limit且名称非空无外围空白，续页必填cursor；闭合字段/分类/安全整数/条数/来源形状及has_more-next_query关联。规范游标解码、原身份权限/范围/trace/完整query绑定、筛选/ID倒序/排他位置、来源逐项对应及UTF-16/日期/字节限制仍由运行时执行，结构不授予读取或写权限。独立Schema源码已补，自动契约一致性、完整OpenAPI和运行证据仍缺，R-001未完成；旧实体/历史目录Schema及生产代码不变，无依赖/迁移，仅源码文档人工审阅，未编译/类型检查/测试/执行生成器、校验器、SDK、Mock、API、数据库或发布。

- P0：已补MockArtifactStore项目目录GET，与创建POST及历史目录分开；listArtifacts可经既有MockWcpServer配置读取当前已上传文件。仅目录GET路径8192字符、内层查询8 KiB，严格单值名称/分类/页大小/游标、默认20最多20；权限/名称ASCII字面子串/分类先过滤、ID倒序，Web Crypto绑定原五项身份/受限能力/筛选/limit，异步后同步读取当前状态。每store两笔目录容量持有到底层结束，核对取消/到期；最多21份元数据各限2 MiB且核对版本Map和完整摘要，封套256 KiB/调用方更低限额，探测行也核验。无正文读取/内容摘要/回执或释放记录写入/自动翻页；动态权限、损坏种子、真实SQL锁/审计、独立Schema和运行证据仍缺，R-001未完成。无真实服务/schema/依赖变更，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK、Mock、产品、API、数据库或发布。

- P0/P4：已补CLI artifacts list与MCP list_artifacts当前项目文件目录，查询8 KiB、默认20最多20、名称/分类过滤与完整next_query显式续页。CLI网络/嵌入复用SDK listArtifacts的256 KiB封套、30秒期限与固定错误；嵌入核对有效实际reader、规范路径/方法/范围/限额，稳定文件/网络有界stdin沿原入口。MCP发现/prepare/直接执行均核对有效已验证实际artifact.read，独立每Gateway两笔/30秒等待，底层超时未结束仍占槽；成功/错误256/16 KiB，转义文本另限，完整scope/trace/query/排序/next_query和restricted检查。SDK registry错误补齐项目不可见及重新查询提示，不改旧读取错误。无自动分页/下载/上传/回执查询/本地输出，当前目录非跨页快照；独立Schema/OpenAPI及运行证据仍缺；Mock目录源码接入见独立增量，R-001未完成。无服务端目录/schema/依赖变更，仅源码文档人工审阅，未编译/类型检查/测试/执行CLI、MCP、SDK、API、数据库或发布。

- P5：已补工作台/artifacts/browse项目文件目录，严格单值名称/分类/页大小/游标，默认20最多20，搜索或清除筛选显式GET回到首屏，下一页保留服务端完整next_query。复用当前认证范围、无缓存读取、30秒期限、256/16 KiB成功/错误限制与完整共享封套核验；显示当前筛选、当页数量、分类/大小/来源数及保存时间，所见版本/当前详情/截至所见版本的历史均新标签页且禁用预取。参数或过期位置错误可重新搜索，缺可信快照/项目不可见/服务不可用分别提示，无自动分页/下载/上传/浏览器持久保存。独立Schema和运行证据仍缺；Mock目录源码接入见独立增量；CLI/MCP源码接入见独立增量，R-001未完成；无依赖/数据库schema/服务端目录变化，仅源码文档人工审阅，未编译/类型检查/测试/浏览器渲染/执行产品、SDK、API、数据库或发布。

- P0/P2：已补GET /v1/artifacts与SDK listArtifacts当前项目文件目录，按名称ASCII折叠字面子串/分类筛选，默认20最多20，ULID C序倒序，完整next_query绑定原范围/账号/客户端/受限读取能力/筛选/页大小；不是跨页快照或写条件。持久读取沿父项目锁和最多21条当前行共享锁，当前JSON与保存快照各先限2 MiB，复用完整currentRow一致核验且验证探测行，坏/旧快照不返回部分成功。响应256 KiB、公开当前摘要/来源数无存储键/正文/ETag/回执；Gateway显式artifact_registry或沿artifact_storage、实际artifact.read及未过期已验证客户端，SDK30秒/取消/固定错误。独立Schema和性能/运行证据仍缺；Mock目录源码接入见独立增量；CLI/MCP源码接入见独立增量；工作台源码接入见独立增量，R-001未完成；无依赖/迁移，只源码文档人工审阅，未编译/类型检查/测试/执行SDK、产品、API、SQL、数据库或发布。

- P0：已补contracts/schemas/artifact-versions.json自包含2020-12结构定义和显式包子路径，完整成功封套为根，提供输入/规范回显/完整续页/摘要/页面/封套锚点与静态示例。拒绝未知字段，区分limit默认输入与必需规范输出，约束安全整数/分类/来源/分页形状，before依赖at，has_more关联next_query。共享解析器仍承担字节/JS属性/UTF-16/规范日期/原query、scope、trace绑定和版本顺序/下一查询比较；Schema不替代实际授权、完整解析或正文核验。旧Artifact实体Schema不变，无运行时JSON导入/新依赖/迁移；完整OpenAPI、自动生成/契约一致性及运行证据仍缺，R-001未完成。仅源码文档人工审阅，未编译/类型检查/执行生成器或校验器/测试/运行SDK、Mock、产品、API、数据库或发布。

- P0：已补MockArtifactStore的GET附件版本目录，复用既有内存上传历史与固定模拟会话，listArtifactVersions可经MockWcpServer接入。只有目录GET接受严格limit/at_version/before_version参数，默认10最多20，保留原上界和完整next_query；POST追加及其他路由的查询/正文/写条件约束保持。当前与最多21条选中/探测元数据完整有界校验，历史分类权限再检查，完整封套256 KiB并遵守更低调用方限额；目录不读字节/计算内容摘要、不写回执/版本/释放记录，不自动翻页。Mock只覆盖已有上传历史，不模拟历史损坏/缺失种子、动态权限、SQL锁或真实审计；独立schema及运行证据仍缺，R-001未完成。仅源码文档人工审阅，未编译/类型检查/测试/执行SDK、Mock、CLI、产品、API或数据库/发布。

- P5：已补工作台/artifacts/versions历史目录，严格文件ID与1–20条分页参数、完整保留next_query原上界，默认10条。服务端读取复用当前认证项目，256/16 KiB成功/错误限额、30秒等待、完整共享封套及trace/无ETag检查，固定错误提示。明确区分较早页、同上界首页与重新读取最新；摘要显示分类/大小/时间/来源数，独立版本详情新标签页打开且禁用预取。缺可信旧快照/不存在/权限不足/未配置分别提示，无自动翻页/下载/上传/回执查询/浏览器持久存储。Mock目录、独立schema和运行证据仍缺，R-001保持未完成。仅源码文档人工审阅，未编译/类型检查/测试/浏览器渲染/执行产品、SDK、CLI、API或数据库/发布。

- P0/P2/P4：已补CLI artifacts versions与MCP list_artifact_versions，复用现有版本目录契约及完整next_query。CLI网络/嵌入沿SDK有界256 KiB响应、默认30秒和固定错误，4 KiB内联/稳定文件查询，网络可有界stdin，拒绝key/output/重复参数；嵌入清除写条件并校验未过期实际reader、规范路径/方法/正文/响应限额。MCP目录/直接调用均要求已验证未过期实际artifact.read，独立两笔/30秒期限，底层未结束不释放超时名额；成功/错误256/16 KiB、转义结果另限，完整共享核验并丢弃上游错误详情。只读历史摘要，不自动翻页/下载/查上传回执/恢复/上传；工作台/Mock目录及运行证据仍缺，R-001未完成。无服务端目录/数据库schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行CLI、MCP、SDK、API、数据库或发布。

- P0/P2：已补PersistentArtifactService.listVersions、GET /v1/artifacts/{artifact_id}/versions与SDK listArtifactVersions，默认10最多20条历史摘要，首轮固定版本上界、续页完整query/at_version/before_version，明确非当前写条件。当前项目/附件共享锁及每页权限检查，最多21份历史快照各先限2 MiB并完整核验（包括探测行），公开只含元数据摘要/来源计数，无对象正文或storage_key；成功封套256 KiB，SDK默认30秒与signal，不自动翻页。显式artifact_versions reader或既有artifact_storage接线，旧reader必需方法保持；CLI/MCP/Web/Mock目录、Schema生成物和运行证据仍缺，R-001未完成。无依赖/数据库schema变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK、产品、API、SQL、数据库、迁移或发布。

- P0/P2/P4/P5：已补SDK独立inspectArtifactReceipt，4 MiB文本/非共享UTF-8字节、1 MiB内嵌原请求，支持完整expected_original和实际/规范回执SHA-256约束。默认30秒本地预算与signal，异步前捕获输入/约束，取消或失败不返回部分结果。contracts共享parseSavedArtifactReceipt统一CLI及工作台解析；原裸封套、历史trace/status和既有文件行为保持。输出本地trace/空外层sources、完整回执/原请求及规范JSON和摘要、明确身份未认证/服务器与内容未检查/未上传/未读写文件；不需要WcpClient或凭据。签名认证、回执集合/持久恢复及运行证据仍缺，R-001未完成。无服务端/schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK、CLI、浏览器、Mock、API、数据库或发布。

- P2/P4/P5：已补工作台在线回执反馈的显式保存按钮，覆盖receipt页与上传页已查询反馈，浏览器仅报告保存请求。新增/artifacts/receipt/saved本地文件查看，兼容CLI裸WCP回执4 MiB与原命令1 MiB，完整共享解析/实际字节SHA、可选独立原文件比对；固定历史状态加本地未认证提示，不复用服务器confirmed样式。不提交导入内容、不查Gateway、不写浏览器存储；原请求可显式导出后由用户另行查询。沿现有30秒有界operation/stream，取消/卸载/pagehide/缓存恢复撤销迟到结果与内存视图，下载URL及时释放。页面壳仍沿既有会话读取，不承诺脱网启动；签名认证、集合管理、持久恢复及浏览器/运行证据仍缺。无服务端/schema/依赖变化，只源码文档人工审阅，未编译/类型检查/测试/渲染/执行产品、接口、数据库或发布。

- P0/P2/P4：已补CLI artifacts receipt显式--output NEW_FILE及离线inspect-receipt --receipt-file，可选--json-file ORIGINAL。新路径预检在查询前，完整原回执4 MiB独占保存并按实际hash/大小/共享封套读回；stdout包装保留receipt/local，文件失败退出1仍保留原回执，发布后不确认明确保留目标。无output返回形状保持，get/version拒绝output。离线无需配置/网络/数据库，核对完整原身份/键/版本/命令及适用历史快照，可选独立原文件1 MiB比对，返回实际字节摘要且外层sources空、身份未认证/服务器与内容未检查。不把not-observed或本地有效当作上传失败/成功，不自动重试或上传。签名认证、回执集合恢复、持久上传恢复编排及运行证据仍缺；无服务端/schema/依赖变化，只源码文档人工审阅，未编译/类型检查/测试/执行CLI/SDK/Mock/API/数据库或发布。

- P0/P2/P4：已补CLI artifacts download整次读取期限，网络与嵌入--timeout-ms默认180秒覆盖历史元数据/正文/完整校验，Fetch两阶段共用signal，嵌入迟到结果丢弃且不启动保存。文件输入/路径预检在预算前完成，保存前最后检查，写盘/清理开始后等待结束。元数据及正文非字节封套2 MiB纯JSON限制、HTTP头16 KiB，非共享内容复制并独立SHA核对，失败保留已确认release ID；远端异常只有限同trace代码/固定消息，只有本地save错误保留文件恢复信息。嵌入重查有效reader并清除旧写条件。流式下载、后台provider容量、文件取消、客户端持久交付回执及运行证据仍缺；无服务端/schema/依赖变化，只源码文档人工审阅，未编译/类型检查/测试/执行CLI/SDK/Mock/API/数据库或发布。

- P0/P2/P4：已补CLI artifacts get/version/receipt共用有界SDK查询，网络与嵌入支持--timeout-ms默认30秒，元数据响应2 MiB/回执4 MiB/HTTP错误16 KiB，完整scope/trace/版本/原身份及命令校验，固定查询错误不证明此前上传失败。查询JSON限制4 KiB、原请求1 MiB，文件稳定读取与网络--json -有界读取，嵌入新增--json-file但不消费进程stdin；输入等待在查询期限之外。嵌入要求可信未过期reader/writer和原身份匹配，清除继承写条件，迟到结果不发布；底层router可能继续。保留content_state及recorded/not-observed，不上传/重试/刷新版本。文件/stdin取消、后台provider并发限制和运行证据仍缺；仅源码文档人工审阅，无服务端/schema/依赖变化，未编译/类型检查/测试/执行CLI/SDK/Mock/API/数据库或发布。

- P0/P2/P4：已补CLI网络原附件上传的bounded-json multipart传输，完整成功4 MiB/错误16 KiB、HTTP期限覆盖凭据/网络/逐块响应，成功完整解析后重查期限。共享artifactUploadResult先做4 MiB纯JSON快照，网络/嵌入均生效；派发后失败仅同trace有限代码/固定消息，去除上游详情及retryable建议，固定false和started/unknown/unconfirmed，保留原身份/键/版本/内容查回执。嵌入清除旧if_match，参数/稳定文件读取/Node SHA流程保持，不新增文件I/O或嵌入writer隐藏超时。上传恢复持久化、文件读取取消、流式传输及运行证据仍缺；无服务端/schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行CLI/SDK/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2：已补SDK createArtifact/putArtifactVersion的timeout_ms/signal及默认180秒整次预算，完整原请求1 MiB、非共享内容沿既有1 GiB协议上限，异步前复制，发送前SHA-256核对原描述；显式原身份/键/版本头，不继承旧写条件。Fetch bounded-json支持同步复制的原生FormData POST，凭据/网络/正文共用独立传输期限，成功4 MiB/错误16 KiB，完整原封套解析及迟到拒绝。错误固定retryable=false，派发前本次not-sent/服务器未查，开始transport后任何失败unknown，保留原请求并显式查回执，不重试/换键/刷新版本。Mock仅源码兼容，CLI通用json路径不自动增强；流式上传、调用方持久恢复及运行证据仍缺。无服务端/schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK/CLI/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2：已补SDK独立inspectArtifactUploadRequest，接收1 MiB内原identity/command UTF-8字节或JSON文本，可选非共享内容（默认64 MiB/最多1 GiB）与实际/规范请求预期SHA-256；异步前复制所有输入、保留原键/版本/身份/内容描述，默认180秒预算及signal、完整Web Crypto摘要，失败无部分报告。返回完整original、实际字节和规范JSON各自大小/摘要、content_state，明确本地有效/身份未认证/服务器未查询/未上传/无文件I/O；无需WcpClient/当前会话，不重新prepare或生成键。与CLI共用原请求格式但不修改CLI文件流程，文件读取/保存、上传恢复编排及运行证据仍由后续补齐。无服务端/schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK/CLI/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2/P4：已补SDK固定版本下载整次180秒本地预算与AbortSignal，max_bytes默认64 MiB仍保持，元数据/二进制/摘要共用期限，固定身份/版本/描述、复制非共享字节并核验完整头和SHA-256；失败无部分返回，已核对放行ID保留、未确认不推断无记录。Fetch bytes新增凭据/网络/逐块正文取消与独立期限、严格成功200/trace/octet-stream/规范长度、错误16 KiB，清理不等待、迟到响应取消；网络CLI原bytes读取JSON改为bounded-json以保持兼容。Mock沿既有signal衔接，普通json不受影响；自定义transport/摘要后台、流式大文件、客户端保存回执及运行证据仍缺。无schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK/CLI/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2：已补SDK getArtifact/getArtifactVersion/getArtifactReceipt的WcpArtifactReadOptions，默认30秒本地预算、signal、当前/历史2 MiB和原回执4 MiB完整响应上限、原请求1 MiB及Fetch错误16 KiB。异步前固定上下文/选项/原查询，transport正文与本地期望分离，scope及可选账号客户端约束保持，回执始终附原身份前置头；完整共享解析、固定错误及迟到检查，不继承写条件、不重试/上传/刷新版本，失败不改成not-observed。下载元数据阶段受默认预算，内容接口保持；自定义transport须执行bounded-json/signal，其预先分配内存不受SDK全局控制。文档和Mock源码兼容说明已补，运行证据仍缺；无服务端/schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/执行SDK/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2/P4：已补实际Gateway MCP prepare_artifact_upload，规范新草稿+最多4 MiB Base64内容，可信身份/限制及追加实际read能力/显式审阅版本核对后生成原请求JSON和摘要，明确未保存未上传；目录实际artifact.write、有效认证、readOnlyHint=true/idempotentHint=false，不走通用单路由准备或自动重试。与上传共用HTTP/嵌入两路容量，大正文扩展先预留容量，实际上传解析后仍核对持久writer；30秒本地期限，超时底层读取继续占槽，迟到不继续准备。输入8 MiB、原请求1 MiB、身份/错误16 KiB、元数据2 MiB、输出及二次转义均有界。调用方保存/恢复、客户端兼容和运行证据仍缺；仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行MCP/API/SDK/数据库或发布，独立提交push main带[skip ci]。

- P0/P2/P4：已补SDK prepareArtifactUpload，新草稿/有限非共享内容副本在异步前固定，核对可信身份、服务器大小上限、实际read能力和显式追加版本；默认64 MiB/180秒，Web Crypto SHA-256、安全随机键、有界只读响应与取消/期限，返回完整original及request_json/摘要，明确未保存/未上传。共享草稿解析同时接CLI；SDK上传/回执核对scope及可选配置身份，原账号/客户端始终以服务器前置头验证，普通字符串账号可省略于SDK构造上下文。MCP准备已由后续源码增量补齐；调用方保存/恢复和运行证据仍缺；仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行SDK/CLI/Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2/P4：已补CLI artifacts inspect-request，无配置/令牌/网络的完整原请求离线核验，可选内容长度/SHA-256检查；严格参数、1 MiB请求与默认64 MiB内容预算、稳定有界普通文件读取。返回原身份/完整命令、实际文件及规范请求摘要，明确未认证身份/服务器未检查/本次未上传；不改键、版本、文件或回执状态。原文件可直接交既有上传/回执入口，输出封套不代替原文件。SDK准备已由后续源码增量补齐；MCP准备另有后续源码；专用失败副本恢复/保存及运行证据仍缺；仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行CLI/SDK/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P2/P4：已补CLI artifacts prepare，新建完整元数据草稿或追加artifact_id/显式expected_version，拒绝旧原请求/键/hash/size；先核对新输出与草稿，读取可信上传身份、有界稳定文件并计算SHA-256，追加核对实际read权限/当前元数据/原版本。校验完整原请求后生成一次新键，独占保存并完整最终读回，可交既有上传/原回执入口；不上传、不预留版本、不自动换键或重试。默认64 MiB文件上限与180秒准备期限，文件I/O等待结算，保存开始后不竞速超时，失败保留路径/阶段。SDK准备已由后续源码增量补齐；MCP准备另有后续源码，恢复工具及运行证据仍缺，R-001未完成。仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行CLI/SDK/Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P2/P4：已补CLI artifacts identity与MCP get_artifact_upload_context，要求实际artifact.write及可信有效会话，admin不代替；空参数读取原可信身份/期限/限制/能力，不生成键、准备文件或上传。CLI严格单次timeout参数，HTTP复用SDK、嵌入router核对完整可信authority；MCP目录和直接调用一致，独立两并发/30秒期限/16 KiB封套与固定错误，超时底层继续占槽。Gateway抽取原身份校验并新增不可表示错误码，服务端上传协议不改。CLI完整原请求准备/文件保存已由后续源码增量补齐，SDK准备另有源码增量，MCP准备另有后续源码，其他公开路由及运行证据仍缺；只源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行CLI/MCP/SDK/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P2：SDK已补getArtifactUploadContext及选项/响应类型，连接既有上传身份GET与资料Mock；固定范围/trace和可选actor/client约束，30秒本地期限/取消/16 KiB完整响应及纯JSON副本/到期核对，规范错误，不继承写条件、不重试或保存/替换原上传请求。无服务端/schema/依赖变化；CLI/MCP身份读取和CLI完整原请求准备已由独立增量补齐，SDK准备另有源码增量，MCP准备另有后续源码，实际兼容证据仍待补，R-001未完成。仅源码文档人工审阅，未编译/类型检查/测试/执行SDK/Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P2：资料Mock已追加固定版本二进制下载，独立download_access导出/策略配置、当前与历史分类/描述符核对、字节副本及SHA-256、单次限制与两并发、取消到期和完整响应头检查。成功前同步保留模拟释放记录，最多1000条/16 MiB，getDownloadRelease供store持有者读取副本；每次下载独立记录，既有版本及原上传回执不改写。拒绝审计、传输观察、动态权限、持久恢复、真实Policy/存储/审计及运行证据仍缺。仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行SDK/Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P2：已补独立资料上传与版本历史 Mock 六路由，显式范围/模拟权限、multipart创建/追加、当前及固定版本元数据、完整原上传回执。核对五项身份、原键/命令/If-Match及SHA-256；历史元数据与原回执保留原版本，异步读取后同步检查重放/当前版本/容量/完整响应/取消到期再提交。单次16 MiB、两并发、1000版本及64 MiB累计编码预算，返回复制；二进制下载已由后续独立增量补齐，持久恢复、真实权限审计和运行证据仍缺，P0-02/R-001未完成。仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行SDK/Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P0/P3：已补同一同步Mock的冲突目录/详情/解决身份/原请求提交与回执五路由，显式conflict_access读写开关并复用来源/分类可见性。上传冲突同批保留完整双方值和原版本；元数据分页绑定store/身份/权限/筛选，详情完整。解决严格核对原版本/键/完整命令，同文重放原事件，换键已解决/同键异文拒绝；只更新冲突并追加同流ConflictResolved，不改源字段或原上传回执，原请求查询保持recorded/not-observed。完整响应/流/容量/取消到期检查后同步写入；动态来源、旧外部冲突导入、持久化、真实权限审计/网络未知及运行证据仍缺。仅源码文档人工核对，无schema/依赖变化，未编译/类型检查/测试/执行Mock/API/数据库或发布，独立提交push main带[skip ci]。

- P0/P3：已补可选同步上传与原事件回执 Mock，显式来源和会话能力配置后开启两路由；完整身份隔离批次键和事件ID，原批次精确重放、原事件规范同文重放、客户端序号连续性与来源/版本冲突回执。新增canonical事件进入既有下载/确认流，来源/分类和显式可见性过滤；原回执保留原trace/时间/结果，不修改来源字段。完整输出、容量、取消/过期核对后才同步提交内存账本与流，未启用时保留原四路由。冲突详情/解决、动态来源更新、持久恢复、真实权限审计与运行证据仍缺；仅源码文档人工审阅，无schema/依赖变化，未编译/类型检查/测试/执行Mock/API/数据库或发布；独立提交push main带[skip ci]。

- P7：已补生成日志备份离线 list/get/result/outcome，完整核验后按状态与原键摘要分页，默认10最多20条，续页/选择绑定原备份摘要。完整读取保留原请求/领取/结果，成功记录导出沿用2 MiB格式；原结果导出为8 MiB内三字段恢复文件，保留成功/失败原时间和摘要，不重建领取。新文件不可覆盖发布，失败保留提取内容、来源及保存阶段；不打开日志/队列、不调用模型或解除未知。自定义失败封套不能直接恢复，仅其中outcome content兼容原恢复解析器。普通日志合并、隔离解除、供应商对账和运行证据仍缺；仅源码文档人工核对，无schema/依赖变化，未编译/类型检查/测试/运行或发布；独立提交push main带[skip ci]。

- P7：已补已有恢复日志缺项合并，严格要求原隔离标记/原备份/完整binding一致及同范围规范日志；普通目录、其他绑定、孤立或损坏拒绝。完整差异预检后只补缺失request/attempt/outcome，异文/跨键ID冲突整批拒绝，目标更多结果及独有项保留，联合100请求/32 MiB。计划摘要固定源、目录/隔离身份、目标原逻辑内容及预计联合内容，执行重读匹配；先独占保留完整来源及目标原快照，再按原顺序新增，逐请求和最终全量读回。多文件非事务，竞争/失败保留已写文件、证据与阶段，须重新预览，不自动重试/删除或解除隔离。普通日志原位合并、冲突处置、并发协调和运行证据仍缺；仅源码文档人工核对，无schema/依赖变化，未编译/类型检查/测试/运行或发布；独立提交push main带[skip ci]。

- P7：已补生成日志备份差异比较，两完整文件或备份+现有目录/原binding两种互斥入口。全量验证双方请求/领取/结果后按原键标注同文/缺失/单侧扩展/冲突，逐文件列状态和变化字段，跨键复用request_id/attempt_id也冲突，current独有项单列；原时间/摘要不同不归并，扩展仅指文件关系不代表较新或可信。只输出原身份/时间/摘要/状态等元数据，目录复用有界两轮完整捕获并核对目录身份/隔离观察一致，变化/损坏不返回部分报告；不写日志/凭据/队列/网络，不合并、释放未知或派发。成功含差异仍退出0，逻辑identical不要求外层观察时间/摘要相同，隔离来源未认证。既有日志合并、冲突处置/解除隔离和运行证据仍缺；仅源码文档人工核对，无schema/依赖变化，未编译/类型检查/测试/运行或发布，独立提交push main带[skip ci]。

- P7：已补生成日志恢复全新目录，原绑定/完整备份核验，preview与原摘要确认二选一；先独占建目录、写隔离标记及完整原备份，再保存全部原request/attempt/outcome，全量两轮读取/全文/文件集合/目录身份核对后才成功。原ID/键/时间/来源/provider/结果/摘要保持，不伪造领取或解除prepared未知；失败保留目录、文件和阶段，不覆盖/自动删除或续写失败目标。当前worker新增请求/模型派发检查恢复标记或源备份，任一存在/不可检查即拒绝，领取前后重查；status/result/原成功重放及原领取结果补存保留，状态/目录新增journal_dispatch。旧worker、手动删除隔离文件和原进程仍须协调；已有日志补缺合并、解除隔离、供应商对账及运行证据仍缺。无schema/依赖变化，仅源码文档人工核对，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P7：已补生成请求日志按原绑定整批备份、离线核验及保留失败副本补存。完整保存request/attempt/outcome，原键/ID/时间/来源/provider/结果/摘要与未知领取保持；最多100请求、整份32 MiB、每轮32 MiB读取、每次10,000目录条目，两轮核对完整内容和规范文件集合，孤立文件/损坏/变化/超限拒绝整份。独占新文件完整读回，失败保留完整备份和阶段；预览/补存不访问原日志，不改变领取或调用模型。两轮观察不是事务快照或重发资格，整套日志恢复、队列联合备份、供应商未知对账、保留/清理和运行证据仍缺。无schema/依赖变化，仅源码文档人工核对，未编译、类型检查、测试、运行或发布；每任务独立提交push main带[skip ci]。

- P7：队列备份已补生成记录离线目录和独立导出，固定完整备份摘要/原任务，默认10最多20条按记录摘要升序；续页位置必须属于同任务，保留原选择，目录只元数据，缺表与空表含义保持。get再按记录摘要返回完整原proposal-generation，保留原来源准备、模型响应/草稿、时间/trace及摘要，可选独占保存既有2 MiB文件并完整读回；关联时间与来源信息留在报告/原备份。每次全量验证未选任务及关联，损坏/错摘要/缺项拒绝，不生成部分成功；导出失败保留完整record与阶段，不打开库/读凭据/调用模型/查询回执/入队或发送。无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布，独立提交push main带[skip ci]；联合日志备份、保留与运行证据仍缺。

- P7：提交队列备份已补离线list/get/receipt-query源码；全部32 MiB/100任务/100生成关联备份完整核验后，按原job_id倒序分页及状态筛选，续页绑定原摘要，单任务选择必须同摘要及原ID。列表只输出元数据，get保留完整原14字段/未知/租约及关联，不改变原状态；原查询导出保留原身份/键/完整规范草稿，复用1 MiB回执查询格式，独占新文件完整读回，保存失败保留查询和阶段。全程不打开队列/读取凭据/联网/恢复或重发，输出文件可接后续显式原网关只读回执入口。无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行CLI/SQL/数据库或发布；独立提交push main带[skip ci]。冲突处置、解除未知、联合备份与运行证据仍缺。

- P5/P7：创建及审核历史已补UTC观察日期起止范围，与建议ID/原键/结果/来源按AND组合；共享严格YYYY-MM-DD日期解析和输入组件，首尾两日均含、单边不限，拒绝不存在日期/非规范值/倒置范围，输入未完整时明确提示并阻止查找。七字段查询及续页保留原日期和扫描摘要，按原observed_at匹配，不改时间/排序；创建5份、审核100份扫描/20条匹配上限保持，未匹配项仍完整核验，空匹配可续查。改日期撤销旧目录和删除资格，保留完整副本；按摘要读取和完整范围备份不受日期限制，无新索引/库版本/schema/依赖。仅源码文档人工审阅，未编译、类型检查、测试、运行或发布，独立提交push main带[skip ci]；时间索引、跨页快照及运行证据仍缺。

- P5/P7：审核历史已补同浏览器完整绑定范围的尽力变更通知，四条写入口覆盖单份保存/移除、所选移除及非空备份恢复，也覆盖自动留存和显式重试；尝试前及结束/失败/未知后通知，不改变原事务结果。创建/审核共用通知工厂，各自独立通道/种类/监听，创建协议保持；只传有界范围/v1种类，不传正文/决定/回执/摘要。审核页面接收通知或返回焦点/可见性/缓存时同步撤销旧目录与单份/批量/备份资格，阻止未重渲染旧动作；在途读取或比较期间代次变化不能重新授予资格，完整候选/备份保留可导出。子面板捕获本次锁释放，不因重渲染中止操作；通知不取消在途写入，最终事务仍全量预检。自动备份/容量清理、跨设备协调和运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P5/P7：创建历史已补同浏览器完整绑定范围的尽力变更通知，单份保存/移除、所选移除、整批恢复及自动留存共用写入封装，尝试前及提交/失败/未知结束后通知；同页同步失效、跨页BroadcastChannel仅传有界范围及v1种类，不传正文/摘要/回执，不自动读写或改变事务结果。收到通知、返回焦点/可见页面及缓存恢复时清空目录和旧单份/批量/备份资格，保留完整候选；同步代次阻止尚未重渲染的旧操作，读取开始代次与完成时不一致则不授予资格，备份快照仍可保留导出。通知失败不影响存储，卸载释放监听/最后通道，不承诺送达或跨页锁，实际写入仍全量预检。自动备份/容量清理、跨设备协调和运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P5/P7：固定原创建页已补默认关闭、仅当前页有效的新结果自动留存；完整核验发送/只读查询响应（含not-observed及与旧确认不同的新观察）后先保留原结果，再独立30秒本地历史保存，保留原时间/trace/请求/响应及4 MiB格式，双槽幂等读回提交。原页面锁维持到保存尝试结束，停止/失败只令本地留存未知并关闭自动开关，不改变已收创建确认；完整失败观察单独保留，未补存成功前禁止重开，后续查询不覆盖它，显式重试仅保存同一观察。父页外部代次同步失效目录/单份删除/所选整理/备份确认，完整候选仍可审阅导出；开启不补旧记录、不持久化偏好、不依赖卸载补存。自动备份/容量清理、跨页协调和运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P5/P7：创建历史已补当前筛选目录页1–5份所选批量整理，可逐选/整页选择，单读事务核对所选完整正文及原目录后逐份验摘要，保留兼容备份格式的子集供逐项审阅/导出恢复；单份4 MiB与文档16 MiB限制保持，超限/缺失/损坏拒绝整批，不扫描整库或依赖100份总量上限。独立摘要确认后单写事务全量预检，精确同文才删除双槽、缺项单列、全部缺失读回并等提交；未知保留导出候选，须重新查目录选择审阅。目录/筛选/选择/存储代次失效旧资格，共享父/单份/备份锁，删除尝试清空旧目录及备份比较确认，不改原请求/当前创建确认/远端。自动留存/容量清理与运行证据仍缺，复用v1无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P5/P7：创建历史已补建议ID、原请求键、历史结果及响应来源精确组合筛选，严格查询模型与携带原条件/最后扫描摘要的续页。保持每轮最多5份完整观察的既有读取上限，未匹配项也核验完整双槽/正文/摘要，损坏拒绝整页；空匹配仍可继续，展示扫描数量与本次末尾，不保证跨页快照。not-observed没有建议ID，改条件/重新扫描撤销目录与单份删除资格，保留已审阅副本，整批备份不受筛选限制。批量清理/自动留存及运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；独立提交push main带[skip ci]。

- P5/P7：创建历史已补当前完整原绑定范围的整批备份/载入/只读比较及确认后原子补缺恢复，独立v1封套最多100份/16 MiB文档，原单份限额保留；单读事务核对双槽计数和全部正文，逐份及外层摘要全部核验，损坏/超限拒绝整份。恢复单写事务全量预检后仅add缺失，同文保留、异文/半槽整批拒绝、全部读回等提交；目标额外项保持，不改原请求/当前提交状态。父页/单份/备份同步互斥，稳定回调和捕获释放，存储代次与文档摘要绑定确认，写入尝试失效旧目录及删除/比较资格，未知保留候选并重新比较。批量清理/自动留存与运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；单独提交push main带[skip ci]。

- P5/P7：创建历史已补独立浏览器v1双槽保存/找回及单份确认移除，按原完整绑定和观察摘要寻址；先核验摘要再事务缺失添加、同文幂等、异文/半槽拒绝、读回提交，原时间/响应不改写。目录每页5份完整正文/目录/摘要核验、按摘要直接读取；文件/实时观察不授予删除资格，须浏览器重读审阅，删除事务精确重查双槽/缺失读回。存储代次及重读失效旧目录/确认，未知保留导出候选，共享父页互斥和30秒期限，缺库只读/删除不初始化；不影响原请求/草稿/审核或远端提交。整批备份/清理、自动留存与运行证据仍缺，无服务端schema/依赖变化；仅源码文档人工审阅，未编译、类型检查、测试、运行或发布，单独提交push main带[skip ci]。

- P5/P7：原创建页已补完整结果内存观察与独立历史文件，发送保留完整封套，查询保留完整原查询/回执，原观察时间和trace不改写；后续not-observed/错误不清除已确认结果。4 MiB观察、SHA-256封套、严格UTF-8/结构/绑定/摘要核验，提供独立历史页、审阅导出及原请求单独导出接既有恢复。导入只进入历史候选，不回填提交状态或发送；文件操作与父页共享互斥，30秒期限和卸载忽略迟到，失败保留候选。浏览器持久历史/备份/自动留存仍缺，无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；单独提交push main带[skip ci]。

- P5/P7：原创建页显式保存、保存后发送及只读回执查询已补30秒整体本地等待与停止等待按钮。保存读回后及派发前检查期限/挂载/当前操作，发送前停止不继续提交；派发后超时或停止仍视为未知，不宣称远端取消，保留原内容/键。迟到结果不覆盖后续消息/回执或解除新操作，操作结束释放本次互斥，保存/发送/查询撤销发送确认；存储未知保留原请求，回执查询不依赖保存成功。仅源码文档与人工审阅，无schema/依赖变化，未编译、类型检查、测试、运行产品/浏览器/数据库或发布；单独提交push main带[skip ci]，运行证据仍缺。

- P5/P7：审核历史已补建议ID、原请求键、结果和响应来源组合筛选，每次只读扫描最多100份完整双槽观察、返回20条匹配；非匹配项同样核验摘要，损坏拒绝整页，不返回部分成功。续页携带原筛选及最后扫描摘要，空结果仍可续查，页面显示本次扫描数与后续范围；切换条件/重读失效旧目录和删除资格，保留审阅副本，整批备份明确不受目录筛选限制。无schema/依赖变化，仅源码文档人工审阅，未编译、类型检查、测试、运行或发布；运行证据仍缺，任务独立提交push main带[skip ci]。

- P5/P7：固定原审核页已补默认关闭的新有效结果自动留存，完整核验并先保留已收发送/只读查询结果（含not-observed）后，在原页面锁释放前独立30秒本地历史保存，复用原128 KiB格式/原时间trace/摘要及双槽幂等读回。开启不采集或补存旧观察、不持久化偏好；保存未知独立于审核结果，自动关闭并保留完整失败观察，未解决前不能重新开启覆盖，显式本地重试保持原内容且不查询/发送。后续观察不丢失失败候选，历史面板可审阅/导出；外部存储代次同步失效单份/批量/备份确认，卸载取消等待、不依赖关闭补存。自动备份/清理、容量保留与运行证据仍缺；无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，单独提交push main带[skip ci]。

- P5/P7：原创建请求已补当前页1–20份副本整理，原目录仍仅摘要，所选需单读事务完整正文/目录/原键及字节数核验；逐份审阅、原备份格式子集导出与独立确认原子移除，复用共享整理机制，1 MiB单份/16 MiB文档限额保留且不扫描全库。删除重验摘要/绑定，全量预检后才删双槽并全部缺失读回，异文/半槽整批拒绝、缺项单列，未知保留文件并重新审阅。目录读取/备份/整理共享全页互斥，恢复/移除失效旧目录和摘要/存储代次确认；旧标签页副本不读不删，恢复仍沿用旧槽冲突检查，不改草稿/审核/回执/远端状态。自动/容量管理和运行证据仍缺；复用v1无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，单独提交push main带[skip ci]。

- P5/P7：原审核请求已补当前页1–20份所选批量整理，单读事务精确目录/完整决定理由版本核验，逐份审阅与原备份格式子集导出；4 MiB文档/32 KiB单份限制保留，不扫描全库。确认原摘要后单写事务全部预检，异文/半槽拒绝整批，缺项单列，精确双槽删除及全部缺失读回后提交。目录重查/选择/存储变化撤销资格，单份/批量移除及恢复失效旧备份确认，未知保留内容并重新审阅。手动草稿共用提取后的副本整理机制、原入口与格式保留；不改草稿/历史或发送、查询、撤回、取消审核。自动/容量清理与运行证据仍缺，复用v1无schema/依赖变化；仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，单独提交push main带[skip ci]。

- P5/P7：创建/审核手动草稿已补当前页最多20份批量整理，单读事务完整摘要/正文核验、逐份审阅与原备份格式子集导出；不依赖全库100份限制，创建16 MiB/审核4 MiB预算保留。确认摘要后单写事务全量预检，异文/半槽拒绝整批、缺项单列，精确双槽删除并全部缺失读回后提交。选择/目录重查及失败/存储变化撤销资格，未知保留文件并重新审阅；共用编辑锁暂停自动写者，手动保存/恢复/移除失效旧备份和单份确认。未改当前字段、自动副本或远端状态，自动清理/容量保留及运行证据仍缺；复用v1无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，单独提交push main带[skip ci]。

- P5/P7：创建/审核自动草稿已补当前页最多20份所选批量整理，支持逐选/整页、同读事务完整摘要及正文核对、逐份审阅与可恢复子集导出。所选文档保留原会话/完整草稿/时间，兼容原备份格式且明确非完整范围；不依赖全库100份上限，创建16 MiB/审核4 MiB预算仍生效。确认摘要后同写事务全量预检，异文/半槽拒绝整批、缺项单列，仅同文双槽删除并全部读回后提交；目录/选择/存储变化和失败重读撤销资格，未知保留文件并重新选择审阅，当前写者暂停、备份旧确认失效。不动编辑器/手动库/原请求/远端，自动/容量清理与运行证据仍缺；复用v1无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，独立提交push main带[skip ci]。

- P5/P7：创建/审核自动草稿已补独立完整范围备份、逐项完整审阅、文件加载与摘要核验、只读比较和明确确认后原子缺失补入。保留每份原会话UUID/完整草稿/时间，允许同请求键跨会话，最多100会话、创建16 MiB/审核4 MiB；同读事务核对双槽计数与全部正文，损坏/超限不截断。写事务全量预检，同文保留、异文/半槽拒绝整批，缺项add且全部读回后提交；操作暂停当前写者、恢复/移除撤销旧目录和确认，未知保留备份需重新比较。手动库范围不变，其他页可继续其原会话，不接管写者或准备/发送。批量/自动清理、保留策略、定时/跨范围备份及运行证据仍缺；复用v1无迁移/schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品/浏览器/数据库或发布，独立提交push main带[skip ci]。

- P5/P7：未准备审核草稿已补显式开启的1.5秒延迟自动保存，独立会话更新完整32 KiB原决定/理由/绑定/建议/版本/键；提取创建端双槽精确比较和串行保存为共享机制，创建布局/格式/入口保留。旧确认不标记新输入已保存，手动操作暂停、未知停写、重开新会话；审核表单及独立恢复页可20条分页查找、完整审阅/单份导出和精确确认移除，恢复沿用同建议/版本及同键原审核检查，不准备或发送审核。手动备份明确不含自动副本；自动副本整批备份/清理、容量保留及运行证据仍缺。新增独立浏览器v1结构仅源码，无服务端schema/依赖变化，不编译、类型检查、测试、运行产品/浏览器/数据库或发布；独立提交并push main带[skip ci]。

- P5/P7：建议创建编辑器已补可选择开启的1.5秒延迟自动保存，每次开启独立会话只更新最新副本，完整原绑定/键/不完整字段保留，双槽事务精确比较上次确认副本后更新并读回。输入不锁定，旧保存确认不覆盖新字段状态；手动操作暂停，失败/取消结果未知停写，重开新会话。独立20条目录、完整审阅/逐份导出、沿用同键原请求检查的确认恢复及精确确认移除已接入；手动不可变快照及整批备份不含自动副本。自动副本整批备份、批量清理/容量保留、审核草稿自动保存及运行证据仍缺。新增独立浏览器v1结构仅源码，无服务端schema/依赖变化，不编译、类型检查、测试、运行产品/浏览器/数据库或发布；独立提交并push main带[skip ci]。

- P7：已补queue-backup-merge已有队列严格补缺合并，原生只读完整预览，计划摘要绑定原备份/全部目标逻辑状态/固定策略；正式BEGIN IMMEDIATE重读、全量预检及确认后才插缺失任务/关联，完整读回后提交。已有任务须与原行或共享隔离行全14列相同，原键占用/关联原文或时间差异整批拒绝；不更新已有任务/租约，新增未知任务暂停，可选表按需建，目标独有项保留，总量100任务/100关联/32 MiB。旧确认失效、冲突无可执行摘要，未知事务/关闭保留计划和mutation并需重读；冲突处置/解除未知/旧发送器协调和运行证据仍缺，仅源码文档人工审阅，不编译/类型检查/测试/执行CLI/SQL/数据库/发布，沿用v1无迁移/依赖，独立提交push main带[skip ci]。

- P7：已补queue-backup-restore完整备份恢复至新队列，preview与原摘要确认互斥，绑定/摘要/转换状态及新目标全量预检。原submitted保留，其他任务blocked/uncertain=1并解除旧租约，保留ID/键/原文/摘要/计数/时间和全部生成关联，当前retry后只查回执不重发。独占临时目录/空库、共享v1建表事务导入、关闭后原生只读完整比较，再同步/独占保存/文件摘要读回；目标或日志存在拒绝，失败保留源备份和本次阶段/路径/未知状态，无自动覆盖或续写。现有队列合并、显式解除未知、旧版本发送器协调及运行证据仍缺，仅源码文档人工审阅，不编译/类型检查/测试/执行CLI/SQL/数据库/发布，无新schema/迁移/依赖，独立提交push main带[skip ci]。

- P7：已补queue-backup-compare备份与已有队列只读比较，打开前核对完整备份/原绑定，目标完整只读快照与关闭后输出差异；双方各100任务/100关联/32 MiB，超限/损坏拒绝整份。编号/请求键双向占用核对，区分一致/缺失/状态变化/原请求冲突及目标独有项；全部生成关联和可选表存在状态比较，原时间仅作观察，原文/回执/租约令牌不输出。纯快照比较接口重新核验双方，无导入/恢复/重发/远端查询；队列恢复和运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/执行CLI/数据库/发布，独立提交push main带[skip ci]。

- P7：已补queue-backup-recover完整快照补存，接受原备份及导出/补存失败JSON，32 MiB+128 KiB输入与64 KiB错误元数据限制；原内外摘要/字段/状态/关联全量核验，严格核对关闭及保存阶段，保持原时间/正文/租约/未知/摘要。preview仅核验输入和新路径，正式独占保存并读回，失败保留同一backup可再次补存；不访问错误中的旧路径、不打开队列/查询/恢复/重发。队列目标比较/导入/恢复和运行证据仍缺，无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/执行CLI/数据库/发布，独立提交push main带[skip ci]。

- P7：提交队列已补queue-backup原生只读完整快照和inspect-queue-backup离线核验；保留原绑定、全部14列任务状态/正文/回执/未知/租约及生成关联原文/时间，已知结构严格核对，100任务/100关联/32 MiB上限，计数和大小预检后完整读取，损坏/超限不截断。内外摘要、父任务草稿/身份、唯一键和排序完整校验；关闭队列后独占保存新文件，关闭/保存失败保留已构造快照。不恢复、不重发、不改租约，独立生成日志和浏览器库不在范围。尚缺备份导入/目标比较/队列恢复、自动备份/保留和跨范围联合归档；无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行CLI/SQL/数据库/发布，独立提交push main带[skip ci]。

- P5/P7：审核历史已补当前目录页所选批量审阅和确认移除，最多20份、可选择整页，不受整库100份备份上限限制；所选目录/正文同读事务完整核对，事务后逐份验摘要，缺项或损坏不跳过。所选子集可导出兼容历史备份文件恢复，不标为完整范围。删除前重验外层/内层摘要与确认摘要，同写事务全量预检、完整同文才删除、已缺失单独计数、冲突拒绝整批，读回并等待提交。选择/翻页/失败重读/存储改变撤销资格，未知保留导出副本并须重新选择审阅；共享单份/备份/原审核互斥，失效目录和旧确认，不改审核结果或其他库。仍缺自动清理/保留、自动保存/备份、跨范围同步和服务器归档，无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核历史已补逐份完整审阅与独立确认移除，仅新读取并核验摘要的浏览器候选可删；文件/实时结果、失败重读及存储改变撤销旧资格。删除前重验完整文档和摘要，同事务精确核对正文/目录后删除双槽并读回，缺库不初始化、缺项仅报告未见、异文/半槽/损坏拒绝。未知保留可导出候选并重新读取审阅后才可再删；失效目录/备份比较/确认，与原审核共享互斥，不改变已收结果、原请求、草稿、文件或服务端。仍缺历史批量/自动清理、容量保留、自动保存/备份、跨范围同步及服务器归档；无schema/依赖变化，只源码文档人工审阅，不编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核历史已补当前完整原绑定范围的整批备份与恢复，独立100份/16 MiB格式保留每份完整观察及摘要，外层SHA-256与内层逐份核验；单读事务双槽计数/完整快照，超限或损坏拒绝整批。文件载入和比较只读，明确确认后同写事务全量预检、缺失补入及完整读回，同摘要异文/半槽/损坏阻止整批恢复；未知保留备份并要求重新比较。与单份历史及原审核共用互斥，保存/恢复尝试撤销旧目录/比较/确认，不查询或发送审核。仍缺自动保存/备份、历史清理/容量保留、跨范围同步和服务器归档；无schema/依赖变化，只源码文档人工审阅，不编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核历史观察已补完整原请求+发送/只读查询封套+原观察时间的独立128 KiB格式、规范SHA-256、显式浏览器双槽保存、20条完整核验目录、按摘要读取和文件导入导出；不同trace/时间保留不同记录，同文重复保存幂等，损坏冲突不覆盖。最新已确认观察在后续not-observed/失败后仍可留存，历史导入只作参考不发送/重试或改变当前状态；与原审核共享互斥，失败保留完整候选。新增浏览器库仅源码，无服务端schema/依赖变化；仍缺历史自动保存/整批备份清理/容量保留/跨范围同步和服务器归档，仅开发文档人工审阅，未编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核编辑草稿已补逐份完整浏览器审阅、导出及独立确认移除；仅新读取浏览器候选可删，单份文件/失败重读/存储改变撤销资格。单事务精确核对原文/保存时间/绑定和目录后删除并读回，缺库不初始化，半槽/损坏/异文拒绝；未知保留候选，需重读审阅后再确认。共享互斥，删除失效目录/备份比较和旧确认，不改当前字段、原审核或服务器状态。仍缺批量/自动清理与容量保留、自动保存/备份、跨范围同步及持久回执历史；无schema/依赖变化，仅源码文档人工审阅，未编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核编辑草稿已补当前完整原绑定范围的整批备份、规范SHA-256、有界载入与只读比较；100份/4 MiB独立v1，完整双槽计数与逐份核验，不截断。确认后单事务全量预检/缺失才补/完整读回，保存时间或原文冲突和损坏拒绝整批；保存及恢复尝试失效目录/比较/确认，未知保留候选和备份并重新比较，共享页面互斥，不修改当前字段、不准备/发送/查询审核。仍缺草稿清理、自动保存/备份、容量保留、跨范围同步和持久回执历史，无schema/依赖变化；仅源码文档人工审阅，未编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：未准备审核草稿已补独立32 KiB格式和浏览器双槽保存、20条完整校验目录、有界文件导入导出及独立找回页。空决定和未完成原始理由可保存；确认恢复前核对同建议/版本及同键原审核，同文打开固定原请求、异文拒绝，准备时再次检查。草稿与审核操作共用互斥，编辑换键撤销确认，草稿区置于审核form外避免回车误准备，不发送或查询审核。缺自动保存/整批备份/清理/保留和持久回执历史；新增浏览器结构仅源码，无服务端schema/依赖变化；仅开发文档人工审阅，未编译/类型检查/测试/运行/发布，独立提交push main带[skip ci]。

- P5/P7：审核原请求已补逐份浏览器副本审阅/导出/独立确认移除；目录或按键重新完整读取才可确认，原绑定/理由/决定/版本/键及目录单事务精确重查、删除并读回，两槽缺失仅报告当前不存在。导入/移除尝试撤销旧移除资格并失效目录，结果未知保留候选且重新读取审阅后才可再删；全页共享互斥，不撤回/取消/发送审核，不读回执或改变其他副本。批量/自动清理和保留策略、未准备审核草稿/历史回执仍缺，无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品浏览器接口数据库或发布，独立提交push main带[skip ci]。

- P5/P7：审核原请求已补当前原网关/完整身份范围的整批备份、规范SHA-256、有界文件加载、只读比较及确认后原子补入。独立v1最多100份/4 MiB文档，同读事务核验正文/目录全部计数和内容，不截断；恢复单事务重查全部目标、同文保留/缺失才补/异文损坏整批拒绝，完整读回后等待提交。恢复页共享互斥与摘要确认，导入开始失效旧目录，未知保留备份并重新比较，不发送或查询审核。未准备审核草稿、清理/跨范围联合备份/自动同步和持久回执历史仍缺；无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行浏览器接口数据库/发布，独立提交push main带[skip ci]。

- P4/P7：CLI proposals review-receipt与MCP get_proposal_review_receipt已接入原审核只读查询，严格原六字段query、原human/review权限、完整历史封套与原身份校验。CLI文件/内联32 KiB，网络与嵌入一致，拒绝标准输入/重复/写参数；MCP发现/调用门禁、两路容量/30秒本地期限，超时保留名额到底层结束，成功64 KiB/错误16 KiB且不扩张普通HTTP限额。查询完成不等于审核成功，not-observed不触发重发，不保存或删除原文件。审核草稿、整批备份/清理、持久回执历史仍缺，无schema/依赖变化，仅源码人工审阅，不编译/类型检查/测试/执行CLI/MCP/数据库或发布，独立提交push main带[skip ci]。

- P5/P7：原审核回执只读查询已接入contracts/Gateway/SDK/Mock/Web，完整核对原身份/键/决定/理由/版本。真实网关在一致只读快照检查当前可见性、命令指纹、审核字段和ApprovalCompleted事件，要求未过期human及review权限；not-observed不证明失败，不重发。Web查询不依赖保存，完整recorded后显示历史并收起发送入口；SDK有界读取与等待，Mock仅核对模拟内存记录。CLI/MCP审核适配、审核整批备份/清理、未准备草稿及持久回执历史仍缺。无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/执行产品接口数据库/发布，独立提交push main带[skip ci]。

- P5/P7：Web审核已补页面可信身份绑定、完整原请求准备/冻结、浏览器双槽不可变保存/20条目录、文件导出及独立recover-review恢复入口。载入不写不发，每次发送重新保存读回确认，按原网关/身份/建议/版本/决定/理由/键重试，服务端/客户端完整回执校验；错误不解锁换键，实际human/review权限沿用Gateway强制检查。32 KiB原文、64 KiB回执及本地期限，客户端超时不取消服务端，旧页面无副本不可重建。未准备审核草稿、审核只读回执、原审核整批备份/清理、历史回执和跨端证据仍缺。独立浏览器v1仅源码，无Gateway/服务端schema/依赖变化，仅人工审阅，不编译/类型检查/测试/执行产品或数据库/发布，独立提交push main带[skip ci]。

- P5/P7：编辑草稿已补当前原网关/完整身份范围的完整备份、规范摘要、文件加载、只读比较与确认后原子恢复。最多100份/16 MiB文档，同读事务核对双槽计数和全部正文，不截断；恢复前重验原摘要，整批预检后仅补双槽缺失，包含saved_at的同文保留、异文/损坏拒绝，所有目标完整读回后提交。未知结果保留原备份，须重新比较确认；当前编辑器/原请求/服务器不改动，历史敏感本地副本属于备份范围。跨范围联合备份、自动保存/清理及运行证据仍缺。无schema/依赖变化，仅源码文档人工审阅，不编译/类型检查/测试/运行产品或数据库/发布，独立提交push main带[skip ci]。

- P5/P7：编辑草稿已补逐份浏览器移除：完整载入后可审阅全部字段/导出所选副本，再独立确认删除；写事务精确比较原绑定/正文/时间/目录，删除双槽并读回，缺库不初始化，缺项不声称历史删除成功，损坏/异文拒绝。尝试撤销确认并清空目录，未知结果保留可导出候选，需重新查询选择才能再移除；文件候选不直接删除，不改当前编辑器、已准备请求或远端建议。批量清理/容量保留、完整备份及运行证据仍缺，无schema/依赖变化；仅源码文档人工审阅，不编译/类型检查/测试/运行产品或数据库/发布，独立提交push main带[skip ci]。

- P5/P7：建议编辑器已补独立未准备草稿格式、浏览器不可变双槽保存/20条目录/完整所选读取、文件导入导出和确认替换。保留不完整字符串/来源/派生引用及原身份/键，编辑换随机键并撤销确认；保存同内容保留首次时间，同键异文拒绝。恢复先查同键原请求，存在则核对草稿并转原恢复、不自动保存或发送。页面可信绑定和准备时复查防止编辑期间身份切换；本地缺副本不证明未提交。独立浏览器v1结构仅源码，无Gateway/服务端schema/依赖变化，后台自动保存/清理/整库编辑草稿备份和运行证据仍缺。只源码文档人工审阅，不编译/类型检查/测试/运行页面/接口/数据库或发布，独立提交push main带[skip ci]。

- P7：新增receipt-record-recover --file --output [--preview]，从完整原记录或含record且重复result/trace一致的导出错误离线补存新文件。完整字段/身份/状态/摘要及失败元数据核验，保留原封装时间、摘要、query和结算状态；预览不写，正式独占保存不覆盖，不访问旧错误路径。缺record/未知事务或矛盾输入不重建，再次保存失败保留同一完整记录；不联网/开库/结算，未增加自动索引/失败归档/队列导入。仅源码文档人工审阅，无schema/依赖，不编译/类型检查/测试/执行产品或数据库/发布，独立提交push main带[skip ci]。

- P7：receipt/reconcile 已补 --output 显式完整回执记录，操作返回且队列关闭后独占保存新文件，原绑定/任务/行摘要/query/回执/本地状态与封装时间受规范SHA-256绑定。inspect-receipt-record离线有界普通文件读取，严格字段/身份/trace/结果组合/摘要核验，只显示元数据，不开库联网或结算。保存失败保留完整result/已构造record和阶段，已确认mutation不改称回滚；4 MiB记录、原query/回执预算保持，自动历史索引/备份/导入/签名仍缺。无schema/依赖，仅源码文档人工审阅，未编译/类型检查/测试/运行产品或数据库/发布；独立提交push main带[skip ci]。

- P4/P7：建议 Mock 已补 getProposalCreateReceipt，只读POST按完整原身份/键/规范草稿核对原命令、当前可见建议及不可变字段；缺记录返回not-observed，同键异文/审核命令冲突拒绝。原账号创建能力、会话期限、项目/来源/派生链可见性继续检查，已审核/过期/来源变旧不改变原创建回执。共享输入/响应校验、有界返回与无写条件，查询不改变建议/命令/游标；不模拟真实同步历史、审计、网络未知结果或持久化。P7-01继续保留其他缺口；仅源码文档人工审阅，不编译/类型检查/测试/执行Mock或产品/数据库/发布，无依赖/schema变化，独立提交push main带[skip ci]。

- P7：flush 已补未知结果门禁：uncertain 和回收 sending 只查原创建回执，recorded 凭本次领取结算，not-observed 保留未知并退避查询，不回退创建。正常提交增加16 KiB预检/64 KiB创建响应及完整20秒请求期限，发送前复查原领取；领取前完整核验已知行，结算匹配原键/正文/摘要/attempts/租约。报告区分创建调用、回执查询及未派发。旧版本进程协调、显式解除未知、队列备份/持久回执历史及运行证据仍缺，P7-01不勾选。无新schema/依赖，仅源码文档与人工审阅，不编译、类型检查、测试、执行产品或数据库、发布；独立提交push main带[skip ci]。

- P7：worker 新增 receipt/reconcile，按已有队列完整原绑定/任务只读查询创建回执，完整校验已知14列/草稿摘要并固定快照；recorded 后显式结算前重新比较完整行，sending（含过期）和并发变化不接管，not-observed 不写入。仅非发送且原行一致时保存既有最小历史回执，全部已知列读回后提交；已submitted须与远端回执一致。未知事务/关闭失败保留完整原请求和远端观察，CLI区分查询完成与本地结算。existing模式不初始化布局，无新schema/依赖，旧flush保持；旧发送者协调/自动重试门禁、队列备份/持久对账历史及运行证据仍缺。仅源码文档与人工审阅，不编译、类型检查、测试、执行CLI/接口/数据库或发布，独立提交push main带[skip ci]。

- P4/P7：新增 proposals receipt 网络/嵌入 CLI 和 get_proposal_create_receipt MCP。CLI 严格原请求 JSON/稳定普通文件、1 MiB 限制、拒绝标准输入/重复/写选项；复用 SDK 原身份、完整回执与本地等待预算。MCP 发现/调用校验有效 writer/admin，完整成功2 MiB/错误16 KiB、两路准备容量/30秒期限，超时名额保留到底层结束；HTTP 原回执扩容绑定最终工具名。无自动创建/重试/保存/审核，不把 not-observed 或退出0当作原创建成功。Mock/worker 对账、持久回执历史及运行证据仍缺；无 schema/依赖变化，仅源码文档与人工审阅，不编译、类型检查、测试、运行产品/数据库或发布，独立提交 push main 带 [skip ci]。

- P5/P7：新增原创建回执只读查询，完整绑定原身份/键/规范草稿；同一只读快照核验原指纹、当前可见建议的不可变内容及创建事件。recorded 仅确认历史创建，not-observed 不证明失败；身份/可见性/损坏错误均保留原请求。SDK 有界查询与 Web 恢复按钮共用完整封套校验，网页保存失败仍可查询，不重提或改键；CLI/MCP/Mock 专用适配、历史回执持久备份和审核恢复仍缺。复用现有存储，无迁移/依赖变化；仅源码文档及人工审阅，未编译、类型检查、测试、运行产品/接口/数据库或发布，P7-01 未完成，独立提交 push main 带 [skip ci]。

- P5/P7：新增当前原网关/完整身份范围的浏览器原请求整批备份、摘要核验、只读目标比较和确认后原子补入。最多100条/16 MiB文档，单读事务核对双槽计数及全部原文/摘要，不截断；规范SHA-256覆盖全部内容与身份。导入重新核验文件和目标/旧槽，缺失才补、同文保留、异文/损坏整批拒绝，所有写入读回并确认事务完成；未知结果保留备份，比较后显式重试。载入/预览不写入，导入不发送。仅源码文档和人工审阅，无服务端协议/schema/依赖变化，不编译、类型检查、测试、运行产品/浏览器/接口/数据库或发布；跨范围整库备份/清理、未准备草稿、审核恢复和运行证据仍缺，P7-01 未完成，独立提交 push main 带 [skip ci]。

- P5/P7：建议原请求增加独立浏览器持久副本与按原网关/完整身份限定的20条摘要分页目录；原文/摘要同事务比较、只补缺失、完整读回并确认提交，异文/损坏不覆盖。每次发送前再核对已保存完整原文及旧标签页精确槽，取消/失败不派发；载入不迁移或发送，选中后核验完整原文与所选摘要，旧副本/文件入口保留。浏览器清理/隐私模式/跨设备仍需独立导出，未准备草稿、跨范围全库备份/清理、只读创建回执及审核恢复仍缺（范围备份见上）。复用既有浏览器事务工具，无 Gateway/服务端 schema/依赖变化；仅源码文档与人工审阅，不编译、类型检查、测试、运行页面/接口/数据库或发布。P7-01 未完成，独立提交 push main 带 [skip ci]。

- P5/P7：建议创建改为先读可信 submission-context 并准备完整原提交，再审阅并明确发送；原网关/项目/actor/client/键/规范草稿固定。同标签页精确槽写前比较/写后读回，失败阻止发送；可导出完整文件，独立 proposals/recover 通过原键或有界文件/文本载入，载入不发送。每次重试核对原身份/网关并带预期身份头，完整封套/回执核验后才显示成功；未知及后续错误均不解锁换键。未准备草稿、审核请求和跨标签页自动持久化仍缺（后续浏览器副本增量见上）；无新 Gateway 协议/schema/依赖，仅源码文档与人工审阅，未编译、类型检查、测试、运行浏览器/接口/数据库或发布。P7-01 未完成，独立提交 push main 带 [skip ci]。

- P7：新增 generation-requests 只读目录，按原绑定发现请求键及状态，支持状态筛选和绑定目录/身份/条件的续页游标。按键摘要排序、完整核验所扫描请求和同绑定结果，正文不输出；10,000 目录项、64 候选、32 MiB 读取预算与 1–20 返回条数限制，预算停止保留续页位置，空页可继续。抽出共享只读状态模块，原按键查询/运行/恢复继续复用；不新增索引、数据库或依赖。仅源码文档与人工审阅，未编译、类型检查、测试、执行 CLI/模型/服务、打开库或发布。完整备份/审计、未知调用对账和运行证据仍缺，P7-01 不勾选；独立提交 push main 带 [skip ci]。

- P7：新增 generation-recover 及只读 --preview，从有界完整保存失败封套或 recovery 对象补存已保留的生成/失败结果。完整核验原请求和实际领取，目标前置文件必须存在且完全相同；缺失 outcome 独占发布，相同保留、异文冲突，无覆盖/重派发。封套重建保留原生成时间，结果新封装时间明确区分；写入未知重新读取并保留规范恢复内容。无依赖/schema变化，仅源码文档与人工审阅，未编译、类型检查、测试、执行 CLI/模型/网关、打开库或发布。供应商未知调用对账、整套缺失日志恢复/备份和运行证据仍缺，P7-01 未完成；独立提交 push main 带 [skip ci]。

- P7：新增不可变 v1 生成请求日志及 generation-request/run/status/result。原键、绑定、完整准备记录与无凭据 provider 在调用前保存，独占 attempt 发布并完整读回后才允许单次生成；所有已有领取均不再次派发，成功结果直接读取，失败只保存筛选后的错误。支持状态查询和完整记录新文件导出，封装/保存失败保留已生成内容；排重依赖原标记保留，不保证断电目录持久性或供应商恰好执行一次。无数据库/schema/依赖变化，仅源码文档与人工源码审阅，未编译、类型检查、测试、执行 CLI/模型/网关、打开库或发布。供应商未知调用对账、恢复导入/备份、全局审计和真实运行证据仍缺，P7-01 不勾选；独立提交 push main 带 [skip ci]。

- P5/P2：项目搜索新增共享导航参数解析与详情返回，保留关键词、类型、匹配模式、失效条目选项、游标及精确所选类型/ID。工作项详情与 Context 条目在读取前校验固定内部返回路径，刷新/失败重试保持原目标；搜索失败保留筛选表单、原页重试和筛选首页入口，已不在当前页的选择明确提示，不改选其他结果。无 API/schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行浏览器/服务、调用接口、打开库或发布；真实导航、权限变化及恢复证据仍缺，独立提交 push main 带 [skip ci]。

- P7：新增 enqueueGenerated 与可选 proposal_generation_records v1，草稿任务/完整生成记录同事务保存并读回，原键同文重放保留首次关联时间，一个任务可保留多份生成记录。generation-list/get 原生只读分页及新文件导出，缺扩展不建表，逐条核验原绑定/草稿/记录摘要，损坏拒绝且有单条/整页字节上限。未知提交保留原键/摘要/候选任务，导出失败保留完整记录；对象键顺序不改变记录重放。新增本地表仅初始化源码，无依赖/Gateway 变化；未编译、类型检查、测试、执行 CLI/模型/网关、打开库、运行 SQL/迁移或发布。持久生成请求/未知模型调用恢复、保留/备份及全局审计和运行证据仍缺，P7-01 未完成；独立提交 push main 带 [skip ci]。

- P7：新增 preparation/generation v1 完整记录及规范 SHA-256，保存原绑定、选择、来源观察、输入、无凭据模型配置和完整结果。prepare-generation --record、generate-prepared、inspect-generation、enqueue-generated 接入完整核验；打开队列前比较原网关/项目/actor/client，保存失败保留已完成结果。2 MiB 有界新文件输出，旧普通草稿流程兼容。摘要不认证来源/模型执行/当前权限，队列尚无记录关联列，持久生成任务/未知调用恢复/审计与运行证据仍缺，P7-01 保持未完成。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行 CLI、调用模型/网关、打开库或发布；独立提交 push main 带 [skip ci]。

- P7：新增 prepareProposalGeneration/prepare-generation，从原 gateway/project/actor/client 绑定读取明确选择的 ContextItem ID/revision。先核对身份协议，再以同一令牌/预期身份头逐条读取，检查范围/trace/版本/ETag/来源封套和当前有效性；完整摘录保留观察状态，分类只升不降，超限/冲突/失败不保存部分输入。全程期限/取消、有界读取，独占输出直接兼容 generate，完整身份/观察保留命令结果。无 Gateway/schema/依赖变化，仅源码文档，未调用网关/模型、执行CLI、编译、类型检查、测试或发布；后台发现/版本刷新、目的地绑定、持久生成任务/审计及运行证据仍缺。独立提交push main带[skip ci]。

- P7：新增 generateProposalDraft/独立 generate CLI，明确配置 Chat Completions 兼容端点/模型/分类上限，从固定摘录单次生成；仅接收完整标题正文 JSON，来源/类型/分类/期限固定，记录响应模型及提示版本。凭据隔离、统一期限/取消、有界响应、不重定向或自动重试；输出新草稿经完整读回，保存失败保留生成结果供恢复。生成不打开队列或自动提交/审核。无依赖/schema变化，仅源码文档，未调用模型、执行CLI、编译、类型检查、测试或发布。自动来源摄取/权限、持久生成任务/审计、供应商兼容/质量证据仍缺；独立提交push main带[skip ci]。

- P0-02：新增 MockProposalStore/Session/Source 与六个建议路由，支持创建/目录/详情/人工版本审核及身份读取；固定项目和会话能力，来源变化由显式配置模拟，可见性先于分页、分类不降低、派生链最多32层。按原 actor/client 保存规范命令及历史回执，同键同文重放、异文拒绝；有界内存/响应且失败不写入。其余公开 Mock 路由、真实来源图/Policy/持久化/未知网络结果和运行证据仍缺，P0-02 不勾选。无依赖/schema 变化，只开发源码文档，未编译、类型检查、测试、执行 Mock/API 或发布；独立提交 push main 带 [skip ci]。

- P7：建议提交队列增加原生只读打开选项，CLI list/get 要求已有队列，在读事务检查 v1 表/列、唯一有界绑定及原网关/项目/身份；缺库不创建、不补结构、不回退可写。所有写入入口拒绝只读实例，flush 在取令牌前停止；默认可写提交/重试保留。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行 worker/CLI、打开库或发布；全队列审计、模型生成、保留清理及运行证据仍缺。按任务提交 push main 带 [skip ci]。

- P5：工作项详情新增完整浏览返回路径，共用导航解析/链接构造保存原筛选、分页、视图和所选 ID；返回结果/切换视图、刷新及读取失败后的显式重试保持条件，旧直接详情链接兼容。return_to 仅允许已知内部工作项目录参数，拒绝外部/其他路径、片段、重复字段和选中项不一致；不存储快照或修改鉴权。无 API/schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行浏览器/服务、调用接口、打开库或发布；导航边界与真实浏览证据待补，按任务提交 push main 带 [skip ci]。

- P4/P5：工作项目录新增 priority=P0..P3 与 owner 精确保存文本筛选，契约/数据库/MCP/CLI 帮助/网页同步接入，SDK 与网络 CLI/Web 复用共享输入及整页结果匹配。owner 区分大小写/空格、不推断账号；参数化 C 相等过滤在分页前生效。新增字段纳入扩展查询摘要，无新筛选时保持旧 v1 游标；网页分页/视图/选择保留筛选，提交与清空回首页。无写入、依赖或 schema/迁移变化，仅源码文档，未编译、类型检查、测试、执行产品/API/CLI/MCP/浏览器、打开库或发布。真实性能/边界/客户端兼容与 UI 运行证据仍缺，按任务提交 push main 带 [skip ci]。

- P0-02：新增 MockSyncStore 与固定模拟会话，MockWcpServer 可配置同步身份、changes、cursor、ack 四个路由。完整有界事件流、显式可见集合先过滤后分页，末页保留高水位；缺省读取原消费者确认，确认按五字段身份隔离、允许重复、拒绝回退/超前。复用完整共享契约、独立副本、trace/来源及响应大小/取消检查；身份来自开发配置，不从预期身份头授权。原项目 Mock 保持，上传/冲突/其他公开路由与真实 Policy/持久化/网络未知结果仍未覆盖，P0-02 不勾选。无依赖/schema/Gateway 变化，仅源码文档，未编译、类型检查、测试、执行 Mock/产品、打开库、生成样本或发布；按任务提交 push main 带 [skip ci]。

- P3/P4：新增共享parseClientEventSyncChange和client-event-history/1固定适配器，保存ClientEventRecorded完整content/来源及原账号、客户端、事件ID；核对规范封套、身份/来源尾项绑定，字段建议保留扩展content并验证字段/base/observed版本。投影按原身份三元组排序去重，最多512条/1 MiB，拒绝重复ID/cursor、回退和未知外层类型；接入现有apply/preview/pending/replay与通用历史归档。明确接收不等于源字段生效，不重建缺失原client_cursor/批次键/分类、不结算队列。无schema/依赖/Gateway格式变化，仅源码文档，未编译、类型检查、测试、执行reducer/产品、打开库、生成样本或发布；源实体完整同步、其他业务适配/容量管理及运行证据仍缺，按任务提交push main带[skip ci]。

- P3/P4：新增联合重新排队备份import/import-preview，scope/backup_sha256严格绑定完整源；同事务比较全部父历史/批次，只补缺失、同文保留、异文/跨项目冲突拒绝。与单批次共用目标比较器，每轮共用父只读一次，目标64 MiB/轮、总256 MiB；写父前复查、父写后核对整批计划、逐批写前复查、最终全部父历史和批次关联读回，空备份不建表。保留source-only缺父修复、源摘要/候选结果及未知提交/回滚/关闭状态，原ID继续历史幂等，不恢复事件或发送。CLI源完整验证后打开已有库，预览原生只读；90秒/128 KiB，备份摘要提供import_query。无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行产品、打开库、初始化表、生成样本或发布。跨项目备份/保留管理/来源证明与运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增重新排队联合备份离线history/get/export，整份核验后按原backup_sha256绑定分页和批次选择；默认10最多20，续页固定摘要与ID。get找回完整原请求/回执并可保存纯原请求，export复用独立回执格式保存选中批次及父历史，保留备份观察时间/trace，返回独立摘要和import_query衔接已有单批次导入。缺项不创建输出，独占发布及最终完整读回，128 KiB封套保留已知文件状态。无数据库/配置/网络依赖，无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行产品、打开库、生成样本或发布。联合备份原子导入/预览、保留管理和运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增readRestoreRequeueBackup及restore-requeue-backup/inspect-restore-requeue-backup，单读快照保存项目全部批次和按restore_id去重的完整父历史；离线重核固定v1映射、全部摘要和引用闭包。最多100批/100父项、64 MiB文档，读取预算默认64最多512 MiB且共享父每批计费；超限整份拒绝。独占保存并最终逐字节/摘要/历史读回，保留失败定位/收集进度、文件发布清理与关闭状态。无数据库结构或依赖版本变化，仅源码文档，未编译、类型检查、测试、运行产品、打开库、生成样本或发布。联合备份导入/预览、离线分页提取、保留管理和运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增previewRestoreRequeueFileImport/importRestoreRequeueFile及restore-requeue-import-preview/import，严格scope/document_sha256/requeue_id绑定完整文件；同事务预检父恢复ID/批次ID全局占用及完整内容，缺失补入、相同保留、异文/跨项目拒绝。支持批次元数据相同而父历史缺失时凭已核验源补回；实际父写后重查批次、所有写后完整读回，保留候选/源回执及未知提交/回滚状态。只恢复历史，当前事件/控制不读写，原ID继续历史幂等；重复不证明此前提交。CLI源完整验证后打开已有库，预览原生只读；90秒/128 KiB，文件摘要新增import_query。复用既有表，无schema/依赖版本变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库或初始化表。全项目联合备份/导入、保留管理和运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增单批次重新排队独立回执文件，含原七字段查询/完整回执及父恢复回执/原事件档案。Bridge同一只读事务导出，离线子路径重建固定v1恢复和重新排队映射并核对全部摘要/字段；CLI restore-requeue-export关闭尝试后独占新文件并最终逐字节/SHA/历史核验，inspect-restore-requeue-receipt离线读取，restore-requeue-file-get绑定document_sha256/requeue_id找回原请求/回执并可显式保存原请求。缺项不创建文件，保留历史、原选择、文件发布/清理和关闭状态，响应超限保留已保存local；stdout不包含父档案正文。无数据库schema/依赖版本变化，仅源码文档，未编译、类型检查、测试、运行产品命令、打开库、生成样本或发布。全部批次联合备份/跨设备导入及运行证据仍缺；按任务提交推送main，带[skip ci]。

### 2026-11-03 开发补充（未编译、未发布、未测试）

- P3/P4：新增auditRestoreRequeueReceipts/restore-requeue-audit及目录audit_query，单项目单读事务完整核验全部持久批次原请求、父恢复档案/回执与事件变更前后摘要。先有界计数，再逐项预检查询与父档案长度，默认100批/64 MiB/30秒，最多1000批/512 MiB/90秒；共享父历史按批次出现计费，拒绝重复ID/缺父历史/损坏，不返回部分通过。保留失败阶段、批次/恢复ID、已核验计数和预算/关闭状态，不读写当前事件/控制、不发送；CLI原生只读。无schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行产品命令、打开库或发布。独立回执文件/联合备份/跨设备导入及运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增listRestoreRequeueReceipts/restore-requeue-history，按配置项目只读分页发现重新排队批次，默认10最多20，BINARY ID游标。共享有界原查询/摘要/时间trace核验，本页和前瞻均检查ID唯一性及顺序；返回get_query/next_query，明确父历史与选中内容未核验，不读取正文或当前队列/控制。缺可选表返回未配置空目录；失败保留原查询/所选ID/完整性与关闭状态。90秒预算、128 KiB结果、16 KiB查询，无schema/依赖变化。全量关联历史审计、回执文件/联合备份/跨设备导入及运行证据仍缺；仅源码文档，未编译、类型检查、测试、执行产品命令、打开库或发布，按任务提交推送main，带[skip ci]。

- P3/P4：新增readRestoreRequeueRecord/restore-requeue-get，严格scope/requeue_id选择，复用原完整回执/父历史/前后摘要验证找回原七字段请求，旧精确查询和写入幂等比对保持。可选output在打开库前预检，完成读取并尝试关闭后独占保存16 KiB原查询，最终字节/SHA/JSON读回；缺记录不创建文件，失败保留历史/原请求/输出与关闭状态，响应超限保留已保存local。固定90秒/128 KiB结果，不修改当前队列/控制或自动重发；无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库或发布。分页目录、回执文件/联合备份/跨设备导入及运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：重新排队查询增加可选requeue_id，显式写入在同事务持久原查询/SHA、完整父恢复回执SHA、归一档案和选中记录前后SHA、原时间trace。查询解析和固定v1选择/映射抽取共享；精确重复原操作/预览只返回核验历史，异请求/跨项目占用拒绝，不重新排队当前行。新增原查询只读回执入口，缺表/缺记录不推断原提交失败；候选/历史回执和事务未知/关闭状态分开保留。可选新表仅首次实际带ID写入初始化，旧六字段行为保留；仅源码定义，未打开库或执行schema、编译、类型检查、测试、运行命令或发布。目录/原查询发现、回执文件/备份、跨设备导入/保留管理和运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增恢复事件批量预览/显式重新排队，严格原scope/restore_id/档案SHA/暂停generation/1至100个唯一事件ID/原因。整份原历史验证后逐条全23列匹配不可变恢复基线，终态/已有投递元数据/缺失/变化整批拒绝；写事务只重置四列为pending及最早调度，全部事件/完整原历史/暂停控制读回后提交。固定90秒、所选32 MiB、结果128 KiB，保留原查询/候选计划/选中定位和事务/关闭状态；无持久重新排队回执，同请求再次调用不能推断原提交结果。CLI独立本地入口，未自动resume/核对服务器/发送。无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库或发布。持久批次凭据/旧发送者协调/远端核对后自动激活及运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增 prepareArchiveRestore/outbox restore-prepare，按原scope/新restore_id/reason和完整原档案，在单个只读快照检查全局ID未占用、暂停generation、空项目及事件/键冲突，共享实际v1归一计划后输出完整恢复查询。CLI打开前预检新路径，读取并尝试关闭后独占保存16 KiB查询及最终字节/SHA/JSON读回；失败保留原输入/完整准备结果/源文件/发布清理及关闭状态。已有或导入的历史ID直接拒绝，不刷新旧请求、自动暂停/恢复/发送；实际恢复重新检查。无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库或发布。非空合并/旧发送者协调/来源认证及运行证据仍缺；按任务提交推送main，带[skip ci]。

- P3/P4：新增恢复历史备份离线目录/单条回执/原事件档案提取，完整核验全部历史后选择，目录默认10/最多20项，续页和get/export选择绑定原backup_sha256，换文档明确拒绝。保留原回执和原档案SHA/JSON/租约，stdout仅摘要；缺项不创建文件，独占输出和完整读回失败保留历史/路径/文件状态及底层错误。不加载原生SQLite、不需配置项目/令牌/网络，未自动创建新恢复请求或写队列。无schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库、生成样本或发布；跨项目发现、清理/修复、来源认证和完整恢复向导及运行证据仍缺。按任务提交推送main，带[skip ci]。

- P3/P4：新增恢复历史备份导入和只读预览，严格原scope/backup_sha256及完整v1文件；同事务预检全局恢复ID，缺失补入、完整原历史相同保留，异文/跨项目占用整批拒绝。目标正文每次检查64 MiB、整笔90秒、结果128 KiB；全部写入后逐份完整核验读回才提交，缺表仅非空首次导入创建既有扩展。保持原恢复时间trace/回执/源档案，不恢复当前事件或控制；重复请求只证明当前内容已存在，不证明原未知提交，失败保留候选计划和事务/关闭信息。无新表格式/依赖变化，仅源码文档，未编译、类型检查、测试、执行命令、打开库或发布；选择提取、跨项目发现、持久导入审计、清理/来源认证和运行证据仍缺。按任务提交推送main，带[skip ci]。

- P3/P4：新增 readRestoreBackup/outbox restore-history-backup 和独立离线 inspect-restore-history-backup，完整保存单项目全部原恢复查询、回执和原档案，逐份核验原身份/内容摘要及不可变v1恢复摘要，再核验集合SHA。复用单次有界审计，最多100份/64 MiB文档及整体节点/深度限制；超限整笔失败，不分页截断。原生只读已有库，完整读取并尝试关闭后独占写新文件，最终完整读回；错误保留历史/原事件定位、预算进度、文件和关闭状态。无schema/依赖版本变化，未编译、类型检查、测试、执行命令、打开库、生成样本或发布；历史备份导入/目标比较/选择提取、跨项目备份、清理和来源认证仍缺。按任务提交推送main，带[skip ci]。

- P3/P4：新增 compareRestoreRecord/outbox restore-compare，按原项目/恢复 ID/事件 ID 在单次只读事务先完整核验源档案和不可变恢复摘要，再核验当前原行、精确对照全部23个存储列。展示原档案、恢复基线和当前摘要及变化列，固定90秒/128 KiB；相同内容不证明来源，当前缺失不推断删除或投递。错误保留请求事件和底层原档案损坏事件定位、回滚/关闭详情。无 schema/依赖变化，未编译、类型检查、测试、执行命令、打开库或发布；跨项目目录、完整历史备份、保留策略、因果来源和运行证据仍缺。按任务提交推送 main，带 [skip ci]。

- P3/P4：新增auditRestoreReceipts/outbox restore-audit，在单个只读快照核验项目全部恢复历史；默认100份/64 MiB/30秒，上限1000份/512 MiB/90秒。先有界计数，逐份正文前核对存储字节和同范围ID唯一性，复用完整原档案及不可变恢复映射摘要；损坏/超限/超时均未完成，保留进度/选中ID/原错误/回滚和关闭状态，不修复或改当前队列。目录附全项目audit_query，零历史不推断过去没有恢复。无schema/依赖变化，未编译、类型检查、测试、运行核验/CLI/接口、打开库或发布；跨项目目录、完整历史备份、清理/来源关联及运行证据仍缺。按任务提交推送main，带[skip ci]。

- P3/P4：收件箱/发送队列readonly构造现以DatabaseSync原生readOnly打开，再保持query_only/已有结构检查；只读打开失败不回退可写、不隐式创建或升级主库。Outbox提前严格核对existing/readonly布尔值，常规写入与Inbox显式创建保持原规则。现有查询/审计/导出/预览入口继承此边界，无schema/依赖/CLI格式变化。文件身份原子绑定、日志环境兼容性和运行证据仍缺；未编译、类型检查、测试、运行CLI/接口、打开库或发布，按任务提交推送main并带[skip ci]。

- P3/P4：新增 previewArchiveRestore/outbox restore-preview，共享实际恢复的完整原档案、精确历史回执、ID占用、暂停generation/空项目/原事件键冲突和v1映射核验。一次只读事务返回预计状态/待处理/清租约统计，已完成原请求只返回原历史；不生成提交回执、不预留ID或写入，实际执行重新检查。Bridge预览结果128 KiB/固定90秒，原查询和失败定位/回滚/关闭信息保留。无schema/依赖变化，未编译、类型检查、测试、运行CLI/接口、打开库或发布；非空合并、旧发送器协调、批量激活及运行证据仍缺。按任务提交推送main，带[skip ci]。

- P3/P4：新增恢复历史目录、按 ID 完整回执查询与原档案重新导出。目录仅校验有界元数据，BINARY 分页默认10/最多20条；单条核验完整原档案及不可变恢复映射，找回原查询，导出独占新文件并保留失败历史/路径。无 schema/依赖变化，未编译、类型检查、测试、运行CLI/接口、打开库或发布；全范围正文核验已由restore-audit补入；跨项目目录、历史清理和运行证据仍缺。按任务提交推送 main，带 [skip ci]。

- P3/P4：新增 restoreArchive/readRestoreReceipt 与 outbox restore/restore-receipt，完整核验原档案和固定原查询，首次恢复要求空目标项目与 paused generation 精确匹配，并预检全库事件/键冲突。原正文/引用文本、身份/键/摘要/尝试/调度/trace保持；历史sent/conflict保留，pending/sending/failed转failed、清除旧租约并标待处理。原档案/原查询与全部恢复行在同一事务提交，可选 local_outbox_restore_receipts 保存原历史及归一后摘要；全部写完再逐行/整回执读回核对。相同恢复ID/原查询只返回历史结果，异查询拒绝；提交未知保留候选回执、原请求及回滚/关闭状态。CLI先核验原文件/范围再只开已有明确目标，回执查询不建表、不改队列，不自动resume/retry/发送。非空合并、旧发送者停机、批量激活、完整控制/回执备份及运行证据仍缺；新增本地表仅初始化源码未执行，无Gateway API/依赖变化。未编译、类型检查、测试、执行CLI、打开库、迁移、生成样本或发布；按任务提交推送main并带[skip ci]。

- P3/P4：新增 readSendControl/changeSendControl 与 outbox send-control/pause/resume；按项目持久控制行含 generation/原因/时间/trace，显式首次暂停同事务初始化可选 local_outbox_send_control 表，绑定 expected_generation、拒绝陈旧或重复状态并完整读回。claim 写事务每次读取控制，指定暂停项目拒绝领取，无范围 drain 在 LIMIT 前跳过暂停项目；已有领取和结算不取消，租约过期/零sending不证明发送器停止。只读状态以1000条上限区分活跃/过期/缺令牌，超限/坏元数据返回未知计数；原内容不审计。CLI 固定配置范围/稳定输入、只开已有库，提交未知保留原查询/候选generation/回滚和关闭状态。正常构造和读取不初始化控制表；新增表仅源码未执行，无依赖/Gateway API变化。旧发送器协调、档案恢复、全局写入锁与运行证据仍缺；未编译、类型检查、测试、执行CLI/服务、打开库、迁移或发布，任务独立提交推送main并带[skip ci]。

- P3/P4：新增 SqliteOutbox.readArchive、outbox export/inspect-archive，单项目完整逻辑档案保存23个已知本地列及原 payload/source_refs 文本、身份/命令摘要、状态/调度/租约。导出复用单次只读 audit 收集全部记录，最多1000行/32 MiB文档及复杂度限制，超限或损坏不出部分档案；完整文档/逐行原摘要均核验，独立无SQLite包子路径提供离线检查。CLI 关闭队列后独占写入新文件并完整读回，失败保留原查询/路径/摘要/进度和关闭状态，不覆盖目标。原校验算法抽取复用，历史租约不授权发送；受控恢复、旧发送者协调、跨项目/未知列档案和运行证据仍缺。无数据库schema/依赖版本/API变化，仅源码文档，未编译、类型检查、测试、执行CLI、打开库、生成样本或发布；按任务提交推送main，使用[skip ci]。

- P3/P4：新增 SqliteOutbox.auditRecords 与本地 outbox audit，严格原项目/预算，在一次只读事务中先有界计数，再按 BINARY event_id 分批核验全部原身份、完整命令/正文摘要及范围内事件/幂等键唯一性。默认1000行/64 MiB/30秒，最多10000行/512 MiB/90秒；终点数量对齐，预算/损坏/缺身份拒绝完整结论，保留查询/阶段/已核验数量字节/选中事件及回滚关闭状态。成功只返回本地状态/租约和旧摘要统计，不查询远端、不发送/结算/改租约；主程序及嵌入共用只读已有库入口。全库跨项目核验、队列备份恢复、旧身份追溯/发送者协调及运行证据仍缺。无 API/schema/依赖变化，仅源码文档，未编译、类型检查、测试、执行 CLI/服务、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P0/P3/P5：新增浏览器历史回执完整备份/恢复，workctx.sync-receipts-backup v1 保留每份完整原回执与原查询 trace，按摘要唯一递增；最多256份/32 MiB及整体复杂度限制，完整快照读取后在事务外逐份验证摘要，再计算集合摘要。显式恢复重新核验双层摘要，在一个写事务预检全部目标后仅add缺失槽并读回，同槽异文/单边损坏整批拒绝；不生成原查询或远端观察。独立新标签页与原查询共用审阅/下载/确认/未知结果保留及30秒整笔预算，旧文件格式不变；缺库导出与空恢复不永久建库，非空恢复初始化与数据事务分开。容量管理、损坏修复、跨库联合快照/恢复、跨设备队列恢复及运行证据仍缺。无 API/schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行浏览器/服务、访问 IndexedDB 或发布；按任务提交推送 main，使用 [skip ci]。

- P0/P3/P5：新增浏览器原查询完整备份/恢复及专用审阅页，共享 workctx.sync-originals-backup v1 文件按原六字段槽排序唯一并独立核验文档 SHA。单次只读事务核对全部正文/目录，最多 256 条/32 MiB，超限或损坏不截断；明确确认后同一写事务预检全部目标，只添加缺失项并读回，异文/单边损坏整批拒绝。导入不写入，成功或未知失败保留完整文件；空恢复不建库，既有结构初始化可能留下空库。30 秒整笔预算及取消/忙碌保护，不查询/确认投递或结算队列。历史回执现已补独立备份恢复；容量管理/损坏修复及运行证据仍缺。无 API/schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行浏览器、访问 IndexedDB 或发布；按任务提交推送 main，使用 [skip ci]。

- P3/P5：工作台同步原查询/历史回执目录新增单条审阅后移除。先完整载入核验并保留可下载/复制副本，显式确认后在已有库同事务比较当前完整原文/目录、删除两槽并读回缺失；回执摘要在事务外核验，再以原字节比较防止间隙变化。缺库不创建、缺两槽报不存在，单边/异文/损坏拒绝；成功或未知失败均保留审阅副本至关闭，不联动其他记录、服务器或本地队列。忙碌/期限/卸载保护延续；浏览器跨库联合备份/损坏恢复/容量管理及运行证据仍缺。仅源码文档，无 schema/依赖/API 变化，未编译、类型检查、测试、运行浏览器、访问 IndexedDB 或发布；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 Bridge readBuiltInApplicationPendingPages 与 CLI application-pending，在一次只读事务中对齐所选应用头与接收头，按序号发现待处理原页（含游标不变的空终页）。默认20/最多50页，完整核验额外前瞻页及连续原页/前驱/游标，64 MiB原页预算和512 KiB完整响应；返回首待处理页完整 next_apply_query，推进后刷新。检查点差值注明计数依据，列表不执行 reducer、不宣称业务可应用或全历史审计，不写入/确认；失败保留原查询/阶段/所选页与关闭状态。缺基线引导、其他业务适配、权限重建和运行证据仍缺。仅源码文档，无 schema/依赖变化，未编译、类型检查、测试、运行 CLI/reducer、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 Bridge previewBuiltInApplicationPage 与 CLI application-apply-preview，复用实际 apply 的准备/校验/归约流程，只读返回当前已存状态、预计投影和完整原查询，支持三个固定内置适配器。已应用页不重跑或回退，空新页显示下一步骤；两份投影分别限 1 MiB、处理 64 MiB、完整响应 3 MiB。失败保留阶段/事件定位和关闭状态，实际应用重新检查；不生成快照/回执或确认。其他业务适配、缺基线引导、权限重建和运行证据仍缺。仅源码文档，无 schema/依赖变化，未编译、类型检查、测试、运行 CLI/reducer、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P0/P3/P4：新增 conflict-sync 严格共享解析器和 conflict-lifecycle/1 内置冲突历史投影，按现有 Gateway 检测/决策封套保存 open/resolved、完整 detected/latest 和决策值。核对原 conflict/entity/field/三版本、来源前缀/后缀、actor 绑定、递增游标和分类不下调，缺检测基线/重复终态整页拒绝；最多 512 冲突与原字节预算。集中选择器接逐页 apply 和 readonly 完整 replay，原上下文/建议 v1 规则不变，另外 12 类范围外事件显式忽略。原检测无 local/server 值，不证明源字段已应用或原请求回执；旧基线、权限重建、其他业务适配及运行证据仍缺。无 schema/依赖/Gateway wire 变化，仅源码文档，未编译、类型检查、测试、运行 reducer/CLI/接口、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P0/P3/P4：新增 proposal-sync 严格共享解析器及 proposal-lifecycle/1 内置建议投影，消费现有 ApprovalRequested/Completed 的 Proposal 原事件，校验创建 proposed/revision1 至 verified/rejected/revision2、种类/分类不变和游标递增，保留 requested/latest 历史封套。最多 512 建议，12 类范围外事件显式忽略，未知类型/缺创建基线/重复终态整页拒绝；不含正文/审阅理由/到期或当前权限。集中适配器选择同时接入原页 apply 和 readonly 全历史 replay，旧 context-item-lifecycle/1 规则不变，固定安全错误分域。无 schema/依赖/Gateway wire 变化，仅源码文档，未编译、类型检查、测试、运行 reducer/CLI/接口、打开库或发布。其他业务适配/正文、缺口引导、权限重建和运行证据仍缺；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 auditApplicationRestoreReceipts/application-restore-receipt-audit，严格原身份/应用及数量/字节/期限预算，单个只读事务按实际行数和 BINARY ID 分批核验全部回执，覆盖无应用头的 empty 恢复记录。默认 1000 份/64 MiB，最多 10000 份/512 MiB，失败保留原查询、阶段、已核验计数和选中 ID，不返回部分通过。两个目录补 receipt_audit_query 衔接，完整响应 512 KiB。只证明所选范围历史回执自洽；跨范围全库审计、实例绑定、来源认证、不同历史合并及运行证据仍缺。无 schema/依赖变更，仅源码文档，未编译、类型检查、测试、执行 CLI/接口、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 listApplicationRestoreReceiptScopes/application-restore-receipt-scopes，直接从独立回执表发现原消费者/应用，包含没有消费者或应用头的空恢复记录。默认 20、最多 50，二元摘要键 BINARY 续页；逐个完整校验选中范围和额外前瞻的一份代表回执，返回原身份/应用与现有 list/get 查询。外层 scope=null，续页取最后返回项，完整响应 512 KiB；错误保留查询/未完成/关闭状态。不是完整回执审计或跨页固定快照；实例绑定、来源认证、不同历史合并及运行证据仍缺。无 schema/依赖变更，仅源码文档，未编译、类型检查、测试、执行 CLI/接口、打开库或发布；按任务提交推送 main，使用 [skip ci]。

- P0/P3/P4：新增共享应用恢复回执文件 v1，查询/目标/回执结构解析抽取至 contracts，保留原规范字段顺序，Bridge/CLI 独立核验 SHA。get 新增互斥的 receipt-output，读事务完成并尝试关闭后独占导出，缺记录不创建文件；新增离线 inspect/query，不加载 Bridge 或打开库，完整核验文档与原查询摘要后查看/提取。发布未确认、文件/响应失败保留原回执、查询、路径和文件状态。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行 CLI/接口、打开库、生成样本或发布。跨应用发现、实例绑定、来源认证及恢复运行证据仍缺；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 listApplicationRestoreReceipts/application-restore-receipt-list，按完整原身份/应用分页发现恢复请求 ID。默认 20、最多 50，BINARY ID 升序，完整校验页内及额外前瞻回执后输出历史摘要、原请求摘要和 receipt_get_query；next_query 保留原范围/期限与最后返回 ID。独立读取快照，不解释为时间顺序、跨页冻结成员或全库审计；512 KiB 完整响应，错误保留原查询/关闭状态。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、运行 CLI、打开库或发布；回执文件导出、跨应用发现、实例绑定和运行证据仍缺。按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 application-restore-receipt-get/getApplicationRestoreReceipt，按原身份/应用/请求 ID 只读发现完整历史回执和原恢复查询；本次读取 timeout_ms 与原请求分离，原完整查询核对/重复恢复仍严格比较。可选 --output 在查询成功并尝试关闭后独占保存原查询 JSON，保留原归档摘要/目标约束/期限及字段是否存在；缺记录不创建文件、不推断回滚，文件失败保留回执/原查询/路径/关闭状态。无新 schema/依赖，只修改源码文档；未编译、类型检查、测试、运行 CLI、打开库或发布。回执完整文件导出、请求 ID 目录、实例绑定及运行证据仍缺；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增显式可选应用恢复回执扩展 v1。恢复/预览可指定 restore_request_id，完整规范原查询绑定 ID；首次恢复与页面/应用历史在同一事务登记紧凑回执并读回，相同请求仅返回原历史结果，ID 复用不同查询明确拒绝。CLI 增加 enable-application-restore-receipts/application-restore-receipt，只读精确查询不需要归档；缺记录不推断未知提交已回滚。预览命中回执不生成计划，未命中继续目标比较并保留 ID。回执文件导出、原查询发现、实例绑定、不同历史合并和运行证据仍缺。独立扩展仅源码，未打开库、执行扩展/CLI、编译、类型检查、测试或发布；按任务独立提交推送 main，使用 [skip ci]。

- P4：application-restore-preview 新增可选 --output NEW_FILE，输出路径在打开库前预检，完成只读预览并尝试关闭后仅允许恢复时保存带 expected_target 的原查询；可直接用于既有 --json-file，无新格式/schema。16 KiB 紧凑 UTF-8 固定原字节，独占临时文件/同步/硬链接发布并最终有界逐字节/摘要读回；冲突不创建文件，失败保留原查询、输出/临时路径及关闭/清理状态，发布未确认不删除目标。完整响应 512 KiB，后续响应超限保留已保存状态；不自动恢复或重试。完整预览/恢复结果归档和持久恢复回执仍缺。无新依赖，仅源码文档，未编译、类型检查、测试、执行命令、生成样本或打开库；按任务独立提交推送 main，使用 [skip ci]。

- P3/P4：恢复/预览查询新增可选 expected_target v1，完整审计后流式摘要固定原消费者/应用的全部页、投影/原 trace 和完整接收后缀；预览生成绑定目标的 restore_query，旧约束不符返回 conflict，不静默替换。恢复在同一写事务首次插入前检查应用/接收摘要，变化报 TARGET_CHANGED；成功输出 target_before/target_after，未知提交保留原约束。旧无约束查询兼容，内容摘要不是实例版本或历史写入回执。持久查询/回执、不同历史合并和完整跨设备恢复证据仍缺。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行接口/摘要样本、打开库或发布；按任务独立提交推送 main，使用 [skip ci]。

- P3/P4：新增 previewApplicationArchiveRestore 与 CLI application-restore-preview，沿用原身份/应用/归档摘要查询，完整核验文件后只读打开已有库。单次只读事务完整审计目标应用/接收链，与实际恢复共用比较规则，返回关系、正序首差异摘要、恢复兼容性、预计新增页/事件数和保留后缀数；合法冲突返回 conflict，损坏/预算不足仍失败。512 KiB 响应，无正文输出/写入/reducer/确认，预览不冻结后续目标，实际恢复重新检查。不同历史合并、目标版本绑定、跨设备完整恢复及运行证据仍缺。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行接口或打开库；按任务独立提交推送 main，使用 [skip ci]。

- P3/P4：新增 restoreApplicationArchive 与 CLI application-restore，完整原身份/应用/归档摘要在打开库前绑定，Bridge 独立核验全部摘要。单写事务恢复缺失原接收页、逐页投影/原 trace、派生事件 ledger 与应用头，前后完整审计；只接受空应用或完整相同历史，保留兼容较新接收后缀，拒绝分叉/部分应用历史。原接收链每遍 10000 页/64 MiB、应用归档 1000 页/16 MiB、默认 30 秒最多 90 秒；未知提交/回滚保留 unknown、原查询和进度。须已有扩展，不执行 reducer/确认，不认证来源/语义；只读预览、不同历史比较/合并、跨设备完整恢复与运行证据仍缺。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行恢复、打开库或发布；按任务独立提交推送 main，使用 [skip ci]。

- P0/P3/P4：新增独立应用历史归档 v1 与 Bridge readApplicationArchive，完整结构审计后保存根到应用头的原页面/逐页投影/摘要/原应用 trace，最多 1000 页、文档 16 MiB、投影 1 MiB。CLI application-export 只读取档、关闭后独占保存并最终读回；application-inspect 默认20/最多50离线分页，application-archive-get 按归档/原页摘要读取完整历史投影。每次完整核验全部页面/投影/外层摘要，空页不改投影、事件 ID 不复用；离线不加载数据库。失败保留路径/关闭状态，不覆盖文件、不确认或认证业务语义，导入恢复/比较合并/跨设备恢复证据仍缺。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、运行、生成样本或打开库；按任务独立提交推送 main，使用 [skip ci]。

- P3/P4：新增 readApplicationCatalog 和只读 application-list，原消费者身份下发现已保存的应用名称/版本及头摘要，默认 20/最多 50，按应用摘要键 BINARY 顺序显式续页。每项和前瞻完整核验描述/键、头/原页/ledger，返回状态查询、固定本次上界历史查询和精确快照查询。逐应用原源文档/投影预算 64 MiB、响应 512 KiB、原本地期限；不输出投影正文，不冻结跨调用成员/头、不核查缺描述孤立行或声称全历史审计。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行 CLI/数据库；按任务独立提交推送 main，使用 [skip ci]。

- P3/P4：新增 replayBuiltInApplicationHistory 与只读 application-replay，同一事务先全应用结构审计，再从 null 按原页/事件正序重算固定 context-item-lifecycle/1，逐页严格比对保存投影。未知类型、生命周期拒绝和首个正序差异保留具体页/事件及安全诊断；预算不足不报部分通过。新增累计重算字节预算（默认 64 MiB/最多 512 MiB），沿用单页 64 MiB/投影 1 MiB 及审计限额/期限。结果只证明本次历史与当前内置规则相符，不认证原代码或来源、不写入/修复/确认；其他适配、正文、备份恢复和运行证据仍缺。无新 schema/依赖，仅源码文档，未编译、类型检查、测试、运行 reducer/CLI 或打开库；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 readApplicationHistory/readApplicationSnapshot 及只读 application-history/application-get。按原消费者/应用版本固定首次上界和续页末项的序号/原页摘要/投影摘要，默认 20/最多 50，选中步骤与前瞻完整核验；每项可精确读取当时完整投影，独立显示当前头，缺记录与摘要变化分开。64 MiB 选中源文档/投影预算、512 KiB 摘要/2 MiB 详情及原期限，错误不返回部分成功；不代表全历史审计或业务语义证明，不自动导出/恢复/确认。无新 schema/依赖，仅源码与文档，未编译、类型检查、测试、运行 CLI 或数据库；按任务提交推送 main，使用 [skip ci]。

- P3/P4：新增 auditApplicationHistory 与本地 application-audit，同一只读事务按原消费者/应用版本完整遍历头到根，核对实际步骤/事件行数、原页/快照摘要、ledger、前驱/游标及空页投影不变性。页/事件/字节/时间预算不足明确未完成，不重放 handler 或修复；成功仅标记本次结构审计，业务语义/未应用接收后缀/确认日志/全库物理状态不作断言。应用历史业务重放、备份恢复及真实运行证据仍缺；无新 schema/依赖，未编译、类型检查、测试、执行 CLI 或数据库。按任务独立提交并推送 main，使用 [skip ci]。

- P0/P3/P4：新增严格上下文同步事件解析和内置 context-item-lifecycle/1，保存创建/最新事件及生命周期元数据，从创建版本 1 连续处理五类事件；缺基线、断档、非法迁移/分类变化整页拒绝，九类范围外事件明确保持原投影，未知类型不忽略。CLI application-apply 固定原身份/应用版本/原页/预期前驱，复用原子快照/ledger/头事务；空页与重复页也检查投影结构和应用边界。仍缺正文同步、其他业务适配器、旧条目/权限变化基线、历史完整审计/备份及运行证据；无新 schema/依赖，仅源码文档，未编译、测试、执行 CLI 或数据库。按用户要求，历史开发基线已提交并推送 main；此后每个开发任务独立提交推送，使用 [skip ci]。

- P3/P4：CLI 新增 inbox enable-applications/application-status，主程序和嵌入调用均为本地入口。启用仅接受已有库路径；状态以完整原身份/应用名称版本选择，16 KiB 严格查询先解析再只读打开，完整返回本地投影、应用游标及原 trace。关闭失败保留结果和原提交/回滚未知状态，不自动应用事件或确认。业务 reducer、CLI 执行应用、应用目录/历史审计/备份仍缺；无新 schema/依赖，仅源码文档，未编译、类型检查、测试、执行 CLI、打开库、运行初始化/迁移或发布。

- P3：Bridge 收件箱新增显式 application 扩展、完整本地投影读取和原页同步 reducer 应用事务；原身份/应用版本/原页/预期前驱固定，未知类型/事件复用/异步或失败处理拒绝整页。完整快照、事件 ledger、不可变步骤与应用头同事务写入/读回，重复已提交页不重跑；接收/服务器确认保持独立。投影 1 MiB、单页处理 64 MiB、默认 30 秒，提交或回滚不明保留 unknown。具体业务 reducer、CLI 应用入口、历史审计与备份仍缺；新 SQLite 扩展仅源码，未打开库/执行 schema，无依赖变化，未编译、类型检查、测试、运行或发布。

- P0/P4：SDK 新增离线 prepareSyncEventReceiptFile / inspectSyncEventReceiptFile 及独立子路径，完整 v1 文件规范生成/有界 UTF-8 读取、文档与实际文件双 SHA-256、原查询/所选摘要可选绑定。原文在异步等待前复制，本地 trace 不覆盖历史 trace；默认 30 秒、取消和有限文件错误，返回历史标识与待保存字节/原查询，不读取路径或访问网络/数据库。持久适配器/MCP 文件工具仍缺，无依赖/schema/迁移变化；仅源码文档，未编译、类型检查、测试、调用 SDK、生成样本或发布。

- P5：同步回执页新增显式保存完整查询结果/已核验历史、20 条摘要目录和完整历史载入，恢复后明确为历史，不替代本页新查询。独立回执库按文档摘要保留各次观察，同事务 add/完整读回，不覆盖旧结果；载入事务结束后独立核验摘要，保存/载入有覆盖摘要工作的 30 秒本地预算。补历史下载/复制，提取共用浏览器事务助手而不变原查询 schema。新浏览器 schema 仅源码，SQL 016–049 未执行，无依赖变化；未编译、类型检查、测试、运行浏览器/服务或发布。

- P5：/sync/receipt 新增显式保存原查询到浏览器、20 条元数据目录与完整载入，原文/目录同事务添加并读回；固定五字段身份/event_id 槽，异文/损坏不覆盖。只读缺库中止初始化，显式保存才创建 v1；打开/事务各 10 秒及卸载取消，失败保留内存/下载、提交不明不声称未保存。目录不读全部正文、不确认投递，恢复后仍需原身份下显式查询；回执历史不自动保存。浏览器 schema 仅源码，未执行，无新依赖/SQL 迁移，016–049 未执行；未编译、类型检查、测试、浏览器/服务运行或发布。

- P5：新增 /sync/receipt 和侧栏入口，载入原 identity/event 或 v1 回执文件，完整解析/WebCrypto 摘要后固定原查询；导入历史与显式查询结果分开，失败保留原内容和先前完整响应。独立同源代理使用原身份/当前会话范围、原回执路由、请求/成功/错误限额、30 秒及两笔准备容量，浏览器 35 秒等待与卸载取消；不放宽全局 Server Action 限额。支持原查询与回执文件下载/复制，不证明浏览器保存完成，不上传/确认/结算队列。Web 持久恢复/旧身份/本地应用事务等仍缺，无依赖/schema/迁移变化，仅源码文档，未编译、类型检查、测试、浏览器/服务运行或发布。

- P3/P4：outbox list 改为默认 20/最多 50 的现有队列摘要分页，SQL 有界投影不加载正文，scope/status/event_id 续页返回 next_query；新 outbox get 按原 ID 完整核对身份/命令/摘要，损坏不补空 payload，活跃发送可查看但不抢占。Bridge 只读模式已补原生readOnly打开，保留已有列检查/query_only，不建目录/主库或自动升级；CLI 主程序/嵌入共用入口，关闭失败保留结果。旧数组/rowid 顺序消费者需迁移，无全量审计或冻结备份保证。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行或打开库。

- P0/P4：新增 workctx.sync-event-receipt v1 完整回执文件，outbox reconcile --result-output 在核对结束及尝试关闭库后独占保存/最终读回，覆盖成功与完整验证后本地失败；文件结果不覆盖原提交状态，保存失败保留完整输出。outbox inspect-result --result-file 离线完整校验并查看，不需要当前身份/令牌/数据库；文件保留原身份/事件/查询 trace 和 recorded/not-observed，不证明当前状态或允许离线结算。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、实际生成文件、运行或打开库。

- P3/P4：outbox reconcile 保留完整验证后遇到本地错误的原回执，错误 details.reconciliation 单列本次提交未发生/未知和事务阶段、回滚状态；COMMIT 异常明确 OUTBOX_COMMIT_UNKNOWN，回滚异常不覆盖原错误，CLI 关闭失败仍保留完整信息。未观察到、已一致和实际更新分支均在提交前重核预算。未提供持久回执文件/离线结算，不代表其他进程状态；无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、打开库或运行。

- P3/P4：归档新增离线 archive-history/archive-page，完整核验原档后分页摘要、精确双摘要详情或单页提取，无需恢复数据库。查询 16 KiB，历史默认 20/最多 50、续页绑定归档摘要，返回可复制 next_query/selection_query；不同档案拒绝，缺页详情为 null、要求导出则不造文件。新文件复用原单页独占保存/最终读回，保留原下载 trace/摘要/前驱及来源元数据，不绕过导入链要求。两个 CLI 入口先于 Bridge 分流；无格式/schema/依赖变化，仅源码文档，未编译、类型检查、测试、生成样本、打开库或运行。

- P3/P4：compare-pages 增加可选 --output，兼容比较可直接保存原四字段 append_query，供 append-pages --json-file 使用。打开库前预检新路径，读事务释放并尝试关闭库后独占保存，最终核对字节长度/摘要及共享解析/规范内容；不同链不生成计划。保存/读回失败保留完整比较、文件路径和关闭状态，不重新读头修改请求、不自动追加；文件成功仍须在追加时重新核对过期检查点。无 schema/格式/依赖变化，仅源码文档，未编译、类型检查、测试、实际保存文件、运行或打开库。

- P3/P4：页面链归档新增 compare-pages/append-pages 及 Bridge 完整比较/显式前缀追加。单次读取事务核验全部本地链后报告相同/空目标/前缀/分叉，兼容时生成绑定原身份、归档摘要和本地头/页数的 append_query；写事务重新检查所有前提，只追加缺失后缀并全链读回。过期头、不同归档、分叉或较短归档拒绝，原 restore-pages 仍只允许空目标/完整相同。比较不自动写入，CLI 两入口保留关闭状态；不处理确认日志/应用事务，无 schema/格式/依赖变化，仅源码文档，未编译、类型检查、测试、运行命令或打开库。

- P3/P4：新增单消费者 workctx.sync-page-chain v1 完整页面链档案，Bridge readPageChainArchive/restorePageChainArchive 及 CLI export-pages/inspect-pages/restore-pages。导出同一读事务覆盖实际全部页面，保留原身份/下载 trace/逐页摘要；上限 1000 页、16 MiB 文档及整体 JSON 复杂度，超限不生成局部文件。离线检查不打开库；恢复先核验全部摘要，在同一写事务恢复空消费者或确认完整相同重放，拒绝部分/不同/更长目标。旧单页导入复用事务助手，文件新路径发布及读回、提交未知/关闭失败均保留。确认历史、租约和应用状态不包含，全库/流式备份仍缺。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、生成样本、运行或打开库。

- P3/P4：新增 Bridge listConsumers 和本地 inbox consumers，以 limit/after_consumer_key 分页找回本库完整原身份及接收 state，无需旧身份文件或当前账户。默认 20、最多 50，单次读事务核验规范身份/摘要键与返回项完整头页、相邻前页；损坏明确失败，输出数据最多 512 KiB。续页为当前成员/状态，新键可能落到已有下界之前，重新首页才可发现，不声称全量快照/备份。主程序及嵌入均接本地 query_only 路径，scope=null、保留关闭状态；无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行命令、打开库或发布。

- P3/P4：新增 Bridge auditAcknowledgements 与本地 inbox ack-audit，按原消费者在单次读事务核验全部已启用确认/派发/恢复日志，默认 max_entries=1000（逻辑行总数），超预算明确未完成。完整证据/原页、连续序号、原目标游标单调、pending/active 唯一性、恢复首派发及跨消费者引用均检查；可选扩展缺失单列、部分存在拒绝，不补造旧发送历史、不改状态。派发/恢复读取的数据库访问移出内容解析 catch，保留存储失败类型。页面链/物理库审计、全量备份和应用事务保持独立范围。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行命令或打开库。

- P3/P4：新增 inbox page-history/page-get 与 Bridge 原身份限定的历史摘要分页/精确摘要读取。默认 20、最多 50，next_query 固定上界序号/摘要及上次末页序号/摘要；同一读事务核验头、边界、返回页与相邻前页，序号缺口/边界变化拒绝，不混入后来追加成员。page-get 返回完整原页及独立当前状态，或 --output 在释放事务并尝试关闭库后保存原页面，缺目标不造空文件、不覆盖。历史浏览不替代全链审计或全量备份，不写库、不自动导入/确认。无 schema/依赖变化，仅源码文档，未编译、类型检查、测试、运行或打开库。

- P3/P4：新增 Bridge auditPages 与本地 inbox audit-pages，在单次只读事务核对所选消费者/实际页面行数、头检查点和完整原页面链，从头沿前驱校验身份/规范摘要/安全连续序号/游标/固定 limit 到零起点根页。全部覆盖才返回 complete；默认 max_pages=1000，可显式提高，预算不足/损坏/不可读均明确未完成，不修复或拼接跨快照结果。报告 checked_pages/checked_events/root_sha256 与快照状态，确认扩展及全库物理状态明确未审计。主程序/嵌入入口不需要令牌或网络。无新 schema/依赖，仅源码文档；未编译、类型检查、测试、运行命令、打开库或发布。

- P3/P4：确认四种调用新增可选 --result-output，预检新路径后继续原流程；收到完整结果后保存独立 sync-ack-result v1，携带原页面、请求前原记录/派发快照、本次 trace、完整服务器结果及日志方法是否完成。日志失败仍保留原错误和 server_result，文件失败另附状态；本地重放/无有效结果不造新文件。离线 ack-result-inspect/page 接入主程序和嵌入入口，完整结构/两层摘要核验后查看或提取原页，不导入或结算日志。可信导入、全量历史审计及应用事务仍缺。无新依赖/schema；仅源码文档，未编译、类型检查、测试、生成样本、执行请求、打开库或发布，见 docs/design/01-contracts/sync-ack-result-runtime.md。

- P3/P4：恢复凭据新增 ack-evidence 档案 v2，ack-recovery-get --output 可保存完整原目标/页面、恢复凭据及其首笔本地派发；共享解析核对原 record/dispatch ID、调用 trace、登记时间及此前未知标志。普通 get/dispatch-get 仍生成 v1，旧字段和规范序列化保留；离线 inspect/page 接受两版并标明版本，不迁移旧文件或写回日志。缺恢复凭据拒绝导出，不降级；可信证据导入、全量历史审计/备份和应用事务仍缺。无 schema/依赖变化，仅源码，未编译、类型检查、测试、生成样本、打开库或运行。

- P3/P4：旧缺派发历史的未知确认新增显式 recovery 扩展 v1、enable-ack-recovery、ack-recover --record-id 和只读 ack-recovery-get。恢复要求精确最新原目标/页面且无派发历史，新派发与不可变恢复凭据同事务提交，保留此前本地记录缺失/远端未知；不伪造旧发送。重复恢复/已有派发必须转精确 ack-retry，终态本地返回；复用原身份/游标/trace、占用及完整证据结算。恢复凭据导出已由后续档案 v2 增量补入；旧发送者协调、可信证据导入、放弃/应用事务/全量审计仍缺。核心/ack/dispatch v1 不改，recovery v1 仅源码未执行，无新依赖；未编译、类型检查、测试、打开库、运行或发布。

- P3/P4：新增共享 sync-ack-evidence 完整档案、ack-get/ack-dispatch-get --output 新文件保存、离线 ack-evidence-inspect 和 ack-evidence-page 原页面提取。原记录/可选派发/完整页面同一读事务取得，原身份/游标/trace/摘要绑定核验，关闭库后在新路径保存并核对两层摘要与最终字节；离线入口不打开库、不请求网络、不升级未知状态。档案不是服务器签名，未入库 server_result 仍需单独保留；可信证据导入、旧发送者协调、全量历史导出/审计和应用事务仍缺。无 schema/依赖变化，仅源码，未编译、类型检查、测试、生成样本、运行或发布。

- P3/P4：确认与派发新增本地 ack-history/ack-get/ack-dispatch-history/ack-dispatch-get。列表按原身份与固定上界序号/ID分页，默认 20、最多 50，派发可限定原 record_id；每项完整核验后返回摘要，按 ID 可读取完整原响应/观察。单次读事务，返回 next_query，明确只固定成员上界而不冻结后续证据更新；无网络、不修改占用或未知状态。无新 schema/依赖，未编译、类型检查、测试、打开数据库或运行；旧发送者协调、证据导入、完整历史导出/审计和应用事务仍缺。

- P3/P4：新增独立 dispatch 扩展 v1 和 inbox enable-ack-dispatch/ack-dispatch-status/ack-retry。首次原意图与派发占用同事务登记；显式重试必须指定最新派发 ID，保持原身份/页面/cursor/request trace，各派发独立保存响应和本次调用 trace。占用期内拒绝重复派发，旧 ID 不能再次接替；期限届满不证明远端停止，超时/崩溃保持未知，不自动请求。旧缺派发历史意图可观察，显式恢复已由 recovery 增量补入，放弃/证据导入/应用事务与全局门禁继续缺失，历史查询已由后续增量补入。核心/ack v1 未改，dispatch v1 仅源码未执行，无新依赖；未编译、类型检查、测试、打开数据库、运行或发布。

- P3/P4：收件箱新增显式启用的 ack 日志扩展 v1、本地 enable-ack/ack-status 与网络/嵌入 ack/ack-observe。确认前事务持久原页面/身份/cursor/trace 为 unconfirmed，完整成功响应记 confirmed；只读当前位点达到目标记 observed，不能冒充原请求历史回执。未知意图阻止新确认，低位点观察保持未知；网络等待不持锁，本地日志失败保留已收到的完整服务器结果。固定原目标显式重试已由后续 dispatch 增量补入；旧发送者协调/显式放弃、证据导入/完整历史导出、应用事务/applied_cursor 和跨端运行证据仍缺。核心 inbox v1 未改，ack 扩展 v1 仅源码未执行；未编译、类型检查、测试、打开数据库、运行或发布，见 docs/design/01-contracts/sync-inbox-ack-runtime.md。

- P3/P4：新增独立 SqliteSyncInbox 与 CLI inbox init/import/status/head，完整页面按原五字段身份隔离，首篇从零、后续绑定当前头摘要/游标/页大小，事务追加不可变页并推进 received_cursor；重复原页不回退，缺页/分叉拒绝。状态核验完整头页和相邻前页，头可导出到新文件用于续读；提交异常保留 unknown，不自动确认或重导。只表示连续接收，应用事务/applied_cursor、服务器确认日志、全量历史审计/修复及跨设备备份仍缺。新 SQLite schema v1 仅源码，未打开库、初始化或迁移，无新依赖；未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/sync-inbox-runtime.md。

- P3/P4：CLI sync changes --output 已补完整单页/原消费者身份/显式起始游标/有效页大小与摘要保存，复用不覆盖文件写入、同步、读回和最终路径核验；sync inspect --page-file 可离线查看，changes/ack/cursor --page-file 从完整核验文件恢复原输入。文件不代表事件已应用或历史请求已确认，前页摘要不证明整链连续；不自动翻页/确认/查询/重试。全局本地消费检查点、应用事务、链连续性/分叉处理和目录掉电保证仍缺。无依赖/数据库 schema/迁移，仅源码与文档，未编译、类型检查、测试、实际保存样本、运行或发布，见 docs/design/01-contracts/sync-saved-page-runtime.md。

- P3/P4：MCP 新增 get_sync_command_context/get_sync_event_receipt，发现/执行要求可信未过期 sync.write/admin，独立固定原上下文和事件，完整共享响应校验。两读取共用每 ApiGateway 两路准备容量/30 秒单调期限，超时名额保留到工作结束；成功身份 16 KiB/回执 2 MiB、错误和二次转义结果有界。HTTP 为可信 sync writer 增加原回执封套余量并按最终工具名限用，Artifact 更大扩容和准备前名额继续独立受控。不上传、重试、替换身份或结算队列；旧 MCP uploader/下载/ack、Web 同步恢复、旧消费者/Mock/fixture 和真实运行证据仍缺。无新依赖/schema/迁移，016–049 及先前 SQLite 升级未执行；仅源码和文档，未编译、类型检查、测试、调用或发布，见 docs/design/01-contracts/sync-mcp-runtime.md。

- P3/P4：新增 SqliteOutbox.reconcile 与 CLI outbox reconcile EVENT_ID（网络/嵌入），固定完整原行/身份，复用可信原事件回执，BEGIN IMMEDIATE 内重读整行/租约后结算 sent/conflict。未观察到、超时、缺身份/摘要损坏、活跃发送、并发变化或已有证据冲突均不覆盖；原命令、键、trace、attempt/next_retry_at 保留。已有库模式不建表/自动升级，回执等待不持有写事务，迟到结果不结算；默认 30 秒，清理失败不遮蔽已知提交。旧行身份追溯/绑定、自动重试门禁、MCP/Web 与真实恢复证据仍缺，flush 策略不变。无新依赖/schema/迁移，先前 SQLite 升级及 016–049 未执行；仅源码与文档，未编译、类型检查、测试、运行、打开数据库或发布，见 docs/design/01-contracts/outbox-reconciliation-runtime.md。

- P3/P4：新增 sync.event.receipt / POST /v1/sync/events/receipt，按保存的原五项身份和完整事件只读核对既有规范化指纹及历史投递。SDK getSyncEventReceipt、CLI sync receipt 网络/嵌入接入完整有界解析和默认 30 秒预算；recorded 区分原接受/冲突，not-observed 不证明失败，历史回执不证明源实体应用。身份/范围/当前来源及历史可见性、损坏/超限/不匹配均明确拒绝，不重发、不打开 SQLite 或给旧行补身份。本地显式核对结算、MCP/Web、旧消费者/Mock/fixture 与恢复运行证据仍缺。无新依赖/schema/迁移，016–049 及先前 SQLite 升级未执行；仅源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/sync-event-receipt-runtime.md。

- P3/P4：新增只读 sync.command-context / GET /v1/sync/commands/context，SDK getSyncCommandContext 与 CLI sync identity（网络/嵌入）读取可信原账号/客户端。新离线入队要求完整 expected_identity，保存账号/客户端与完整命令校验和；同键不同原事件/身份拒绝，返回深副本。claim/retry 阻止缺身份/损坏行，原数据保留；按同身份组批，Bridge 发送原身份前置条件，SDK uploadEvents 可选同一约束，Gateway 网络/直接适配核对可信身份。旧行不自动补写、不提供猜测性身份迁移；旧进程/自定义 publisher/未带身份的直接上传与 MCP 仍需迁移，真实恢复证据未有。SQLite 三个可空列仅升级源码，未打开数据库或执行升级，PostgreSQL 016–049 未执行；未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/sync-identity-runtime.md。

- P0/P3：SDK uploadEvents 接入独立有界上传实现，保留原幂等键并新增 timeout_ms/signal，默认本地 30 秒；Fetch 成功正文限 256 KiB、错误 16 KiB，完整原批次回执继续共用严格解析。固定原输入、无自动重试、错误统一文案/本次 dispatch_state，未知结果保留原事件与键。共用 RequestBudget 改为单调时钟，bounded-json 清理异常不遮蔽原错误；方法/Fetch 各自预算取先到者，自定义传输须遵守请求边界。MCP 上传、下载/ack、原身份持久绑定、旧消费者/Mock/fixture 与运行证据仍待补。无新依赖/schema/迁移，只改源码和文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/sync-upload-runtime.md。

- P3/P4：Bridge 同步发送新增固定原批次/范围/键及请求 trace、贯穿取令牌/HTTP/正文的本地等待预算（默认 30 秒、最多 90 秒）、256 KiB 有界 UTF-8 JSON 与完整回执解析。共享解析接入 SDK uploadEvents 和 SQLite 自定义 publisher 结算，核对完整事件集合、拒绝形状、唯一持久事件/游标、范围/来源/trace；传输未知或畸形回执不标为 sent。CLI sync flush 传递 trace，既有退避/五次上限及每次 claim 批次键策略保留；原事件不因未知结果被删除。原 actor/client 持久绑定、旧 SDK/MCP 网络边界和运行证据仍缺。无新依赖/schema/迁移，016–049 未执行；只改源码与文档，未编译、类型检查、测试、运行同步或发布，见 docs/design/01-contracts/sync-upload-runtime.md。

- P5：冲突原请求新增浏览器 IndexedDB 精确槽保存与关闭标签页后的恢复；新版准备在同一 readwrite 事务检查并分配新键/添加/读回，已有原请求恢复不改写。发送前等待事务完成，存储失败保留内存/导出/回执；旧 sessionStorage 只读兼容，显式保存才复制，异值/损坏阻止覆盖和发送。恢复页分别读取持久副本与旧标签页副本，不扫描存储；异步保存/加载忙碌保护，离开页面后不启动新的决策动作。打开/事务各 10 秒本地预算，迟到打开关闭、超时保留原键；不保证浏览器数据永久保留或跨存储/网络原子性。无新依赖/SQL 迁移，浏览器 schema 只写源码，016–049 未执行；未准备文字草稿/跨设备备份、SDK/MCP 持久适配与运行证据仍缺。仅源码与文档，未编译、类型检查、测试、运行浏览器或发布，见 docs/design/01-contracts/conflict-recovery-runtime.md。

- P4：新增 CLI conflicts prepare --json-file/--output，为明确的新冲突决定读取可信身份、生成一次键并保存完整原请求；拒绝已有键/封套与覆盖目标，通过已有文件同步/哈希读回/独占硬链接保存，再完整核对最终路径。网络/嵌入均只准备，不提交；失败保留路径与状态。conflicts receipt 网络/嵌入补齐同一原文件的有界读取和可选期限，submit 复用读取助手，避免原文件绕过专用读取；旧网络 stdin 兼容分支仍有原边界。无新依赖/迁移，016–049 未执行；SDK/MCP 持久备份、Web 关闭标签页恢复、全局草稿索引及运行证据仍缺。只修改源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-submission-runtime.md。

- P0/P3/P4/P5：新增 SDK submitConflictDecision、CLI conflicts submit --json-file/--reviewed（网络/嵌入）、MCP submit_original_conflict，固定完整原 identity/request_key/command，复用旧 resolve 路由与指纹。共享解析完整旧写响应及事件后仅返回 unconfirmed，需显式 receipt；Web 同步使用完整解析。CLI 从已保存正规文件有界读取 1 MB，拒绝临时 JSON/stdin/新键和重复选项，不修改原文件；SDK/MCP 不代替持久备份，不自动查询/重发。修复普通字符串账号进入冲突 SDK/CLI 时受旧 ULID actor 构造限制的问题，Gateway 仍完全核对原可信身份。客户端草稿准备、关闭标签页后的持久恢复、任意精度写入、旧消费者/Mock/fixture 与运行证据仍缺。无依赖/迁移，016–049 未执行；仅源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-submission-runtime.md。

- P0/P3/P4：补齐冲突身份专用客户端入口：SDK getConflictCommandContext、CLI conflicts identity（网络/嵌入）与 MCP get_conflict_command_context。固定原范围/trace，清理继承写条件，完整 16 KiB 元数据校验；SDK/CLI 支持本地期限，嵌入/MCP 与原可信身份/到期比对。CLI 拒绝正文/写键/多余和重复选项，MCP 发现与调用要求可信未过期 resolver；不读记录/回执、不生成键或替换原请求、不自动写入/重试。完整跨客户端保存/恢复流程、持久草稿、Mock/fixture 及运行证据仍缺。无依赖/迁移，016–049 未执行；只开发源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-recovery-runtime.md。

- P0/P3/P4/P5：新增 conflict.command-context / GET /v1/conflicts/commands/context，Web 决策改为显式准备并冻结完整原身份/命令/键，sessionStorage 精确槽保存与读回后才发送。独立 conflicts/recover 支持同标签页精确槽加载及有界导入，固定原请求查询/重发；不同原请求不覆盖，存储失败保留导出和查询，写响应只表示等待回执。旧事务补父项目共享锁、安全整数版本/游标和历史事件可见性/一致性检查，旧指纹不变。SDK/CLI/MCP 专用身份包装已由后续增量补齐；跨关闭标签页的持久草稿及运行证据仍缺。无迁移/依赖，016–049 未执行；仅源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-recovery-runtime.md。

- P0/P3/P4/P5：新增 conflict.receipt / POST /v1/conflicts/receipt，复用旧键/指纹及决策事件，核对原身份、有效命令、当前项目/来源和原事件可见性。recorded/not-observed 与 legacy/参数不匹配/损坏分开，结果不证明源实体已应用；SDK/CLI/MCP 和 Web 原请求导入/审阅/显式查询页已接入源码，失败保留原请求。输入 1 MB、存储元数据 16 KiB、完整成功 2 MiB，SDK/CLI/Web 有界读取；无新迁移/依赖，016–049 未执行。提交前保存与固定请求恢复由上方后续增量补充；关闭标签页后的持久草稿、Mock/fixture 及运行证据仍缺；未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-receipt-runtime.md。

- P0/P3/P4/P5：冲突目录 GET/workbench 改为默认 25、最多 100 条的元数据分页，按不可变 ID 的 C 顺序续页，游标绑定范围/可见性/筛选/页大小；单条 16 KiB、完整封套 2 MiB，超限或损坏拒绝整页。SDK/CLI/MCP/Web 直接消费者接入，网页按 ID 独立读取比较面板，页内统计、筛选/续页新标签页导航和安全版本的既有决策表单保留。新增 049 索引文件但未执行，016–049 未执行；Mock/fixture、外部兼容性、原决策恢复及运行证据仍缺。只修改源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-registry-runtime.md。

- P0/P3/P4/P5：新增 conflict.read / GET /v1/conflicts/{conflict_id}，SQL 同一语句核对范围、父项目及来源可见性，独立返回双方值和决策元数据。版本保留十进制字符串，值保留 JSON 文本，SQL NULL/JSON null 与旧决策缺失信息明确区分；完整响应限 2 MiB，超限不截断。SDK getConflict、CLI conflicts get、MCP get_conflict 与工作台独立详情/失败查找入口已接入源码，SDK/CLI/Web 有界读取及本地期限。旧列表分页、决策原请求恢复、Mock/fixture 和运行证据仍缺；无新依赖/迁移，016–048 未执行，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/conflict-read-runtime.md。

- P0/P3/P4/P5：检查点详情完整响应限 2 MiB、十条历史页限 8 MiB，SQL 输出前限制正文，历史第十一条只用于位置判断；超限明确 413，不截断笔记或返回部分页。SDK/CLI 网络与 Web 接入有界读取、默认 30 秒及有限错误；嵌入 CLI/MCP 补齐旧会话历史模式完整解析，保留原封套/权限信息。历史/详情失败保留查找、最新修订与同标签页原请求恢复入口，笔记保留空串及换行。无新 API/依赖/迁移，016–048 未执行；数据库成本、MCP 发送边界、旧消费者/fixture/Mock 及运行证据仍待补。只修改源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/checkpoint-read-runtime.md。

- P3/P5：/sessions/recover 补入 session.start/run.start/tool.call，与检查点及收尾合计覆盖七种原请求。开始按原身份槽读取，无需未知的新会话 ID；运行创建按原会话槽、工具创建按原会话/运行槽定位。保留原可选父会话/身份字段、模型、工具名/初始状态、适用版本和键，复用原动作/回执；成功后仅展示匹配历史结果，不执行模型或工具、不自动新建下一条。活动创建成功/失败接入同标签页导航。无新 API/依赖/迁移，016–048 未执行；源码和文档已接入，运行证据仍缺。未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/session-request-recovery-runtime.md。

- P3/P5：新增 /sessions/recover，覆盖检查点保存、结束会话、运行及工具收尾。只读可信身份后，明确读取精确本地槽或导入原文本，保留原笔记数组/包/结果/版本/键；固定原请求组件提供本地保存/导出、原回执和确认重试，存储冲突不覆盖，未知结果不因拒绝或未查到解除。会话查找及运行/工具详情的成功/失败均接入同标签页导航；无当前记录前置读取或自动发送。session.start/run.start/tool.call 独立恢复仍待补，无新 API/依赖/迁移，016–048 未执行；仅源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/session-request-recovery-runtime.md。

- P5：/handoffs/recover 补入领取与续接独立恢复，明确按原会话/交接 ID 读取本标签页精确保存槽，或导入有界原文本。可信身份完整匹配后固定原版本/键/检查点，复用原表单的未知状态、保存读回、确认重试及显式回执；不依赖当前详情、不扫描存储、不自动提交或换键。详情成功/失败均有同标签页入口。加载只保留内存，实际请求前沿用存储保护；存储冲突不覆盖并保留导出/查询。无新 API、依赖或迁移，016–048 未执行；检查点及其他会话命令独立恢复仍待补。仅源码与文档，未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/session-command-context-runtime.md。

- P0/P3/P4/P5/P6：新增只读 session.command-context，可信未过期客户端经原读/写/领取策略及入口审计，只返回自身身份、到期与权限提示，16 KiB 完整契约接入 SDK/CLI/MCP/Web。新增 /handoffs/recover，同标签页恢复创建原请求，不依赖目录或原记录详情，不生成键、不自动查询/重试，权限变化仍保留原数据；鉴权/审计不可用时不绕过。无新迁移/依赖，016–048 未执行；其他操作独立恢复及运行证据待补。未编译、类型检查、测试、运行或发布，见 docs/design/01-contracts/session-command-context-runtime.md。

- P0/P3/P4/P5：项目检查点目录改为默认 25、最多 100 条的文本/精确 ID 筛选分页，原会话十条历史模式保留且拒绝混用。共享完整封套校验、安全修订号、微秒游标及摘要 8 KiB 明确省略接入 SDK/CLI/MCP/Web；交接创建选择器支持独立筛选翻页，核对页面身份/范围并保留原请求恢复，未发送草稿切页重置。新增 048 索引文件，016–048 均未执行；旧消费者/fixture/Mock、历史笔记全文限制及运行证据仍待补齐。无新依赖，未编译、类型检查、测试、运行或发布；见 docs/design/01-contracts/checkpoint-registry-runtime.md。

- P0/P3/P4/P5：交接目录增加服务端文本、待处理/历史、会话 ID 和来源筛选及分页，默认 25、最多 100；微秒 updated_at/ID 游标绑定范围、受限数据能力、筛选及页大小。持久记录优先于同 ID 历史投影，摘要 8 KiB 明确省略、完整封套 2 MiB，SDK/CLI/MCP/Web 接入；工作台保留独立详情和原请求恢复。会话 handoff 资源返回基础首屏与显式工具续读；修复旧 MCP 批量注册覆盖分页定义并拒绝重复工具名。新增 047 索引文件，016–047 均未执行。检查点选择仍为全量读取，旧消费者/fixture/Mock 兼容及运行证据仍缺。无新依赖，未编译、类型检查、测试、运行或发布；见 docs/design/01-contracts/handoff-registry-runtime.md。

### 2026-11-02 开发补充（未编译、未发布、未测试）

- P0/P3/P4/P5：会话目录由全量读取/页面内筛选改为 Gateway 服务端筛选分页，默认 25、最多 100，微秒时间/ID 位置与范围/受限数据能力/筛选/页大小绑定游标。先选页再聚合该页活动，完整共享响应解析接入 SDK/CLI/MCP/Web；页面统计明确当前页、父会话与页外选择使用独立详情入口。新增 046 排序索引文件但未执行，016–046 均未执行；无新依赖，未编译、类型检查、测试、运行或发布。旧全量消费者/fixture/Mock 兼容、SQL 性能与运行证据仍缺。

- P0/P4/P6：补齐管理快照 SDK getAdminSnapshot、CLI admin snapshot 与 MCP get_admin_snapshot 源码。固定范围/trace、完整封套与有限错误；可信嵌入核对管理员、有效期、实际能力及返回计数状态。SDK/CLI 复用有界传输与等待，MCP 两路准备/30 秒期限，超时保留在途名额；不自动重试、保存或探测。外部服务及发布仍未检查，Mock/fixture/兼容及运行证据待补；无新依赖/迁移，未编译、类型检查、测试、执行示例、运行或发布。

- P4/P5/P6：管理页改用严格校验的项目查询快照，实际数据库版本/读取时刻/权限内计数取代硬编码健康、功能开关和发布清单。admin 入口要求可信有效会话及实际 admin.read，审计/上下文计数独立按实际能力及分类过滤，缺权限明确不可读。Web 成功/错误 16 KiB、30 秒等待及 scope/trace/来源绑定，导出视图模型同步；外部服务及发布状态均未检查。旧响应/fixture 需同步迁移，专用 SDK/CLI/MCP 与实际探测仍缺；无新依赖/迁移，未编译、类型检查、测试、SQL/HTTP 调用、运行或发布。

- P4/P5/P6：补齐审计 session_id 精确筛选、共享返回校验与分页绑定，SDK/CLI/MCP 复用；工作台增加会话审计与状态跳转。Gateway 明确会话目标操作的入口审计填入既有会话列，默认 PostgreSQL sink 补齐该列写入，allowed/denied 仍只代表入口决定。历史未关联记录不回填，不推断新建/认领结果，会话筛选查询自身不关联为会话操作；无新依赖/迁移，未编译、类型检查、测试、实际查询、运行或发布。全流程操作结果关联及运行证据仍待补齐。

- P4/P6：MCP 新增 list_audit_records/get_audit_record/export_audit_record，可信有效会话及实际审计能力约束发现/调用；单条读取附带当前视图摘要，显式提交原选择与审阅声明后，复用 Gateway 双重读取、分类授权和持久放行，独立摘要核验再返回完整 JSON。两路准备容量与读取/导出截止时间、完整对象及二次转义大小限制已加入源码；容量不覆盖 HTTP 发送。无自动保存/翻页/重试，放行不代表交付。全量原文、稳定快照、恢复、协议兼容及运行证据仍缺；无新依赖/迁移，未编译、类型检查、测试、实际调用、运行或发布。

- P4/P6：CLI 新增 audit list/get/export，网络与可信嵌入均使用 SDK 有界读取及完整解析。导出必须提供已审阅的单条读取封套文件、--reviewed 和新输出路径；原项目/记录/摘要固定，Gateway 放行后独占临时写入、同步/读回并硬链接创建文件，不覆盖目标。区分 document 与实际文件摘要、本地 saved 与远端交付未确认，失败保留放行及临时文件状态，无自动翻页、替换、重试或 outbox。MCP、全量原文/稳定快照、恢复及运行证据仍缺；无依赖/迁移变更，未编译、类型检查、测试、实际调用/保存、运行或发布。

- P0/P6：SDK 新增审计精确筛选分页读取和按已审阅 document 导出，固定范围/内容、完整封套和独立摘要核验。新增 bounded-json 传输，列表/导出成功分别限 16 MiB/128 KiB、错误限 16 KiB，支持凭据/网络/正文等待取消与截止时间；迟到结果不返回成功，错误保留有限说明及已确认放行。调用方显式翻页/保存，无自动重试。CLI/MCP 导出、Mock、全量原文/稳定快照及运行证据仍缺；无新依赖/迁移，未编译、类型检查、测试、实际调用、运行或发布。

- P4/P5/P6：单条审计视图导出已有源码，固定审阅范围/记录/SHA-256，两次读取和本地/OPA 分类授权，持久 release 确认后返回 JSON 封套；持久审计详情继续按分类脱敏。工作台同源代理双端核验，准备与浏览器保存分开，省略字段不补取；取消/切换清理内存副本，不冒充客户端保存完成。补齐实际能力、4 KiB 输入/128 KiB 响应和有界准备等待。批量/原文导出、稳定快照、恢复与运行证据仍缺。无新依赖/迁移，未编译、类型检查、测试、实际导出、运行或发布，详见 docs/design/01-contracts/audit-export-runtime.md。

- P4/P5/P6：审计读取补入 SQL 分页后的元数据/详情/来源大小限制及明确省略状态，原审计不改写；共享契约限制单记录和全页，Web 独立限成功正文 16 MiB、错误 16 KiB并覆盖一次 30 秒期限。页面区分超限未包含与原空值，不显示部分结果或回显上游原始错误。有限读取已有源码，治理导出/稳定快照/审计补偿及运行证据仍缺。无新依赖/迁移，未编译、类型检查、测试、实际查询、运行或发布。

- P4/P5/P6：审计历史加入每页 200 条的键集翻页，位置绑定项目/可见性/原筛选，保留微秒时间并以审计 ID 区分同刻记录。完整响应检查排序、边界、下一页与末条一致性，页面保留筛选继续查看更早记录或显式返回首屏，错误不自动换页。游标不充当凭据或冻结快照，字段/传输限额已有后续源码，稳定导出、审计补偿仍待开发。无新依赖/迁移，仅源码与文档，未编译、类型检查、测试、实际查询、运行或发布。

- P4/P5/P6：审计页补入资源/完整追踪号/动作/审计 ID 精确交集查询、关联审计跳转与明确截断提示。Gateway/Web 共用范围/trace/记录/筛选校验；200 条结果数量不冒充总计，读取失败和无可见匹配分开，失效选择不换记录。来源 URI 仅文本，保留 audit.read/restricted 过滤，清理未接入的导出/脱敏/复制按钮。普通翻页及字段/传输限额已有后续源码，审计导出仍待开发。无新依赖/迁移，仅源码与文档，未编译、类型检查、测试、实际查询、运行或发布。

- P2/P4/P6：补入下载处理阶段失败与 HTTP/MCP 发送终态观察审计，区分存储读取、内容核验、发送结束/断开/错误/超时；已有 release 审计保持强制。补充记录最多 8 笔在途、等待 5 秒，不掩盖原错误，不含正文或存储地址；关联已确认 release，不声明客户端保存。outbox/丢失补偿、客户端回执及运行证据仍缺。无新依赖/迁移，只改源码和文档，未编译、类型检查、测试、运行或发布。

- P2/P5：工作台新增 /artifacts/upload/new 新请求准备，可信身份来自新只读 upload-context；一次会话读取身份及追加目标当前元数据，固定原版本。新建编辑名称/类型/分类/来源，文件按服务器上限及 64 MiB 有界读取/hash；明确准备时仅生成一次原键，JSON 与已核对 Blob 同页交给保存/确认/上传/原地回执流程。原请求导入和未知恢复不生成键，不自动更新版本或发送。无新依赖/迁移，仅源码/文档，未编译、类型检查、测试、实际上传、浏览器/服务运行或发布。

- P2/P5：工作台新增 /artifacts/upload，导入保存的原请求、审阅并选择最多 64 MiB 文件，浏览器核对长度/hash 后明确提交。同源代理先会话后有界 multipart，独立核对范围/内容，复用原 Gateway 写能力/键/版本和持久回执；两路容量、超时/取消、完整响应双端校验。未知结果保留原请求并提供原地回执查询，阻止本页重复发送；临时内容结束/离开释放，无自动重试或浏览器存储。新请求可视化准备仍待开发。无新依赖/迁移，仅源码/文档，未编译、类型检查、测试、实际上传、浏览器/服务运行或发布。

- P2/P4：MCP 新增 create_artifact/put_artifact_version，保存的原身份/命令与最多 4 MiB 规范 Base64 内容绑定，派发前核对长度/SHA-256，复用持久上传与完整原回执校验。HTTP 鉴权前置，普通 1 MiB/上传扩展 8 MiB，声明或实际越界前申请共享两路容量，120 秒有界读取；小型未知长度查询不受上传容量或 writer 配置影响。未知结果保留原键/版本并显式查回执，不自动重试。无新依赖/迁移，仅源码/文档，未编译、类型检查、测试、实际上传、运行或发布。

- P2/P5：工作台文件详情新增固定版本获取与独立保存，双端校验内容、最大 64 MiB；同源 POST 代理绑定页面范围和单次会话，经原 Gateway 读/导出策略与持久审计，有界请求/正文、两路容量、超时和取消。页面保留原选择，区分内容已校验、已请求保存及放行审计，丢弃/卸载/页面离开清理临时副本，不自动重试或声称本地保存成功。无新依赖/迁移，仅源码/文档，未编译、类型检查、测试、浏览器/服务运行、实际下载/保存或发布。

- P2/P4：MCP 新增 download_artifact_version，要求明确版本/hash/size 和可信 reader/有效会话，复用原导出策略及持久 release 审计；校验完整封套/SHA-256 后返回摘要与最多 4 MiB 内嵌 blob。HTTP MCP 共用下载容量到响应结束，发送期限 60 秒，嵌入按 gateway 实例限流。资源 URN 不是访问凭据，不枚举内容、不自动重试或写客户端文件。无新依赖/迁移，仅源码/文档，协议兼容性仍待核对，未编译、类型检查、测试、实际下载、运行或发布。

- P2/P4：CLI 新增 artifacts download，网络/嵌入固定历史版本和显式输出；有界读取元数据/正文，校验 hash/size/trace/审计，独占临时写入、同步/读回和硬链接不覆盖保存。区分服务端放行、本地保存、清理待处理及未知结果，不重试。抽取上传共用文件读取及交付封套；新增 SDK workspace 依赖/锁文件链接，未安装，无新迁移。仅源码/文档，未编译、类型检查、测试、实际下载/保存样本、运行或发布。

- P2/P4/P6：新增固定版本文件内容 GET 和 SDK downloadArtifactVersion，绑定版本/hash/size，读取前后检查当前/历史可见性及分类导出权限；Gateway 与 SDK 核验字节，持久 release 审计确认后发送，分类/策略拒绝另记 denied。默认 64 MiB、每实例两路下载，二进制附件不含存储地址或当前 ETag；不自动重试/降级，审计不冒充客户端交付证明。无新依赖/迁移，未编译、类型检查、测试、下载实际内容、运行或发布。

- P2/P4：CLI 新增 artifacts create/put-version，显式读取保存的原请求 JSON 和内容文件，在发送前检查普通文件、大小、读取变化及 SHA-256；网络 multipart 与嵌入 writer 共用原身份/键/版本及完整响应校验。默认 64 MiB 本地上限，支持显式上限与 HTTP 超时；未知结果保留原请求并提示查询回执，不自动重试、改写文件或建 outbox。无新依赖/迁移，未编译、类型检查、测试、执行上传、运行或发布。

- P2/P4：新增 Artifact 创建/追加版本 HTTP multipart 上传及 SDK createArtifact/putArtifactVersion，认证后有界读取，默认 64 MiB、每实例两路、正文读取期限 120 秒；绑定原身份/命令/键/版本并复用持久写事务。共享封套区分首次保存内容校验和回执重放，不返回当前写用外层 ETag；未知结果保留原请求，SDK 不自动重试。无新依赖/迁移，016–045 未执行；只改源码及文档，未编译、类型检查、测试、运行或发布。

- P2/P5：新增工作台 /artifacts/receipt 原回执查询，导入/粘贴有界原 identity/command 后先审阅，显式查询绑定可信身份；动作及浏览器校验完整响应。未知/权限/存储错误保留原请求，成功仅展示原历史结果，提供原 JSON 导出及元数据新标签页入口；无浏览器存储、自动重试或文件正文操作。无新 API/依赖/迁移，未编译、类型检查、测试、浏览器/服务运行或发布。

- P2/P4：Artifact 回执接入 CLI artifacts receipt 和 MCP get_artifact_receipt，复用完整原身份/命令及响应校验；MCP 发现和调用必须具备已验证客户端与实际 artifact.write。拒绝外层写字段，清除继承键/版本，原 command 不变；not-observed 不证明失败，不上传/下载、不自动重试或保存 outbox。工作台回执入口仍待开发，无新依赖/迁移，未编译、类型检查、测试、运行或发布。

- P2/P4：新增 Artifact 原请求回执 POST /v1/artifacts/receipt、SDK getArtifactReceipt 及共享命令/封套解析；保留原指纹规范化，绑定令牌身份、原参数/键和 artifact.write。回执只返回原历史公开快照，不读正文、不带当前写用 ETag；未观察到仍为未知，追加目标不可见不伪装成缺回执。显式 reader 或存储配置接入，CLI/MCP/Web 回执入口待开发。无新依赖或迁移，未编译、类型检查、测试、运行或发布。

- P2/P5：工作台新增 Files & artifacts 及 /artifacts 当前/指定历史元数据查询；严格 URL 参数与响应绑定，展示分类、大小、版本、时间、来源和可展开记录详情。缺失/受限/服务错误保留查询入口，历史失败不降级，正文状态明确为未检查。仅放行新页面源码的忽略规则，无新 API、依赖或迁移；未编译、类型检查、测试、浏览器/服务运行或发布。

- P2/P4：Artifact 元数据读取接入 CLI artifacts get/version 和 MCP get_artifact/get_artifact_version；复用共享响应校验，拒绝身份/写字段覆盖，清除继承写条件。MCP 目录要求实际 artifact.read；历史读取不降级、不下载、不确认原回执。无新迁移或依赖，未编译、类型检查、测试、运行或发布。

- P2/P4：新增 Artifact 当前/指定历史元数据 GET、SDK 方法与共享响应校验；令牌身份、artifact.read、项目/历史分类可见性绑定，移除公开存储键，正文状态固定 not-checked。服务器支持显式 reader 或存储配置，未配置返回 503；历史缺快照返回 409，不返回当前写用 HTTP ETag。无写/下载路由、无新迁移，未编译、类型检查、测试、运行或发布。

- P2：新增 S3 对象适配与双适配组合工厂源码，包含 SigV4、不可覆盖条件 PUT、按字节有界 GET、凭据/传输超时及错误脱敏；对象缺失与权限/缺桶错误分开。无新依赖或迁移，未连接业务存储、编译、类型检查、测试或发布；官方文档检索未返回可读内容，签名和 MinIO 兼容性仍待验证，服务器路由未启用。

- P2：补入复用现有 postgres 驱动的 Artifact 数据库适配器及显式组合工厂，同连接 READ COMMITTED 事务确认提交后返回；设置事务本地 SQL/锁/空闲超时，拒绝事务结束后调用并复制值参数。Gateway 增加 workspace 依赖及包导出，未接入启动流程或公开路由；S3/MinIO 与审计仍待开发。无新增迁移，未安装依赖、编译、类型检查、测试、联网、运行或发布。

- P2：新增独立 Artifact 持久化服务基础，注入数据库与不可变对象端口，元数据/版本快照/原身份请求回执同事务；支持历史读取、正文 hash 核对和追加式内容恢复，拒绝缺少可信快照的旧版本。补强 Buffer 副本与版本保存时间校验。045 仅写迁移，016–045 均未执行；真实存储适配、Gateway/客户端、审计下载、事件和清理仍待开发。仅源码与文档，未编译、类型检查、测试、联网、运行或发布。

- P3/P4：检查点历史分页新增公共 GET、SDK listSessionCheckpoints、CLI checkpoints history 和 MCP list_session_checkpoints。复用工作台已有同语句可见性/分页读取，公共封套校验范围、会话、原笔记、顺序和游标；只读入口清除继承写条件，不自动翻页或恢复命令。无新迁移，016–044 未执行；仅源码和文档，未编译、类型检查、测试、网络调用、运行或发布。

- P3/P5：新增独立检查点历史页及共享分页解析，历史查询同语句核对可见父会话与最多 11 条记录；不可见/缺失会话不再伪装为空列表。严格校验修订顺序、游标、原笔记、会话归属和包引用，响应附可信权限提示；状态/详情/注册表导航接入，旧内嵌历史保留，错误局部显示。无新增 HTTP 路由、写事务或迁移；仅源码和文档，未编译、类型检查、测试、运行或发布。

- P3/P5：新增按会话 ID 读取的独立状态与恢复页，复用单会话 GET 与现有检查点保存/结束会话恢复表单，不依赖注册表全量读取。注册表正常/错误页提供直达输入，创建/续接成功及交接/检查点/活动详情接入；页面快照与表单读取、原回执分开说明。原身份/版本/键及恢复格式不变，无 API、事务或迁移变更；仅源码和文档，未编译、类型检查、测试、运行或发布。

- P5/P3：概览和交接页拆分主查询与附属读取错误，预览/检查点选项失败保留其余内容和可信身份下的创建恢复入口；检查点选项、审计行结构异常进入局部错误。交接计数改用正式汇总，审计明确为预览条数；新增按 ID 打开交接和定向准备入口，队列失败仍可导航。无 API、事务或迁移变更；仅源码和文档，未编译、类型检查、测试、运行服务或发布。

- P5/P3：交接独立详情新增原地读取与领取/续接衔接，保留挂载的原请求恢复和回执状态；刷新绑定原身份与关联记录、拒绝版本倒退，失败保留上次快照。页面内读取/命令/回执互斥，旧确认随状态与读取轮次失效；写后显式刷新再操作，未知请求原版本/键不变。无 API、事务或迁移变更，未编译、类型检查、测试、浏览器/服务运行或发布。

- P3/P4/P5：新增单条交接当前状态读取，HTTP/SDK getHandoff/CLI handoffs get/MCP get_session_handoff 和工作台独立详情页接入；同语句核对持久交接、检查点、父会话及项目可见性。复用领取/续接恢复表单，成功结果和来源可直达，不依赖看板列表；旧领取缺失账号不补造归属，当前状态不确认原请求。无新迁移，016–044 未执行；未编译、类型检查、测试、运行服务或发布。

- P5/P3：新增按会话/检查点 ID 准备交接的独立页面，使用当前会话可信身份读取指定历史修订，移除定向准备对全量列表和其他看板查询的依赖；会话、历史、保存结果和详情入口接入。原恢复请求优先，检查点读取失败保留恢复表单，实际选择/原请求可新标签页查看。打开页面不自动写入，现有创建回执和恢复格式保留；无新增迁移，未编译、类型检查、测试、运行服务或发布。

- P3/P4/P5：新增按会话/检查点 ID 读取历史详情的只读接口、SDK getSessionCheckpoint、CLI checkpoints get、MCP get_session_checkpoint 和工作台独立详情页。保存/历史/交接/续接结果可新标签页直达，展示原六类笔记、引用和保存时间；项目权限同语句过滤，不用最新记录代替目标，不确认原请求或包当前有效。无新迁移，016–044 未执行；未编译、类型检查、测试、浏览器/服务运行或发布。

- P3/P4/P5：续接保存/回执新增共享原身份、父会话、交接、领取要求、原键及可选预期检查点绑定，SDK/CLI/MCP/Web 接入。完整响应核对父子关系、来源、检查点和上下文包，允许子会话状态/版本推进，历史回执不代表包当前有效；工作台保留原固定键和恢复格式。MCP/嵌入调用拒绝静默改变工作台领取要求。无新迁移，016–044 未执行；未编译、类型检查、测试、网络请求、运行服务或发布。

- P3/P4/P5：检查点保存/回执新增共享原身份绑定和完整响应解析，SDK createCheckpoint/getCheckpointReceipt、CLI 网络/嵌入、MCP 和 Web 接入。保留原六类数组、包/记忆引用、版本、键及历史额外字段；正常保存核对原笔记、来源及引用，查询不继承写条件、不宣称包当前有效。Web 保留原恢复格式和未知状态，无新增迁移，016–044 未执行；未编译、类型检查、测试、网络请求、启动服务或发布。

- P3/P4/P5：新增单会话当前状态 GET /v1/sessions/{session_id}，SDK getSessionState、CLI sessions get、MCP get_session_state 和工作台读取统一接入。当前状态/版本/结束时间及 scope/trace/来源/可信身份提示共享校验，读取受父项目可见性与 context.read 限制，不走写入缓存、不重写未知请求。更新文档和追踪，无新增迁移，016–044 仍未执行；未编译、类型检查、测试、运行服务或发布。

- P3/P4/P5：运行收尾、工具收尾和结束会话的 SDK/CLI/MCP/Web 入口统一原身份绑定和完整成功响应解析；保留双版本/单版本及 delta=0 的无变化终态，结束记录创建者与操作者分开校验。未知结果不自动改键/版本，Web 明确保留损坏回执的未知状态。文档与追踪已更新，无新迁移，016–044 仍未执行；未编译、类型检查、测试、网络请求、运行服务或发布。

- P3/P4/P5：运行/工具创建与通用进度回执新增共享身份绑定和封套校验，SDK startAgentRun/recordToolCall/getSessionCommandReceipt、CLI 网络/嵌入入口及 MCP 对应工具接入，Web 复用。保留原参数/版本/键，查询清除继承写条件并校验原身份；当前记录不代替原回执。更新用法和需求追踪，无新增迁移，016–044 仍未执行；未编译、类型检查、测试、网络请求、服务运行或发布。

- P3/P5：工作台新增开始运行和记录工具调用的独立创建页，接入原身份/版本/参数/键绑定、发送前保存读回、重载恢复、导入导出、原回执查询与明确重试。未知结果不随状态/权限变化解除，新草稿须显式读取并审阅当前状态；正常成功响应和查询封套核对来源及原版本。无新增迁移，016–044 未执行；仅源码与文档修改，未编译、类型检查、测试、启动服务或发布。详见 `docs/design/01-contracts/session-activity-runtime.md`。

- P3/P5：会话活动详情/分页及进度、检查点、续接回执补入父项目删除/分类/restricted 权限过滤；活动分页改为同语句读取父会话、运行筛选与有限明细。持久进度、检查点和旧领取/续接写入先锁可见项目，检查点持久重试不再提前命中内存成功；续接及旧领取拒绝自报其他身份。不可见父会话返回错误，不能当作空页或未观察到原成功。无新迁移，016–044 保持未执行；仅源码和文档开发，未编译、类型检查、测试、服务运行或发布。详见 `docs/design/01-contracts/session-project-access-runtime.md`。

- P3/P4：SDK startSession 增加原身份与成功回执校验、新增 getSessionStartReceipt；CLI sessions start/新 sessions start-receipt、MCP start_session/新只读 get_session_start_receipt 接入同一共享解析。保留原可选父会话/账号/客户端及键，查询不继承写入条件，不自动改键或重提，not-observed 不证明失败。已更新用法与追踪，无新迁移，016–044 仍未执行；未编译、类型检查、测试、网络调用、服务运行或发布。

- P3/P5：普通会话开始改为已验证身份、创建与最小开始回执同事务保存，新增 `/v1/sessions/start/receipt` 只读查询；旧原键无回执不补认或重建。工作台开始前保存/读回原身份、正文和键，支持重载、导出/导入、明确查回执和原键重试；仅确认成功后显式准备下一次会话。044 仅写迁移文件，016–044 均未执行；未编译、类型检查、测试、启动服务或发布。SDK/CLI/MCP 的专用开始回执适配待继续开发，见 `docs/design/01-contracts/session-start-runtime.md`。

- P3/P4/P5：SDK 新增 getHandoffCreateReceipt，createHandoff 固定原身份并校验持久创建回执；CLI handoff/新 handoff receipt、MCP create_handoff/新只读 get_handoff_create_receipt 接入同一原请求绑定和响应解析，Web 同步复用。保留原父会话/检查点/目标/键及可选发送者，不自动重提，not-observed 不证明失败。更新用法和追踪，无新迁移，016–043 保持未执行；未编译、类型检查、测试、启动服务或发布。

- P3/P4/P5：创建交接与账号绑定的最小回执同事务保存，新增只读 handoff/receipt；旧 client/原键记录没有当前账号回执时拒绝补认，避免创建重复交接。工作台创建前保存并读回原身份/会话/检查点/目标/键，响应未知后固定请求，支持重载和有界导出/导入，权限或列表变化仍保留恢复入口。043 只写文件，016–043 均未执行；未编译、类型检查、测试、服务运行或发布。SDK/CLI/MCP 专门创建回执适配仍待补齐，见 `docs/design/01-contracts/handoff-create-runtime.md`。

- P3/P4：SDK 新增 getHandoffClaimReceipt，并为 claimHandoff 增加原身份前置条件和完整持久回执校验；CLI 新增 handoff claim-receipt，网络/嵌入入口共用原请求适配与解析；MCP 新增只读 get_handoff_claim_receipt，accept_handoff 同样要求原 expected_identity。核对身份/范围/原版本/键和成功归属，未查到不代表失败，不自动换键或重提。未新增迁移，016–042 仍未执行，未编译、类型检查、测试、服务运行或发布；创建交接恢复仍待开发。

- P3/P4/P5：带键交接领取新增原版本/身份/参数绑定的持久成功回执，领取更新与回执同事务，重试先读原回执、缓存只发布当前交接；旧无回执归属不补认成功。新增只读 claim/receipt，session.write 或 handoff.claim 可查询本人原请求，父项目不可读则拒绝。工作台领取新增提交前持久化、重载恢复、导出/导入和原键查询，结果未知不因 claimed 状态或版本冲突解除。042 只写文件，016–042 均未执行；未编译、类型检查、测试、服务运行或发布。SDK/CLI/MCP 专门回执入口及创建交接恢复待继续开发，见 `docs/design/01-contracts/handoff-claim-runtime.md`。

- P3/P4/P5：交接续接新增同标签页原请求恢复与有界导出/导入，沿用固定续接键并绑定原身份、父会话、交接和检查点；提交前保存并读回，存储失败不发写入。重载/导入取消确认、不自动发送，未知结果跨响应丢失、包失效、权限/领取变化保留；历史回执不证明上下文当前有效。恢复入口保留到交接仍可读取的页面，查询/重试仍受服务端授权。创建和领取交接表单尚未接入。无新迁移，未编译、类型检查、测试、服务运行或发布，见 `docs/design/01-contracts/checkpoint-context-runtime.md`。

- P3/P4/P5：检查点保存新增原请求同标签页恢复与有界 JSON 导出/导入，提交前保留原六类笔记数组、包 ID、会话版本、键和身份；恢复不重新规范化笔记、不信任缓存成功、不自动发送。保存前存储失败阻止写入，丢失操作响应/408/键冲突等保留未知；原地状态读取及权限/终态变化不清除请求，确认成功并刷新活动会话后才能准备下一份。未发送笔记只保存在当前页，导出明确含笔记。无新增迁移，未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/checkpoint-context-runtime.md`。

- P3/P4/P5：会话结束复用原请求恢复/导出/导入，单独保存原会话版本、结束状态、键和身份，不补造运行或工具字段。增加 workbench.query 的 session 单条状态读取及结束表单原地刷新，按项目可见性过滤，刷新/终态不解除未知结果；页面按原身份和会话固定。旧运行/工具恢复格式保留，无新增迁移，未编译、类型检查、测试、启动服务或发布；检查点等表单恢复仍待开发。

- P3/P4/P5：运行/工具收尾新增同标签页原请求恢复与有界 JSON 导出/导入，发送前保存原键/两个版本/结果/身份并读回，保存失败不发送写请求。重载/导入后按未知处理并撤销确认，不自动重试；终态和当前读取不解除未知状态。详情返回已验证客户端身份，收尾/回执/刷新绑定原账号、客户端和项目，损坏或不同请求不得覆盖。只开发源码与文档，无新增迁移，未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/session-activity-runtime.md`；会话结束等其他表单仍未补持久恢复。

- P1-01/P4：补齐 getWorkItem/getWorkItemResult 与项目/工作项 IfChanged 条件读取，返回明确的 not_modified 分支；304 无正文，只接受显式条件 GET，核对响应 ETag 的唯一性、格式及弱匹配，缺失时不补造。读取供调用方查看当前状态，不证明某次未知写入成功、不生成观察事件。原生路由与条件请求兼容性仍未验证；无新增迁移，未编译、类型检查、测试、连接 Plane、启动服务或发布，见 `docs/design/01-contracts/plane-rest-transport-runtime.md`。

- P1/P2/P4/P5：观察目录增加 query 字面包含检索，覆盖当前标题摘要及 external/aggregate ID，ASCII 字母忽略大小写；删除行只匹配 ID，不查询历史正文。SQL 先按权限与检索条件过滤再分页，共享解析器复核匹配，游标 v2 绑定检索词。工作台从目录进入详情、切换上下文和返回时保留合法筛选/游标；SDK/CLI/MCP 复用契约。无新迁移，未编译、类型检查、测试、启动服务或发布。

- P1-01/P4：补入 FetchPlaneTransport 与 createFetchPlaneClient，单 origin 路径/请求校验、超时取消、流式响应限额、资源 ID 与分页校验；GET 有界退避并尊重 Retry-After，POST/PATCH 不自动重试且保留写入 unknown/not_sent。旧数据方法保留，新增 Result 方法暴露原始 ETag/状态/trace；未接入网关写入，也未验证原生 Plane 路由/鉴权/幂等。无新增迁移，未编译、类型检查、测试、连接 Plane、启动服务或发布，见 `docs/design/01-contracts/plane-rest-transport-runtime.md`。

- P1/P2/P4/P5：新增当前 Plane 工作项观察目录，HTTP/SDK/CLI/MCP/Web 支持 active/deleted/all 筛选和按 external_id 的有界游标分页；单 SQL 按当前项目、事件/快照/索引完整性与权限过滤后取页。只返回限长元数据，删除行不含旧标题/状态；游标绑定范围/身份/筛选/页大小，空页不证明同步完成。041 排序索引仅写文件，016–041 均未执行；未编译、类型检查、测试、启动服务或发布。

- P1/P2/P4/P5：新增 WorkItemRestored Canonical 契约，causation_id 与 restored_from 绑定确切删除事件和紧邻版本；缺口等待，无基线不能引导恢复。事务核对删除快照与未过期删除索引，清除标记但保留分类/到期；缺失或不一致拒绝，不补造记录。恢复状态为内层 v1 并带来源，后续普通更新移除顶层来源；SDK/CLI/MCP/Web 解析、界面与队列版本诊断同步。无新迁移，仍依赖未执行的 040；原生恢复映射和外部副本恢复未实现，未编译、类型检查、测试、启动服务或发布。

- P1/P2/P4/P5：新增 WorkItemDeleted Canonical 契约、持久删除快照和同版本索引停用；沿用事务/顺序/别名保护，普通更新不能复活记录。state 返回内层 v2 删除标记，context 对可读删除状态返回 410 并停止记忆召回；SDK/CLI/MCP/Web 共用解析，队列诊断支持 deleted_stream。040 迁移仅写文件、016–040 均未执行；原生删除映射、项目删除/恢复和外部副本清理仍待开发，未编译、类型检查、测试、启动服务或发布。

- P1/P4/P5：新增只读版本诊断 HTTP/SDK/CLI/MCP/Web，单快照核对实际最新已提交流的可读基线、下一版本和有界候选回执；不可用基线不退化为较低可见版本，不返回隐藏版本/计数。共享解析器核对同范围/快照、版本关系和候选截断，工作台独立标签页不影响原人工重试草稿。诊断不补拉或重试，没有新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P6：新增默认关闭的 Plane 队列运行指标采集器、独立只读数据库连接及过期/失败状态；HTTP 抓取只读缓存，不将失败伪装为空队列。固定状态 gauge 与 worker 轮询状态接入 /metrics，补入积压/缺口/拒绝/采集故障等 Prometheus 规则、Compose 开关、ADR 和处置说明。全库统计限运维网络；未启用开关，未接通通知投递，无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P4/P5：队列列表新增 pending_state 到期/延后/最后记录的版本缺口筛选，HTTP、SDK、CLI、MCP 和工作台共用输入与响应约束；筛选在数据库分页之前执行并绑定续页游标。概览数量可直接进入对应待处理列表，页面保留筛选并展示计划/检查时间；每页重新判断时间，不宣称固定快照或当前缺口仍未补齐。无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P4/P5：新增当前可见队列概览 plane.inbox.summary，接入 HTTP、SDK、CLI、MCP 和工作台；同一 SQL 快照在权限过滤后汇总状态、到期/延后、版本缺口和队列时间。计数保留字符串并校验求和与时间关系，版本缺口属于 pending 子集；概览独立于列表筛选，读取失败不显示为零，零积压不等于同步完整或处理器健康。无新增迁移，016–039 仍未执行；未编译、类型检查、测试、启动服务或发布。

- P4-02/P1：MCP 新增 retry_plane_event 和 get_plane_event_retry_receipt；写工具限可信人工管理员、显式确认及原身份/键/字符串队列修订号，查询工具只读。独立适配避免套用 Proposal 数值版本，执行复用原策略/审计/事务，成功响应再按原请求校验；未查到不标为失败，也不自动重提。人工重试 HTTP/SDK/CLI/Web/MCP 源码入口现已接入，运行证据仍缺；无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P5-01/P1：工作台事件详情接入人工重试、原回执查询、原地刷新及恢复数据复制/导入；从可信详情响应固定身份，提交前保存并读回标签页恢复记录。未知结果锁定原命令/键，查询不自动重提，刷新/拒绝不清除不确定状态；重新准备需已知结果和新读取状态。网关详情增加当前身份及人工重试资格提示，实际写入仍重查策略。MCP 重试入口仍待接入；无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P4-01/P4-03：人工 Plane 重试增加 SDK retryPlaneInboxEvent/getPlaneInboxRetryReceipt 和 CLI plane-events retry/retry-receipt；保持队列修订号字符串，固定原身份、命令和键，HTTP 发送签名身份前提，内嵌 CLI 比对可信 context。两条路径复用共享回执解析，不自动换键/刷新版本/重提；not-observed 不证明失败。MCP/工作台提交控件仍待接入，无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P4-01：增加管理员人工重试 HTTP 命令和原请求回执查询，要求可信管理员/签名人工身份、队列 revision、理由与固定请求键。重新排队、持久回执和审计同事务；同键不重复调度，读取/重提重新检查可见性；后台失败回写核对 revision，防止覆盖后续重试。详情显示队列修订号，039 迁移仅写文件，016–039 均未执行。SDK/CLI/MCP 和工作台重试提交控件仍待开发；未编译、类型检查、测试、启动服务或发布。

- P4-02/P4-03：Plane 接收目录新增 SDK listPlaneInboxEvents/getPlaneInboxEvent、CLI plane-events list/get、MCP list_plane_events/get_plane_event_receipt。SDK/CLI 核对当前范围、trace、目标 ID、空来源及共享元数据契约；CLI 两条路径共用解析且拒绝 --key。MCP 目录按可信管理员过滤，调用仍经过 admin.read 和原读取策略，不新增重放或权限旁路。无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P4-01/P5-01：增加 Plane 接收队列元数据列表和独立回执 GET；要求可信管理员、admin.read，核对当前项目及事件/索引/父项目的有效分类。共享契约核对范围、状态、时间、十进制版本/次数与分页顺序；游标绑定范围/权限/筛选。Admin 新增队列、详情、错误说明与观察导航，读取失败保留查询表单；038 目录索引仅写文件、未执行。SDK/CLI/MCP 专门入口和人工重放仍待开发；未编译、类型检查、测试、启动服务或发布。

- P1/P2：Plane Webhook 改为持久 inbox 接收、投递/事件指纹绑定和数据库事务处理；增加后台退避重试、跨实例范围/aggregate/别名锁、版本缺口等待及终态冲突记录。事件、快照、索引、处理回执与处理审计同事务，不再提前更新内存；202 queued 仅表示接收已保存，无数据库则 503。037 迁移只新增文件、未执行；人工重放、补拉缺口和队列管理仍待开发。未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/plane-inbox-runtime.md`。

- P5-01：工作台新增当前项目和指定工作项的 Plane 观察页面、概览/列表/详情入口；显示观察版本、源事件时间、分类与来源，明确本地投影和观察快照的区别。上下文由用户选择后读取，显示外部记忆和降级状态，失败保留查找表单。请求路径与响应解析绑定同次会话范围及 trace，并核对来源；无新增迁移，未编译、类型检查、测试、启动服务或发布。详见 `docs/design/01-contracts/observed-state-runtime.md`。

- P0-02/P4-03：Plane 观察状态新增共享 ObservedSnapshot/ObservedWorkItemContext 契约与解析，SDK 三类读取及 CLI observed project/work-item/context 已接入；校验请求 ID、范围、trace、Plane 版本、字段及来源，工作项上下文核对本地摘要与外部 memory/restricted 命中。网关快照和连接器 ID 校验复用契约，CLI HTTP/router 两种路径共用结果校验；只读、不使用请求键。无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P1/P2/P4：旧 project.state/workitem.context 和 MCP 根工作项改为持久 Plane 观察读取，新增 workitem.state HTTP/MCP 入口；同条查询核对项目、源事件、索引可见性及版本，HTTP 强制令牌并绕过响应缓存。外部 recall 复用 restricted 权限、整批范围/结构检查和去重。Webhook 取快照显式传 scope，持久化校验事件/快照/索引一致，投影只接受更高版本；启动仅恢复支持的 Plane 观察事件。无新增迁移，写入重试队列和跨实例排序仍待开发；未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/observed-state-runtime.md`。

- P2-02/P4-02：持久 MCP 目录增补会话 checkpoint/handoff 和保存包；会话按实际记录去重，交接沿用持久记录优先。每页最多检查 8 个保存包候选，复用正常包读取授权、哈希、有效期和来源检查；跳过不可读/失效包，按最后扫描候选继续，空页有 nextCursor 时仍可续读。游标升至版本 2，旧游标须重开。补齐会话查询和包编译/读取/消费的父项目检查；036 索引仅写文件、未执行。未编译、类型检查、测试、启动服务或发布。

- P2-02/P4-02：MCP resources/list 改为数据库持久分页，枚举项目概览、未归档上下文、有效旧索引、可见建议和本地工作项；游标绑定范围/受限数据权限，增加 overview 和项目下本地 work-item 资源地址，移除通用缓存短路。补充上下文/建议/本地工作项父项目可见性过滤。035 排序索引仅写文件、未执行；保存包与会话目录增补见上文，旧 Plane 组合路径仍待统一。未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/mcp-runtime.md`。

- P2-03/P4-01/P4-02/P5-01：旧索引新增按 ID/状态/来源筛选的元数据分页目录，接入 SDK listLegacyContextIndexes、CLI index list、MCP list_context_indexes；工作台 Context 增加目录和独立详情、删除/恢复、原请求重试。表单绑定原身份/项目/版本/理由/键，未知结果保持草稿，原地刷新不替换请求。034 排序索引仅写文件、未执行；未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/legacy-context-lifecycle-runtime.md`。MCP resources/list 持久目录增补见上文，外部副本清理仍待开发。

- P2-03/P4-01/P4-02：补齐旧手工索引状态读取、软删除/恢复及 SDK/CLI/MCP 入口，按原 revision 和请求键事务化修改并保存历史元数据回执；恢复保留分类与到期，Plane 投影禁止手工修改。修复旧索引 HTTP 请求键头未读取的问题。033 回执迁移仅写文件，管理页面/外部副本清理和同步事件仍待开发；未编译、类型检查、测试或发布，见 `docs/design/01-contracts/legacy-context-lifecycle-runtime.md`。

- 旧索引重试增补：回执核对原请求全部规范化内容和允许追加的 memory 来源，检查当前版本不倒退，并以数据库时间判断到期；首次写入的外部来源槽位限制不再阻挡已保存请求重放。仅源码和文档修改，未编译、类型检查、测试或发布。

- P2-03/P4-02：旧 context.search 改为带项目/分类/删除/到期过滤的 PostgreSQL FTS，旧 MCP context 资源按 ID 即时读库；context.index 新增分类/到期、持久请求回执、严格递增版本及禁止降级，手工索引持久化前不发布缓存。032 列/索引/回执迁移仅写文件；外部记忆无分类时按 restricted 处理，capture 与本地提交仍有孤立页面风险，未宣称外部幂等闭环。未编译、类型检查、测试、启动服务或发布，见 `docs/design/01-contracts/legacy-search-runtime.md`。

- P2-03/P4-01/P5-01：新增直接读取工作项/上下文当前表的 POST /v1/search，支持全文及字面包含、范围/分类/失效状态过滤和游标分页；SDK/CLI/MCP/工作台统一搜索入口已补入源码。031 GIN 表达式索引只写文件、未执行；旧 context.search 外部记忆/命中缓存路径迁移、pgvector 和重建运维仍待开发，P2-03 不勾选。未编译、类型检查、测试、启动服务或发布，详见 `docs/design/01-contracts/project-search-runtime.md`。

- P5-01/P4-01：项目概览改为同条 SQL 的范围内汇总及有限预览，分别聚合工作项/上下文/会话/冲突，修复第一页上下文被当全量统计、结束会话混入活跃列表和置信度被称为新鲜度的问题。共享解析器核对计数与预览，接入 SDK getProjectOverview、CLI overview、MCP get_project_overview；页面补齐导航/刷新、移除无历史依据的趋势柱图。无新增迁移，未编译、类型检查、测试、启动服务或发布；见 `docs/design/01-contracts/workbench-overview-runtime.md`。

- P4-01/P5-01：工作项列表增加范围/权限/筛选绑定游标，默认 25 条、允许 1–100 条分页，保留微秒排序；共享查询及响应解析接入 SDK/CLI/MCP/Web。看板/列表保留筛选和位置、标注当前页；概览工作项统计改从数据库汇总读取，预览只显示最近更新。030 分页索引只写文件、未执行；未编译、类型检查、测试、启动服务或发布。分页非快照，原全量调用方须改用 next_cursor。

- P4-01/P5-01：新增工作项独立投影详情查询、共享字段解析和 SDK/CLI/MCP 入口；工作台详情展示本地版本、时间及来源，并修正显式选中项缺失时误显示其他任务。版本保持 BIGINT 十进制字符串，读取绕过旧响应缓存并重新检查范围与分类；不宣称 Plane 实时状态或变更已执行。无新增迁移，未编译、类型检查、测试、启动服务或发布。见 `docs/design/01-contracts/work-item-projection-runtime.md`。

- P3/P4-03/P5-01：新增单次工具调用详情 GET、SDK getSessionToolCall、CLI tool-calls get、MCP get_session_tool_call，同条查询读取工具/运行/会话并校验所属关系。工作台新增独立工具详情页及 succeeded/failed 收尾确认、原请求重试和回执查询；原地刷新不替换请求，父记录关闭不隐藏迟到结果入口，未知请求不因权限变化或终态而清除。草稿仍仅在当前页面；无新增迁移，未编译、类型检查、测试、启动服务或发布。

- P3/P4-03：新增 tool.finish 补记原工具调用 succeeded/failed，原子核对会话与工具版本并保存回执；支持已关闭运行/会话的迟到结果，保持父状态和运行版本。SDK/CLI/MCP 与只读回执查询接入，工具列表读取终态；旧 started 回执不能倒退当前工具缓存。029 操作约束迁移仅写文件、未执行；未编译、类型检查、测试、启动服务或发布。工具收尾 Web 表单尚待开发。

- P3/P4-03/P5-01：新增单次运行详情 GET、SDK getSessionRun、CLI runs get 和 MCP get_session_run；同条查询读取会话与运行版本。工作台活动列表接入独立运行详情页和 completed/failed 收尾表单，保留确认、原键、两个版本及未知结果；原地刷新读取不替换原请求，不因终态、拒绝或缺失回执解除未知状态。草稿仅保留在打开页面中；无新增迁移，现有收尾迁移仍未执行；未编译、类型检查、测试、启动服务或发布。

- P3/P4-03：新增运行收尾 run.finish，原子核对会话/运行版本，保存 completed/failed 及持久回执；已关闭会话可补记结果但不重开，不修改工具记录。SDK/CLI/MCP 和只读回执查询已接入；终态不可反向覆盖，历史启动回执不会倒退运行缓存。028 约束迁移仅写文件、未执行；未编译、类型检查、测试或发布。

- P3/P4-03/P5-01：新增会话运行/工具明细 GET 与分页，按项目范围读取、工具可按 run_id 筛选；SDK/CLI/MCP 和工作台独立明细页已接入。页面展示原始记录、版本、追踪和来源，不推断执行时间或实时状态。027 分页索引只写文件、未执行；仅代码与文档修改，未编译、类型检查、测试或发布。参见 `docs/design/01-contracts/session-activity-runtime.md`。

- P5-01/P4-03：工作台会话详情新增结束/放弃/失败入口及原请求回执查询，绑定状态、版本、确认与请求键；结果未知时保持原请求，后续认证/冲突/未查到不解除锁定，浏览器未收到服务端操作响应也保留恢复入口。详情补充版本和关闭时间；已知失败可刷新当前记录后重新确认。只保留当前页草稿，无新增迁移；未编译、类型检查、测试或发布。

- P3/P4-03：新增进度命令只读回执查询，按原身份/键/原参数查询 run.start/tool.call/end，SDK/CLI/MCP 已接入；返回历史标识与版本，未查到不视为失败，不执行原命令。修复迟到的创建响应覆盖新缓存及嵌套来源引用共享。复用 026、未执行迁移；仅源码与文档修改，未编译、类型检查、发布或测试。

- P3/P4-03：会话运行/工具调用/结束改为锁内读取当前状态、纯转换并原子写会话/明细/回执，持久化成功后才更新缓存；运行序号从数据库分配，旧版本及旧缓存不能覆盖进度。三入口要求稳定键，同键重放核对持久回执，响应新增历史 session_version。026 迁移仅写文件，未执行；未编译、发布或测试。参见 `docs/design/01-contracts/session-command-runtime.md`。

- P4-03/P5-01：子会话新增不可变 resume_origin（交接/检查点/有效领取要求），持久续接统一事务化，重放核对来源并拒绝将旧无绑定记录补认为成功。新增本人原键续接回执只读查询，SDK/CLI/MCP/工作台恢复入口及会话来源导航已接入；已保存不代表当前包有效，旧记录/未查到保持未确认。025 迁移仅写文件、未执行；未编译、发布或测试。

- P4-03/P5-01：增加检查点保存回执只读查询，按原身份/范围/键/请求指纹返回 recorded 或 not-observed，不读取旧包正文、不宣称当前有效。SDK/CLI/MCP 和工作台恢复按钮已接入；仅匹配成功回执解除未知保存状态，未查到及错误保留原草稿/键。复用已有持久回执，不新增迁移；未编译、发布或测试。子会话续接回执增补见上文。

- P2-02/P4-03/P5-01：检查点新增持久 `context_pack_id`，按原请求指纹绑定保存包；续接重查授权、哈希、到期与来源链，在同一项目锁/事务内领取交接和创建子会话。重试重新检查包，旧哈希明确标为未验证；SDK/CLI/MCP/工作台及历史入口已接入，保存结果未知时锁定草稿。024 迁移仅新增文件、未执行。参见 `docs/design/01-contracts/checkpoint-context-runtime.md`；未编译、类型检查、测试、部署或发布。

### 2026-11-01 开发补充（未编译、未发布、未测试）

- P4-03：CLI 已补充会话启动/结束、Agent Run、Tool Call、交接领取和会话/交接/检查点列表入口；检查点历史支持会话与 revision 分页。参见 `apps/workctx-cli/README.md`。
- P0-02：SDK 已补充真实 HTTP transport，以及会话、检查点、交接、同步上传/分页/确认和冲突处理方法；保留响应来源、追踪与版本信息。参见 `packages/sdk/README.md`。全量 WCP、Mock 扩展与契约验证仍未完成，不勾选原验收项。
- P4-02/05：HTTP MCP 已扩展会话、交接、同步、冲突工具和六类提示，接入参数 Schema、令牌鉴权、统一策略/审计/限流、独立 trace、资源模板与范围绑定分页；修复跨项目同名资源覆盖。实际范围和剩余接口见 `docs/design/01-contracts/mcp-runtime.md`，未运行兼容性或权限验证。
- P2-02/P4-01/P5-01：已开发 ContextPack 编译/持久化/读取、严格预算、SHA-256、来源失效检查、持久请求键及同步事件；SDK、CLI、MCP 和 Context 页面已接入。新增 016 迁移仅写入文件、尚未执行。原验收项不勾选；详见 `docs/design/01-contracts/context-pack-runtime.md`。
- P2-02/P5-01：已补充 ContextItem 新增、读取、编辑、排除和归档，接入 SDK、CLI、MCP、工作台及同步事件。写入使用持久请求回执和版本检查，编辑不保留事实确认状态。017 迁移尚未执行；自动来源摄取和运行验证仍待完成，人工确认增补见下文。参见 `docs/design/01-contracts/context-item-runtime.md`。
- P7-01：已开发持久化 Proposal 提交/分页/详情/确认/拒绝，接入 SDK、CLI、MCP 和审核页面；审核要求签名 human 身份、权限、原 revision 与理由，确认前重查本地来源。018 迁移尚未执行；真实模型生成、审核结果物化和运行验证仍未完成。参见 `docs/design/01-contracts/proposal-runtime.md`。
- P2-02/P5-01：上下文列表已增加游标分页，保留优先级/更新时间排序，默认 25、最多 100 条；SDK、CLI、MCP 和工作台同步接入。详情独立读取，编辑/归档入口移回条目详情，修复其依赖已保存包和空条目的问题。019 排序索引迁移仅写入文件，尚未执行；实时分页不提供一致性导出保证。
- P5-01/P7-01：工作台已增加 Proposal 提交表单、多个来源与 provenance 编辑，可从上下文条目带入当前来源版本；提交权限由网关能力提示控制，未知结果固定原草稿/请求键重试，成功后进入审核详情。草稿仅保留在当前页面；模型生成、审核结果物化和运行验证仍未完成。
- P2-02/P5-01：上下文已增加归档列表、归档详情与恢复命令，接入 SDK/CLI/MCP/工作台。恢复按归档版本写入事务和同步事件，保持 excluded、原分类及到期时间；旧包和旧来源不会自动重新有效。020 迁移仅写入文件，未执行；未做运行验证。
- P2-02/P5-01：上下文写入已接入事务内版本快照、来源/内容哈希、作者/客户端/事件记录；SDK/CLI/MCP/工作台可分页查看历史及单个版本。旧条目首次修改前只捕获无作者归属的 baseline，不补造更早历史；读取同时校验当前与历史可见性。021 迁移仅写入文件、未执行，未做运行验证。
- P7-01：worker 新增 SQLite 持久提交队列及 enqueue/list/get/retry/flush，真实 HTTP 提交已有草稿，固定请求键、范围和身份；支持过期租约恢复、指数退避、损坏隔离、最小回执校验和持续保留未知结果。网关增加提交身份预检及 expected actor/client 前置条件。尚未接入真实模型生成，未安装依赖、启动 worker 或运行验证。参见 `workers/intelligence/README.md`。
- P2-02/P5-01：ContextItem 新增按版本人工确认，要求签名 human、context.review 和理由，事务内保存确认版本/历史/回执/事件；检查本地来源的固定版本、确认状态、分类和到期时间。SDK/CLI/MCP/工作台已接入，编辑撤去当前确认。022 迁移仅写入文件，未执行；递归来源检查增补见下文，运行验证未完成。
- P2-02/P7-01：新增有界本地来源链检查，接入上下文详情/确认、Proposal 创建/确认/详情和持久 ContextPack 编译/读取。无效链排除入包，选中内容寿命受后代限制；包/建议保存递归依赖摘要，旧快照缺少摘要时要求重新生成。历史批准不改写，后台级联通知仍待开发；本轮无新增迁移、未运行验证。参见 `docs/design/01-contracts/context-source-runtime.md`。
- P5-01/P2-02：工作台已补充 ContextItem 多来源编辑、固定版本修复、当前/历史来源入口和来源改动撤销；仅提交修改字段，保留未动的旧正文与引用。新来源列表校验本地固定版本、自引用与冲突版本，未知结果锁定列表并用原请求重试；仅开发、未运行验证。参见 `docs/design/01-contracts/context-item-runtime.md`。
- P5-01/P7-01：工作台包保存与建议审核补齐持续保留未知结果、回执字段校验及明确失效后的新请求入口；审核修改理由/决定后重新勾选确认。保存包显示排除原因和条目修复入口，建议来源增加固定历史版本链接，避免查看来源时离开审核草稿。仅代码与文档修改，未编译、未发布、未测试。
- P2-02/P5-01：上下文活动详情补充按直接来源位置的 source_checks，提示版本差异、确认/分类要求和下游失效；仅披露可读活动来源的当前版本，隐藏来源统一不可用，未检查不视为有效。工作台显示逐条修复提示和当前/历史入口，诊断复用原遍历且不参与摘要/历史保存。无新增迁移，未编译、未发布、未测试。
- P2-02/P5-01：活动 proposed 条目为授权 human 增加 confirmation_readiness，复用已加载图进行独立严格检查并共享工作上限；确认入口依据后代确认状态、固定版本及有效到期时间开放，工作台显示提前处理提示。实际确认仍在锁内重新检查，预览不写入历史或依赖摘要。仅开发代码与文档，无编译、发布或测试。
- P7-01/P5-01：新增 Proposal 修订草稿与 derived_from 关联，工作台可从可读旧建议带入正文及固定来源，重新填写生成信息后独立提交。服务端核对原版本、新证据和分类下限，原批准不继承；最多 32 次派生，列表/审核/回执/同步沿关联链检查可见性。SDK/CLI/MCP/worker 接入，复用 JSONB、保留旧草稿规范化字段，不新增迁移；未编译、发布或测试。
- P7-01/P5-01：Proposal 列表新增按原建议 derived_from 查询直接修订，工作台提供修订/同源修订入口、筛选及保留条件的分页；共享参数解析器接入网关/SDK/CLI，MCP 扩展对应字段。查询沿用派生链权限过滤、不返回隐藏计数；023 派生索引仅写入迁移文件，未执行、未编译、未发布、未测试。
- 本次仅修改开发代码和使用说明，未运行构建、类型检查、测试、发布或部署；下方历史通过记录不代表此次改动已验证。

### 历史基线记录

- [x] 根目录 `tsc --project tsconfig.build.json`、`tsc --noEmit` 和 Prettier 检查通过。
- [x] `node tools/plan-audit.mjs` 通过，当前发现 38 个任务文件、9 个模块、28 条协接边；计划审计缺失项为空。
- [x] `node tools/run-module-tests.mjs` 通过：116 个测试通过、0 个失败、3 个跳过。
- [ ] `node tools/rc-readiness.mjs` 真实模式通过：本次审计返回 `live-services: not-ready`，`docker compose ps` 没有运行中的服务；离线模式只能返回 `simulated`。
- [ ] `apps/web-console` 独立依赖安装、类型检查、Next 构建、Lint 和浏览器测试通过；根目录配置当前排除了 `apps/web-console/src`，且根 Lint 未覆盖 `.tsx/.css`。
- [ ] 3 个跳过测试在真实依赖下运行并归档：其中包含 `SESSION_TEST_DATABASE_URL is required` 的 PostgreSQL 会话恢复测试，以及两个 P8 真实数据闭环测试。

## P0：契约、事件和开发平台

- [ ] **[P0-01][缺实现] 生成并发布 OpenAPI v1、AsyncAPI/CloudEvents v1 和 MCP schema。** 当前已有 JSON Schema，以及保存包生成/完整读取/目录/保存身份/历史回执五接口、文件目录/当前详情/版本目录/历史详情四接口、上传身份/原回执两接口、创建/追加上传两接口及指定版本下载一接口、上下文历史目录/指定版本两接口及当前/归档详情两接口的 OpenAPI 源码文件，共十八路；新增上下文实时来源检查/确认准备与归档完整 Schema；新增上下文完整历史摘要/快照/确认/分页与封套 Schema；新增下载描述/HTTP标量Schema和原始二进制响应契约；新增按操作区分的完整上传成功 Schema；新增原身份/命令/回执与上传提示完整 Schema；文件详情新增完整当前/历史封套 Schema，复用公开元数据及原目录定义；裸事件和结构化 CloudEvents 两份 AsyncAPI 消息目录各覆盖默认 38 类，提供逐类完整封套 Schema，结构化类型同时绑定外层 type 与内层 event_type，并有独立 CloudEvents 1.0 双向对象转换。完整 WCP 路径、普通事件业务 payload、实际通道/传输绑定、结构化 CloudEvents 消费者接线和独立完整 MCP schema 仍缺；SDK/Mock 从机器契约派生或核对及破坏性差异 CI 尚未闭合，也未执行工具兼容验证或发布。完成条件保持：生成物进入版本控制，SDK/Mock/契约测试从生成物校验，CI 对破坏性变更失败；当前源码增量不作为验收完成。
- [ ] **[P0-02][缺实现] 扩充 `packages/sdk` 和 Mock Server 到完整 WCP 面。** SDK 已有会话、同步、冲突、上下文、建议、资料、观察目录及审计查询/导出等源码入口；Mock Server 保留 `POST /v1/projects` 并可选配置同步身份/变化分页/当前游标/显式确认四路由，共享内存流与按原身份隔离的确认，显式配置可见集合。另已补显式来源/会话能力开启的上传及原事件回执两路由，原批次/事件重放、客户端序号、来源/版本冲突、历史回执及同流下载；不修改来源字段或推断旧种子上传账本。建议 Mock 已补身份/创建/列表/详情/确认/拒绝及原创建回执查询七路由、原请求回执与显式来源场景。上传产生的冲突已接目录/详情/身份/解决/原决定回执，显式权限与原版本/键约束并追加同流历史；资料Mock另已补上传身份/创建/追加版本/当前与历史元数据/原上传回执和固定版本二进制下载七路由，显式导出配置、摘要校验与有界模拟释放记录。工作项Mock已补workbench.query的列表/详情两操作，固定数据集、显式权限/可见集合、组合筛选和独立续页；其余公开路由尚未覆盖，客户端兼容与错误/幂等/ETag 契约证据尚未逐项闭合。完成条件仍为所有公开路由的类型化 SDK、Mock 与契约证据；当前新增源码不作为测试通过或发布完成依据。
- [ ] **[P0-03][缺实现] 接入真实 NATS JetStream 事件总线。** 当前 TypeScript 源码没有 NATS publisher/consumer，NATS 只出现在 Compose 和故障脚本中。完成条件：事件写入、消费、重放、积压指标和故障恢复均使用真实 NATS；内存路径只保留为离线 fixture。
- [ ] **[P0-04][文档漂移] 修正计划计数和追踪状态。** `plan-audit` 当前报告 `task_files=38`、`expected_task_files=37`，而 `docs/traceability/requirements-matrix.yaml` 仍为 `status: planned`。完成条件：统一 38 个任务（含 T8.4）的计数、需求状态、ReadMe 勾选项和完成审计。

## P1：Plane 连接器与工作图谱

- [ ] **[P1-01][缺实现] 补齐 Plane REST/Webhook 能力矩阵。** `apps/plane-connector/src/plane-client/client.ts` 目前只实现项目读取、工作项创建/更新和附件列表；ReadMe 还要求 states、labels、custom properties、cycles、modules、milestones、pages、comments、relations、releases 等对象。完成条件：逐项实现或明确版本化降级，并把限制同步到 `integrations/plane/compatibility.yaml` 和契约测试。
- [ ] **[P1-02][缺实现] 把 Webhook 去重、重试、死信和回放做成持久能力。** 已开发 PostgreSQL inbox/delivery ledger、后台退避、拒绝记录和人工重试及各客户端入口、版本诊断与 WorkItemDeleted 删除观察，037–040 迁移仅写文件；队列指标与积压/缺口/拒绝告警规则默认关闭，未部署或接通通知。仍缺缺失前置版本补拉、原生删除映射、项目删除与恢复、历史重建、保留清理，也缺跨实例/重启和告警触发恢复证据。完成条件：持久接收、重试/拒绝管理、人工/自动恢复和重启后不重复副作用形成完整闭环。
- [ ] **[P1-03][待外部环境] 完成真实 Plane 版本兼容和命令确认。** 在真实 Plane 固定版本上验证 API、HMAC Webhook、重复/乱序/迟到事件、权限传播和“Plane 成功响应/事件后才进入 observed”的状态转换，并归档事件 ID、revision、source_refs。

## P2：上下文、文件、记忆与检索

- [ ] **[P2-01][缺实现] 将 ArtifactService 接入 PostgreSQL + S3/MinIO。** 已有持久服务、版本快照/原回执事务、PostgreSQL/S3 适配器、显式服务器配置，及 HTTP/SDK/CLI/MCP/工作台按原请求上传、可审计下载、元数据/原回执查询、工作台新请求准备和下载失败/服务端发送观察源码；旧内存类保留兼容。003/045 描述持久表，045 未执行；S3 签名/条件写入与 MinIO 兼容性未验证，观察审计 outbox/丢失补偿、客户端收取/保存回执、事件、旧数据升级和清理仍缺失。详见 `docs/design/01-contracts/artifact-persistence-runtime.md`。完成条件仍为真实持久存储、可审计下载和重启/恢复证据；源码阶段不认定完成。
- [ ] **[P2-02][缺实现] 完善 ContextItem/ContextPack 持久化及 WCP/MCP 读取面。** 已开发条目录入/编辑/归档/恢复/人工确认、版本历史、持久包、参数化资源、持久 MCP 目录及使用时递归来源检查，旧 Plane 读取已改持久路径；仍缺自动来源摄取、后台级联通知及恢复/权限运行证据。完成条件：ContextPack hash、预算、来源、过期和 exclusions 可恢复，`resources/list/read` 按 scope 返回。
- [ ] **[P2-03][缺实现] 用 PostgreSQL FTS 和可选 pgvector 替换进程内搜索。** 已新增 `/v1/search` 当前表检索及旧 context.search 数据库检索，031/032 索引和分类/回执迁移仅写文件；尚缺依赖来源级联失效、外部记忆补偿、embedding、pgvector、重建运维与运行证据。完成条件：FTS 默认可用，pgvector 受 Feature Flag 控制，索引重建、来源/版本过滤和性能基线可重复。
- [ ] **[P2-04][待外部环境] 完成 ai-memory 全操作闭环。** 已有 Streamable HTTP/MCP Adapter 和本地探针，但需在固定版本服务上验证 capture、recall、consolidate、read、handoff、claim、restore、备份/恢复及 `MEMORY_REQUIRED` fail-closed 行为，并把页面 revision/hash 与 ContextPack 关联。

## P3：会话、同步、离线与冲突

- [ ] **[P3-01][缺实现] 完善 SyncService/ConflictService 的 Gateway 闭环。** `/v1/events:batch`、`GET /v1/sync/changes`、`POST /v1/sync/ack`、冲突列表及解决路由已有持久源码接入；冲突完整详情、元数据分页、保存原请求的只读回执已衔接 SDK/CLI/MCP/Web。Web 提交前身份/完整原请求保存、IndexedDB 关闭标签页后恢复、旧标签页精确槽兼容及固定请求重发已有源码，CLI 已有原请求文件准备/提交/回执；原写事务增加父项目锁、安全版本和历史事件检查。同步 Bridge 与 SDK uploadEvents 已补有界发送/本地期限，共享完整回执接入 SDK/SQLite；新队列原身份持久绑定、可信身份读取及发送前置条件已有源码，缺身份旧行保留阻止发送。原同步身份/事件回执查询已衔接 Gateway/SDK/CLI/MCP；独立 outbox reconcile 已补指定完整原行的显式核对/事务结算，不重发；outbox audit 已补指定项目全部原记录在同一只读快照下的有界身份/内容摘要核验，超限或损坏不返回部分通过；outbox export/inspect-archive 已补完整原记录逻辑档案与离线核验；send-control/pause/resume 已补按项目持久领取控制和generation并发约束；restore/restore-receipt 已补已暂停空项目的完整原档案恢复、未完成行待处理和同事务原历史回执，restore-preview 已补共享实际恢复条件和v1映射的只读预计状态检查；restore-audit 已补单项目完整恢复历史及原档案核验；restore-history-backup/inspect-restore-history-backup 已补全部原查询/回执/源档案的独立完整备份和离线集合核验，历史备份只补缺失项的整事务导入和只读目标比较已补，离线摘要绑定目录/原回执读取/原事件档案提取亦已补；restore-prepare 已补读取暂停版本、拒绝占用ID并显式保存完整新恢复请求；restore-compare 已补单条原档案/恢复基线/当前原行只读摘要和23列精确差异，明确不证明因果来源；restore-history/restore-get/restore-export 已补元数据分页、按 ID 找回完整原查询/历史回执及原档案重新导出；restore-requeue/restore-requeue-preview 已补基于完整恢复基线、档案摘要及暂停版本的整批显式重新排队与只读预览；可选requeue_id已补同事务原回执、精确重复和原查询只读核验，按批次ID找回原查询/回执及显式保存原请求文件亦已补；批次元数据目录已补只读分页及单条/续页查询，关联历史和选中内容明确未核验；完整项目批次及关联历史审计已补，同快照有界计数、正文前预算检查及全量原回执摘要验证；单批次完整回执文件已补只读导出/离线核验及摘要ID绑定原请求提取，含父历史且独占保存；单批次历史导入及只读预览已补，只补缺失父历史/回执、保留同文、拒绝冲突并完整读回，支持从完整匹配源补回缺父历史；全项目批次联合备份及离线完整核验已补，单读快照按恢复ID去重父历史、严格核验引用闭包并独占保存；联合备份离线分页/原请求保存及单批次独立回执导出已补，原摘要绑定选择且完整核验后取用；联合备份原子导入/只读预览已补，整份比较、只补缺失、相同保留、冲突拒绝，全部父历史/批次读回后统一提交；非空合并/旧发送者协调、跨项目备份/保留管理/来源证明和远端核对后的自动激活仍缺。MCP upload_events 已要求显式原身份/键及完整批次，增加完整回执、独立两笔容量/30 秒期限和派发未知状态；旧调用方需迁移。同步下载已补 Gateway/SDK/MCP 共享完整页校验、4 MiB 有界响应与等待期限，SDK 分页固定原参数和续页游标；读取不自动确认。确认接口现要求原身份/游标，新增当前位点查询，Gateway/SDK/MCP 已接有界完整响应及派发未知状态；下载可固定同一原身份。CLI sync changes/ack/cursor 已接专用有界网络/嵌入适配、稳定输入文件及超时/派发未知状态；changes --output 可显式保存完整页面，inspect 离线检查，--page-file 恢复原输入；独立 SQLite inbox 已补连续接收游标/事务导入/状态与头导出；可选 ack 日志已接原意图持久化、完整成功响应与当前观察分离，不自动确认或重试。Web 原同步回执查询、原查询/回执文件导入导出、显式 IndexedDB 原查询/完整历史回执保存与分页恢复已有源码，历史回执载入完整核验原文/摘要并保留历史标识，浏览器恢复不确认投递或结算队列；原查询/回执已有审阅后逐条移除，按完整原文和目录绑定，仅删除本浏览器副本；原查询已补完整有界备份和审阅后原子补入缺失槽，异文整批拒绝，历史回执亦补独立完整备份及逐份摘要核验后的原子补入。Bridge 已补独立应用扩展及固定原消费者/应用版本的逐页本地投影事务，快照/事件 ledger/应用头原子读回；CLI 已接显式启用、完整状态读取、固定原页应用、共享校验的只读应用预览及待处理原页发现，上下文/建议生命周期元数据、冲突历史适配器及各自完整历史重放已补，客户端事件完整内容历史适配器亦已补并接入应用/预览/待处理页/重放，按原账号客户端事件三元组区分且不声称源字段生效；应用目录、历史结构审计、固定范围分页、指定历史投影读取、固定内置全历史重放核对及完整历史归档导出/离线浏览、空应用或完整相同历史的原子恢复、只读恢复预览、目标历史双摘要约束、原查询文件显式保存、可选持久回执、跨消费者/应用回执目录及所选范围完整回执审计已接 Bridge/CLI；其他业务适配、完整正文、其他适配器重放及跨设备完整恢复仍待补。本地收发库readonly模式已补原生只读打开且不回退可写；旧内存类仍保留；旧队列身份追溯/绑定、全局自动重试门禁、浏览器跨库联合备份/损坏恢复/容量管理及本地队列恢复、其他业务适配/完整正文、跨范围全库回执审计及不同历史合并、旧发送者协调/显式放弃、历史记录恢复与全量历史修复、未准备草稿/跨设备备份、SDK/MCP 持久恢复适配、旧进程/消费者/Mock/fixture 迁移和跨端运行证据仍缺；049 索引和本地三列升级仅源码。完成条件仍为公开路由的 Policy/Audit/Idempotency/ETag、`ConflictDetected/ConflictResolved` 与真实恢复闭环；源码增量不等于运行通过。
- [ ] **[P3-02][缺实现] 完善服务端同步持久化和事件游标。** Gateway 已有 PostgreSQL 批量上传、项目流锁/游标、可见变化分页、按账号/客户端的单调 ack 和原事件回执源码；完整分页现由共享契约校验后返回。确认已接原身份约束/父项目锁/未知结果处理和当前位点查询；CLI 独立 inbox 已有持久连续接收位点源码，确认日志已有原意图/成功响应/当前观察源码，固定原目标显式重试已补独立派发日志源码，Bridge 本地应用扩展已有逐页纯 reducer 投影/事件去重/应用头同事务源码，接收与确认保持独立；CLI 已接显式启用、只读状态、原页应用、共享校验的只读应用预览及待处理原页发现，上下文/建议生命周期与冲突历史适配器及各自完整历史重放已有源码，客户端事件完整内容历史亦已补固定适配器/预览/重放并保持原生产者身份和接收历史语义；应用目录、历史结构审计、分页浏览、指定快照读取、固定内置正序重放核对及完整历史归档导出/离线读取、原接收页和空应用的原子恢复、只读恢复预览、目标历史双摘要约束、原查询文件显式保存、可选持久回执、跨消费者/应用回执目录及所选范围完整回执审计已有源码；仍需其他业务适配、完整正文、其他适配器重放、不同应用历史合并/跨范围全库回执审计、旧发送者协调、权限变化重放策略与跨实例恢复证据。迁移未执行，源码接入不代表数据库或运行验证完成。
- [ ] **[P3-03][待外部环境] 完成真实客户端断网、进程崩溃和并发恢复。** `SqliteOutbox` 已有离线单测/探针，但还要用真实 CLI/Bridge 进程验证 durable write → reconnect → exactly-once、cursor gap、客户端重启和两个客户端并发冲突。

## P4：REST、MCP、CLI 和客户端适配

- [ ] **[P4-01][缺实现] 补齐 WCP REST 路由。** 对照 `docs/design/01-contracts/wcp-api.md`，当前缺少事件批量同步、ContextPack、Conflict、Proposal confirm/reject，以及 Plane 工作项创建/更新等规划接口；需要逐项注册并做 REST/SDK 契约测试。
- [ ] **[P4-02][缺实现] 将 MCP 表面扩展到契约清单。** `apps/api-gateway/src/server.ts` 当前硬编码只暴露 `context_search`、`context_index` 两个 Tool 和一个 `resume` Prompt；规划要求的项目/工作项/上下文/时间线/决策/风险/文件/会话资源、写入 Tools 和六类 Prompts 尚未接入。完成条件：动态注册、input schema、scope/capability 检查、错误 parity 和资源读取测试全部覆盖。
- [ ] **[P4-03][缺实现] 提供可安装的 `workctx` CLI。** `apps/workctx-cli` 目前只有 `runWorkctx` 函数和 package export，没有 bin、安装入口或真实 shell smoke。完成条件：`workctx resume/checkpoint/handoff/sync/conflicts/doctor` 在 Windows/Linux 下可执行，JSON 输出与 REST/MCP 语义一致。
- [ ] **[P4-04][缺实现] 实现客户端专属适配器和 Hook。** `integrations/claude-code`、`deepseek`、`workbuddy` 当前只是重新导出 Codex Adapter；支持矩阵虽标记部分 degraded，但没有真实 hook/session-start/session-end/显式 finalize 的端到端证据。
- [ ] **[P4-05][缺实现] 修复 MCP trace 和能力声明。** 真实 WaveMate 报告中的响应仍出现 `trace_mcp_unknown`，而 `initialize/server-discover` 返回空 capability map。完成条件：缺少入站 trace 时生成唯一 trace，贯穿 initialize → tool/resource/prompt → audit，并按客户端声明返回实际降级能力。

## P5：Web 工作台

- [ ] **[P5-01][缺实现] 将工作台按钮接成真实命令。** `apps/web-console/src/app/handoffs/page.tsx` 的 Create/Claim、`conflicts/page.tsx` 的 Resolve/Keep local，以及 sessions/work-items/context/audit/admin 页面的操作按钮当前没有提交处理或仍是 disabled。完成条件：操作调用 Gateway，携带 expected_version/idempotency，展示 loading/denied/conflict/success 状态并刷新数据。
- [ ] **[P5-02][缺实现] 把 Web Console 纳入构建和质量门禁。** 根 `tsconfig` 排除了 `apps/web-console/src`，根 Prettier/Lint glob 未覆盖 `.tsx/.css`；当前工作区无法直接解析 Next/React 依赖。完成条件：冻结依赖后 `next build`、独立 typecheck、Lint、Playwright 关键旅程和可访问性 smoke 在 CI 中执行。
- [ ] **[P5-03][待外部环境] 完成真实权限/交接/冲突 UI E2E。** 用真实 Keycloak/OPA、Gateway 和 PostgreSQL fixture 验证 claim/resume/resolve、双版本 diff、scope isolation、stale/denied/error 状态和审计记录；不能只依赖页面静态 smoke。

## P6：身份、治理、审计与观测

- [ ] **[P6-01][待外部环境] 固定生产身份和策略配置。** 当前 Keycloak/OPA 主要由 Compose/test overlay 验证；需要 RC/生产版本、网络、JWT claims、密钥轮换、策略版本和 fail-closed 演练，并把 digest/配置写入 Release Manifest。
- [ ] **[P6-02][缺实现] 覆盖所有敏感操作的审计与留存。** runtime 已有 Gateway 审计和 PostgreSQL sink，但 Artifact、Sync、Conflict、Proposal、导出、恢复和后台 worker 尚未形成统一入口；需要留存、查询、脱敏导出、失败重试和清理策略的真实闭环。
- [ ] **[P6-03][待外部环境] 完成 OTel/Prometheus/告警联动。** 本地有 Trace/Metrics/Health 类型和 Collector 配置，仍需在部署环境验证跨服务 trace、事件延迟、队列积压、审计失败、Context resume SLO 和告警触发/恢复。

## P7：搜索和智能能力

- [ ] **[P7-01][缺实现] 完善 Proposal 提交与审核链路。** 已开发持久化路由、来源/provenance、人工 expected_revision 确认及 MCP/SDK/CLI/UI，worker 已有持久提交队列与真实 HTTP 入口；显式模型生成适配器/CLI 已补源码，配置端点/模型从指定摘录生成并保存可审阅草稿，不自动入队。指定当前 ContextItem 的身份/权限读取、版本核对及完整生成输入准备亦已补独立命令。完整准备/生成记录、离线一致性核验、入队前原目的地绑定及任务记录原子关联/只读查询/导出已补源码，旧普通草稿流程保持兼容，可选关联表尚未初始化。调用前不可变请求日志、独占领取、失败/成功结果保存和只读取回已补源码，已有标记不再次派发；保留结果可先预览再受控补存，只补缺失 outcome；请求目录可按原绑定/状态有界分页发现原键和结果。Web 创建已补完整原请求准备、文件导出及独立恢复页；原文/摘要双槽浏览器保存、按原网关/完整身份的20条分页目录、关闭标签页后找回及旧标签页精确槽兼容亦已补。每次发送确认原文保存并固定原网关/身份/内容/键，核对完整回执；载入不写入或发送，错误保留原请求。当前原绑定范围的完整原请求备份、摘要核验、只读目标比较和确认后原子补入亦已补；原创建请求当前目录页1–20份所选完整审阅、原格式子集导出和确认后原子移除已补，元数据不得代替正文核验，全量预检后精确删除双槽及全部缺失读回；目录/备份/整理共享互斥，存储代次及摘要失效旧确认，未知保留子集并重新审阅，旧标签页副本不读不删、原恢复旧槽检查保留；原创建回执只读查询已接入 Gateway/SDK/Web/CLI/MCP，绑定原身份/键/草稿并核验历史事件，不重提；CLI 有界原请求文件及嵌入读取、MCP 权限/期限/并发/完整响应与 HTTP 额度检查亦已补。worker 已补原创建回执查询及显式本地结算，固定完整已知任务快照、拒绝发送中/并发变化、保留未知事务远端观察。worker flush 已补未知/回收 sending 只查回执的门禁及有界发送、原领取复查，not-observed 不重提。Mock 已补原创建回执只读适配，按完整原身份/键/草稿核对模拟命令与不可变内容，查询不修改内存记录。worker 显式回执文件导出/离线核验已补，保存失败保留完整结果；已保留记录及一致错误封套可离线预览并补存新文件，保留原时间/摘要/状态；Web 未准备编辑草稿已补独立浏览器快照、20条目录及文件导入导出，保留原身份/键与不完整字段；确认恢复前检查同键原请求，编辑换新键并撤销确认；逐份浏览器草稿审阅/所选导出/确认移除亦已补，原文与目录一致才删除，未知保留完整候选；当前完整绑定范围的编辑草稿备份/摘要核验/只读比较及确认后原子补入已补，保存时间或正文冲突拒绝整批恢复。worker 已补原生只读完整队列快照导出及离线文件核验，保留原绑定、全部已知任务状态/正文/回执/租约和生成关联，100任务/100关联/32 MiB有界完整读取，损坏或超限拒绝整份，关闭队列后独占保存新文件，失败保留已构造快照。完整备份及导出/补存失败封套已补有界离线预览和新文件补存，保持原捕获时间/摘要/任务状态，旧路径仅作元数据，再次失败保留同一快照。备份与已有队列的完整只读比较亦已补，核对原绑定、编号/请求键占用、全部任务状态/生成关联及可选表区别，关闭后输出一致/缺失/变化/冲突和目标独有摘要，不推断可恢复或可重发。已补完整备份新文件恢复，预览与原摘要确认后独占创建新库，未确认任务统一blocked/uncertain并解除旧租约，submitted与生成关联保留；事务导入关闭后只读全量核对和文件摘要读回，原备份留存，当前retry保留未知，后续flush只查原回执。已有队列严格补缺合并亦已补：原生只读预览和完整目标逻辑摘要确认，写事务重读/全量预检后仅插缺项、完整读回提交；原行或已隔离行同文保持，其他差异整批拒绝，新增未知任务暂停，已有状态/租约不改。建议创建编辑器已补显式开启的延迟自动保存，独立会话只更新最新完整副本，双槽比较上次确认正文后写入，旧回执不标记新字段已保存；手动操作暂停，未知停写并重开新会话，20条目录/完整审阅/文件导出/同键原请求核对后确认恢复/精确确认删除已接入，手动快照及备份范围独立。旧发送者协调/显式解除未知、冲突处置及自动备份/历史索引、编辑草稿自动清理及容量保留/跨范围联合备份/远端同步、跨范围整库备份/清理仍缺。Web审核已补原绑定/决定/理由/版本/键准备冻结、浏览器双槽保存与20条目录、完整文件及独立恢复，每次发前核对保存并校验完整回执；原审核回执只读查询已接入Gateway/SDK/Mock/Web，保持原完整请求并核验历史命令/事件，not-observed不重发。CLI/MCP已补原审核专用查询入口及有界文件/权限/期限/响应控制；当前完整原绑定范围的审核原请求整批备份/摘要核验/只读比较与确认后原子补入亦已补；缺失才添加，同键异文或损坏拒绝整批，导入不发送审核。审核原请求逐份完整浏览器审阅、导出和确认后精确双槽移除已补，未知保留候选并要求重读；当前目录页最多20份所选批量审阅、原备份格式子集导出与确认后原子移除亦已补，全部预检/读回、异文整批拒绝、缺项单列，恢复页存储变化代次失效旧目录/单份/备份确认，不发送或撤回审核；未准备审核草稿已补独立32 KiB格式、双槽保存/目录、文件导入导出和独立找回页；明确恢复前核对原建议/版本及同键原审核，原文同一则打开固定请求、异文拒绝，编辑换键撤销确认。当前原绑定的审核编辑草稿整批备份、摘要核验、只读比较及确认后原子缺失补入亦已补；保存时间或正文冲突拒绝整批，恢复不改变当前字段。审核草稿逐份审阅/独立确认移除已补，精确核对正文及保存时间、未知保留候选且重读后再删。审核历史观察已补独立浏览器持久保存/20条目录、完整原请求与发送或查询封套、摘要寻址及文件导入导出，not-observed不覆盖已确认观察，历史不驱动审核动作。审核历史当前完整原绑定的100份/16 MiB整批备份、外层及内层摘要校验、只读比较及确认后原子缺失补入亦已补，同摘要异文或损坏拒绝整批，未知保留备份并重新比较。审核历史逐份浏览器审阅及独立确认移除亦已补，原文/摘要/目录精确匹配才删，未知保留可导出候选并重新读取审阅。审核历史当前目录页最多20份所选审阅/子集导出/确认后原子批量移除亦已补，全部预检后才删除，同摘要异文拒绝整批、缺项单独计数，不依赖完整范围100份备份。未准备审核草稿已补显式开启的独立会话延迟自动保存、20条分页目录、完整审阅/导出/同建议版本原审核核对后恢复/精确确认移除，共用创建端事务和串行保存机制，未知停写、手动操作暂停、备份范围独立。创建/审核自动副本已补独立完整范围文件备份、规范摘要/原身份核验、逐项审阅、只读比较及确认后原子缺失补入，100会话/创建16 MiB审核4 MiB限制，保留原会话及时间、同文保留/异文整批拒绝、全量读回后提交；暂停当前写者，未知保留文件并重比，手动备份独立。创建/审核自动副本当前页所选批量整理已补，最多20份同事务完整审阅、可恢复子集导出、确认摘要后全量预检/精确双槽删除/全部缺失读回，异文整批拒绝、缺项单列，不受全库100份限制；分页/选择/失败重读/存储变化撤销资格，未知保留文件并重新审阅。创建/审核手动草稿当前页最多20份所选批量审阅、可恢复子集导出及确认后原子移除已补，复用原双槽与备份格式；完整预检/全部缺失读回、异文整批拒绝、缺项单列，目录/选择/存储变化撤销资格与旧手动备份及逐份确认，未知保留内容并重新审阅。尚缺自动/容量清理及保留策略、定时/跨范围联合备份、历史自动备份/清理及服务器归档。固定原审核页已补默认关闭的新有效结果自动留存，保留原时间/完整响应并在网络结果核验后独立本地保存，未知不改变审核结果且停止自动模式、保留失败观察，显式同文重试仅本地操作；存储代次失效旧确认，不补造旧观察或后台发送。生成请求日志已补完整原绑定备份、离线核验/失败副本补存及确认后恢复新隔离目录，保留原请求/领取/结果，prepared不授予重发资格，原状态读取和结果取回仍可用。恢复目录已补计划确认后的只增缺项合并，先保存来源/目标原快照，异文拒绝、生成仍隔离，失败保留部分文件并重新预览。仍缺后台来源发现/刷新、供应商未知调用对账、普通日志原位合并/解除隔离、队列联合备份/保留策略/全局审计、真实供应商兼容和运行质量证据，原内存服务仅保留离线兼容。完成条件：默认 `proposed`，带 source/provenance，人工 expected_revision 确认后才可进入 verified。
- [ ] **[P7-02][待外部环境] 接入真实模型/Embedding 与 Golden 评测。** 当前评测和建议主要是 deterministic fixture；需要固定模型、prompt、embedding/index 版本，执行 source fidelity、next action、stale content、injection 和人工抽样回归，并保存阈值报告。
- [ ] **[P7-03][缺实现] 实现阻塞/依赖/进度分析的可消费输出。** 将 blocker、dependency、progress suggestion 接入 ContextPack、REST/MCP/UI，始终区分 desired/observed/verified，禁止智能结果直接提升权威状态。

## P8：发布、恢复和私有化交付

- [ ] **[P8-01][缺实现] 生成可批准的不可变 Release Manifest。** `deploy/release-manifest.yaml` 仍含 `PLACEHOLDER_SET_BY_CI` 和 `sha256:SET_BY_CI`；需用真实 git SHA、镜像 digest、migration/schema/fixture/client/Plane/ai-memory 版本生成并审批清单，且不把占位符带入 RC。
- [ ] **[P8-02][待外部环境] 重新执行 RC 真实门禁。** 依次运行 live readiness、Compose clean install、Plane→Webhook→Projection→ContextPack→MCP、客户端切换、身份/审计、依赖故障恢复、性能负载、备份恢复和 release smoke；本次审计因服务未运行，不能沿用历史报告宣称当前通过。
- [ ] **[P8-03][待外部环境] 完成目标集群升级/回滚和 HA 证据。** 在目标 k3s/Helm 环境执行 upgrade、rollback、3 副本重建、节点/Pod 恢复、事件重放和恢复后业务 smoke，并保存 manifest、image digest、migration checksum、trace 和审批记录。
- [ ] **[P8-04][待外部环境] 完成生产数据恢复和上线 Smoke。** 验证 PostgreSQL、SQLite outbox、ai-memory、对象存储恢复后的 revision/hash/event/audit 一致性，随后检查事件延迟、Context resume、Plane Webhook、策略拒绝无副作用、审计留存和告警，再决定是否打开 Feature Flag。
- [ ] **[P8-05][风险登记] 处理依赖镜像漏洞报告。** 当前 `trivy-images-current4` 对多项基础镜像仍报告 HIGH/CRITICAL；按 ReadMe 当前范围它不作为功能 RC 门禁，但必须在发布清单中保留扫描结果、例外批准、升级计划或明确接受风险。

## 文档和维护

- [ ] **[DOC-01][文档漂移] 让 `ReadMe.md` 成为单一入口。** 当前文件同时包含早期方案、最终方案和重复的实施计划，首个两周清单仍全部未勾选；应保留架构基线，链接到本 TODO、当前验证审计和唯一实施计划，删除/标注过期副本。
- [ ] **[DOC-02][文档漂移] 每次 live gate 后更新状态审计。** `docs/design/06-planning/05-completion-audit.md` 中的“当前通过”必须与最新运行环境和报告一致；离线、simulated、历史报告不得升级为当前 RC/生产通过。
- [ ] **[DOC-03][维护] 增加自动差异检查。** CI 应检查 WCP 路由、MCP 名称、Schema、SDK、Mock、README/requirements matrix 和测试矩阵的一致性，避免计划继续显示已完成而运行时只覆盖子集。

## 推荐执行顺序

1. 先完成 P0-01/02/03/04，冻结真实契约、事件总线和追踪状态。
2. 接着完成 P3-01/02 与 P4-01/02/03，先把同步、冲突和客户端入口接成闭环。
3. 完成 P1-01/02、P2-01/02/03，替换内存实现并验证 Plane/存储恢复。
4. 完成 P5-01/02、P6-01/02/03，补齐可操作工作台、身份、审计和观测。
5. 完成 P7-01/02/03，最后打开 proposal/vector 等非默认能力。
6. 按 P8-01/02/03/04 执行 RC、升级回滚和生产 Smoke，清单批准后再发布。

## 审计证据入口

- 规划基线：[ReadMe.md](ReadMe.md)
- 总体计划：[docs/design/06-planning/00-overall-development-plan.md](docs/design/06-planning/00-overall-development-plan.md)
- 当前完成审计：[docs/design/06-planning/05-completion-audit.md](docs/design/06-planning/05-completion-audit.md)
- WCP 契约：[docs/design/01-contracts/wcp-api.md](docs/design/01-contracts/wcp-api.md)
- MCP 契约：[docs/design/01-contracts/mcp-interface.md](docs/design/01-contracts/mcp-interface.md)
- 模块协接：[docs/design/03-integration/04-module-interface-contracts.md](docs/design/03-integration/04-module-interface-contracts.md)
- 计划审计工具：[tools/plan-audit.mjs](tools/plan-audit.mjs)
- 发布就绪工具：[tools/rc-readiness.mjs](tools/rc-readiness.mjs)
