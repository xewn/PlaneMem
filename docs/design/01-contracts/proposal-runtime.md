# Proposal 提交与人工审核开发说明

更新：2026-11-01。本文记录新增代码；未执行编译、类型检查、测试、数据库迁移、部署或发布。

## 入口与身份

| 方法 | 路径 | 能力 |
| --- | --- | --- |
| POST | `/v1/proposals` | `proposal.write` |
| GET | `/v1/proposals` | `context.read` |
| GET | `/v1/proposals/submission-context` | 有效客户端身份；仅返回自身身份及范围 |
| GET | `/v1/proposals/{proposal_id}` | `context.read` |
| POST | `/v1/proposals/{proposal_id}/confirm` | `proposal.review` |
| POST | `/v1/proposals/{proposal_id}/reject` | `proposal.review` |

全部接口要求 Bearer 身份和租户/工作区/项目范围头。写入需要有效客户端身份和稳定请求键。确认、拒绝额外要求签名令牌明确包含 `actor_type: "human"`，没有这个声明或声明为 service 的令牌不能审核。actor_type 只从验证后的令牌读取，不从正文、普通请求头、客户端名称或用户填写的布尔值推断。管理员也不能绕过 human 声明和 restricted 内容可见性。

身份提供方需给真实交互式用户签发 human 声明，给受信审核角色授予 `proposal.review`；应防止服务账户自行取得该声明。当前代码不修改外部身份提供方，也不把普通登录或 Base scope 自动升级成审核权限。网关记录审核权限拒绝审计，具体审核决定在持久化 Proposal 与同步事件中保留。

## 提交

```json
{
  "kind": "next_step",
  "title": "下一步工作建议",
  "content": "根据当前交接内容，建议先整理未决问题。",
  "source_refs": [{ "type": "context-item", "id": "01JAAAAAAAAAAAAAAAAAAAAAAA", "revision": 3 }],
  "model_version": "provider/model-version",
  "prompt_version": "next-step-v1",
  "classification": "internal",
  "ttl_seconds": 604800
}
```

必填 kind/title/content/source_refs/model_version/prompt_version。kind 为 decision、risk、next_step、blocker、brief；标题最多 300 字符，正文最多 131072 个 JavaScript 字符串长度单位，来源 1–32 条，model/prompt version 各最多 200 字符。classification 默认 internal；TTL 默认七天（604800 秒），范围 60–2592000 秒。字段校验复用上下文条目的文本和来源限制，并拒绝未知字段。

新建议始终 proposed、revision=1。正文、来源及 provenance 在提交后不可修改，需要变更时提交新建议。服务端保存规则式提示注入警告，但警告只是供审核者参考，不代表内容已安全或已验证。model/prompt version 是提交者提供的来源信息，不是服务端模型执行证明。

类型精确为 `context-item` 的来源必须提供正整数 revision。提交时在当前项目内读取来源，验证权限、版本、归档、excluded 和过期状态，并保存来源指纹。建议的分类至少等于声明分类和所有直接本地来源分类中的最高级，不能以较低分类包装本地 restricted 内容。其他来源类型保留为外部引用，网关不抓取或验证其内容。

### 从已有建议提交修订稿

创建请求可选 `derived_from: { "proposal_id": "01JAAAAAAAAAAAAAAAAAAAAAAA", "revision": 2 }`，仅接受原建议 ULID 和正安全整数 revision，拒绝额外字段或 null。网关在原创建事务和项目流锁内检查原建议同项目可读、版本与请求一致，并将关联保存到新建议的 `provenance.derived_from`。原建议版本改变返回 `PROPOSAL_VERSION_CONFLICT`，不可见/不存在返回 `PROPOSAL_NOT_FOUND`。关联和新草稿一起参与请求指纹；未知结果重试必须保持原关联、正文、来源及请求键。

新建议始终使用新 ID、proposed/revision 1、新 TTL 和新审核流程；原建议可以是 proposed、verified、rejected 或已经过期，只要当前可读即可。原建议的来源可以已经失效，以支持修复后重提，但新建议自己的全部本地来源必须重新通过当前版本和依赖检查。新分类不低于声明分类、原建议保存分类及新直接来源分类的最高级。关联表示修订来源，不授予批准，也不把原建议的过期时间、审核状态或模型运行记录当作新建议的证明。原建议的状态、正文和审核记录不修改。

派生关系在读取权限上沿原建议链生效：列表、详情、审核、回执重放和同步事件继续核对每一层原建议的分类及其原直接本地来源的当前可见性。原建议后来不可读、原本地来源被归档或变为不可读时，修订稿也不可读，不能通过删掉复制的来源绕过这个约束。关联链逐跳绑定同一 tenant/workspace/project，最多 32 次派生；缺失、循环、超限链默认不可见，创建第 33 次派生返回 INVALID_INPUT。原建议后续的正常审核及 revision 增加不撤销修订关系，也不会给子建议补授批准；来源有效性仍由子建议自己的 source_manifest 决定。

关联复用现有 provenance JSONB 存储，无需新增存储列或回填旧行；直接修订查询的索引文件增补见下文，未执行数据库迁移。不带 derived_from 的请求仍省略该字段，保持已有规范化字段顺序，避免改变旧请求指纹与 worker 已保存草稿。SDK、CLI、HTTP MCP 和 worker 提交面均可携带此字段；客户端须使用支持该扩展的网关。以上为开发实现说明，尚无运行或性能验证。

## 审核

确认或拒绝正文：

```json
{ "expected_revision": 1, "reason": "已检查原始来源，接受这条建议。" }
```

reason 必填、最多 2000 字符。expected_revision 可以由 `If-Match: W/"version-1"` 提供；两者同时出现必须一致。每条建议只有一次最终决定：proposed → verified 或 proposed → rejected，revision 增为 2，并记录审核 actor/client、时间和理由。不同请求重复审核或使用过期 revision 返回 409，不覆盖原决定。

确认前再次锁定并检查本地来源的 revision、内容指纹、状态和到期时间；来源变化返回 `PROPOSAL_SOURCE_STALE`。建议过期后不能确认，但只要仍可见，允许拒绝。来源被归档、移出范围或变为当前不可读分类时，建议在列表、详情和重试回执中一起隐藏，返回 404。

verified 表示该建议 revision 曾经过明确人工审核，不表示来源永远有效。详情返回 `sources_current`，用于提示本地来源链是否仍符合提交时的状态。新增建议保存递归依赖摘要，创建/确认/详情均接入有界本地来源检查；旧建议含本地来源但没有依赖摘要时返回 false，需提交新建议，仍允许按原有权限查看和拒绝。没有本地来源时，这个值仅表示没有待校验的本地来源，不能解释为外部证据已经验证。边界和限制见 [本地来源链说明](context-source-runtime.md)。

审核结果目前保存在 Proposal 自身，不自动修改 Plane 工作项、不创建 confirmed ContextItem，也不改写已保存 ContextPack。将审核结果纳入上下文包、后台级联通知及来源变化后的重新审核需要后续开发。

## 持久化、回执和事件

新增 `018_proposal_reviews.sql` 创建建议及命令回执表，依赖现有项目、上下文和同步表。该迁移尚未执行；同步读取新增查询也依赖此表，部署代码前须安排相应升级。存储不可用时返回 503，不回退到内存结果。

同一事务获取项目同步流锁，保存建议或决定、命令回执和同步事件。命令键按 actor/client 哈希后绑定 tenant/workspace/project。规范化后的命令类型、提案 ID、原 revision、理由或创建内容参与指纹；相同请求键和内容重试返回原回执，不再次增加 revision。改变决定、理由或原 revision 后需要新键。每次回放仍检查身份、策略和当前来源可见性。

写响应 `data` 包含 proposal_id/status/revision/event_id/occurred_at/replayed。它是历史命令结果，不能代替当前详情读取。响应外层保留 trace、revision、ETag、server_cursor 和来源引用。所有响应沿用 `Cache-Control: private, no-store`。

创建追加 `ApprovalRequested`，审核追加 `ApprovalCompleted`，aggregate_type 为 Proposal。同步 payload 仅含 ID、kind、status、revision，不含正文或审核理由；通过详情权限读取具体内容。同步事件根据建议及其当前本地来源可见性过滤。

## 列表和客户端

GET 列表接受 status、kind、before、limit，以及可选的 derived_from（原建议 ULID 字符串）。默认 25 条，limit 为 1–100，按 proposal_id 倒序返回摘要；`data.next_before` 为下一页 before。继续分页时保留 status/kind/derived_from 等原筛选。分页是当前视图，不提供跨请求快照；审核导致状态变化后，应返回第一页刷新。详情返回 `data.proposal`、`sources_current` 和 `review_allowed`。review_allowed 仅表示基础身份/能力条件，最终决定仍经过策略。

列表的 derived_from 只选择 `provenance.derived_from.proposal_id` 等于该 ID 的直接修订，不递归罗列全部后代，也不按原建议 revision 区分。它与创建正文中作为对象的 derived_from 含义不同：创建对象记录原 ID/revision，列表参数只指定原 ID。所有候选仍经过同项目及整条派生链可见性过滤；原建议不存在或不可读时返回空列表，不额外确认其存在，不返回隐藏条目或总数。

新增共享 `parseProposalListQuery`，网关、SDK、CLI 与工作台复用 status/kind、ULID 及 limit 校验；HTTP 入口仍拒绝重复或未知查询参数。SDK `listProposals({ derived_from: id })`、CLI `proposals list` 的 JSON 字段以及 MCP `list_proposals` 均可使用筛选。新增 `023_proposal_derivation_index.sql` 为项目范围、原建议 ID 和倒序分页提供表达式索引，仅写入文件、未执行；索引不改变权限语义，不包含性能验证结论。

列表增加可选 `data.create_allowed` 和 `data.restricted_read`，供工作台显示提交入口与分类选项。create_allowed 要求经过认证的客户端及 proposal.write（或 admin），restricted_read 对应 data.restricted.read。旧响应缺少这些提示时，工作台默认不显示创建表单。它们不是授权凭据；提交仍经过网关鉴权、策略和来源检查。

- SDK：createProposal/listProposals/getProposal/confirmProposal/rejectProposal。审核选项为 `{ expected_revision, idempotency_key }`，理由作为单独参数。
- CLI：proposals create/list/get/confirm/reject。审核 JSON 使用 proposal_id、expected_revision、reason 和稳定 `--key`。
- MCP：create_proposal/list_proposals/get_proposal/confirm_proposal/reject_proposal。审核工具只向签名 human 身份且具备能力的客户端展示；调用同样强制校验。资源为 `work://project/{project_id}/proposal/{proposal_id}`。
- 工作台 `/proposals`：授权用户可以提交建议，包含类型、正文、分类、有效期、模型/提示版本和 1–32 条来源；也提供状态/类型筛选、分页、正文、来源、警告、审核历史和确认/拒绝表单。未知审核结果保留并锁定原决定与理由；版本冲突提供显式重新加载。外部来源只显示安全 HTTP(S) 链接，不执行其中内容。

### 工作台提交流程

在建议页展开提交表单，或者从 `/context` 条目详情选择 “Prepare a proposal using this source”。后者跳转到 `/proposals?source={item_id}`，服务端重新读取当前可见条目，将其 ID、当前 revision 和分类带入草稿，不复制或编造建议正文。归档、不可见、过期或 excluded 的初始来源会显示错误/说明，需显式选择其他来源。创建入口要求同时能读取工作台页面并具有提交能力。

来源可以增删，直接本地引用使用精确的 `context-item` 类型及正整数 revision；用户可在新标签页打开当前条目，检查内容和版本。服务端在真正提交时再次验证来源，因此打开表单后发生的编辑也会触发冲突。普通外部来源仍需要人工核实。模型及提示版本由用户明确填写；人工撰写可使用 manual 和实际编写流程标识，不伪造模型运行记录。

每次修改尚未准备的草稿都会更换请求键并取消准备确认。Prepare original submission 校验草稿并读取既有 submission-context，固定原网关、项目、账号、客户端、请求键和完整规范草稿；这一步不创建建议。新准备的完整原请求单独展示，并尝试保存在本浏览器 IndexedDB，用户再次审阅确认后才显式发送。所有提交错误均保留冻结原请求，不因 401/403/404/409/5xx 或无效回执换键/解锁；收到完整有效回执后提供建议详情链接，原请求继续保留。人工审核保持独立。

尚未准备的草稿仍只在页面内存中；已准备的完整原请求可以从浏览器目录、旧标签页精确槽或导出的文件恢复，详见下节。此入口接通人工填写/粘贴已有建议的提交过程，不调用模型，也不自动审核或物化为 ContextItem。

### 工作台原提交保存与恢复

`/proposals/recover` 独立读取当前可信 submission-context，不依赖建议目录或某条建议详情可读。可从本浏览器目录选择、按原键读取浏览器或旧标签页精确槽，或导入 UTF-8 文件/粘贴完整 JSON。读取不会发送或自动保存；导入先比较原网关、项目、账号及客户端，不匹配则拒绝，不将其改成当前身份。页面、创建表单和目录读取失败状态均提供恢复入口。同源、同浏览器配置中的新标签页可读取已提交的 IndexedDB 副本；仅存于旧 sessionStorage 的内容仍须在旧标签页载入后明确保存或导出。

原请求 v1 为 `{schema_version:1, kind:'proposal-submission', binding:{gateway_url, identity}, request_key, draft}`。identity 含原 tenant/workspace/project ULID 和 1–255 可见 ASCII actor/client，网关为 HTTP(S) origin、不得含凭据或路径。键遵循既有幂等约束；draft 保存全部规范字段，包括固定 source_refs、分类、TTL、实际模型/提示版本及可选 derived_from 原 ID/revision。顶层/绑定/草稿拒绝未知字段；导入不补默认值或修改原正文。完整输入和规范 pretty JSON 最大 1 MiB，严格有界读取；编码按对象键排序，数组顺序保留，相同内容不因对象键顺序变化冲突。

原请求保存槽按完整 binding 和原键区分，写入前比较已有完整内容，损坏/不同内容不覆盖；写后读回完整核验。恢复载入只展示原请求，须明确保存或发送才写浏览器副本；每次发送前仍重新保存与读回并等待事务提交，失败则不调用提交动作。旧 sessionStorage 槽保持可读且不自动删除，若同键旧副本损坏、不可读或内容不同则阻止保存/发送，不选择其中一份覆盖另一份。浏览器副本详见下节。导出按钮只表示浏览器下载已发起，需检查文件实际保存；文件包含完整建议内容，应按原分类保管，不含登录令牌。

每次明确发送，服务器先比较当前配置网关与原网关，再读取可信 submission-context 检查 identity_preconditions=1、完整身份、scope、trace 和空来源封套。实际 POST 继续携带原键、原草稿及 X-Expected-Actor-Id/Client-Id，服务器还比较当前项目范围；登录切换不会把原请求改绑到新账号。预检身份不授予 proposal.write、不证明来源仍有效；实际 Gateway 仍执行原权限/来源/幂等校验。上下文响应最多 16 KiB、提交回执最多 64 KiB，读取有本地期限且不重定向或自动重试。

提交成功必须核对 trace、revision=1、ETag、正安全整数 server_cursor、单一 proposal 来源及对应 ID/revision，以及 proposed/revision 1 的完整命令回执；浏览器再次检查原请求对应关系和回执。只有这些检查完成才显示成功链接。历史幂等回执说明原创建已确认，不表示建议当前仍为 proposed，详情会重新读取。任何不确定结果、后续权限/来源错误及页面离开都不删除原请求或改变键；恢复后仅显式重试同一创建命令，不会自动确认/拒绝建议。当前没有只读创建回执查询，也不提供自动放弃、原请求正文修改或审核请求恢复。

本增量只覆盖新版创建表单准备出的完整原提交及同格式文件；旧页面里没有完整身份绑定的内存草稿不能冒充可恢复原请求。来源的当前真实性、内容签名和跨设备存储完整性不由本地 JSON 证明。未编译、类型检查、测试、运行浏览器/网关、执行数据库或发布。

### 浏览器持久副本与恢复目录

独立 `planemem-proposal-originals` v1 浏览器数据库包含 `originals` 和 `directory` 两个无索引、无自动编号的外部键 store，复用既有 `browser-store` 的有界连接/事务工具。仅保存操作可初始化缺失数据库；读取缺库返回空，异常布局/版本、阻塞或打开失败不降级可写。源码新增此结构，本轮没有打开或初始化任何浏览器数据库。

键沿用 `planemem:proposal-original:v1:` 加规范 `[binding,request_key]`，保持旧标签页精确槽兼容；浏览器键最多16 KiB。正文为最多1 MiB的完整规范原请求，摘要最多4 KiB，含格式版本、原键、标题、类型、分类及规范正文UTF-8字节数。保存先核对旧标签页槽，再在单一读写事务读取原文/摘要；缺失双槽才同时 `add`，已有双槽须完整核验并与输入相同。半对、异文或损坏拒绝，既有内容不 `put`、不修复、不删除。写后同事务完整读回，事务完成后再核对旧槽才返回；同文并发保存保留第一份，异文并发不覆盖。提交结果未知时保留内存原请求和导出入口，不能据此派发服务器动作。

恢复目录只扫描完整原网关/tenant/workspace/project/actor/client前缀范围，按字符串键升序每页最多20条，额外读取1条摘要判断是否有下一页。续页键必须是同一范围的规范键，不接受跨身份/网关游标。每行先核验键与摘要格式；发现损坏拒绝整页，不返回部分成功。只读事务提供本页一致读取，跨页没有冻结快照；其他标签页新增较早键时需回首页重读。目录不读取全文、不查询服务器、不证明原文尚在或建议已提交，也不枚举其他身份范围。

选中摘要后重新读取完整原文与摘要双槽，核验原绑定、原键、正文规范编码、摘要及字节数，并与所选摘要比较后才展示。按原键和旧槽读取仍独立可用；旧副本或文件载入不迁移、不保存、不提交。完整原文、摘要和浏览器身份范围只是本地恢复数据，不是权限证明或远端回执。新准备请求可自动尝试本机保存，恢复请求只在明确保存/发送时写入。

打开连接与事务各有10秒本地等待边界；组件离开时取消未完成存储操作，忽略过期异步结果，存储完成前离开不继续调用提交动作。已经调用的服务器动作仍可能完成，不能把离开页面当作取消提交。保存失败、容量不足、旧副本冲突或损坏均保留原键和正文，明确重试时继续比较原副本。

同源同浏览器配置的副本可在关闭标签页后恢复，但浏览器清理、隐私模式、存储驱逐或更换设备都可能导致缺失，不保证长期保留。独立导出文件仍有必要；当前绑定范围的完整备份见下节，自动云备份、跨范围整库联合备份、清理/容量管理、未准备草稿持久化、审核请求恢复或只读创建回执接口仍缺。仅源码及文档与人工审阅，无编译、类型检查、测试或运行证据。

### 原请求范围备份与导入

恢复页新增 “Back up or restore saved requests”，独立准备当前可信 binding 下的完整浏览器备份，然后明确下载。备份只覆盖该原网关及 tenant/workspace/project/actor/client 精确前缀范围内的 IndexedDB 副本，不包含其他身份、旧标签页独有副本、未准备草稿或服务器回执。旧副本须先载入并明确保存，不能把目录摘要或新内容冒充原请求。这里的“完整”是所选精确范围的单次快照，不表示全浏览器审计或服务器状态。

导出在同一只读事务检查 originals/directory 范围计数相等且最多100条，再按原键顺序读取每一个完整双槽，核对原绑定、键、规范全文、摘要和字节数；缺项、错配、损坏或超限拒绝整份，不截断导出。读取不创建缺失数据库；缺库/空范围可形成带原绑定的空备份。正文累计和完整规范文档均最多16 MiB，每条仍受1 MiB原请求限制。事务中所有内容核验完成后才交给摘要和文件封装步骤。

v1 文件为 `{document, document_sha256}`，document 为 `{schema_version:1, kind:'proposal-originals-backup', binding, entries}`。entries 是完整规范原请求，按原存储键严格升序、不可重复，每条 binding 必须与 document 完全一致。顶层、文档、绑定和原请求继续拒绝未知字段，不修正原身份/正文/键。摘要为64位小写十六进制 SHA-256，输入是固定字段顺序的紧凑 v1 文档 JSON：binding 使用既有规范字段顺序，各 entries 使用原请求对象键排序编码，数组顺序保留。文件最多16 MiB+1 KiB，读取核对源文件大小/实际字节数并严格解码 UTF-8；不根据文件名信任内容。摘要证明所载规范内容未变化，不证明来源、签名、可信正文或远端提交结果。

文件载入只做完整格式、范围和摘要核验，页面保留规范文件并列出包含的请求；下载保留文件仍需用户确认浏览器实际保存。显式 “Compare with this browser” 再次验证保留文件，使用只读事务检查每个候选的当前原文/摘要及同键旧标签页副本，报告 missing/same/different/blocked。不可读、损坏或旧槽不同会阻止整批导入；基础双槽布局/存在性错误可使整次比较失败，不显示部分成功。缺库比较不初始化；空文件比较返回零项。比较只覆盖备份候选，不要求目标范围没有额外请求，也不修改这些额外记录。

用户审阅文件身份、条目和比较结果后单独勾选确认。实际导入重新读取保留文件、核对已审阅摘要/当前 binding，再在一个读写事务预检全部候选，使用与预览相同的比较规则。所有候选均为 missing/same 才开始写入：missing 同时 add 原文/摘要，same 保留；不同或损坏拒绝整批，不替换、删除或补修半对。写后读回每个新增双槽，再完整比较所有候选，等事务完成并再次核对旧槽才报告新增/原有数量。只读预览不锁住之后的状态；并发新增相同内容可变成 same，新增不同内容使实际导入失败。空备份不创建数据库或写入。

导入只恢复本机副本，从不调用提交动作、生成新键、确认/拒绝建议或删除源文件。文件读取/摘要/存储合计30秒本地期限，存储连接与事务仍各受10秒限制；载入文件、比较、准备与导入共用页面忙碌保护，离开页面取消未完成工作并忽略过期结果。事务已经提交而后续确认失败时结果可能未知；页面保留完整规范备份并撤销旧确认，需重新比较后明确重试。重新发现相同内容只说明当前副本相同，不推断上次导入是否提交。未知结果、容量不足、摘要失败或冲突都不能丢弃原文件。

没有跨身份整库备份、自动云备份、损坏存储修复、删除/容量管理或历史导入回执；当前协议不声称涵盖在范围外的异常键。仅源码和文档，无编译、类型检查、测试、浏览器/接口/数据库运行或发布证据。

### 工作台审核重试与来源查看

创建和审核的成功响应现在核对 proposal_id、预期 status/revision、event_id、occurred_at 和 replayed。创建须返回 proposed/revision 1；确认或拒绝须返回对应建议、verified 或 rejected 以及原 revision 加一。不匹配或缺失字段视为未知结果，保留原请求重试，不直接跳转或认定审核已完成。

审核首次出现未知结果后，后续鉴权、404、409、410 或本地输入错误均持续保留原决定、理由、确认勾选与请求键，不显示重新加载或换键入口。只有此前没有未知结果的确定性版本/来源冲突才提示重新加载。修改决定或理由会撤销确认勾选，需重新明确确认本次审核；未知期间不能修改。审核表单尚无跨页面草稿恢复。

建议详情的本地来源提供当前条目和提交时固定 revision 的历史链接，均在新标签页打开，以保留当前审核表单。历史版本缺失或当前不可见时沿用历史读取错误，不替换为当前版本。查看历史不修改建议来源或恢复其有效性；过期或失效建议仍需按现有流程提交新的建议。

### 工作台修订草稿

可提交用户在已有建议详情选择 “Prepare a revised proposal”，在新标签页打开 `/proposals?from={proposal_id}`。页面重新读取可见原建议，带入标题、正文、类型、分类及原固定来源，保留原建议 ID/revision 关联。来源失效或原建议过期不阻止准备草稿，但新提交仍须通过服务端来源检查。不能同时指定 from 和 source 两种起点；原建议不可读时不创建空白替代稿。

模型/提示版本留空，用户需填写此次真实生成或人工编写过程；旧批准不带入确认勾选。固定来源版本不自动升级，用户可打开当前来源自行核对并修改。原建议在编辑期间发生审核时，可先在新标签查看它，再明确更新“Original proposal revision reviewed”；此编辑和其他草稿修改一样更换请求键并取消提交确认。未知结果期间包含原版本在内的所有草稿参数锁定，沿用原请求重试。

保存后新详情展示原建议链接及记录的 revision；链接读取的是原建议当前状态，不冒充不可用的 Proposal 历史快照。尚未准备的修订草稿仍只在当前页面；准备后使用同一完整原提交保存/导出/恢复流程，保留原关联版本。没有后台草稿存储、自动模型生成、批量重提、原建议自动拒绝或自动物化。

详情为可读用户提供 “View direct revisions of this proposal”，修订稿还提供同一原建议下的其他修订入口，均在新标签页打开以保留当前草稿。列表可填写原建议 ID，下一页、条目选择和返回第一页保留此筛选；改变条件或清除原建议筛选回到第一页。跳转入口默认查看所有状态，页面明确区分直接修订与更深后代；显式选择不在当前分页/筛选中的可读条目时显示说明。空列表不表示原建议不存在或所有修订均不存在。

## 错误与后续范围

worker 的 `prepare-generation` 可按明确条目 ID/revision 取得当前可见且有效的来源，输出独立生成输入；身份预检、版本检查、来源状态和失败边界见 [来源准备契约](proposal-generation-sources-runtime.md)。这是逐条读取观察，不锁定未来权限或来源，提交仍执行原来源检查。

| 错误 | HTTP |
| --- | --- |
| INVALID_INPUT | 400 |
| DENIED | 403 |
| PROPOSAL_NOT_FOUND | 404 |
| PROPOSAL_VERSION_CONFLICT、PROPOSAL_ALREADY_REVIEWED、PROPOSAL_SOURCE_STALE、PROPOSAL_SOURCE_UNAVAILABLE、IDEMPOTENCY_KEY_REUSED | 409 |
| PROPOSAL_EXPIRED | 410 |
| PROPOSAL_INVALID | 500 |
| PROPOSAL_STORAGE_UNAVAILABLE | 503 |

worker 已增加 SQLite 持久提交队列和显式 enqueue/list/get/retry/flush 命令，使用真实 HTTP 提交已有草稿，详见 [worker 使用说明](../../../workers/intelligence/README.md)。发送前通过 `GET /v1/proposals/submission-context` 核对协议及已认证身份；随后使用相同令牌和固定请求键提交。`X-Expected-Actor-Id` / `X-Expected-Client-Id` 是已验证身份的前置条件，不是身份来源；不匹配返回 DENIED。队列绑定网关、项目、actor/client，未知结果只重试原草稿和请求键，保留 uncertain 标记。

2026-11-04：worker 的 `list/get` 改为原生只读打开已有队列，缺失文件不会创建；读取事务检查 v1 必需表/列及唯一绑定，绑定文本最多 16 KiB，并与规范化的网关/项目/身份精确匹配。只读分支不初始化结构、绑定或更改 journal_mode/synchronous，不回退可写；库接口可传 `{ readonly: true }`，所有写入入口报 `PROPOSAL_QUEUE_READ_ONLY`，flush 在获取令牌前拒绝认领。默认可写模式保留，结构/绑定检查不等于全队列完整性审计。无 schema 或依赖变更，仅源码文档，未编译、测试、运行 CLI、打开数据库或发布。

2026-11-04：新增显式模型草稿生成源码，配置兼容端点/模型后可调用 `proposal-worker generate`，从用户指定来源摘录生成并独占保存标准草稿，后续审阅再显式入队。模型只返回标题/正文，来源、类型、分类和期限固定，详情见 [生成契约](proposal-generation-runtime.md)。未调用模型，兼容性和质量没有运行证据；原内存 ProposalService 已标记为 deprecated，仍保留离线兼容，不是上述 HTTP 接口的存储。自动来源摄取、生成持久任务/审计、外部证据验证、建议正文编辑历史、重开审核、审核结果物化到 ContextItem/ContextPack、后台调度、规模化保留清理和运行验证仍待后续工作。
