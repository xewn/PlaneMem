# workctx 开发入口

2026-11-05：`context recover-receipt --result-file EXTRACT_RESULT.json --output NEW_RECEIPT.json [--json-file ORIGINAL.json]` 现接收`extract-backup-receipt`的成功/保存失败完整stdout，提取输出限256 KiB，旧查询/补存输出仍限96 KiB。校验完整回执、实际或候选文件摘要以及有界提取元数据，保留原观察；只读取显式result-file、可选独立原请求和新输出，不访问元数据中的旧备份、绑定或输出路径。输出recovery增加input_status和backup_membership=not-checked，兼容旧补存输出。下述提取失败stdout不能补存的历史缺口由本增量覆盖，整套备份构造失败输出仍不支持。详见[备份提取输出回执补存](../../docs/design/01-contracts/context-pack-runtime.md#备份提取输出回执补存2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件流程或发布。

2026-11-05：新增`context extract-backup-receipt --backup-file FILE --observation-sha256 SHA256 --output NEW_RECEIPT.json`，backup-file可重复以提供清单及全部卷，支持原binding-file/expected-document-sha256/timeout-ms约束。先完整核验备份，不按请求键猜选；目标观察摘要可从inspect-backup的entries查看，未命中退出1且不写入。选中后保持完整原回执，保存前复读全部源备份/独立绑定文件并核对实际长度与SHA-256，独占新文件保存和完整读回；保存失败stdout保留receipt_file及本地阶段、退出1，成功0，用法2。timeout-ms只限整套核验，后续复读/发布独立等待；输出文件可再inspect-receipt、extract-original或网页导入。主入口/内嵌均无需凭据、路由或网络，失败stdout直接补存尚未接入recover-receipt。见[从备份提取历史回执](../../docs/design/01-contracts/context-pack-runtime.md#cli从备份提取历史回执2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件流程或发布。

2026-11-05：新增`context prepare-backup --binding-file BINDING.json --format single|volumes --output NEW_DIRECTORY --observation-file RECEIPT.json`，observation-file可重复，单份最多100条、分卷最多1000条；没有观察时必须显式`--empty`且不能同时提供观察。--timeout-ms默认30000，仅约束新路径预检、稳定文件读取及SDK完整核验/构造，开始写入后独立等待完成。新输出目录必须不存在且父目录已存在，逐份使用独占新文件/sync/读回，清单最后写入，末尾重新核对所有输出字节；已有目录不续写。成功local.state=saved-and-read-back退出0，保存失败stdout保留完整候选/输出计划及已写文件、save-failed退出1；用法2，准备失败1且不创建目录。仅覆盖所供观察、不证明全库历史；无认证/网络/原请求派发/浏览器恢复，runWorkctx同入口。详见[CLI历史备份构造留存](../../docs/design/01-contracts/context-pack-runtime.md#cli历史备份构造留存2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/文件流程或发布。

2026-11-05：新增`context inspect-backup --backup-file FILE`离线核验，可重复`--backup-file`传入清单及全部分卷（总1–11文件，任意顺序）；一份输入只视为单份备份，不推断其属于完整集合。可选`--binding-file BINDING.json`提供8 KiB以内独立完整PackSaveBinding，`--expected-document-sha256`约束单份或清单的规范document摘要，`--timeout-ms`默认30000且覆盖读取与核验。复用SDK逐层摘要/身份/数量/顺序核验，main和runWorkctx均在凭据与路由前执行，后者只使用context.trace_id作本地追踪。stdout包含完整备份或清单/有序分卷、各输入路径/实际字节摘要，storage_access=file-read-only；不写入、不扫描目录、不联网或恢复浏览器历史。成功0，用法2，文件/核验/超时错误1且无部分stdout；文件读取非跨文件原子快照，超时后当前底层读取可能继续关闭，但不读后续文件。详见[CLI历史备份离线核验](../../docs/design/01-contracts/context-pack-runtime.md#cli历史备份离线核验2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/文件流程或发布。

2026-11-05：内嵌`runWorkctx(argv, router, verifiedContext, { gateway_url: actualGatewayBase })`新增`context submit-save --json-file ORIGINAL.json --reviewed [--timeout-ms 30000]`，补齐原文件提交入口。要求宿主实际网关、当前完整身份及restricted与原文完全一致；复用save-identity核对后，按原预算/TTL/键提交，授权结束后再次完整读文件，任何字节变化均拒绝。首次读文件之后共用总期限，超时阻止迟到提交；共用既有compile两笔容量及完整回执/摘要核验。成功stdout为完整保存封套，退出0；用法错误2，其他失败1并区分not-sent/not-checked与started/unknown，保留原文恢复提示。命令不改文件、换键或自动重试；内嵌调用无HTTP响应头核验。详见[内嵌CLI原请求提交](../../docs/design/01-contracts/context-pack-runtime.md#内嵌cli原请求提交2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件流程/API或发布。

2026-11-05：内嵌`runWorkctx(argv, router, verifiedContext, { gateway_url: actualGatewayBase })`新增`context prepare-save --key ORIGINAL_KEY --output NEW_ORIGINAL.json [--json-file DRAFT.json] [--timeout-ms 30000]`。先预检新输出路径与最多4 KiB预算/TTL草稿，再复用save-identity读取完整可信身份，核对原宿主Gateway、五字段身份、restricted及会话期限；与网络入口共享8 KiB原请求格式、规范摘要、独占保存及完整读回。成功返回prepared，供inspect-save审阅，不发送保存包请求。timeout-ms限制身份查询，文件I/O独立等待，发布前复查身份到期；本地失败保留恢复路径。旧三参调用保持兼容，新准备命令需要宿主实际Gateway配置；内嵌submit-save仍待开发。详见[内嵌CLI原请求准备](../../docs/design/01-contracts/context-pack-runtime.md#内嵌cli原请求准备2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件流程/API或发布。

2026-11-05：内嵌`runWorkctx(argv, router, verifiedContext, { gateway_url: actualGatewayBase })`支持`context save-receipt --json-file ORIGINAL.json [--timeout-ms 30000] [--output NEW_RECEIPT.json]`。第四参数由宿主实际router配置提供，包含部署路径；缺少配置拒绝，不能取原文件中的地址冒充宿主地址。旧三参数调用和离线命令保持兼容。新入口完整核对原文件Gateway/五字段身份/restricted，要求未过期可信context.read，单次只读路由查询、16 KiB完整回执、查询期限/取消及独立两读容量；授权等待后复查，不发送保存或身份GET。可选新输出与网络入口复用独占留存/读回和本地失败保留，成功观察（含not-observed）退出0，本地失败1、用法2。详见[内嵌CLI原保存回执查询](../../docs/design/01-contracts/context-pack-runtime.md#内嵌cli原保存回执查询2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件工作流/API或发布。

2026-11-05：新增`context recover-receipt --result-file RESULT.json --output NEW_RECEIPT.json [--json-file ORIGINAL.json]`。将`context save-receipt --output`或本补存命令的完整stdout保存为UTF-8文件后，可离线恢复其中已捕获的receipt_file；输入最多96 KiB，缺失候选/损坏摘要/原请求或回执矛盾均拒绝，不补造观察时间。可选独立原文件作完整绑定核对，原local路径只作为历史提示且不会访问；输出必须是已有目录内的新路径，复读输入后独占保存并完整读回。stdout返回`data.status=receipt-recovered`、完整receipt_file、本次recovery信息与local状态；本地失败保留候选、退出1，输出可再次补存，成功退出0，用法错误退出2。内嵌回执时间/trace/原键不变，本次外层trace独立且source_refs为空；无网络、登录、路由调用或重发。成功文件可交给inspect-receipt、extract-original或网页历史导入。详见[查询输出离线补存](../../docs/design/01-contracts/context-pack-runtime.md#cli查询输出离线补存2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件工作流或发布。

2026-11-05：新增`context extract-original --receipt-file RECEIPT.json --output NEW_ORIGINAL.json [--json-file ORIGINAL.json]`。无需登录或网络，可从CLI/网页共享历史回执恢复完整原请求。先核对32 KiB完整文件及规范document摘要，可选独立8 KiB原请求精确比对；目标必须是已有目录中的新文件，发布前再次检查输入全部字节，独占保存并完整读回。stdout保留`data.receipt_file/original/request_sha256/local`；`local.state=saved-and-read-back`退出0，预检/输入变化/发布或读回失败保留候选与恢复信息、`save-failed`退出1，参数错误退出2。提取不改变历史时间、身份、Gateway、权限、键或参数，也不触发查询/保存；恢复后先`context inspect-save --json-file NEW_ORIGINAL.json`审阅，再自行选择查询或明确提交。普通摘要不认证服务器，历史not-observed不证明失败。详见[从历史回执提取原请求](../../docs/design/01-contracts/context-pack-runtime.md#cli从历史回执提取原请求2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/文件流程或发布。

2026-11-05：`context save-receipt --json-file ORIGINAL.json --output NEW_RECEIPT.json`可显式留存历史查询，output必须是已有目录内的新路径，查询前预检、不覆盖；查询完成后独占发布并完整读回。指定output时stdout为`data.original/receipt/receipt_file/local`，文件只含receipt_file；本地失败仍保留完整观察及已构造候选、local.state=save-failed，退出1，无output继续返回原完整WCP查询封套。新增`context inspect-receipt --receipt-file RECEIPT.json [--json-file ORIGINAL.json]`，main及嵌入均离线，32 KiB稳定UTF-8文件、规范document SHA-256及可选完整原请求相等核验，不需登录/环境或路由。文件含原Gateway/身份/参数/键、本地观察时间及完整历史回执，普通摘要不认证服务器，not-observed不能证明失败或授予重发。详见[保存回执文件与离线查看](../../docs/design/01-contracts/context-pack-runtime.md#保存回执文件与离线查看2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行命令/文件工作流或发布。

2026-11-05：新增`context save-receipt --json-file ORIGINAL.json [--timeout-ms 30000]`，读取准备保存或网页导出的完整8 KiB原请求文件；先核对配置Gateway（含路径）及项目，再按原账号/客户端/restricted/参数/键查询一次历史保存记录。成功stdout为完整16 KiB以内WCP封套，`data.status`为recorded或not-observed，已记录含固定包编号和历史元数据，正文/来源尚未检查。未观察到记录不能证明没有保存，也不会自动重发。本入口只接网络main，不读stdin/内联JSON，不接受--reviewed/--key/--output，不写文件或调用保存接口；默认30秒网络等待，文件读取在此前完成。详见[原保存请求回执查询](../../docs/design/01-contracts/context-pack-runtime.md#原保存请求回执查询2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/API或发布。

2026-11-05：新增`context prepare-save --key ORIGINAL_KEY --output NEW_ORIGINAL.json [--json-file DRAFT.json]`、`context inspect-save --json-file ORIGINAL.json`和`context submit-save --json-file ORIGINAL.json --reviewed`。准备仅读取可信身份后将完整请求独占保存并读回；草稿只接受预算/TTL，省略为4096/3600，原键由用户明确提供。离线审阅显示完整原文及摘要，提交固定原Gateway（含路径）、项目、账号/客户端、权限桶、参数和键；同token复核身份、再次读取原文件、单POST并完整核验回执和HTTP ETag。准备/提交可选timeout-ms默认30000；新流程只接受稳定普通文件，不读stdin/内联JSON，不覆盖旧文件或自动换键。与网页使用同一8 KiB格式，可导入网页原请求；准备和提交限网络main，嵌入runWorkctx支持离线审阅，旧compile保持兼容。详见[CLI完整保存原请求](../../docs/design/01-contracts/context-pack-runtime.md#cli完整保存原请求2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/API/网页或发布。

2026-11-05：新增`context save-identity`，读取当前可信tenant/workspace/project/actor/client、expires_at及compile/read_restricted提示。最多一个4 KiB `--json`或`--json-file`，省略为{}；仅网络入口支持有界`--json -`，可选`--timeout-ms`默认30000。输入只能含成对expected_actor_id/expected_client_id，用来核对原账号/客户端；拒绝其他参数和写选项。网络main/callGateway及嵌入runWorkctx统一复用SDK getContextPackSaveContext，完整16 KiB封套，嵌入与其他九类上下文读共用两路容量并核对可信权限/期限。读取不会保存包、预留键或替换已有原请求；完整边界与未执行示例见[CLI/MCP保存身份入口](../../docs/design/01-contracts/context-pack-runtime.md#climcp保存身份入口2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/API或发布。

2026-11-05：`context compile`的网络main/callGateway和嵌入runWorkctx接入SDK完整保存回执及SHA-256核验。默认{}，最多一个4 KiB `--json`/`--json-file`，网络支持有界stdin；稳定键沿--key或正文idempotency_key，嵌入还可沿原context键，多来源必须相等。新增默认30秒 `--timeout-ms`，可选成对expected_actor_id/expected_client_id；完整回执2 MiB、Fetch错误16 KiB，失败不返回部分内容，派发后保留结果未知。嵌入要求可信未过期实际context.read/完整身份，授权后复查取消及到期，独立每router两笔提交容量到底层结束才释放；无自动重试、新键、读回或文件保存。详见[CLI保存包提交核验](../../docs/design/01-contracts/context-pack-runtime.md#cli-保存包提交核验2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK/API/保存命令或发布。

2026-11-05：新增`context list-packs`，网络main/callGateway和嵌入runWorkctx复用SDK listContextPacks完整元数据读取。最多一个4 KiB `--json`/`--json-file`，默认{}，仅网络支持有界`--json -`；可选pack_id/limit/cursor及成对expected_actor_id/expected_client_id，默认30秒timeout-ms。每次一页、完整256 KiB封套，保留筛选和续页，不读取正文/hash/来源，过期或来源变化记录仍可能列出；打开具体包另行检查。嵌入原handler负责父项目/read_restricted过滤，九类上下文读共用每router两容量、底层结束才释放。无自动翻页/重试/换包/写入，详见[CLI保存包目录](../../docs/design/01-contracts/context-pack-runtime.md#cli-保存包目录读取2026-11-05源码增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK或发布。

2026-11-04：新增 `context compare-packs`，要求不同的 from_pack_id/to_pack_id 及 expected_actor_id/expected_client_id；网络 main/callGateway 和嵌入 runWorkctx 共用 SDK 双包读取、摘要核对与比较。恰一 4 KiB JSON/稳定文件，网络支持有界 stdin，默认30秒总等待期限；完整结果包含两侧内容和原方向差异，失败不输出半份结果。详见[CLI保存包对比](../../docs/design/01-contracts/context-pack-runtime.md#cli-指定保存包对比2026-11-04源码增量)。仅源码文档，未编译、类型检查、测试、执行 CLI/SDK 或发布。

2026-11-04：`context get` 接入保存包专用完整读取，网络 main/callGateway 与嵌入 runWorkctx 均复用 SDK getContextPack 的结构/范围/版本/来源/预算/格式与 SHA-256 校验。最多一个 `--json`/`--json-file`（4 KiB），默认 `{}` 读取 latest，网络支持有界 `--json -`；可选 `--timeout-ms` 默认 30000，以及 JSON 内成对 expected_actor_id/expected_client_id。完整成功 2 MiB、Fetch 错误 16 KiB，不输出部分或未核对内容；嵌入要求可信未过期实际 context.read，核对原 GET/头/空正文/限额和入选 restricted 分类，与其他六类上下文读取共用每 router 两笔容量，底层 router 未结束则超时后仍占槽。共享 SDK 仅核对 JSON 内 ETag，不宣称通用传输可见 HTTP ETag/状态；无自动换包、重试、编译或保存。见[CLI保存包读取](../../docs/design/01-contracts/context-pack-runtime.md#cli-保存包完整读取2026-11-04源码增量)。仅源码文档，未编译、类型检查、测试、执行 CLI/SDK 或发布。

2026-11-04：`context list`接入SDK完整目录读取，支持最多一个`--json`/`--json-file`（8 KiB），省略为{}，网络支持有界`--json -`；可选`--timeout-ms`默认30000及JSON内成对expected_actor_id/expected_client_id。完整响应2 MiB、Fetch错误16 KiB，核对原项目/trace/筛选回显/完整记录/归档/排序/续页，失败不返回局部结果。嵌入实际未过期context.read、完整身份/POST正文/头及restricted核验，六类上下文读取共用每router两笔容量，超时底层未结束仍占槽。每次一页，下一页保留原身份/筛选/归档/limit并传回next_cursor，换页大小或旧游标须回首屏；无自动翻页/重试/缩页/保存。拒绝key/output/写字段/重复未知参数，文件/stdin等待在SDK期限前，其他五类读取仍要求恰一4 KiB输入。见[CLI上下文目录](../../docs/design/01-contracts/context-item-runtime.md#2026-11-04-cli上下文目录完整读取增量)。仅源码文档，未编译、类型检查、测试、执行CLI/SDK或发布。

2026-11-04：`context read` / `context read-archived`接入SDK完整读取，接受恰一`--json`或`--json-file`（4 KiB），可选`--timeout-ms`（默认30000）；网络入口支持`--json -`，嵌入不读stdin。输入为`{item_id}`及可选成对expected_actor_id/expected_client_id，拒绝key/output/写字段/重复未知选项。完整详情2 MiB、Fetch错误16 KiB，核对原条目/范围/版本/正文ETag/来源诊断/确认信息，失败不输出部分正文或切换当前/归档视图。嵌入要求可信未过期context.read，核对restricted权限及实际SDK请求；详情/历史/比较共用每router两笔容量，超时后底层未结束仍占槽。原item_id输入保持，旧不完整自定义返回须迁移；不自动重试或保存，通用SDK不暴露HTTP ETag。详见[CLI当前/归档详情](../../docs/design/01-contracts/context-item-runtime.md#2026-11-04-cli当前与归档详情读取增量)。仅源码文档，未编译、测试、执行或发布。

2026-11-04：`context history/version/compare --json-file QUERY.json [--timeout-ms 30000]`统一复用SDK有界历史读取；也可使用`--json`，网络支持有界`--json -`，嵌入不读stdin。恰一输入、最多4 KiB；history接收`{item_id,before_version?,limit?}`（默认25最多100），version接收`{item_id,version}`，compare接收`{item_id,from_version,to_version,expected_actor_id,expected_client_id}`。两版本为不同正安全整数，方向保留；history/version也可附加成对expected身份。账号为ULID，客户端为本地ID，只作与可信读者相等约束，不授予权限。成功目录256 KiB、单版2 MiB，版本核对完整快照SHA-256；比较两次读取共用总期限，stdout原样返回SDK本地组合对象（无外层data），包含完整from/to封套和comparison，来源真实性未检查。嵌入要求可信未过期context.read，额外核对restricted权限、真实请求和每router两笔容量；超时不代表底层router已停止。输入文件/stdin等待在预算前完成，不承诺可取消。拒绝key/output/写字段/重复未知参数，不自动翻页/重试/保存；下一页保留item_id、limit和身份，将data.next_before_version传作before_version。详见[CLI上下文历史与对比](../../docs/design/01-contracts/context-item-runtime.md#2026-11-04-cli上下文历史与对比增量)。仅源码文档，未编译、测试、执行或发布。

2026-11-04：`work-items list`的JSON增加sort，例如`{"sort":"due_asc","status":"todo"}`按保存截止日期从早到晚读取，null最后、同日期ID升序。省略/显式updated_desc仍为最近更新；续页保留排序和全部筛选，换排序去掉cursor。原单页/预算/期限保持，详见[工作项排序](../../docs/design/01-contracts/work-item-projection-runtime.md)。仅源码文档，未编译、测试、执行或发布。

2026-11-04：`work-items list`的JSON增加`due=scheduled|unscheduled`、`due_from`、`due_before`。日期为有效YYYY-MM-DD，UTC含起始、不含结束；示例文件内容`{"due_from":"2026-11-01","due_before":"2026-12-01","status":"todo"}`。unscheduled只匹配due_at=null且与区间互斥；区间排除null，不自动判断逾期或工作状态。下一页保留这些条件和原cursor，换条件回首页，原8 KiB输入/单页读取/期限保持。见[工作项筛选](../../docs/design/01-contracts/work-item-projection-runtime.md)。仅源码文档，未编译、测试、运行命令或发布。

2026-11-04：`work-items list/get`新增`--timeout-ms`，默认30000；网络和嵌入统一复用SDK有界单页/详情读取，成功2 MiB、Fetch错误16 KiB和完整trace/结果校验。输入支持最多8 KiB内联JSON/稳定普通文件，列表省略为{}，网络支持有界`--json -`、嵌入不读stdin；本地输入等待不计入网络期限。可选成对expected_actor_id/expected_client_id只转成身份相等头；嵌入要求可信未过期context.read，按原身份派发、两笔容量到真实读取结束才释放。拒绝key/output/重复/未知/写选项，不自动翻页、保存或重试。下一页保留原筛选/身份和外层next_cursor。详见[命令行工作项读取](../../docs/design/01-contracts/work-item-projection-runtime.md)。仅源码文档人工审阅，未编译、测试、运行命令或发布。

2026-11-04：新增`artifacts compare --json-file QUERY.json [--timeout-ms 30000]`，也支持`--json`及网络入口有界`--json -`；嵌入不读stdin。输入最多4 KiB，仅含artifact_id/from_version/to_version/expected_actor_id/expected_client_id；两版本必须不同，账号ULID和客户端需匹配实际读者，范围沿现有WORKCTX项目配置。网络固定原token，嵌入逐次核对可信未过期artifact.read、完整身份和SDK实际请求，两个指定历史读取共用SDK总期限；任一失败不返回部分对比。成功stdout是明确本地组合的WcpArtifactComparisonResult，包含query/identity_constraints/from/to/comparison，正文未检查；这是独立返回形状，没有外层data或新的Gateway操作。拒绝--key/--output/重复未知参数，不自动下载/上传/保存。详见[命令行版本对比](../../docs/design/01-contracts/artifact-versions-runtime.md#命令行版本对比源码阶段)。仅源码文档，未编译、测试、执行命令或发布。

2026-11-04：新增 `artifacts list --json-file QUERY.json [--timeout-ms 30000]`，也可用 `--json '{}'` 读取首屏；网络入口支持有界 `--json -`，嵌入入口不读stdin。查询`{query?, classification?, limit?, cursor?}`最多8 KiB，名称按字面子串与ASCII大小写规则匹配，分类精确，默认20最多20条。下一页原样传入`data.next_query`；改变筛选/页大小/身份/权限后需去掉cursor重读。网络与嵌入均复用SDK listArtifacts的完整响应校验、256 KiB上限及默认30秒期限；拒绝key/output/重复参数，不自动翻页、下载或保存。文件ID倒序目录只反映各页当前可见性，选定记录后可用`artifacts version`读取所见版本，详见 [项目目录客户端](../../docs/design/01-contracts/artifact-registry-runtime.md#命令行与-mcp源码阶段)。仅源码文档人工审阅，未编译、测试、执行命令或发布。

2026-11-04：新增 `artifacts versions --json-file QUERY.json [--timeout-ms 30000]`，也可用 `--json`（网络入口支持有界 `--json -`；嵌入入口不读stdin）。查询JSON为`{artifact_id, limit?, at_version?, before_version?}`，最多4 KiB；默认10最多20条，下一页原样使用返回的`data.next_query`，不把整个响应或单独before_version当查询。网络和嵌入复用SDK listArtifactVersions，完整成功256 KiB、默认30秒，嵌入要求有效已验证reader。拒绝`--key/--output`、重复/额外选项，不自动翻页或读取正文。选定版本后另行调用`artifacts version`或下载流程，详见 [版本目录客户端](../../docs/design/01-contracts/artifact-versions-runtime.md#命令行与-mcp源码阶段)。仅源码文档人工审阅，未编译、测试、执行命令或发布。

2026-11-04：回执文件解析已与工作台及新增SDK `inspectArtifactReceipt`共用contracts的`parseSavedArtifactReceipt`和4 MiB上限；仍使用现有裸WCP封套、稳定文件读取与Node摘要，参数、输出和本地保存流程保持。独立SDK调用可额外约束实际/规范回执SHA-256，详见 [共享解析](../../docs/design/01-contracts/artifact-persistence-runtime.md#sdk-原回执离线核验与共享解析源码阶段)。仅源码文档人工审阅，未执行命令或测试。

新增 `artifacts receipt --json-file ORIGINAL.json --output NEW_RECEIPT.json`，网络与嵌入均可显式保存原回执；不指定output时保持原返回形状。指定后stdout含`data.receipt`与独立`data.local`，文件保存失败也保留完整查询结果，退出1；保存并读回成功退出0，临时清理待处理仍在local中说明。文件本身只含完整WCP回执封套，最多4 MiB，查询前检查新路径，独占发布后完整读回；查询超时不启动保存，保存不受查询计时器竞速。`recorded/not-observed`原义保持，未观察到不能当作上传失败。

新增离线 `artifacts inspect-receipt --receipt-file RECEIPT.json [--json-file ORIGINAL.json]`，不需要配置/登录/网络。稳定读取并完整核对封套、原身份/命令及适用历史快照，可选比对独立原请求文件（1 MiB）；返回实际文件字节摘要、完整回执/原请求及original_binding。本地结构有效不认证服务器或内容，外层source_refs为空，原回执trace保留在嵌套receipt内；不改键/版本、不上传或写文件。输入需使用保存的回执文件或无output查询得到的裸封套，不能把带local的stdout包装当作回执文件。见 [保存与离线核验](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-原回执保存与离线核验源码阶段)。仅源码文档人工审阅，未编译、类型检查、测试、执行上述命令或发布。

网络 `artifacts create/put-version` 已改用FetchWcpTransport的bounded-json multipart路径，完整成功响应最多4 MiB、错误16 KiB，HTTP超时覆盖凭据/网络/逐块响应等待，完整结果解析后再次检查期限。共享结果解析对嵌入入口也施加4 MiB纯JSON限制；派发后错误只保留同trace有限错误码与固定消息，丢弃上游details/重试建议，固定retryable=false、artifact_outcome=unconfirmed和server_outcome=unknown。嵌入入口同时清除旧if_match；文件读取/原SHA预检和参数保持，没有给文件I/O或嵌入writer添加隐藏后台超时。详见 [上传响应限制](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-上传响应限制与未知结果源码阶段)，仅源码文档人工审阅，未编译、测试、执行或发布。

网络 `artifacts download` 的历史元数据GET已改用2 MiB bounded-json，衔接SDK Fetch bytes新增的严格二进制媒体类型、完整长度、16 KiB错误上限及凭据/正文期限。原CLI参数、固定版本校验和文件保存流程保持；下载传输改动仅源码兼容审阅，未编译、测试或执行命令，详见 [下载期限与取消](../../docs/design/01-contracts/artifact-persistence-runtime.md#sdk-下载期限与取消源码阶段)。

CLI `artifacts prepare` 与 SDK `prepareArtifactUpload` 现共用 `ArtifactUploadDraft/parseArtifactUploadDraft`，同样拒绝旧身份/键/内容描述符及未明确填写的追加版本。CLI仍独占保存并读回文件；SDK仅返回待保存原请求。共享调整仅源码文档，未编译、测试或执行命令。

新增 `artifacts inspect-request --json-file ORIGINAL.json [--file CONTENT [--max-bytes N]]`，无需项目配置或令牌，离线完整核验原请求；可选核对内容长度和SHA-256。返回原身份/完整命令、实际文件摘要、规范请求摘要及content_state，保留原键/预期版本；不写文件、不调用Gateway或认证文件身份。未提供内容时明确not-checked，成功退出0只表示本次本地检查通过，不确认此前上传结果。请求文件最多1 MiB；内容默认64 MiB，可显式0至1 GiB，max-bytes仅随file允许。详见 [离线核验边界](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-原请求离线核验源码阶段)。仅源码文档，未执行命令、编译或测试。

新增 `artifacts prepare --json-file DRAFT.json --file CONTENT --output NEW_ORIGINAL.json`：为新建或追加版本准备完整原上传请求；追加草稿须含已审阅的 `expected_version`，与当前版本不同即拒绝。读取当前可信上传身份并核对文件大小/摘要后，生成一次新键，独占保存 `{ identity, command }` 并完整读回；不发送上传。可选 `--max-bytes` 默认64 MiB，实际不超过身份返回上限；`--timeout-ms` 默认180秒，保存开始后等待保存与读回结束。新输出路径必须不存在，草稿和请求各最多1 MiB，拒绝旧身份、键、hash/size、stdin及重复参数。保存失败保留可检查路径；见 [草稿示例、后续上传与恢复边界](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-上传原请求准备源码阶段)。仅源码文档，未编译、测试或执行命令。

新增 `artifacts identity [--timeout-ms 30000]`，只读当前可信上传账号、会话期限、上传大小上限和读取权限提示；要求实际artifact.write，admin不能代替。仅允许一次timeout-ms，不接JSON、请求键、文件或输出路径；HTTP复用SDK，内嵌router核对完整原可信身份/期限/能力，不创建请求或上传。见 [CLI/MCP上传身份](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-与-mcp-上传身份读取源码阶段)。仅源码文档，未编译、测试、调用或发布。

`inbox application-apply/application-apply-preview/application-pending/application-replay` 新增 `application:{name:'client-event-history',version:'1'}`，按原消费者的连续接收页保存完整客户端事件内容；不同生产者同名事件分开记录，重复原身份或游标回退拒绝。见 [客户端事件历史](../../docs/design/01-contracts/sync-client-event-application-runtime.md)。不把接收记录当成源字段生效或outbox结算依据，仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-backup-import-preview/restore-requeue-backup-import --outbox EXISTING_FILE --archive-file BACKUP --json/--json-file QUERY`，使用备份摘要提供的import_query。完整源验证后打开已有库，预览原生只读，实际整批只补缺失父历史和批次、相同保留、冲突拒绝。保留未知提交/回滚及关闭状态；不恢复当前事件。见 [联合备份导入](../../docs/design/01-contracts/outbox-restore-requeue-backup-import-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-backup-history/get/export --archive-file BACKUP`：history可选分页JSON；get/export使用backup_sha256/requeue_id选择，get可用output保存原请求，export必须用output保存完整独立回执。所有入口先完整核验备份，不依赖项目配置或数据库；导出摘要中的import_query可接已有单批次历史导入。见 [备份离线取用](../../docs/design/01-contracts/outbox-restore-requeue-backup-access-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-backup --outbox EXISTING_FILE --output NEW_FILE`，可选JSON设置完整读取预算；单快照保存项目全部批次及去重父历史。`outbox inspect-restore-requeue-backup --archive-file FILE` 无需项目配置即可离线完整核验。独占保存并最终读回，保留文件发布/清理和关闭状态，stdout仅摘要。见 [完整备份](../../docs/design/01-contracts/outbox-restore-requeue-backup-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-import-preview/restore-requeue-import --outbox EXISTING_FILE --receipt-file FILE --json/--json-file QUERY`，使用文件摘要返回的import_query。完整源验证和项目核对后，先预览或显式原子补入缺失父历史/批次回执；保留相同历史、拒绝冲突，不恢复或发送事件。见 [历史导入](../../docs/design/01-contracts/outbox-restore-requeue-import-runtime.md)。保留原文件/查询、候选计划、提交/回滚及关闭状态；仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-export` 独占保存完整单批次回执文件，包含父恢复回执和原档案；`inspect-restore-requeue-receipt` 可离线核验，`restore-requeue-file-get` 按文件摘要/批次ID找回原请求并可显式保存。离线入口不要求配置/令牌或数据库，输出只含元数据或原请求/回执。见 [独立回执文件](../../docs/design/01-contracts/outbox-restore-requeue-file-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-audit --outbox EXISTING_FILE [--json QUERY | --json-file QUERY_FILE]`，可使用目录返回的audit_query审计整个项目。可选max_receipts/max_bytes/timeout_ms控制完整历史读取预算，原生只读，失败保留批次与恢复ID、已检查计数和关闭状态，不接受output。见 [完整历史审计](../../docs/design/01-contracts/outbox-restore-requeue-audit-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-history --outbox EXISTING_FILE [--json QUERY | --json-file QUERY_FILE]`，按当前项目浏览批次元数据，默认10最多20，支持after_requeue_id续页。返回get_query用于完整核验和找回原请求，next_query继续目录；关联历史与选中内容明确未核验。原生只读，不接受output。见 [回执目录](../../docs/design/01-contracts/outbox-restore-requeue-history-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-requeue-get --outbox EXISTING_FILE --json-file SELECTION [--output NEW_QUERY_FILE]`，按scope/requeue_id找回完整原查询及回执。可选输出先预检、完整读取并尝试关闭后独占保存原查询，最终核对字节/SHA/JSON；缺记录不创建文件，失败保留历史/文件/关闭状态。见 [按ID找回原请求](../../docs/design/01-contracts/outbox-restore-requeue-selection-runtime.md)。仅源码文档，未执行、编译、测试或发布。

批量重新排队查询可加requeue_id以保存原回执；新增 `outbox restore-requeue-receipt --outbox EXISTING_FILE --json-file ORIGINAL_QUERY`，要求包含该ID的完整原查询，只读核验回执及关联原历史。精确重复原操作/预览只返回历史，不重新检查或修改当前队列。见 [持久原回执](../../docs/design/01-contracts/outbox-restore-requeue-receipt-runtime.md)。未编译、测试、运行、初始化表或发布。

新增 `outbox restore-requeue-preview/restore-requeue --outbox EXISTING_FILE --json-file QUERY`：绑定原恢复ID、档案SHA、暂停版本和显式事件列表，先预览或整批重新排队；不接受档案文件、不自动发送。失败保留原查询、候选计划、提交/回滚及关闭状态；同查询重复调用不作为提交凭据。见 [批量重新排队](../../docs/design/01-contracts/outbox-restore-requeue-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-prepare --outbox EXISTING_FILE --archive-file ORIGINAL_ARCHIVE --json-file PREPARATION --output NEW_QUERY_FILE`：输入scope（可取配置）/新restore_id/reason，只读检查目标后独占保存完整五字段恢复查询，可供restore-preview/restore使用。完成读取及关闭尝试后写文件并核对最终字节，失败保留原请求/计划/文件状态。见 [恢复请求准备](../../docs/design/01-contracts/outbox-restore-prepare-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增离线 `outbox restore-backup-history/get/export`：显式 `--archive-file`，目录可省略JSON，get/export须提供backup_sha256/restore_id，export另需 `--output NEW_FILE`。目录直接给出绑定原文件摘要的next_query/get_query，导出保留原事件档案文档摘要并完整读回；不需队列/项目配置/令牌。见 [备份离线取用](../../docs/design/01-contracts/outbox-restore-backup-access-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-history-import/restore-history-import-preview`，显式已有 `--outbox`、完整历史备份 `--archive-file` 和原scope/backup_sha256查询。预览显示缺失/相同/冲突；实际导入只补缺失项，完整读回后提交，不恢复当前事件；未知结果保留原输入和事务/关闭状态。见 [历史导入](../../docs/design/01-contracts/outbox-restore-backup-import-runtime.md)。仅源码文档，未执行、编译、测试或发布。

新增 `outbox restore-history-backup --outbox EXISTING_FILE --output NEW_FILE` 与 `outbox inspect-restore-history-backup --archive-file FILE`。完整备份项目恢复回执和原档案，支持有界查询；读取和关闭尝试后独占保存并完整读回核验，离线检查无需队列/项目配置/令牌。见 [恢复历史备份](../../docs/design/01-contracts/outbox-restore-backup-runtime.md)。仅源码文档，未执行命令、编译、测试或发布。

新增 `outbox restore-compare --outbox EXISTING_FILE --json/--json-file QUERY`，必须明确 restore_id/event_id，scope 可补入已固定的配置范围；只读展示原档案、恢复基线和当前摘要及变化列，保留底层定位和关闭状态。见 [恢复记录对照](../../docs/design/01-contracts/outbox-restore-comparison-runtime.md)。仅源码文档，未执行命令、编译、测试或发布。

新增 `outbox restore-audit --outbox EXISTING_FILE`，可选 `--json/--json-file` 指定max_receipts/max_bytes/timeout_ms与scope；只读核验整个项目的恢复历史，拒绝输出文件、游标和原档案输入。目录audit_query可直接使用默认预算，失败保留进度/位置/关闭状态。见 [恢复历史核验](../../docs/design/01-contracts/outbox-restore-audit-runtime.md)。仅源码文档，未执行命令、编译、测试或发布。

2026-11-03：已有本地只读命令统一继承Bridge的原生SQLite只读打开，包括收发队列查询/审计、导出、历史查看与预览。参数保持不变；读取无法打开时直接保留错误，不改为可写连接或初始化主库。文件导出仍是显式新文件操作。仅源码文档，未编译、测试、执行CLI或打开数据库。

新增 `outbox restore-preview --outbox EXISTING_FILE --archive-file FILE --json-file ORIGINAL_QUERY`，沿用实际恢复查询和完整档案，以readonly模式查看目标条件和预计变化，实际restore重新检查。预览不输出文件或写回队列。见 [恢复前预览](../../docs/design/01-contracts/outbox-restore-preview-runtime.md)。仅源码文档，未编译、测试、运行或发布。

新增 `outbox restore-history/restore-get/restore-export`，显式指定已有 `--outbox`，可浏览历史、按 ID 找回原查询和完整回执、独占导出原档案到 `--output NEW_FILE`。导出在读取和关闭尝试后写文件，失败保留历史与路径。见 [恢复历史](../../docs/design/01-contracts/outbox-restore-history-runtime.md)。仅源码文档，未编译、测试、运行或发布。

新增 `inbox application-pending --inbox FILE --json-file QUERY`，输入原身份/application 与可选 limit/timeout_ms，发现当前应用头后的已接收页面。`next_apply_query` 可交给预览或显式应用；应用推进后用 `refresh_query` 重读，不自动处理或确认。见 [待应用原页发现](../../docs/design/01-contracts/sync-application-pending-runtime.md)。仅源码文档，未执行命令、编译或测试。

新增 `inbox application-apply-preview --inbox FILE --json-file QUERY`，复用原 application-apply 查询和三个内置适配器，只读打开已有库，输出已存状态与预计投影；拒绝文件输出，失败保留原查询/阶段和关闭状态。实际 apply 重新校验，预览不提交或确认。见 [原页应用预览](../../docs/design/01-contracts/sync-application-apply-preview-runtime.md)。仅源码文档，未执行命令、编译或测试。

`inbox application-apply` 和 `application-replay` 新增 `application:{name:"conflict-lifecycle",version:"1"}`，保存与重算原冲突发现/决策历史。必须从原检测事件建立基线，决策保留 resolved_value，原字段/版本/来源变化或分类下调会拒绝整页；不发起决策或更新源字段。见 [冲突生命周期](../../docs/design/01-contracts/sync-conflict-application-runtime.md)。仅源码文档，未执行命令、编译或测试。

`inbox application-apply` 和 `application-replay` 新增 `application:{name:"proposal-lifecycle",version:"1"}`，显式处理原建议创建/确认/拒绝事件，并可只读重算完整保存历史。与 context-item-lifecycle/1 使用独立应用进度，不能替换已有应用头；缺原创建事件会拒绝。输入仍要求原身份和对应页/预算参数，见 [建议生命周期](../../docs/design/01-contracts/sync-proposal-application-runtime.md)。仅源码文档，未运行命令、编译或测试。

新增 `inbox application-restore-receipt-audit --inbox FILE --json-file QUERY`，按原身份/应用检查全部历史恢复回执。支持 max_receipts/max_bytes/timeout_ms，目录返回的 receipt_audit_query 可直接使用默认预算；超限明确未完成，不输出部分通过或续页。见 [回执完整范围审计](../../docs/design/01-contracts/sync-application-restore-receipt-audit-runtime.md)。仅源码文档，未执行命令、编译或测试。

新增 `inbox application-restore-receipt-scopes --inbox FILE --json '{}'`，从回执找回原身份与应用；支持 limit/timeout_ms 和成对的 after_consumer_key/after_application_key。返回的 receipt_list_query 可继续发现该范围的请求 ID，也可用 receipt_get_query 读取代表回执。见 [跨范围目录](../../docs/design/01-contracts/sync-application-restore-receipt-scopes-runtime.md)。只读、不输出文件；仅源码文档，未运行或测试。

恢复回执 get 可用 `--receipt-output NEW_FILE` 保存完整历史回执，与保存纯查询的 --output 互斥。新增 application-restore-receipt-inspect/query，使用 --receipt-file 离线核验/查看或提取原查询，详见 [回执文件](../../docs/design/01-contracts/sync-application-restore-receipt-file-runtime.md)。核验文档和原查询两层摘要，不打开库或导入回执。仅源码文档，未执行命令、生成文件、编译或测试。

新增 `inbox application-restore-receipt-list --inbox FILE --json-file QUERY`，按原身份/应用发现历史请求 ID；可选 limit（1–50）、after_request_id、读取 timeout_ms，返回 next_query 和每条 receipt_get_query。可接已有 get 找回并保存原查询。见 [回执目录](../../docs/design/01-contracts/sync-application-restore-receipt-catalog-runtime.md)。仅源码文档，未运行命令、编译或测试。

新增 `inbox application-restore-receipt-get --inbox FILE --json-file SELECTION [--output NEW_QUERY]`，按原身份/应用/请求 ID 找回历史回执及原查询。可另设本次读取 timeout_ms；输出文件保留原恢复期限、归档摘要和目标约束，不自动恢复。缺记录不创建文件，已有文件不覆盖。见 [原查询找回](../../docs/design/01-contracts/sync-application-restore-receipt-selection-runtime.md)。仅源码文档，未执行命令、生成文件、编译或测试。

新增 `inbox enable-application-restore-receipts --inbox FILE` 显式启用回执扩展，以及 `inbox application-restore-receipt --inbox FILE --json-file ORIGINAL_QUERY` 只读查询。恢复/预览查询可显式带 restore_request_id，预览保存的最终查询保留 ID 和目标约束，可供实际恢复及回执查询复用。相同请求返回历史回执；缺记录不证明回滚，不自动重试。见 [持久回执契约](../../docs/design/01-contracts/sync-application-restore-receipt-runtime.md)。仅源码文档，未执行命令、扩展、编译或测试。

恢复预览可用 `--output NEW_FILE` 显式保存带目标约束的恢复查询，之后直接交给 application-restore 的 --json-file。仅 restore_allowed=true 时独占创建新文件，预览事务结束并尝试关闭后才写入，最终读回核对完整字节/摘要；冲突返回 request_file.state=not-created，发布后读回失败保留 published-unconfirmed 和路径。现有文件不覆盖，保存不执行恢复。见 [恢复请求文件](../../docs/design/01-contracts/sync-application-restore-request-runtime.md)。仅源码文档，未运行命令、生成文件、编译、测试或发布。

恢复预览现返回带 expected_target 的 restore_query，固定本次观察的应用历史和完整接收链。原 JSON 可选 expected_target={schema_version:1,application_history_sha256,received_history_sha256}；两项均须为完整小写 SHA-256。实际恢复在任何插入前核对，目标变化报 INBOX_APPLICATION_RESTORE_TARGET_CHANGED；原约束预览发现变化则返回 conflict 和原/当前摘要，不自动替换查询。成功返回 target_before/target_after；一次有新增内容的恢复后，旧约束将不再匹配，后续变化也不能证明上次未知提交是否写入。见 [目标绑定契约](../../docs/design/01-contracts/sync-application-restore-target-runtime.md)。仅源码文档，未执行命令、编译、测试或发布。

新增只读应用恢复预览（仅源码，示例未执行）：

```text
workctx inbox application-restore-preview --inbox local-inbox.sqlite --archive-file application-history.json --json-file restore-query.json
```

使用与 application-restore 相同的原身份/应用/归档摘要查询；在只读打开前核验文件与绑定，单次读取事务完整检查目标应用和接收链。返回目标关系、正序首个不同页/字段/摘要、预计新增页/事件及保留后缀数。合法冲突返回 status=conflict、restore_allowed=false、planned_changes/restore_query=null，命令退出码仍为 0；应读取结果字段判断是否兼容。损坏、超限或未完成则报错。不写入、不自动恢复或确认，预览不冻结目标；另行恢复会重新检查。见 [恢复预览契约](../../docs/design/01-contracts/sync-application-restore-preview-runtime.md)。未编译、测试、运行命令或打开库。

新增应用归档恢复（仅源码，示例未执行）：

```text
workctx inbox application-restore --inbox local-inbox.sqlite --archive-file application-history.json --json-file restore-query.json
```

原查询必须包含完整 expected_identity、application={name,version}、archive_document_sha256，可选 timeout_ms（默认 30000、最多 90000）。先完整核对文件及身份/应用/摘要，再打开已有库；core/application 扩展须已存在。单事务只恢复空应用或确认完整相同历史，补齐兼容接收前缀并保留较新接收后缀，原页/投影/原 trace/事件绑定/应用头一并写入和完整读回。返回 restored/already-restored/empty、完整状态和文件信息；提交/回滚未知时保留 unknown 与原查询/进度，关闭失败保留 close_pending。不自动初始化、运行 reducer、发送确认或重试；不同应用历史拒绝覆盖。见 [应用归档恢复契约](../../docs/design/01-contracts/sync-application-restore-runtime.md)。未编译、类型检查、测试、执行命令或打开库。

新增应用历史归档导出和离线浏览（仅源码，示例未执行）：

```text
workctx inbox application-export --inbox local-inbox.sqlite --json-file application-query.json --output application-history.json
workctx inbox application-inspect --archive-file application-history.json
workctx inbox application-inspect --archive-file application-history.json --json-file archive-next-query.json
workctx inbox application-archive-get --archive-file application-history.json --json-file archive-selection-query.json
```

export 的原应用 JSON 含 expected_identity/application，可选 timeout_ms；先完整审计应用历史，只读事务结束并尝试关闭后独占保存新文件，最终读回核对全部摘要。归档包含原页面与逐页完整投影/原 trace，最多 1000 页/16 MiB 文档，投影 1 MiB。inspect 默认 20/最多 50 项，可用 next_query 续页、selection_query 精确读快照；每次先核对整个文件的页面/投影/外层摘要。get 要求原归档和页面两个摘要，缺页返回 found=false/snapshot=null。离线入口不加载 Bridge/数据库，不接受 inbox/output，不发送请求；保存失败保留路径和关闭信息。摘要不认证来源/业务语义，未包含确认日志/未应用后缀；导入恢复已另接上述显式入口，实际恢复证据仍缺。详见 [应用归档契约](../../docs/design/01-contracts/sync-application-archive-runtime.md)。未执行命令或生成样本，无新 schema/依赖。

新增已保存应用目录（仅源码，示例未执行）：

```text
workctx inbox application-list --inbox local-inbox.sqlite --json-file application-catalog-query.json
```

JSON 要求完整 expected_identity，不要求预先知道应用名；可选 limit（默认 20、最多 50）、after_application_key、timeout_ms。next_query 可继续当前目录；每项含名称/版本、当前头摘要、可交给 status/audit 的 application_query，以及固定本次头上界的 history_query 和指定快照 snapshot_query。先完整核验成员/前瞻，再返回摘要，不输出投影正文。只读打开已有库，不自动启用、翻页、创建应用、重放或请求网络；不冻结跨调用目录或扫描缺描述的孤立记录。见 [应用目录契约](../../docs/design/01-contracts/sync-application-catalog-runtime.md)。无新 schema/依赖，未运行命令或数据库。

新增内置应用历史重放核对（仅源码，示例未执行）：

```text
workctx inbox application-replay --inbox local-inbox.sqlite --json-file application-replay-query.json
```

查询要求完整 expected_identity 和固定 application（context-item-lifecycle/1、proposal-lifecycle/1、conflict-lifecycle/1 或 client-event-history/1），接受 application-audit 的 max_pages/max_events/max_bytes/timeout_ms，另加 max_replay_bytes（默认 64 MiB、最多 512 MiB）。只读打开已有库，在同一事务先完整核对结构，再从 null 正序重算每页并严格比较保存快照；成功只表示当前内置规则下所有快照相符，遇到损坏、规则拒绝、差异或超限即报未完成并保留页/事件位置。不改变保存状态或发送确认，也不自动修复、导出或加载自定义模块。详见 [重放核对契约](../../docs/design/01-contracts/sync-application-replay-runtime.md)。未运行命令、reducer 或数据库，无新 schema/依赖。

应用历史新增只读分页和指定快照读取（仅源码，示例未执行）：

```text
workctx inbox application-history --inbox local-inbox.sqlite --json-file application-history-query.json
workctx inbox application-get --inbox local-inbox.sqlite --json-file application-selection-query.json
```

两个查询均含完整 expected_identity/application，可选 timeout_ms。history 默认 20、最多 50 项，续页直接使用返回的 next_query，固定首次上界及上次末项的序号/原页摘要/投影摘要；每项 selection_query 可交给 get，读取该页对应的完整历史投影并核对预期投影摘要。get 也可显式给 document_sha256 和可选 expected_projection_sha256，缺步骤返回 found=false/snapshot=null，摘要变化明确报错。两个入口独立展示当前头，不推进或回退应用进度；前瞻同样核验，损坏/超限不输出部分列表。只读打开已有库，不自动启用扩展、翻页、导出或请求网络。详见 [历史浏览契约](../../docs/design/01-contracts/sync-application-history-runtime.md)，仍非完整历史审计或业务语义证明；无新 schema/依赖，未运行命令或数据库。

应用历史新增只读结构审计（仅源码，示例未执行）：

```text
workctx inbox application-audit --inbox local-inbox.sqlite --json-file application-audit-query.json
```

查询含完整 expected_identity/application，可选 max_pages（默认 1000、最多 10000）、max_events（默认 100000、最多 1000000）、max_bytes（默认 64 MiB、最多 512 MiB）和 timeout_ms（默认 30000、最多 90000）。同一只读事务从应用头遍历到根，完整核对原页、全部投影摘要、事件 ledger、游标/前驱、实际行数及空页投影不变性。只有全部覆盖才返回 complete；超限/损坏/超时明确未完成。结果保留完整 state 和本次结构审计范围，不重跑 reducer、不证明业务内容正确或服务端已应用；普通 application-status 不继承历史审计标记。不自动建库、修复或发送确认，详见 [应用历史审计契约](../../docs/design/01-contracts/sync-application-audit-runtime.md)。未运行命令或数据库，无新 schema/依赖。

首个内置应用已接入显式原页处理（仅源码，示例未执行）：

```text
workctx inbox application-apply --inbox local-inbox.sqlite --json-file application-page-query.json
```

查询必须含完整 expected_identity、application（name 为 context-item-lifecycle/proposal-lifecycle/conflict-lifecycle/client-event-history 之一，version 为 "1"）、已导入原页 document_sha256 和原预期前驱 expected_previous_sha256（根页为 null），可选 timeout_ms。先使用下述 enable-applications；命令不自动建库/启用、选最新页或发送确认。主程序/嵌入入口均本地执行，仅接受已有内置适配器，不加载外部模块。重复同一已提交原页返回当前状态，不重跑处理。

context-item-lifecycle/1 投影只保存上下文创建/更新/确认/归档/恢复的历史状态元数据及创建/最新事件，服务端事件不包含完整正文。必须有版本 1 的原创建事件，后续版本连续；缺基线、断档、非法迁移或分类改变拒绝整页。最多 512 条，另受 1 MiB 投影/单页 64 MiB 处理预算限制。结果 adapter 明确列出处理/范围外类型，未知类型拒绝，applied_cursor 仅对应此本地投影。详情与错误边界见 [上下文生命周期投影契约](../../docs/design/01-contracts/sync-context-item-application-runtime.md)。无新 schema/依赖，未执行命令、数据库操作、编译或测试。

本地应用存储启用和状态读取已接入 CLI（仅源码，示例未执行）：

```text
workctx inbox enable-applications --inbox local-inbox.sqlite
workctx inbox application-status --inbox local-inbox.sqlite --json-file application-query.json
```

enable-applications 只接受已有 inbox 路径，显式启用可选 application v1，返回 enabled/already-enabled。它不创建原收件箱、不注册应用或处理事件。application-query.json 内容如下；名称/版本必须与调用 Bridge 应用接口时使用的值一致，身份必须是完整原消费者身份：

```json
{
  "expected_identity": {
    "tenant_id": "tenant_demo",
    "workspace_id": "workspace_demo",
    "project_id": "project_demo",
    "actor_id": "actor_demo",
    "client_id": "client_demo"
  },
  "application": { "name": "local_projection", "version": "v1" },
  "timeout_ms": 30000
}
```

状态命令必须提供 --json/--json-file 二选一；查询最多 16 KiB，timeout_ms 可省略，默认 30000、范围 1–90000。此预算用于 Bridge 读取事务，不覆盖参数文件读取或打开库。严格解析后只读打开已有库；缺少/不完整扩展明确失败，不自动启用。结果 data.state 保留完整投影、摘要、原应用 trace、applied_cursor、page_count、head_sha256 和本地应用边界。recorded=false 仅表示指定应用没有保存进度，不判断源页面链是否存在。主程序和嵌入入口都不读取当前账号/令牌、不调用网络或路由器；重复/未知选项、--page-file、--output、--key 和 --timeout-ms 均拒绝。

成功结果保留 close_pending；操作失败的原错误码、提交/回滚未知状态与关闭失败标记同时保留。应用版本是调用方声明，不是代码认证；状态读取不是完整应用历史审计或服务端应用证明。CLI 只支持上述内置应用，其他自定义投影仍须调用 Bridge 的受信同步 reducer 接口。该 SQLite 扩展未执行，无新增 schema/依赖；详见 [应用运行契约](../../docs/design/01-contracts/sync-inbox-application-runtime.md)。

收件箱新增原确认日志（仅源码，示例未执行）：

```text
workctx inbox enable-ack --inbox local-inbox.sqlite
workctx inbox enable-ack-dispatch --inbox local-inbox.sqlite
workctx inbox ack --inbox local-inbox.sqlite --page-file page-001.json --timeout-ms 30000
workctx inbox ack-status --inbox local-inbox.sqlite --json-file consumer-identity.json
workctx inbox ack-observe --inbox local-inbox.sqlite --page-file page-001.json
workctx inbox ack-dispatch-status --inbox local-inbox.sqlite --json-file consumer-identity.json
workctx inbox ack-retry --inbox local-inbox.sqlite --page-file page-001.json --dispatch-id LATEST_DISPATCH_ID
```

enable-ack 显式启用已有收件箱的可选日志扩展，ack-status 本地读取，二者不请求网络。ack 必须选择已导入的完整原页面；先事务保存 unconfirmed 原目标，提交后才通过 SDK 发送，再完整核验成功响应并保存 confirmed。已有未知意图阻止再次发送；同一页已有最新已解决记录时只返回本地 already-recorded。ack-observe 仅对最新未解决原页面读取当前服务器确认：recorded=true 且位点已达到目标时记 observed，较低位点仍为 unconfirmed/退出 1。observed 不等于原请求历史回执，所有状态都不证明事件已应用。

首次 ack 现在还要求显式 enable-ack-dispatch，原目标与派发占用在同一事务登记。ack/ack-observe 接受 --inbox、--page-file 和可选 --timeout-ms/--result-output；ack-retry 另须最新 --dispatch-id，保留原身份/页面/cursor/request trace，并登记新的派发 ID/调用 trace。ack-dispatch-status 本地查询最新目标和派发；重复旧 ID 拒绝重发，active 占用期限内拒绝接替。期限为请求预算加 60 秒，届满不证明远端已停止；结束但结果未知的派发可明确重试，不自动请求。缺派发历史的旧未知意图可继续观察，或使用下述显式 ack-recover，不补造历史。

完整服务器结果已收到但本地记录失败时，错误保留 server_result，不丢弃已知证据。ack/dispatch/recovery 三个扩展 v1 均未执行，核心 schema 未变；显式放弃、旧发送者协调、证据导入和应用事务仍待完善。见 [确认日志开发契约](../../docs/design/01-contracts/sync-inbox-ack-runtime.md)。

调用时可另选新文件保存本次完整服务器结果（仅源码，示例未执行）：

```text
workctx inbox ack --inbox local-inbox.sqlite --page-file page-001.json --result-output ack-result.json
workctx inbox ack-observe --inbox local-inbox.sqlite --page-file page-001.json --result-output observation-result.json
workctx inbox ack-result-inspect --result-file ack-result.json
workctx inbox ack-result-page --result-file ack-result.json --output recovered-page.json
```

ack-retry/ack-recover 同样接受 --result-output。路径在打开库/请求前预检，结果在日志处理和尝试关闭库后保存。结果文件包含完整原页面、请求前原记录/派发、本次调用 trace、完整 server_result 和 journal_update；不把请求前未知状态改成确认。本地重放或没有有效新结果不会创建文件。日志失败仍返回原错误与完整服务器结果，文件保存结果附在 result_file；日志处理完成但文件失败则明确返回 INBOX_ACK_RESULT_SAVE_FAILED，保留完整服务器结果。离线 inspect/page 无需账号或库，不导入或修改日志；文件不是可信服务器凭证，详见 [调用结果文件开发契约](../../docs/design/01-contracts/sync-ack-result-runtime.md)。

确认/派发历史也已有本地只读入口（仅源码，示例未执行）：

```text
workctx inbox ack-history --inbox local-inbox.sqlite --json-file consumer-identity.json
workctx inbox ack-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json
workctx inbox ack-dispatch-history --inbox local-inbox.sqlite --json-file dispatch-history-query.json
workctx inbox ack-dispatch-get --inbox local-inbox.sqlite --json-file dispatch-selection.json
workctx inbox ack-audit --inbox local-inbox.sqlite --json-file acknowledgement-audit-query.json
```

所有查询 JSON 都必含完整 expected_identity；ack-get 另含 record_id，ack-dispatch-get 另含 dispatch_id。列表可含 limit（默认 20、1–50），派发列表可含 record_id 限定原目标。下一页复制返回的 next_query，固定原身份、上界序号/ID与筛选；新记录不混入本轮翻页，但已有证据状态可以更新，不称为冻结快照。列表返回经过完整核验的摘要，详情返回完整原响应/观察；无令牌或网络要求，不改变未知状态，也不释放派发占用。无新 schema，未打开数据库、编译、测试或执行示例。

ack-audit 的 JSON 只另可含 max_entries（默认 1000、安全正整数），预算为原确认/派发/恢复行数之和。单次读事务核验全部已启用日志的完整证据、引用原页、连续序号及跨消费者关联，预算不足明确未完成；可选扩展缺失单列，部分存在则拒绝降级。成功返回 checked 和状态分布，保留 unknown/active 原义，不重算期限、不修复或重发；确认日志审计不替代独立 audit-pages 或全库物理审计。此入口不接受 output，仍仅源码未执行。

缺派发历史的旧未知意图已有明确恢复入口（仅源码，示例未执行）：

```text
workctx inbox enable-ack-recovery --inbox local-inbox.sqlite
workctx inbox ack-recover --inbox local-inbox.sqlite --page-file original-page.json --record-id ORIGINAL_RECORD_ID
workctx inbox ack-recovery-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json
```

先前 ack/dispatch 扩展需已启用。ack-recover 会按原身份/页面/cursor/request trace 重新发送，必须指定最新原 record_id；新派发与不可变恢复凭据同事务登记，不伪造历史发送。已有派发/重复恢复被拒绝，后续只能明确使用最新派发 ID 重试；已解决目标只返回本地结果。ack-recovery-get 输入 expected_identity/record_id，查看原记录、恢复凭据和首笔本地派发，不请求网络。缺记录不证明旧请求未发出，恢复也不能阻止旧发送者或远端仍在执行；它不是自动恢复或全局互斥。recovery 扩展 v1 仅源码未执行；普通确认/重试无需启用该扩展。

单笔确认/派发可保存为完整离线凭据（仅源码，示例未执行）：

```text
workctx inbox ack-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json --output ack-evidence.json
workctx inbox ack-dispatch-get --inbox local-inbox.sqlite --json-file dispatch-selection.json --output dispatch-evidence.json
workctx inbox ack-recovery-get --inbox local-inbox.sqlite --json-file acknowledgement-selection.json --output recovery-evidence.json
workctx inbox ack-evidence-inspect --evidence-file ack-evidence.json
workctx inbox ack-evidence-page --evidence-file ack-evidence.json --output recovered-page.json
```

普通 get/dispatch-get 继续生成 v1，包含完整原页面、确认记录和可选精确派发；recovery-get --output 生成 v2，另含恢复凭据，并固定其首笔本地派发，缺恢复记录不降级导出。导出保留原身份/游标/trace/页面摘要，在结束读事务并尝试关闭库后写入新文件，不覆盖旧路径；保存后核对两层文档摘要和实际文件字节。inspect 不打开数据库，按实际版本显示完整历史证据及恢复元数据是否包含，不升级旧文件；page 接受两版，只把内嵌原页面提取到新文件。文件不是服务器签名或当前状态证明，不导入确认日志、不解除未知门禁，也不自动续读或重发。原网络错误中尚未入库的 server_result 仍需另行保留；详见 [凭据文件开发契约](../../docs/design/01-contracts/sync-ack-evidence-runtime.md)。

新增独立本地同步收件箱（仅源码，示例未执行）：

```text
workctx inbox init --inbox local-inbox.sqlite
workctx inbox import --inbox local-inbox.sqlite --page-file page-001.json
workctx inbox consumers --inbox local-inbox.sqlite --json '{}'
workctx inbox status --inbox local-inbox.sqlite --json-file consumer-identity.json
workctx inbox audit-pages --inbox local-inbox.sqlite --json-file page-audit-query.json
workctx inbox head --inbox local-inbox.sqlite --json-file consumer-identity.json --output restored-head.json
```

consumer-identity.json 仅含 `{expected_identity:原五字段身份}`，也可用 --json；身份查询最多 16 KiB。这些本地命令均要求显式 --inbox，不读取令牌、不调用网络。init 只创建新文件，已有库不覆盖或自动升级；import 先核验完整页面/摘要，在事务中保存页面并推进对应原身份的 received_cursor。首篇必须从 cursor=0 且无前页，后续须连接当前头摘要、游标和页大小；缺页/分叉拒绝，重复原页不回退当前头。status 核验完整头页及相邻前页，head 导出该读取快照到新文件，可再交给 sync changes --page-file 续读。

audit-pages 使用 page-audit-query.json，必含 expected_identity，可含 max_pages（默认 1000，安全正整数）；同一读取快照核对实际行数/检查点，并逐页完整校验到根。只有全部覆盖才返回 complete，预算不足明确报 INBOX_AUDIT_LIMIT_REACHED，损坏报 INBOX_AUDIT_CORRUPT，不输出局部通过、不自动提高预算或修复。成功附 checked_pages、checked_events、root_sha256 和快照 state；范围仅为选定消费者页面链，确认扩展和全库物理状态标记未审计。此命令不接受 output/page-file，未执行示例。

原身份查询文件丢失时，可用 consumers 查看本库已保存的完整身份与接收位置。必须提供 --json 或 --json-file，首页内容为 {}，可选 limit（默认 20、最多 50）；续页使用返回的 next_query（limit/after_consumer_key）。各项 state.identity 可复制到后续查询的 expected_identity。结果按身份摘要键排序，每次读取当前成员和状态，新加入且排在续页起点之前的身份须从首页重查；外层 scope=null。每项核验完整头页和相邻前页，损坏明确失败；不输出正文、不代替全链审计、全量备份或远端权限确认。此命令拒绝 expected_identity/output/page-file，不请求网络、不自动续页，源码尚未运行。

历史页面也可分页浏览并恢复指定原文件（仅源码，示例未执行）：

```text
workctx inbox page-history --inbox local-inbox.sqlite --json-file page-history-query.json
workctx inbox page-get --inbox local-inbox.sqlite --json-file page-selection.json
workctx inbox page-get --inbox local-inbox.sqlite --json-file page-selection.json --output restored-page.json
```

历史查询必含 expected_identity，可含 limit（默认 20、最多 50）；续页复制 next_query，保留固定上界和前页末项的序号/摘要。返回经完整核验的页面摘要，新追加页面不混入原范围；边界改变或缺页会报错，不自动跳过。精确选择 JSON 仅含 expected_identity/document_sha256，不指定 output 时返回完整原 page、summary 与独立 current_state；指定新 output 则在释放读事务并尝试关闭库后保存原页面，不覆盖旧路径，缺目标不生成文件。两个入口均不请求网络、不自动导入或确认；浏览/单页读取不等于完整链审计或全量备份。

收件箱仅记录连续接收，event_application=not-verified；导入/审计不应用事件，也不发送服务器确认。提交异常为 INBOX_COMMIT_UNKNOWN，保留原库/页面并显式查状态，不自动重导。独立 SQLite schema v1 仅写入源码，尚未初始化或迁移；不替换 outbox，未编译、测试、运行或发布。单消费者页面链及确认日志审计已有上述源码，跨消费者整库审计、applied_cursor 和应用事务仍待开发；见 [收件箱开发契约](../../docs/design/01-contracts/sync-inbox-runtime.md)。

完整页面链现可单独归档、离线检查和原子恢复（仅源码，示例未执行）：

```text
workctx inbox export-pages --inbox source.sqlite --json-file consumer-identity.json --output pages-archive.json
workctx inbox inspect-pages --archive-file pages-archive.json
workctx inbox restore-pages --inbox destination.sqlite --archive-file pages-archive.json
```

export-pages 的 JSON 仅含 expected_identity；同一读事务核验全部根到头页面后，在释放事务并尝试关闭库后保存新文件，不覆盖已有路径。inspect-pages 不打开库，只核验完整档案并显示摘要。restore-pages 要求已有 inbox，目标消费者须为空或拥有完全相同的完整链；全部页面在一个事务恢复，部分/不同/更长链拒绝，不合并或回退。档案最多 1000 页、16 MiB 文档并受整体 JSON 复杂度限制，超限明确失败、不输出局部文件。保留原页面/身份/下载 trace/摘要，但不包含或恢复确认日志、派发占用和事件应用状态。提交错误保持 unknown；重复同一原档可确认完整相同重放，不能据此自动确认服务器。见 [页面链归档契约](../../docs/design/01-contracts/sync-page-chain-runtime.md)。

归档也可离线分页查看和提取指定原页面，无需先创建或恢复数据库（仅源码，示例未执行）：

```text
workctx inbox archive-history --archive-file pages-archive.json --json '{}'
workctx inbox archive-history --archive-file pages-archive.json --json-file saved-next-query.json
workctx inbox archive-page --archive-file pages-archive.json --json-file selected-page-query.json
workctx inbox archive-page --archive-file pages-archive.json --json-file selected-page-query.json --output selected-original-page.json
```

历史默认 20、最多 50，续页复制 next_query；每项 selection_query 可用于 archive-page，固定归档和页面两个摘要。每次先完整核验原档，换成不同文档会拒绝续页/选择；返回页面摘要或完整原页，缺目标为 null，要求导出则明确报错且不造空文件。提取保留原摘要、trace 和前驱，不覆盖已有文件；中间页导入仍需要对应前驱。两个命令不加载 Bridge、不打开库、不自动导入或确认，分页 has_more 与原页面 page_has_more 分开。

目标已有部分页面时，可先比较再显式追加匹配后缀（仅源码，示例未执行）：

```text
workctx inbox compare-pages --inbox destination.sqlite --archive-file pages-archive.json
workctx inbox compare-pages --inbox destination.sqlite --archive-file pages-archive.json --output selected-append-query.json
workctx inbox append-pages --inbox destination.sqlite --archive-file pages-archive.json --json-file selected-append-query.json
```

compare-pages 完整核验本地链，报告相同/空目标/本地前缀/归档前缀/分叉及最早差异摘要。兼容时返回 append_query，可用 --output 将该四字段对象保存到新文件后直接交给 append-pages --json-file；查询绑定原身份、归档摘要、本地头摘要和页数。文件在释放读事务并尝试关闭库后独占保存、最终核对字节和解析，返回 append_query_file；不兼容的保存请求明确失败、不生成计划。未指定 output 的比较成功退出码不等于可以追加，应读取 append_allowed。追加在单次写事务重新完整核对，只写入缺失后缀；即使查询文件保存成功，本地头后续变化仍会报过期。分叉或归档较短拒绝，不覆盖或回退；两个命令不自动互相调用，文件失败保留完整比较和路径。归档格式/原 restore-pages 规则不变，确认日志和应用状态不处理。

同步页面现可显式保存并跨进程读取（仅源码，示例未执行）：

```text
workctx sync changes --json-file consumer-query.json --output page-001.json
workctx sync inspect --page-file page-001.json
workctx sync changes --page-file page-001.json --output page-002.json
workctx sync ack --page-file page-001.json
workctx sync cursor --page-file page-001.json
```

保存模式的 consumer-query.json 必须含原五字段 expected_identity 与显式 cursor，limit 可选（默认 100）。输出保存完整原页面、起始查询、原身份及 SHA-256，已有目标不覆盖；写入同步/读回/发布后再次核验最终文件。stdout 只报告路径、摘要、起止游标、事件数与本次保存状态，完整数据在文件中。文件最多 4 MiB + 36 KiB；损坏/超限/跨项目输入均拒绝。保存失败保留可诊断路径，不发送确认；临时文件清理失败可在成功结果中带 cleanup_pending。

`sync inspect` 离线检查完整文件，不需要环境身份或令牌。其他三个命令的 --page-file 与 --json/--json-file 互斥，从文件恢复原身份并派生下一页查询、确认目标或当前位点查询；无法同时换身份、游标或页大小。从终页继续调用 changes 是显式读取后来变化，不会自动轮询。确认前由调用方完成所需本地消费/应用；文件及其摘要不证明事件已应用或服务器已确认。未知确认用同一文件 cursor 显式查看，不能把本地保存摘要当作历史回执。目录掉电保证、全局最新消费检查点和整条链连续性仍未实现；见 [本地页面文件契约](../../docs/design/01-contracts/sync-saved-page-runtime.md)。

同步消费命令已接入专用网络与嵌入适配（仅源码，以下示例未执行）：

```text
workctx sync cursor
workctx sync changes --json-file saved-consumer-query.json --timeout-ms 30000
workctx sync ack --json-file saved-acknowledgement.json
workctx sync cursor --json-file saved-consumer-identity.json
```

`sync changes` 输入为可选 `{cursor,limit,expected_identity}`，每次只输出一页完整封套；`sync cursor` 输入为可选 `{expected_identity}`，读取当前账号/客户端/项目的确认位点、recorded、identity 与到期提示。两种读取都可省略 JSON；确认 `sync ack` 必须提供已保存的 `{expected_identity,cursor}`。expected_identity 含 tenant_id/workspace_id/project_id/actor_id/client_id 五字段。先保存完整页面、原消费者身份与下一游标，再显式确认；普通 JSON 确认不检查本地页面，--page-file 确认只核验指定页面文件，不证明应用事务。已有未知确认应保留原文件，使用同一 expected_identity 查询，不能切换身份补认。

三者均支持 `--json`、`--json-file` 或 `--page-file` 三选一。前两者为最多 16 KiB 的查询/确认 JSON；--page-file 使用上文完整页面文件限额。文件须为稳定普通 UTF-8 文件，可带 BOM。拒绝 stdin、额外字段、重复/未知选项、写键和版本；确认不新增 reviewed 参数。可选 `--timeout-ms` 默认为 30000，范围 1–2147483647，同时传给 SDK 与 HTTP 传输，计时不含之前的本地文件读取。变化完整封套最多 4 MiB，确认/当前位点最多 32 KiB，网络错误最多 16 KiB；超限或完整解析失败均不输出部分结果。

网络 main 和直接 callGateway 均接同一 SDK；嵌入 runWorkctx 固定可信未过期 sync.read/admin 身份、独立输入/上下文快照，读取清除继承键/版本，确认拒绝继承键/版本。当前游标还核对可信身份和精确到期。确认错误含本次 dispatch_state：派发前 not-sent，网络进入 transport 或嵌入进入 router 后 unknown；超时不能撤销已执行的写入。当前游标不是原请求历史回执，也不证明本地内容保存或应用完成；recorded=false/cursor=0 与 recorded=true/cursor=0 不同。不自动翻页、确认、查询或重试；仅 changes 显式 --output 才保存文件。源码未编译、类型检查、测试或运行；见 [原消费者确认](../../docs/design/01-contracts/sync-cursor-runtime.md)。

新增 `workctx conflicts prepare --json-file decision.json --output original-conflict.json`：为明确的新决定读取当前可信身份，生成一次请求键，保存完整原 identity/request_key/command。decision.json 必须给出 conflict_id、expected_version、resolution 与适用 merged_value；保留额外命令字段，拒绝已有键/原请求封套、内联 JSON、stdin 和重复选项。已有目标文件不覆盖，父目录须存在，保存后核对最终文件；失败保留可诊断路径。支持可选 --timeout-ms（只限身份请求），网络/嵌入均不发送决定或自动查回执。准备报告 `status=prepared/decision_dispatch_state=not-sent` 不是提交结果；审阅保存文件后才显式 submit --reviewed，未知结果继续使用同一文件 receipt。不会扫描其他草稿或阻止另选新文件名；已有未知请求不能重新 prepare。临时文件同步/读回及不覆盖保存复用现有实现，不保证目录掉电持久性或跨设备备份。见 [CLI 新请求文件准备](../../docs/design/01-contracts/conflict-submission-runtime.md#cli-新请求文件准备)；仅源码，示例未执行。

新增 `workctx conflicts submit --json-file original-conflict.json --reviewed`（可选 --timeout-ms，默认 30000），只从已保存的完整原请求文件明确提交。正规文件/变化检查和有界读取限制 1 MB，拒绝临时 --json、stdin、新 --key、队列和重复选项；网络/嵌入使用同一 SDK，原身份、键、版本与额外命令字段不变。成功退出只表示完整响应已解析，stdout 仍为 unconfirmed，须另行显式 conflicts receipt 确认；失败保留原文件，不自动重试。普通字符串账号无需填入 SDK 的旧 ULID actor 上下文，原身份始终交给 Gateway 完全核对。没有生成/修改备份文件，示例未执行；见 [固定原冲突请求提交](../../docs/design/01-contracts/conflict-submission-runtime.md)。

新增 `workctx conflicts identity`，只接受可选 `--timeout-ms 30000`（1–2147483647），返回当前可信冲突操作 identity、expires_at 与 resolve_conflicts=true 提示。网络/嵌入复用 SDK 的默认本地 30 秒及成功/错误各 16 KiB 边界；嵌入额外核对原可信身份、到期、精确无正文请求与执行前后权限。拒绝 JSON、文件、写键、队列及重复/未知参数；不读冲突记录、不生成键、不保存或覆盖原请求、不自动查询/重发。身份提示不证明项目可见或旧决定成功；已有请求应保持原 identity/版本/键。仅源码，示例未运行，见 [冲突原请求保存与恢复](../../docs/design/01-contracts/conflict-recovery-runtime.md)。

新增 `workctx conflicts get --json-file conflict-query.json`，文件内容仅 `{"conflict_id":"原冲突 ID"}`，也可使用 --json；不接受写键。独立返回完整详情，版本为十进制字符串，双方值及选中值使用 JSON 文本和 recorded/not-recorded 标记，旧决策状态单独展示。网络与嵌入使用 SDK 默认本地 30 秒及完整 2 MiB/错误 16 KiB 限制；嵌入只接受单个 --json，输入最多 16 KiB。结果不证明某个原解决请求成功，也不表明源实体已更新。示例未执行；见 `docs/design/01-contracts/conflict-read-runtime.md`。

`checkpoints get`、`checkpoints history` 和带 session_id 的 `checkpoints list` 网络读取现复用 SDK：完整详情限 2 MiB、十条历史页限 8 MiB、错误限 16 KiB，默认本地等待 30 秒。超限整条/整页失败，不显示部分笔记，不自动重试或翻页；仍拒绝写键。嵌入调用也完整验证历史/详情，但没有新增独立期限；list 的历史模式保留工作台身份/权限提示。读取失败不证明原保存失败，保留原请求并显式查回执。见 `docs/design/01-contracts/checkpoint-read-runtime.md`，未运行命令或测试。

新增 `workctx sessions identity`，只接受可选 `--timeout-ms 30000`（1–2147483647），输出当前可信身份、到期和会话/领取权限提示的完整 JSON。网络/嵌入都复用 SDK，固定项目/trace，成功/错误各 16 KiB、默认本地 30 秒；嵌入另核对原可信身份、有效期和实际提示。拒绝 JSON、文件、写键、队列或重复选项，不读取目录、不扫描恢复文件或自动执行命令。提示不证明原请求成功，不得用于替换保存的原身份/键。示例未执行，见 `docs/design/01-contracts/session-command-context-runtime.md`。

`checkpoints list` 项目目录现支持 query/checkpoint_id/limit/cursor JSON，默认 25、最多 100 条；例如 `{"query":"release","limit":25}`。query 是字面子串，checkpoint_id 精确 ULID；stdout 返回完整一页封套，显式传回 next_cursor 并保留原条件。另一模式仅提供 session_id/before_revision，继续每页十条会话历史，两种参数不能混用。

项目目录复用 SDK 完整校验、成功 2 MiB/错误 16 KiB 和本地默认 30 秒；摘要超出 8 KiB 明确省略。网络支持 `--json`/`--json-file` 二选一并沿用通用文件输入，嵌入只用 `--json`、解析前限 16 KiB；拒绝重复选项和写键，不自动遍历或保存。历史模式的全文限制见本页开头。示例 `workctx checkpoints list --json-file checkpoint-filter.json` 未执行，见 `docs/design/01-contracts/checkpoint-registry-runtime.md`。

`handoffs list` 已改为服务端分页，查询 JSON 仅含 query/status/session_id/origin/limit/cursor，默认 25、最多 100 条；例如 `{"status":"open","origin":"session","limit":25}`。status=open 包含 open/offered，closed 表示其余历史状态；session_id 精确匹配，origin=session/projection。网络使用 `--json`/`--json-file` 二选一，嵌入 runWorkctx 使用 `--json`（文本最多 16 KiB）；网络文件仍沿用通用输入读取路径。拒绝重复选项、写键和未知字段。

输出完整一页封套，显式传回 next_cursor 并保留原筛选/limit；改变范围或条件须重回首屏。SDK 读取成功/错误限 2 MiB/16 KiB，默认本地等待 30 秒；超长摘要明确省略，历史投影仅查看，所有权提示不证明原请求成功。无自动翻页、重试、保存或 outbox，旧无参数命令不再返回全项目列表。示例 `workctx handoffs list --json-file handoff-filter.json` 未执行；详见 `docs/design/01-contracts/handoff-registry-runtime.md`。

`sessions list` 已改为服务端筛选分页：查询 JSON 仅含 query/status/client_id/limit/cursor，默认 25、最多 100 条；例如 `{"status":"running","limit":25}`。query 是不区分大小写的字面子串，client_id/status 精确匹配。网络命令用 `--json` 或 `--json-file`，嵌入 runWorkctx 用 `--json`；拒绝写键、重复选项和未知查询字段。stdout 为完整原范围/trace 校验的一页 JSON，has_more/next_cursor 表示本次可继续位置，调用方须保留筛选和页大小显式续读；改变条件重回首屏，不自动遍历。

目录读取复用 SDK，网络成功/错误限 2 MiB/16 KiB，默认本地等待 30 秒。继承写条件清理，网络固定本次令牌/项目；未新增本地保存或 outbox。旧无参数查询不再返回全项目列表，页内统计不能当总量。只开发源码与文档，未执行命令、编译、测试或发布；详见 `docs/design/01-contracts/session-registry-runtime.md`。

管理快照新增 `workctx admin snapshot`，仅允许可选 `--timeout-ms 30000`（1–2147483647 毫秒）。使用 WORKCTX_URL、WORKCTX_ACCESS_TOKEN 和 WORKCTX_TENANT_ID/WORKSPACE_ID/PROJECT_ID，三层范围遵循 SDK 的 ULID 约定。命令打印完整已校验 JSON 封套；不接受 JSON、输入/输出文件、写键、队列选项、重复标志或额外参数，也不自动重试。

网络调用复用 SDK bounded-json，成功与错误均限 16 KiB，并给 SDK 与 Fetch 设置相同等待期限。嵌入 runWorkctx 也支持该命令：固定可信上下文、清除继承写条件，调用前后核对 admin 角色、实际 admin.read 和有效会话，并按实际 audit.read/context.read 校验返回计数可用性。缺权限显示 not-authorized，外部服务保持 not-checked；退出 0 只表示本次查询成功，不代表平台健康或可发布。用法错误退出 2，其他失败退出 1。超时不取消底层已派发工作；此处为源码用法，未执行 CLI、编译、测试或发布。

审计查询和单条视图导出新增三个命令（仅示例，未执行）：

```text
workctx audit list --json-file audit-filter.json
workctx audit get --json-file audit-id.json
workctx audit export --json-file reviewed-audit.json --reviewed --output exported-audit.json
```

`audit list` 的查询可省略，或用 `--json`/`--json-file` 二选一提供 resource、trace_id、action、audit_id、session_id、cursor 的精确筛选。每次只打印一页完整封套，最多 200 条；续页须显式传入返回的 next_cursor 并保留原筛选，不自动遍历。`audit get` 必须仅含 `audit_id`，例如 `{"audit_id":"01J000000000000000000000001"}`；没有可见匹配时仍返回空页，不代表记录从未存在。查询输入最多 16 KiB，文件必须是稳定普通 UTF-8 JSON 文件；拒绝 stdin、重复选项、--key、队列或额外参数。

按会话定位可将 `{"session_id":"01J000000000000000000000001"}` 保存为查询文件，再明确执行 `workctx audit list --json-file SESSION_QUERY.json`。session_id 只接受 ULID，只匹配已记录的会话字段；改变会话条件须重新从首屏读取。历史未关联记录不会被自动补入，入口授权记录不证明会话存在或命令成功；get 命令不接受 session_id。示例仅说明源码接口，本轮未执行命令或创建示例文件。

请先保存并审阅 `audit get` 的完整输出，再将这份文件交给 `audit export`。导出输入最多 128 KiB，必须保留 scope、原查询 trace、postgres 来源、单条 data、has_more=false；不能传整个多行页面、截出的单条 record、SDK document 或以前的导出封套。可使用恰好单条且没有更多页的合法列表封套，但文件不构成真实性或权限证明。省略字段状态必须一起审阅；`--reviewed` 是调用方明确确认，不是签名认证。命令会核对文件项目和完整记录、构造 document，再用 SDK 固定摘要；Gateway 仍重新读取/授权，变化即失败，不自动替换成最新记录。

导出必须同时指定 `--json-file`、`--reviewed`、`--output`，不接受内联 JSON、stdin、覆盖选项或写入键。输入文件保持原样，输出父目录须存在，任何已有文件、目录或链接均拒绝。目标检查在联系 Gateway 前进行，返回完整封套、内容比对和 SHA-256 核验后才创建同目录独占临时文件，写入同步并读回核验，通过硬链接创建最终文件以避免覆盖。复用现有本地文件保存实现，临时名称沿用 `.workctx-artifact-*.part`；文件系统不支持硬链接时失败，不回退覆盖式 rename。

保存的是整个导出封套 JSON，而标准输出只打印摘要、原记录 ID、原审阅查询 trace、当前 trace、放行引用和本地状态。`document_sha256/document_bytes` 描述内部固定 document；`local.file_sha256/local.file_bytes` 描述实际保存的整个文件。`audit_state=release-recorded` 是服务器放行确认，`local.state=saved` 是 CLI 本次写入/读回/创建最终文件的确认，远端 `client_delivery_state=not-confirmed` 保持不变；CLI 不向服务器发送交付回执。

本地失败退出 1，保留已知放行引用、目标路径、保存阶段和可能遗留的临时路径；`local_state=not-saved` 只表示本次没有完成最终文件创建，不证明目标不存在。最终文件已创建但临时文件清理失败仍退出 0，带 cleanup_pending 和临时路径。用法错误退出 2，读取/权限/网络/持久审计错误退出 1。结果未知或输出报错后应先检查文件和审计 trace，不能据此假定没有放行并自动重试。

网络调用固定 WORKCTX_* 项目和本次令牌，复用 SDK bounded-json：列表成功最多 16 MiB、导出 128 KiB、错误 16 KiB。`--timeout-ms` 默认为读取 30000、导出 90000，允许 1–2147483647；同时配置 SDK 与 Fetch 期限，限制请求准备/摘要及网络等待，不包括之前的本地输入/路径检查或之后的文件保存。嵌入 runWorkctx 也支持这三个命令和期限，要求可信客户端、实际 audit.read、有限未过期会话；导出还需实际导出能力。三层范围遵守 SDK 的 ULID 约定，继承写条件被清理，派发前再次核对能力/到期。嵌入超时不会撤销正在执行的 router，迟到结果不触发本地保存。

读取的标准输出是普通权限内的有界视图，调用方自行保存它作为审阅输入不等于经过服务器放行的导出文件。全量/原文导出、跨页冻结快照、导出回执恢复及服务端客户端交付确认仍缺失。只在用户控制的目录使用现有保存协议；不保证抵御恶意并发目录替换、目录同步或断电恢复，Windows 权限由目录 ACL 决定。本次无新依赖/迁移，仅源码和文档，未编译、类型检查、测试、执行示例、实际保存样本或发布。

Artifact 固定版本下载新增以下命令（仅示例，未执行）：

```text
workctx artifacts download --json-file artifact-version.json --output saved-report.pdf
```

JSON 只含 `artifact_id`（ULID）和明确的正整数 `version`，例如 `{"artifact_id":"01J000000000000000000000001","version":2}`。网络和嵌入 `runWorkctx` 均支持 `--json` 或 `--json-file` 二选一，查询最多 16 KiB；必须提供 `--output`，父目录须存在，已有文件、目录或链接均拒绝。禁止 stdin、`--key`、重复选项、额外参数和覆盖选项。输出路径由用户指定，不从远端名称推导。

先读取指定历史元数据（响应最多 2 MiB），再绑定版本/hash/size 下载；整个调用固定项目和令牌，不刷新令牌、不重试、不退回当前版本。默认内容上限 64 MiB，`--max-bytes` 可设 0–1073741824；网络与嵌入均支持 `--timeout-ms`，默认 180000、范围 1–2147483647，历史元数据/正文读取及内容校验共用一次期限。输入文件/输出路径预检先完成，保存开始前最后检查，写盘和清理开始后等待结果，不计入读取期限。嵌入要求可信客户端、实际 artifact.read 和未过期会话，调用前后及保存前复核，清除继承键/版本/if_match；超时后底层provider可能继续，但迟到结果不会触发保存。Gateway 独立检查当前与历史分类导出权限及持久 release 审计。

元数据及正文封套中的非字节部分最多2 MiB纯JSON，HTTP下载头最多16 KiB；拒绝访问器、非普通封套、共享或自定义子类字节视图，普通Uint8Array/Buffer在完整封套校验时复制并核对SHA。查询/下载错误仅采用同trace有限代码与固定消息，丢弃上游详情；只有本地保存函数的错误可带文件恢复信息。已核对的完整HTTP放行头或完整嵌入封套中的audit_id在后续校验/保存错误中保留，不把unconfirmed当作未放行。详见 [CLI下载读取期限](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-下载读取期限与保存边界源码阶段)。本增量仅源码文档，未编译、测试、实际调用或发布。

只有完整响应、审计头、长度和 SHA-256 校验通过才开始保存：同目录独占临时文件，写完同步并读回校验，关闭后以硬链接创建最终路径，不覆盖竞争期间出现的文件。不支持硬链接的文件系统会失败，不回退覆盖式保存。清理只处理本次拥有的临时文件；输出文件保存成功但清理失败仍退出 0，结果带 `cleanup_pending=true` 与临时路径。其他保存失败退出 1，可能附临时路径及校验状态；用法错误退出 2。输出 JSON 包含 metadata/source_refs、`audit_state=release-recorded` 和独立 `local.state=saved`，不打印字节。错误里的 `local_state=not-saved` 仅指本次未创建最终文件，不声称目标路径不存在；已确认放行也不证明本地保存成功。

请使用自己控制的目录；路径检查不承诺抵御恶意并发文件替换。文件同步不等于目录同步或断电持久性保证，Windows 权限由目录 ACL 决定。新增 SDK workspace 依赖与锁文件链接，未安装；本增量仅源码与文档，未编译、类型检查、测试、实际下载/保存样本、运行或发布，016–045 未执行。

Artifact 上传新增以下命令（仅示例，未执行）：

```text
workctx artifacts create --json-file create-request.json --file report.pdf
workctx artifacts put-version --json-file append-request.json --file revised-report.pdf
workctx artifacts receipt --json-file create-request.json
```

上传必须使用已保存的 `--json-file` 和本地普通文件 `--file`；不接受内联 `--json`、stdin、`--key`、重复选项、队列选项或多余参数。JSON 为原 `{ identity, command }`，与下文回执使用同一格式；operation 分别为 artifact.create / artifact.put-version。tenant/workspace/project 必须匹配当前配置，actor/client 必须匹配 Gateway 验证的令牌。命令不会生成请求键、修改原版本、创建 outbox 或改写输入文件。

发送前以同一文件句柄有界读取，检查普通文件、长度、额外字节及读取前后修改时间，再核对原 size/SHA-256；读取失败或检测到变化不发送请求。请求 JSON 原文和规范化结果上限均为 1 MiB；内容默认上限 64 MiB，可通过 `--max-bytes` 明确设为 0–1073741824，仍受服务器自己的上限约束。网络上传 `--timeout-ms` 默认 180000，可设为 1–2147483647；超过期限不自动重试。multipart 文件名固定，不把本地路径发给 Gateway，原 command 决定文件元数据。

成功退出 0 仅在完整响应与原身份/命令/内容描述/版本/source_refs/trace 一致时返回；首次保存 replayed=false/content_state=verified-at-save，原键重放 replayed=true/content_state=not-checked。返回历史快照，不提供当前写用外层 ETag 或下载保证。参数/大小/hash 不匹配退出 2，本地读取或远端错误退出 1；发送前错误的 dispatch_state=not-sent 只描述这次调用，不能否定原请求以前成功过。发送后的错误附 artifact_outcome=unconfirmed 和原回执查询提示；保留原文件和请求，不以新键/新版本重提。

嵌入 `runWorkctx` 的这两个上传命令同样使用 `--json-file`/`--file` 和可选 `--max-bytes`，不接受只作用于 HTTP 的 `--timeout-ms`。必须提供 authenticated_client=true、实际 artifact.write 及匹配的可信完整身份；先验证权限再读本地内容。原请求独立复制，继承写条件清除后按原命令设置；共用 Gateway writer 与响应校验，未注册 writer 不会回退内存。嵌入回执查询仍使用原 `--json` 接口。

本增量没有实际读取上传样本或发起上传，不新增依赖/迁移，未编译、类型检查、测试、执行命令、运行服务或发布。入口依赖显式持久 writer，回执查询另需 artifact_receipts 或统一 artifact_storage；详见 [Artifact 持久化](../../docs/design/01-contracts/artifact-persistence-runtime.md)。

Artifact 原请求回执新增 `workctx artifacts receipt --json-file original-artifact.json`，也支持 `--json`；嵌入 runWorkctx 只支持 `--json`。JSON 必须是 `{ "identity": { ... }, "command": { ... } }`：identity 保留提交时的 tenant_id/workspace_id/project_id/actor_id/client_id；command 保留完整原创建或追加命令，包括 operation、request_key、sha256、size，以及原创建的 name/mime/classification/source_refs，或原追加的 artifact_id/expected_version。两种命令不能混用字段。禁止 `--key`、额外顶层字段及重复选项；不要为查回执改键、更新版本或替换身份。

配置项目必须与原 identity 一致，网络请求附原账号/客户端前置头，Gateway 与令牌身份逐项核对；嵌入调用要求可信 authenticated_client=true、artifact.write 和同一完整身份，清除上下文继承的写键/版本，保留 command 内原值。返回的完整回执必须匹配原命令及本次 trace；status=recorded 描述原保存版本，status=not-observed 只表示尚未观察到。成功退出 0 包括这两种合法查询结果，不能仅用退出码确认上传成功；错误退出 1，用法错误退出 2。无正文下载、当前写 ETag、自动重试或本地 outbox；服务器须配置 artifact_receipts 或 artifact_storage。此入口仅源码接入，未编译、测试或执行命令。

Artifact 元数据新增 `workctx artifacts get --json-file artifact.json` 和 `workctx artifacts version --json-file artifact-version.json`。前者 JSON 只含 `artifact_id`，后者还必须提供正安全整数 `version`；ID 必须是 ULID。网络与嵌入 runWorkctx 共用请求/响应校验，嵌入调用使用 `--json`，不支持 `--json-file`。示例仅作说明，未执行：

```json
{ "artifact_id": "01J000000000000000000000001", "version": 2 }
```

读取要求令牌中的 artifact.read，项目/当前记录/历史快照仍受可见性与 restricted 权限限制；不能在 JSON 中覆盖身份或 scope。禁止 `--key`、idempotency_key、expected_version 和其他额外字段，重复选项拒绝；嵌入调用移除继承的写键和版本。只返回元数据，`content_state=not-checked`，没有存储键、正文或下载授权；历史结果不能代替当前写条件或原请求回执，缺版本时不退回当前记录。成功退出 0 仅说明元数据读取和响应校验成功，不能说明文件可下载。错误退出 1、用法错误退出 2，不自动重试或保存恢复状态。服务器须配置持久 Artifact reader；见 [Artifact 持久化](../../docs/design/01-contracts/artifact-persistence-runtime.md)。仅源码接入，未编译、测试或运行。

收尾入口 `runs finish`、`tool-calls finish`、`sessions end` 也要求原 expected_identity，网络与嵌入调用共用请求绑定及完整响应解析。原会话版本和运行/工具版本分别保留，不接受不同的上下文键/版本，不自动采用当前版本或重试。共享响应校验支持同终态无变化成功，结束记录的创建者可与操作者不同；调用方仍须保存原 JSON、键和身份，用 `sessions receipt` 显式查询未知结果。仅源码开发，未编译测试或发布。

活动创建入口 `runs start`、`tool-calls record` 和通用 `sessions receipt` 现在都要求 JSON 中的原 expected_identity（tenant_id/workspace_id/project_id/actor_id/client_id）。创建保留原 session_id、model 或工具参数、expected_version 和键；--key、正文 idempotency_key 与嵌入上下文中已提供的键必须一致。回执查询禁止 --key/顶层 idempotency_key，清除嵌入上下文的写入键/版本；command 内原字段继续完整保留。网络与嵌入入口复用共享绑定和响应校验，不自动保存、换键或重试；请先自行保存原请求。无新迁移，仅源码开发，未编译或测试。

普通会话开始现在要求原身份：`workctx sessions start --json-file start.json --key session-start-001`，start.json 包含 expected_identity（tenant_id、workspace_id、project_id、actor_id、client_id）及原可选 parent_session_id/actor_id/client_id。新增 `workctx sessions start-receipt --json-file start-receipt.json`，JSON 为 expected_identity、request_key 和 session（原开始业务正文）。查询禁止 --key/idempotency_key，开始禁止版本字段；身份不是凭证，HTTP 使用前置条件核对令牌。两个入口保留原参数和键，并校验持久回执及当前会话的一致性。

发送前自行保存原请求文件和键；not-observed、旧回执缺失或响应错误不证明开始失败，不自动改键或重提。命令不会从列表中的相似会话推断成功。网络入口支持 --json/--json-file；嵌入 runWorkctx 使用 --json 并核对可信 authenticated_client=true，查询清理继承的写入键和版本。无新增迁移，016–044 仍未执行，仅源码开发；见 [开始回执](../../docs/design/01-contracts/session-start-runtime.md)。

创建交接与回执查询现在也要求原身份。`workctx handoff --json-file handoff.json --key handoff-001` 的 JSON 包含 session_id、checkpoint_id、expected_identity（tenant_id、workspace_id、project_id、actor_id、client_id），以及原可选 target_client/from_client。`workctx handoff receipt --json-file handoff-receipt.json` 使用 session_id、expected_identity、原 request_key 和 handoff；handoff 保存原 checkpoint_id 及实际提供过的可选字段。查询禁止 --key/idempotency_key；创建不接受版本前置条件。缺少原身份时发送前拒绝，不从当前交接补造。

网络调用携带原 actor/client 前置条件，嵌入 runWorkctx 使用 --json 并对比已验证 context。创建与查询共用共享响应解析，核对原身份、参数、历史回执及当前交接；not-observed 不证明失败，无效成功响应不触发新建。原键、目标和可选参数不得在恢复时改写。示例命令未执行，043 迁移未执行；见 [创建交接回执](../../docs/design/01-contracts/handoff-create-runtime.md)。

交接领取增加原身份绑定与持久回执查询：`workctx handoff claim --json-file claim.json --key claim-001` 的 JSON 需要 handoff_id、原 expected_version 和 expected_identity（tenant_id、workspace_id、project_id、actor_id、client_id）。`workctx handoff claim-receipt --json-file claim-receipt.json` 的 JSON 使用 handoff_id、原 request_key、claim（原 expected_version 及实际提供过的 client_id）和同一 expected_identity，禁止 --key/idempotency_key。查询不会领取或续接；not-observed 不证明失败，当前 claimed 状态也不能证明原请求成功。

两种领取命令都在发请求前核对原项目范围，网络调用以原 actor/client 前置条件绑定当前令牌；嵌入 runWorkctx 使用 --json，并核对可信 context，不从输入生成身份。写入/查询共用完整响应校验，包含 trace、交接、检查点、归属和版本；身份变化、损坏响应或缺少持久回执时保留原请求。不会自动换键、提高版本或重发。示例仅为使用说明，未运行命令、编译或测试，042 迁移未执行，详见 [领取回执](../../docs/design/01-contracts/handoff-claim-runtime.md)。

`observed work-item` 可成功返回删除观察：外层 schema_version=1，内层 data.schema_version=2，带 deleted_at，fields 只有 external_id，无活动 status。活动观察仍为内层 v1；退出 0 仅表示读取成功，不能表示工作项仍活动。`observed context` 遇到可见删除标记返回 OBSERVED_RECORD_DELETED/410、退出 1，在外部记忆召回前停止，可改用 state 命令读取删除来源。`plane-events diagnose` 可返回 deleted_stream；普通更新不能恢复记录。040 迁移尚未执行，以上只有源码，未运行命令或验证。

显式 WorkItemRestored 观察成功后，state 返回内层 v1 和 restored_from={event_id,aggregate_version}，保留分类与索引到期；后续普通更新不再带顶层恢复来源。CLI 复用共享解析器，不增加向 Plane 发恢复命令的入口。诊断 next_version 不校验原删除引用和删除索引，只代表版本位置；失败原因可能为 PLANE_RESTORE_PRECONDITION_FAILED。无新增迁移，未编译或测试。

`observed list` 新增当前项目的 Plane 观察元数据分页目录，JSON 可传 state=active/deleted/all（默认 active）、limit=1–100（默认 25）和 cursor，禁止 --key。保持原筛选、页大小与身份传回 next_cursor；每页按当前权限读取，不保证跨页冻结快照。删除行不含标题/状态，活动标题/状态是有长度上限的摘要；external_id 可传给 `observed work-item` 查看完整状态。该命令不使用本地工作项列表、不查询外部 Plane 或记忆、不重试队列。041 索引只写文件，没有运行 CLI、编译或测试。

`observed list` 的 JSON 增加 `query`，如 `{ "query": "release", "state": "all" }`。最多 500 个 UTF-16 单元，去除首尾空白，字面包含匹配 ID 和当前活动标题摘要，只忽略 ASCII 英文字母大小写。删除行只匹配 ID；不查询历史标题，不识别通配符。续页必须保留原检索词和筛选，v1 旧游标需要从第一页重新读取。未运行命令或验证。

版本排查新增 `workctx plane-events diagnose --json-file event-receipt.json`，JSON 只有 `{"event_id":"01J000000000000000000000001"}`，替换为实际 ID，拒绝 --key。命令沿用可信 admin/admin.read，不补拉、不重试；HTTP/内嵌入口共用版本诊断解析，核对目标、范围、trace、同快照和比较结果。返回 baseline/position、下一所需版本、尚未推进的版本区间，以及有界的可见候选回执。baseline_unavailable 是成功读取的一种结果，退出 0，不证明没有已提交历史；空候选不证明事件未收到，next_version 不保证能处理。候选超过 10 条用 has_more 提示，可继续按 aggregate_id 查询目录。示例未执行。

管理员队列概览使用 `workctx plane-events summary`，无需 JSON；如提供 JSON，只接受 `{}`，拒绝 `--key` 和所有业务字段。读取当前项目全部可见记录，独立于列表筛选与分页，沿用可信 admin/admin.read 权限。返回的 counts 均为十进制字符串，pending=due+delayed，version_gap 是 pending 子集；同时返回最早待处理/到期接收时间、最早计划时间、最近接收时间及 checked_at。空集合时间为 null，读取错误不会替换成零。到期可能包含尚未提交结果的处理中事件，零积压不证明同步完整或处理器健康。HTTP/内嵌入口共用汇总解析器核对范围、trace、计数与时间关系；本示例未执行。

管理员事件队列新增 `plane-events list` 与 `plane-events get`，只读查询持久接收元数据，不会触发重投或重放。需真实令牌中的可信客户端身份、admin 角色，并经过 admin.read 策略；数据仍按项目与有效分类过滤。命令拒绝 `--key`、写入字段和范围/角色覆盖。

```text
workctx plane-events list
workctx plane-events list --json-file pending-events.json
workctx plane-events get --json-file event-receipt.json
```

pending-events.json 示例：`{"status":"pending","limit":25}`。可选 aggregate_id 必须是 aggregate ULID；status 支持 all/pending/applied/rejected。续页传入 `data.next_cursor` 为 cursor，保留 status、aggregate_id 和 limit。event-receipt.json 示例：`{"event_id":"01J000000000000000000000001"}`，替换为实际事件 ID。

排查到期积压可把列表 JSON 写为 `{"status":"pending","pending_state":"due","limit":25}`。pending_state 支持 all（默认，不筛选）、due（计划时间已到）、delayed（计划时间未到）和 version_gap（最后记录的版本缺口）；非 all 值只能与 status=all/pending 组合。HTTP 与内嵌入口共用解析，拒绝无效组合，并核对返回记录与筛选一致。续页也必须保留 pending_state，修改条件需重新获取第一页；旧开发版本游标失效。时间条件随每次读取变化，查看新到期记录需刷新第一页；版本缺口记录不证明前置事件现在仍缺失。只读取、不触发重试，以上示例未执行。

HTTP 和内嵌 router 两条路径共用输入/响应解析，核对范围、trace、空来源、目标 ID、状态、十进制版本/次数和分页顺序。成功退出 0，本地参数错误退出 2，权限/存储/响应错误退出 1；pending/rejected 是成功读取的处理状态，不能仅据退出码判断事件已应用。applied 不保证当前观察可用，404 也不证明未收到。以上示例未执行，详细边界见 [持久接收与重试](../../docs/design/01-contracts/plane-inbox-runtime.md)。

人工重试新增 `plane-events retry`，原请求查询为 `plane-events retry-receipt`。先保存原命令和身份前提，例如 retry-event.json：

```json
{
  "event_id": "01J000000000000000000000001",
  "expected_revision": "7",
  "reason": "已排查前置事件到达情况，重新安排处理",
  "request_key": "plane-retry-operator-001",
  "expected_actor_id": "operator-subject",
  "expected_client_id": "operator-client"
}
```

将事件和身份占位值替换为真实值；expected_revision 来自事件详情的队列 revision，保持十进制字符串，不使用 aggregate_version 或 expected_version。expected_actor_id/client_id 是准备原请求时已确认的 subject/client，作为对签名身份的前提校验，不是权限声明。输入不接受角色或范围覆盖。网关排队要求可信 admin、签名 human 身份及 plane.retry 策略；查询回执需要可信 admin/admin.read，仍受当前数据可见性限制。

```text
workctx plane-events retry --json-file retry-event.json
workctx plane-events retry-receipt --json-file retry-event.json
```

第二条仅查询，不重新排队。重试命令也可用 --key 提供原键；若 JSON 同时含 request_key，必须相同。回执查询拒绝 --key，要求 JSON 保留原 request_key。建议将键保存在原文件中，以便两个命令使用同一份恢复信息；CLI 不自动存草稿、换键、刷新版本或提交重试。

HTTP 与内嵌 router 路径复用输入/结果解析，核对原身份、范围、键、命令、修订号变化、尝试次数不变、trace 和空来源。HTTP 发送预期身份头，由网关与认证声明比对；内嵌入口直接比对已提供的可信 context。响应为历史排队回执；当前进度另用 plane-events get。retry-receipt 返回 recorded 或 not-observed，二者都表示查询完成、退出 0，不能据退出码判断原请求成功或失败。网络错误、503、响应校验失败后保留原 JSON；not-observed 也不能作为换键依据。依赖未执行的 039 迁移，以上命令未执行。

Plane 观察状态新增 `observed project`、`observed work-item` 和 `observed context`。前者默认读取 WORKCTX_PROJECT_ID，也可传相同 project_id；后两者 JSON 必填 work_item_id，使用 Plane external_id 或事件 aggregate_id，不使用工作台本地 item_id。三条命令只读，拒绝 --key 和未知 JSON 字段，通过令牌权限读取保存快照。

```text
workctx observed project
workctx observed work-item --json-file observed-item.json
workctx observed context --json-file observed-item.json
```

observed-item.json 示例：`{"work_item_id":"plane-item-42"}`。CLI 核对返回身份、项目范围、trace、版本和来源；context 还核对本地摘要及 memory/restricted 命中的一致性，异常响应输出结构化错误并返回 1，参数错误返回 2。context_pack 字段是摘要集合，不是可绑定的保存包；plane_version 也不是本地工作项版本。HTTP 与内嵌 router 两种入口使用相同校验。以上命令仅加入源码，未执行，见 [观察状态持久读取](../../docs/design/01-contracts/observed-state-runtime.md)。

命令入口是 `bin/workctx.mjs`，工作区内也可通过根脚本 `pnpm workctx` 调用。当前新增代码未执行编译、发布或测试。

网络命令使用 `WORKCTX_URL`（默认 `http://127.0.0.1:3000`）和 `WORKCTX_ACCESS_TOKEN`。项目操作还需设置 `WORKCTX_TENANT_ID`、`WORKCTX_WORKSPACE_ID`、`WORKCTX_PROJECT_ID`，三个 ID 均为 ULID。身份由网关依据令牌确定；人工事件重试及回执查询另外要求 JSON 中保存原预期身份，供前提校验。

`index` 管理旧 context.index 记录。首次写入把状态查询返回的 revision 作为 expected_revision；重试保留原版本和原请求键。回执是历史结果，当前状态另用 `index status` 读取。删除不会清除外部记忆副本，恢复不会延长到期时间，`plane:` 记录不可手工修改。033 迁移尚未执行，详见 [旧索引管理](../../docs/design/01-contracts/legacy-context-lifecycle-runtime.md)。

| 命令 | JSON 输入 | 请求键 |
| --- | --- | --- |
| `sessions list` | 无 | 无 |
| `plane-events retry` | event_id、字符串 expected_revision、reason、expected_actor_id、expected_client_id；仅安排重新处理 | 原 request_key 或 --key，二者同时提供须相同 |
| `plane-events retry-receipt` | 同一原 JSON，含原 request_key；只读查询 | JSON 中原键；拒绝 --key |
| `overview` | 无；返回项目汇总、上下文分层统计及有限条预览 | 无 |
| `search` | 必填 query，可选 type/mode/include_inactive_context/limit/cursor；默认 20，data.next_cursor 继续 | 无 |
| `index status` | id；读取旧索引版本、分类、删除/到期元数据，不含正文 | 无 |
| `index list` | 可选 query/state/managed_by/limit/cursor；ID 包含筛选，默认 25 条，data.next_cursor 续页 | 无 |
| `index delete` | id、expected_revision、reason；软删除手工索引 | `--key` 必需 |
| `index restore` | id、expected_revision、reason；恢复手工索引，保留原到期和分类 | `--key` 必需 |
| `work-items get` | 本地 `item_id`；返回工作项投影、字符串版本及来源 | 无 |
| `work-items list` | 可选 query/status/priority/owner/assignment/due/due_from/due_before/sort/cursor/limit；priority为P0–P3，owner精确文本，assignment为assigned/unassigned；due为scheduled/unscheduled，UTC日期含起始/不含结束，无日期与区间互斥。sort默认updated_desc，可选due_asc（日期升序/null最后）。默认25、最多100条，保留全部筛选和排序并用外层next_cursor继续，换条件回首页 | 无 |
| `sessions start` | `expected_identity`，可选原 `parent_session_id/actor_id/client_id` | `--key` 或正文 idempotency_key，出现多个时须一致 |
| `sessions start-receipt` | `expected_identity`、`request_key`、`session` 原业务正文 | 禁止新键 |
| `sessions end` | `session_id`、`expected_identity`、`status`、`expected_version` | `--key` |
| `sessions receipt` | `session_id`、`expected_identity`、`request_key`、`operation`（run.start/run.finish/tool.call/tool.finish/end）、`command` 原始正文（含原 expected_version；run.finish 还含原 run_id、expected_run_version；tool.finish 还含原 tool_call_id、expected_tool_version） | 禁止新键 |
| `runs start` | `session_id`、`expected_identity`、`expected_version`，可选 `model` | `--key` |
| `runs finish` | `session_id`、`expected_identity`、`run_id`、completed/failed 的 `status`、`expected_version`、`expected_run_version` | `--key` |
| `runs list` | `session_id`，可选 `before_sequence`、`limit` | 无 |
| `runs get` | `session_id`、`run_id`；返回所属会话和运行各自的当前版本 | 无 |
| `sessions get` | JSON 仅 `session_id`；返回当前 status/version/ended_at、范围、来源及可信身份提示；不证明原请求成功 | 无，拒绝 `--key` |
| `tool-calls list` | `session_id`，可选 `run_id`、`before_id`、`limit` | 无 |
| `tool-calls get` | `session_id`、`tool_call_id`；返回工具、所属运行及会话当前记录 | 无 |
| `tool-calls record` | `session_id`、`expected_identity`、`run_id`、`tool_name`、`status`、`expected_version` | `--key` |
| `tool-calls finish` | `session_id`、`expected_identity`、`tool_call_id`、succeeded/failed 的 `status`、`expected_version`、`expected_tool_version` | `--key` |
| `checkpoint` | `session_id`、`expected_identity`、六类原进度数组、`expected_version`，可选原 context_pack_id/context_pack、memory_ref | `--key`，与原正文键一致 |
| `checkpoints list` | 可选 `session_id`、`before_revision` | 无 |
| `checkpoints get` | 仅 `session_id`、`checkpoint_id`；读取指定历史笔记/引用/保存时间，包状态固定 not-checked | 禁止 `--key` |
| `checkpoints history` | 必填 `session_id`，可选正安全整数 `before_revision`；每页最多十条，使用返回的 `next_before_revision` 继续，校验范围/会话/顺序/原笔记 | 禁止 `--key` 和写入字段；仅源码开发，未运行验证 |
| `handoffs get` | 仅 `handoff_id`；读取当前归属、版本、时间与原会话/检查点，不确认原请求成功 | 禁止 `--key` |
| `checkpoint receipt` | `session_id`、`expected_identity`、`request_key`、`checkpoint` 原始请求对象（含六类原数组、原 expected_version 及所有原字段） | 禁止 `--key` |
| `handoff` | `session_id`、`checkpoint_id`、`expected_identity`，可选原 `target_client/from_client` | `--key` |
| `handoff receipt` | `session_id`、`request_key`、`handoff`、`expected_identity` | 禁止新键 |
| `handoffs list` | 无 | 无 |
| `handoff claim` | `handoff_id`、`expected_version`、`expected_identity` | `--key` |
| `handoff claim-receipt` | `handoff_id`、`request_key`、`claim`、`expected_identity` | 禁止新键 |
| `resume` | 来源 `session_id`、`handoff_id`、`expected_identity`，可选原有效 `require_claimed`、`expected_checkpoint_id`（仅约束结果） | `--key`，不接受版本条件 |
| `resume receipt` | 原父 `session_id`、`handoff_id`、`expected_identity`、`request_key`，可选原有效 `require_claimed` 和 `expected_checkpoint_id` | 禁止新 `--key` |
| `conflicts` | 无 | 无 |
| `conflicts resolve` | `conflict_id`、`resolution`、`expected_version`；merge 需要 `merged_value` | `--key` |
| `sync changes` | 可选非负安全整数 `cursor`、1–500 的 `limit`、保存的 `expected_identity` | 不接受键/版本 |
| `sync cursor` | 可选保存的 `expected_identity`，读取当前确认位点 | 不接受键/版本 |
| `sync receipt` | 原查询 `{identity,event}`，--json-file 或 --json；可选 --timeout-ms | 无；拒绝 --key |
| `outbox reconcile EVENT_ID` | 可选 --outbox EXISTING_FILE、--timeout-ms、--result-output NEW_FILE；无 JSON | 无；查询原回执后只结算指定本地行 |
| `outbox inspect-result` | --result-file SAVED.json | 无；完整离线核验并查看回执，不打开队列 |
| `outbox list` | 可选 --outbox EXISTING_FILE、--json/--json-file（scope/status/limit/after_event_id） | 无；默认 20/最多 50 条本地摘要 |
| `outbox get EVENT_ID` | 可选 --outbox EXISTING_FILE；无 JSON | 无；完整校验指定本地原记录 |
| `outbox audit` | 可选 --outbox EXISTING_FILE、--json/--json-file（scope/max_events/max_bytes/timeout_ms） | 无；单次只读快照核验指定项目全部原记录 |
| `outbox export` | --output NEW_FILE；可选 --outbox、--json/--json-file（scope/max_events/max_bytes/timeout_ms） | 仅保存新档案；只读已有队列，不发送 |
| `outbox inspect-archive` | --archive-file FILE；无其他参数 | 无；仅离线核验完整档案，不需要当前项目或队列 |
| `outbox send-control` | 可选 --outbox EXISTING_FILE；无 JSON | 无；查看项目暂停状态和有界发送中计数 |
| `outbox pause` | --json/--json-file（expected_generation/reason，可选scope）；可选 --outbox | 持久暂停新领取；首次显式初始化可选控制表，不取消在途发送 |
| `outbox resume` | --json/--json-file（expected_generation/reason，可选scope）；可选 --outbox | 匹配当前版本后恢复新领取；不执行 flush |
| `outbox restore` | 必须 --outbox EXISTING_FILE、--archive-file FILE、--json/--json-file 原恢复查询 | 原档案恢复到已暂停的空项目，未完成记录先转为待处理；原历史和回执同事务保存 |
| `outbox restore-preview` | 必须 --outbox EXISTING_FILE、--archive-file FILE、--json/--json-file 原恢复查询 | 无；一次只读快照核验恢复条件及预计状态，或返回已核验原历史 |
| `outbox restore-prepare` | 必须 --outbox EXISTING_FILE、--archive-file FILE、--json/--json-file 三字段准备输入、--output NEW_QUERY_FILE | 只读检查新ID/暂停/空目标后独占保存完整恢复查询；不预留ID或恢复事件 |
| `outbox restore-requeue-preview` | 必须 --outbox EXISTING_FILE、--json/--json-file 六字段选择查询 | 原生只读，验证整份恢复历史和显式所选记录的完整基线，返回批次计划 |
| `outbox restore-requeue` | 同一六字段查询和已有 --outbox | 整事务重新检查、设置所选记录pending并完整读回；保持暂停，不发送，不自动重试 |
| `outbox restore-requeue-receipt` | 必须已有 --outbox 和 --json/--json-file 完整原查询，包括requeue_id | 原生只读核验原请求/关联恢复历史及选中前后摘要；无记录不等于原提交失败 |
| `outbox restore-requeue-get` | 必须已有 --outbox、--json/--json-file scope/requeue_id选择；可选 --output NEW_QUERY_FILE | 只读完整核验后发现原请求/回执；显式保存原七字段请求，不覆盖文件或重新排队 |
| `outbox restore-requeue-history` | 必须已有 --outbox；可选 --json/--json-file scope/limit/after_requeue_id | 只读元数据目录，默认10最多20；返回单条查询及续页参数，不代表完整历史核验 |
| `outbox restore-requeue-audit` | 必须已有 --outbox；可选 --json/--json-file scope/max_receipts/max_bytes/timeout_ms | 只读核验整个项目批次及完整关联历史/前后摘要；超限或损坏不返回部分通过 |
| `outbox restore-requeue-export` | 已有 --outbox、--json/--json-file scope/requeue_id、--output NEW_FILE | 只读取得完整批次及父历史，关闭尝试后独占保存并完整读回 |
| `outbox inspect-restore-requeue-receipt` | --receipt-file FILE | 无配置/数据库/网络的完整文件核验，返回摘要及get_query |
| `outbox restore-requeue-file-get` | --receipt-file、--json/--json-file document_sha256/requeue_id；可选 --output NEW_QUERY_FILE | 完整核验并匹配原文件和批次，找回原请求/回执；可独占保存原请求 |
| `outbox restore-requeue-import-preview` | 已有 --outbox、--receipt-file、--json/--json-file scope/document_sha256/requeue_id | 原生只读比较目标父历史/批次；显示缺失、相同、异文或跨项目占用 |
| `outbox restore-requeue-import` | 与预览相同文件及查询；不接受output | 同事务只补缺失父历史/批次并完整读回，冲突拒绝；不恢复事件 |
| `outbox restore-requeue-backup` | 已有 --outbox、--output NEW_FILE；可选 --json/--json-file scope/max_receipts/max_bytes/timeout_ms | 保存全部项目批次及去重父历史，超限不截断，最终文件完整核验 |
| `outbox inspect-restore-requeue-backup` | 仅 --archive-file FILE | 离线完整核验父历史、批次与关联闭包，stdout仅摘要 |
| `outbox restore-requeue-backup-history` | --archive-file BACKUP；可选 --json/--json-file limit/backup_sha256/after_requeue_id | 每次完整核验后分页返回批次摘要与next_query/get_query |
| `outbox restore-requeue-backup-get` | 同一备份；必填 --json/--json-file backup_sha256/requeue_id；可选 --output NEW_QUERY | 返回原请求/完整历史回执，可独占保存纯原请求 |
| `outbox restore-requeue-backup-export` | 同一备份与选择；必须 --output NEW_RECEIPT | 独占导出选中批次及父历史为独立回执文件，并最终完整读回 |
| `outbox restore-requeue-backup-import-preview` | 已有 --outbox、--archive-file BACKUP、--json/--json-file scope/backup_sha256 | 单读快照比较全部父历史/批次，返回缺失/相同/冲突及关联状态 |
| `outbox restore-requeue-backup-import` | 与预览相同完整备份与查询；不接受output | 整事务补入全部缺失历史，完整读回后提交；不恢复事件 |
| `outbox restore-receipt` | 必须 --outbox EXISTING_FILE、--json/--json-file 同一原恢复查询；无档案文件 | 无；只读完整历史恢复回执，不代表当前队列状态 |
| `outbox restore-history` | 必须 --outbox EXISTING_FILE；可选 --json/--json-file scope/limit/after_restore_id | 无；只读元数据分页，原档案正文未核验 |
| `outbox restore-audit` | 必须 --outbox EXISTING_FILE；可选 --json/--json-file scope/max_receipts/max_bytes/timeout_ms | 无；单次只读事务完整核验项目恢复历史，超限或损坏不返回部分通过 |
| `outbox restore-compare` | 必须 --outbox EXISTING_FILE 和 --json/--json-file restore_id/event_id；可选同项目 scope | 无；单次只读事务核验历史和当前原行，返回摘要及相对恢复基线的变化列，不证明来源 |
| `outbox restore-history-backup` | 必须 --outbox EXISTING_FILE --output NEW_FILE；可选 --json/--json-file scope/max_receipts/max_bytes/timeout_ms | 只读完整项目恢复历史后独占保存新文件；最多100份/64 MiB文档，超限不截断 |
| `outbox inspect-restore-history-backup` | 仅 --archive-file FILE | 无；离线核验全部原回执/档案及集合摘要，不加载SQLite或当前项目配置 |
| `outbox restore-backup-history` | 必须 --archive-file BACKUP；可选 --json/--json-file limit/backup_sha256/after_restore_id | 无；完整核验备份后离线分页，续页必须绑定原摘要 |
| `outbox restore-backup-get` | --archive-file BACKUP 和 --json/--json-file backup_sha256/restore_id | 无；返回指定原回执和源档案摘要，stdout无source正文 |
| `outbox restore-backup-export` | 同一原选择查询/备份和 --output NEW_FILE | 独占提取所选原事件档案，保留原文档SHA并完整读回；缺项不创建文件 |
| `outbox restore-history-import-preview` | 必须 --outbox EXISTING_FILE --archive-file BACKUP --json/--json-file scope/backup_sha256 | 无；单次只读事务比较原历史，列出缺失/相同/异文/跨项目占用，不预留ID |
| `outbox restore-history-import` | 同一原备份和scope/backup_sha256查询，显式已有 --outbox | 整事务只补缺失历史，全部完整读回后提交；不恢复当前事件/发送控制 |
| `outbox restore-get ID` | 必须 --outbox EXISTING_FILE；不接受 JSON | 无；完整核验历史回执及原查询 |
| `outbox restore-export ID` | 必须 --outbox EXISTING_FILE、--output NEW_FILE；不接受 JSON | 独占保存历史中的完整原档案，不改当前队列 |
| `sync ack` | 保存的五字段 `expected_identity` 和非负安全整数 `cursor` | 不接受键/版本 |
| `context compile` | 可选 `budget_tokens`、`ttl_seconds`、成对 `expected_actor_id/expected_client_id` | `--key`或JSON内`idempotency_key`，可选`--timeout-ms` |
| `context get` | 可选 `pack_id`、`format`，及成对 expected_actor_id/expected_client_id；可选 --timeout-ms | 无 |
| `context list-packs` | 可选 pack_id/limit/cursor，及成对 expected_actor_id/expected_client_id | 最多一个4 KiB --json/--json-file，默认{}；可选 --timeout-ms，无写键 |
| `context create` | `title`、`content`、`source_refs`，可选层级、分类等 | `--key` |
| `context read` | `item_id`，可选成对 expected_actor_id/expected_client_id | 恰一 --json/--json-file，可选 --timeout-ms；无写条件 |
| `context list` | 可选 query/layer/classification/status/item_type/cursor/limit/archived，及成对 expected_actor_id/expected_client_id；可选 --timeout-ms | 无 |
| `context update` | `item_id`、`expected_version` 和待编辑字段 | `--key` |
| `context archive` | `item_id`、`expected_version` | `--key` |
| `context read-archived` | `item_id`，可选成对 expected_actor_id/expected_client_id | 恰一 --json/--json-file，可选 --timeout-ms；无写条件 |
| `context restore` | `item_id`、归档后的 `expected_version` | `--key` |
| `context history` | `item_id`，可选 before_version/limit、成对 expected_actor_id/expected_client_id | 无 |
| `context version` | `item_id`、正安全整数 version，可选成对身份约束 | 无 |
| `context compare` | `item_id`、不同正安全整数 from_version/to_version、expected_actor_id/expected_client_id | 无 |
| `context compare-packs` | 不同 ULID from_pack_id/to_pack_id、expected_actor_id/expected_client_id | 恰一 `--json`/`--json-file`，可选 `--timeout-ms`；无写键 |
| `proposals create` | kind/title/content/source_refs/model_version/prompt_version | `--key` |
| `proposals receipt` | 原 identity/request_key/完整规范 draft | `--json-file` 或 `--json`，可选 `--timeout-ms`；不接受 `--key` |
| `proposals review-receipt` | 原 identity/request_key/proposal_id/decision/expected_revision/reason | `--json-file` 或 `--json`，可选 `--timeout-ms`；不接受 `--key` |
| `proposals list` | 可选 status/kind/before/limit | 无 |
| `proposals get` | proposal_id | 无 |
| `proposals confirm` | proposal_id/expected_revision/reason | `--key` |
| `proposals reject` | proposal_id/expected_revision/reason | `--key` |

`proposals receipt --json-file original-query.json --timeout-ms 30000` 显式查询保存的 `{identity,request_key,draft}`，也可提供 `--json`。必须是原五字段身份和完整规范草稿（含分类/TTL/适用派生关系）；使用原网关配置及账号，项目须匹配配置。文件最多1 MiB，严格 UTF-8、稳定普通文件，不接受标准输入 `-`、重复/额外选项或 `--key`，失败不修改原文件。Web 原请求包装文件不直接兼容此 query，不能忽略原网关绑定。默认30秒预算用于文件校验后的查询等待，成功正文2 MiB；网络和嵌入模式共用 SDK 完整校验。退出0只代表查询完成，查看 data.status：recorded 仅确认历史创建，not-observed 不证明失败。没有自动提交/重试、查询结果保存或审核；见 [原创建回执客户端](../../docs/design/01-contracts/proposal-runtime.md#cli-与-mcp-原创建回执)。仅源码，未运行示例、编译或测试。

`proposals review-receipt --json-file original-review-query.json` 只读查询原人工审核，接收完整 `{identity,request_key,proposal_id,decision,expected_revision,reason}`，也可用 `--json`，默认查询等待30秒，可设 `--timeout-ms`。文件或内联输入32 KiB、成功64 KiB，文件需稳定普通文件及严格UTF-8；不接受标准输入、重复/额外参数或 `--key`。原网关配置和完整账号/客户端/项目必须保持，实际查询要求未过期human及review权限；网络与嵌入都核对完整回执。Web原审核包装文件不直接兼容query，不忽略原网关绑定；退出0仅表示查询完成，not-observed不证明失败，不自动重试、审核或保存结果。见[原审核CLI/MCP查询](../../docs/design/01-contracts/proposal-review-receipt-runtime.md#cli-与-mcp-原审核查询)，仅源码，未执行示例或测试。

`sessions end` 的 status 为 `ended`、`abandoned` 或 `failed`；`tool-calls record` 为 `started`、`succeeded` 或 `failed`。检查点的六类数组为 `completed`、`in_progress`、`next_actions`、`decisions`、`risks`、`open_questions`，空项使用 `[]`。

`runs finish` 记录 completed/failed，两个版本分别来自会话和运行记录，重试保留原键与原两个版本。会话已关闭仍可补记现有运行的结果，不重开会话；运行终态不可换成另一终态，收尾后不接受新的工具记录。`sessions receipt` 增加 operation=run.finish，command 含原 run_id、status 和两个版本，返回历史 run_version/run_status/changed。028 约束迁移未执行。

`runs list` / `tool-calls list` 要求 context.read，直接读取持久明细，默认 25、最多 100 条；limit 放在 JSON 内。下一页把 data 中的 next_before_sequence / next_before_id 传回，保持 session_id 和可选 run_id。运行按序号、工具按 ID 降序；记录没有执行时间，结束会话也不会改写运行/工具状态。见 [活动明细](../../docs/design/01-contracts/session-activity-runtime.md)；027 索引迁移仅开发、未执行。

运行/工具/结束命令按数据库当前会话版本原子写入，并保存原请求回执；重试保持原键、参数和 expected_version。运行/工具响应新增 session_version，表示原写入完成后的会话版本，重放值可能已过时；自身 version 不能作为会话版本。026 迁移仅写文件、未执行，见 [会话进度命令](../../docs/design/01-contracts/session-command-runtime.md)。

`sessions receipt` 使用原请求身份和原键查询持久成功回执，不重新执行命令。command 保留所有原字段；recorded 返回历史 session_version 和原结果 ID，not-observed 不能证明失败或作为换键依据。缺少 026 表时返回存储不可用；CLI 会校验回执的操作、会话和历史版本。

输入可通过 `--json OBJECT`、`--json-file PATH` 或 `--json -`（标准输入）提供。例如：

```text
workctx sessions start --json-file start.json --key session-start-001
workctx sessions start-receipt --json-file start-receipt.json
workctx sessions list
workctx sessions receipt --json-file session-receipt.json
workctx checkpoint --json-file checkpoint.json --key checkpoint-001
workctx handoff --json-file handoff.json --key handoff-001
workctx handoffs list
workctx handoff claim --json-file claim.json --key claim-001
workctx resume --json-file resume.json --key resume-001
```

同一操作重试时保留 JSON、版本号和请求键；新操作使用新键。会话写入的 `expected_version` 来自会话的 `version`，领取来自交接的 `version`，冲突处理来自冲突的 `version`。检查点 `revision` 不等于会话版本。上述数值版本接口要求安全正整数，不能舍入超界版本。Plane 队列的 `expected_revision` 则必须保留十进制字符串，不转换为数值。

`checkpoints list` 不指定会话时返回项目检查点列表；指定 `session_id` 后按 revision 倒序分页，每页最多 10 条。若响应含 `next_before_revision`，将其作为下一次请求的 `before_revision`，同时保留同一 `session_id`。

`checkpoint` JSON 可增加 `context_pack_id`，与旧 `context_pack` 互斥。绑定要求上下文读取授权，保存及 `resume` 重查包和来源。续接返回 `context_pack_state`（checked / legacy-unverified / none），仅 checked 附带完整包回执。首次结果不明而重试遇到过期/失效时，不据此换键创建第二条，先核对历史。024 迁移未执行，见 [检查点上下文绑定](../../docs/design/01-contracts/checkpoint-context-runtime.md)。

`context list` 默认每页 25 条，limit 范围为 1–100；按优先级、微秒更新时间倒序和 ID 的 C 顺序排列。完整响应外层存在字符串 `next_cursor` 时，在下一次 JSON 输入中传入 `cursor` 并保持原身份、筛选、归档视图和 limit；缺省时表示结束。页大小、筛选、项目或 restricted 权限变化后移除 cursor 重新读取，旧 v1 游标也需回首页。列表是实时视图，条目被编辑后可能改变页位置；不能将单页当作全量结果。

`sync changes` 不自动确认游标。将返回的完整变化、原消费者身份和游标处理并持久保存后，再以 `{expected_identity,cursor}` JSON 提交保存的 `next_cursor` 到 `sync ack`；expected_identity 为原 tenant/workspace/project/actor/client 五字段，不得用切换后的账号补认。旧只传 cursor 的命令会被拒绝。权限过滤可能造成游标跳号，也可能返回空变化和推进后的游标。三条命令已有专用有界适配，未知结果可显式使用同一原身份 `sync cursor` 查询当前位点，不能把异常当作回滚；见 [原消费者确认](../../docs/design/01-contracts/sync-cursor-runtime.md)。

`workctx sync receipt --json-file original-sync-query.json` 按已保存的五项 identity 和完整 event 查询单条投递；网络/嵌入均支持，也可改用 --json，但不能混用、输入 stdin、写键或重复选项。可选 --timeout-ms，默认 30000；完整请求限 1 MiB + 16 KiB、成功响应 2 MiB。退出 0 包括 recorded/not-observed，未观察到不证明失败；recorded 的 accepted=false 表示原上传记录了冲突，不表示当前冲突仍未解决。该命令不打开队列、不更新状态、不触发 flush 或补写旧身份，查询失败仍保留原数据。见 [原事件回执](../../docs/design/01-contracts/sync-event-receipt-runtime.md)；仅源码，未执行命令。

离线队列保留 `outbox enqueue/list/retry` 和 `sync [flush]`。`--outbox` 或 `WORKCTX_OUTBOX` 指定 SQLite 文件，默认 `~/.workctx/outbox.sqlite`。`sync flush --limit N` 上传一批待发送记录，N 为 1–100；它不负责下载和确认服务端变化。

新增 `workctx outbox reconcile EVENT_ID --outbox existing-outbox.sqlite`，网络/嵌入均读取指定原行的可信历史回执，事务内再次比对完整原行和租约后才结算 sent/conflict；不上传事件，不重置 attempt/next_retry_at。可选 --timeout-ms，默认 30000；拒绝 JSON、写键和重复选项。只检查已有文件及列，不自动建队列/升级；活跃发送、并发变化、损坏/缺身份、已有证据冲突均拒绝。recorded 且本地已结算/一致退出 0（包括冲突）；not-observed 原行不动、结构化输出且退出 1，不证明失败或允许重发。关闭失败保留已知结果并标 close_pending。数据库提交或输出失败时不能推断未写入。详见 [本地核对与结算](../../docs/design/01-contracts/outbox-reconciliation-runtime.md)；仅源码，未打开数据库或执行命令。

新增 `workctx sync identity`，只接受可选 --timeout-ms，读取当前可信 sync.write 账号/客户端身份和到期提示；网络/嵌入均不发送事件。准备新事件时保存返回的 data.identity，并作为完整 expected_identity 放入 outbox enqueue 的事件 JSON。入队仍离线，但缺原身份或范围不符时拒绝；不要用当前账号补写未知历史事件。可重新认证为同一原身份，不能换身份重发。

新队列行保存原账号/客户端和完整上传命令校验和，同本地键不同原内容/身份明确报错且不覆盖。flush 每批只处理一种原身份，发送时由 Gateway 核对预期身份头；账号切换会拒绝并保留原行，恢复原身份后再明确 retry。旧缺身份行保留并阻止发送，retry 不能补绑定；目前没有旧行身份迁移命令。SQLite 三个新增列仅写升级源码，本轮未打开数据库或执行升级，旧进程不能混用同一队列。见 [原同步身份](../../docs/design/01-contracts/sync-identity-runtime.md)。

网络 `sync flush` 传递本次 CLI trace，Bridge 发送器在取令牌、HTTP 和完整响应之间共用默认 30 秒本地等待预算；成功正文限 256 KiB，完整验证原批次所有事件及拒绝形状、范围、来源、trace 和游标。超时/取消或畸形回执不会结算为 sent，原事件按既有退避/失败上限保留；远端可能已经完成。HTTP 错误正文不读取或回显。flush 没有新增超时参数，后续 drain 的批次键仍可能改变。详见 [同步上传与完整批次回执](../../docs/design/01-contracts/sync-upload-runtime.md)，本次仅源码，未执行同步、编译或测试。

成功结果写入 stdout；结构化错误写入 stderr。退出码为 0（成功）、1（请求失败、部分同步失败或服务未就绪）、2（参数错误）。

Proposal 审核使用 `expected_revision`，要求令牌含 `actor_type=human` 和 `proposal.review`；普通服务令牌不能审核。列表按 ID 倒序分页，继续时将 `data.next_before` 作为 before，并保留 status/kind。详细字段及 018 迁移依赖见 [Proposal 运行时说明](../../docs/design/01-contracts/proposal-runtime.md)。

`proposals create` 的 JSON 可增加 `derived_from: { "proposal_id": "原建议 ULID", "revision": 2 }` 创建独立修订稿。须提供重新核对的正文、来源和实际模型/编写过程信息；原建议须同项目可读且版本匹配，新分类不能低于原分类。新建议从 proposed 开始，不修改原决定；同键重试须保留该关联。关联及其可见性边界见上述运行时说明。

`proposals list` 的 JSON 可传 `derived_from` 字符串查询原建议的直接修订（例如 `{ "derived_from": "01JAAAAAAAAAAAAAAAAAAAAAAA", "limit": 25 }`），不传 status 时包含所有状态。分页时保留该字段和 status/kind，并将 next_before 传为 before。该筛选不查询全部后代，仍按关联链权限过滤；原建议缺失或不可读时不泄露其修订数量。

`context read` 读取来源条目，`context get` 读取保存的上下文包。新增条目始终 proposed；编辑不允许提升为 confirmed 或改变分类。写响应是历史命令回执，重试以 `replayed=true` 标记；用 `context read` 获取最新正文和版本。详情见 [ContextItem 开发说明](../../docs/design/01-contracts/context-item-runtime.md)。

查询归档条目时给 `context list` 传入 `archived: true`，归档详情使用 `context read-archived`。`context restore` 需要 context.write、归档版本和请求键，恢复后条目仍为 excluded，保留原分类和到期时间；确认内容后可另行 update 为 proposed。旧包/旧来源引用不会自动有效。活动和归档视图不能共用分页游标。020 迁移文件尚未执行。

`context history` 返回已记录的版本摘要，默认 25 条（limit 为 1–100），将 data.next_before_version 传为下一次 before_version。`context version` 读取指定版本的完整快照，未记录或不可见的版本返回 404。baseline 表示首次修改前捕获的旧状态，原作者未知；更早内容不重建。历史只读，不能把旧版本直接当作当前写入前提。依赖未执行的 021 迁移。

`context compare-packs --json-file pack-comparison.json --timeout-ms 30000` 比较两个指定保存包。文件包含 `{from_pack_id,to_pack_id,expected_actor_id,expected_client_id}`，也可使用 `--json`；4 KiB、严格UTF-8/稳定普通文件，仅网络可用有界 `--json -`。默认30秒覆盖SDK两次读取/摘要/比较，输入采集和stdout发送在期限外。输出完整原query/identity_constraints/from/to/comparison，各侧2 MiB、差异8 MiB、组合12 MiB；第二次读取失败也不返回半份。嵌入要求原可信未过期实际context.read，核对两次请求、入选restricted和授权审计后取消；八类上下文读取共用每router两笔容量，底层结束才释放。无写键、output、自动重试/换包/编译/文件保存；两次读取不是同一数据库快照，摘要不证明外部来源真实性，通用transport无HTTP状态/ETag头。详见[完整输入示例及边界](../../docs/design/01-contracts/context-pack-runtime.md#cli-指定保存包对比2026-11-04源码增量)。示例未执行，尚无运行兼容证据。

`context confirm` 是独立人工确认命令，JSON 包含 item_id、expected_version、reason，并提供固定 `--key`。需要签名 human 身份、有效客户端和 context.review，context.write 不足以确认。只接受未过期 proposed 条目，核对直接本地来源的版本、状态和分类；成功增加版本、记录理由，后续编辑撤去确认。`context read` 与历史详情可读取确认元数据。未知结果用原版本、原理由、原键重试。022 迁移文件尚未执行，命令未在本轮运行。

`context compile` 默认以4096的估计内容token预算、3600秒最大寿命生成项目上下文包，范围128–32768和60–86400。最多一个4 KiB `--json`或`--json-file`，省略为{}；网络可用有界`--json -`，嵌入不读stdin。必需稳定--key或正文idempotency_key，多个键来源须相同；可加成对expected_actor_id/expected_client_id。`--timeout-ms`默认30000，完整保存回执和SHA-256核对成功后输出；取消、超时或回执异常不证明保存失败，恢复须显式沿原项目、身份约束、预算、期限和键。只有明确要创建不同的新请求时才使用新键。详见[提交核验及兼容变化](../../docs/design/01-contracts/context-pack-runtime.md#cli-保存包提交核验2026-11-05源码增量)。

`context get`不带ID时读取最新可见完整包；默认输入{}，可选单一4 KiB `--json`或`--json-file`，网络`--json -`有界读取stdin。format支持json、markdown、mcp；后两者仍输出JSON，并在data.rendered.text提供完整匹配的Markdown。`--timeout-ms`默认30000，覆盖SDK读取及SHA-256；输入可加成对expected_actor_id/expected_client_id。完整成功上限2 MiB，不截断包；读取拒绝--key/--output/未知或重复参数。文件/stdin采集在SDK期限之前，stdout发送在期限之外；通用传输仅提供JSON内ETag，读取不会自动编译、换包或保存文件。

```text
workctx context compile --key pack-001
workctx context get
workctx context get --json-file pack-query.json
workctx context get --json-file pack-query.json --timeout-ms 30000
```

2026-11-03：`workctx conflicts` 读取元数据分页，默认 25、最多 100 条；`--json` 或 `--json-file` 可提供 query/status/entity_type/conflict_id/limit/cursor。后续请求沿用原筛选及 limit，显式传回 next_cursor；没有自动翻页。拒绝写键和重复选项。`workctx conflicts get` 按 conflict_id 独立获取双方值与决策信息；列表不再提供这些值。版本保留十进制字符串，两路 CLI 复用 SDK 的完整解析及本地预算；嵌入只接受一次 --json。无 outbox 或保存行为。仅源码开发，未运行命令，见 [冲突目录分页](../../docs/design/01-contracts/conflict-registry-runtime.md)。

2026-11-03：`workctx conflicts receipt --json-file original-conflict.json`（也可 --json）在网络/嵌入均使用专用入口，文件为正规 UTF-8 JSON、限定 1 MB 并检查读取期间变化，内联原文本也限 1 MB；支持可选 --timeout-ms（默认 30000，仅限 SDK/网络请求）。原 JSON 须含 identity/request_key/command，保留有效路由 ID、数字 expected_version、resolution、适用 merged_value 及所有额外原字段。使用原账号/客户端/项目及冲突解决权限，嵌入检查调用前后有效身份；不能传 --key、未知或重复选项。查询不重新解决冲突，not-observed 不证明失败；legacy/参数不匹配明确报错，不改写文件、不保存 outbox 或生成键。网络旧 --json - 仍走通用 stdin 兼容读取，不具备新文件读取边界或 --timeout-ms；嵌入拒绝 stdin。见 [冲突原请求回执](../../docs/design/01-contracts/conflict-receipt-runtime.md)，没有执行上述命令。
2026-11-03：outbox reconcile 错误输出增加 details.reconciliation，保留已经完整验证的原事件回执，并单列本次本地提交为 not-committed/unknown 及事务阶段、回滚状态。数据库关闭同时失败则补 details.close_pending=true，原错误码和回执仍保留；错误退出 1，不能因嵌套回执 recorded 就认定本地结算成功。无新增选项、离线回执导入或自动重试；仅源码文档，未编译、测试或执行命令。
2026-11-03：`outbox reconcile` 可选 `--result-output NEW_FILE`，在打开库前预检新路径，核对结束并尝试关闭后独占保存完整已验证回执；本地核对失败时同样保留并保存回执，原错误与本地未知状态不被文件结果覆盖。保存失败保留路径和完整结果，核对成功但文件失败退出 1；无完整回执时不造文件。新增 `outbox inspect-result --result-file SAVED.json`，无需令牌、项目环境或 SQLite，完整读取并核对结构/摘要后返回历史回执及来源标记。文件不是当前本地/远端状态或服务器签名，不能导入结算。见 [回执文件契约](../../docs/design/01-contracts/sync-event-receipt-file-runtime.md)；仅源码文档，未编译、测试、生成样本或执行命令。
2026-11-03：`outbox list` 改为现有队列的只读摘要分页，默认 20/最多 50，支持 JSON status/limit/after_event_id 与包含原 scope 的 next_query；不再全量读取正文或自动建库/升级。输出 data 已从数组变为 items/has_more/next_query 分页对象，旧消费者需迁移。新增 `outbox get EVENT_ID`，完整读取并校验原身份/命令/摘要，损坏明确报错，缺记录返回 null，活跃发送可查看但不修改。主程序和嵌入入口都不需要令牌/网络，使用已有范围配置；见 [队列读取契约](../../docs/design/01-contracts/outbox-reading-runtime.md)。仅源码文档，未编译、测试、运行或打开库。

2026-11-03：新增 `auditRecords(input,trace)`，严格原项目和 max_events/max_bytes/timeout_ms，在单次只读事务核验全部原身份/正文/命令摘要、事件和幂等键唯一性并对齐实际数量。默认1000行/64 MiB/30秒，超限或损坏明确未完成，保留原查询/定位/进度；不发送、改租约、确认或修复。CLI `outbox audit` 主程序与嵌入均只读已有文件；详见 [完整队列核验契约](../../docs/design/01-contracts/outbox-audit-runtime.md)。仅源码文档，未编译、类型检查、测试、执行 CLI、打开库或发布。

2026-11-03：新增 readArchive 与 outbox export/inspect-archive，完整保存指定项目已知原列/正文文本、身份/摘要、状态/调度/租约，最多1000行/32 MiB；单次只读 audit 收集全部记录，超限或损坏不截断。独立 outbox-archive 包子路径提供无 SQLite 的文件核验；原事件检查抽取共用，旧算法不变。CLI 关闭库后独占保存新文件并完整读回，失败保留路径/档案摘要/关闭状态；历史租约不授予发送权限，恢复另待补。见 [发送队列档案契约](../../docs/design/01-contracts/outbox-archive-runtime.md)。仅源码文档，未编译、类型检查、测试、执行CLI、打开库或生成样本。


2026-11-03：新增 readSendControl/changeSendControl 和 outbox send-control/pause/resume，按项目持久暂停后续领取，原 generation 比较防止陈旧覆盖；首次显式暂停同事务初始化可选控制表，常规读取/构造不初始化。发送领取每次读取，暂停项目不占跨项目窗口；已领取批次仍可能发送和结算。只读状态有界统计发送中记录，过期/缺令牌或超限不声明发送已停止；提交未知保留原查询和候选generation。旧进程协调、档案恢复与运行证据仍待补。见 [发送控制契约](../../docs/design/01-contracts/outbox-send-control-runtime.md)。仅源码文档，未编译、类型检查、测试、执行CLI、打开库、初始化schema或发布。



2026-11-03：新增 restoreArchive/readRestoreReceipt 与 outbox restore/restore-receipt。完整原档案恢复到已暂停的空项目，绑定原档案摘要/恢复ID/控制generation，预检全库事件和键冲突；未完成行改为failed待处理并清除租约，原正文/身份/摘要/尝试/调度保持。完整原档案、原查询与恢复回执同事务持久保存，全部写入后逐行及整回执读回；重复原请求只返回历史，不覆盖后来变化的队列。回执查询不改当前状态，未知提交保留原请求/候选和关闭信息，不自动resume/retry/发送。见 [受控恢复契约](../../docs/design/01-contracts/outbox-restore-runtime.md)。新增可选本地表仅源码，未编译、类型检查、测试、执行CLI、打开库、初始化schema或发布。


2026-11-04：`artifacts get/version/receipt` 的网络与嵌入入口支持 `--timeout-ms`（默认30000），使用有界SDK查询并完整核对响应。通过 `--json` 或 `--json-file` 输入，元数据查询JSON最多4 KiB、完整原回执请求最多1 MiB；网络仍支持 `--json -`，嵌入不读取stdin。成功元数据2 MiB、回执4 MiB、HTTP错误16 KiB；输入读取在查询计时前完成，文件/stdin等待不受该期限约束。嵌入要求可信未过期资料reader或原writer，超时后底层处理可能继续。查询失败保留原请求，不推断此前上传失败。见 [附件查询限制](../../docs/design/01-contracts/artifact-persistence-runtime.md#cli-元数据与原回执查询限制源码阶段)。仅源码文档人工审阅，未编译、类型检查、测试、执行或发布。
