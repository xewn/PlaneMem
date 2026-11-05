# 本地上下文来源链检查

2026-11-05，TODO **P0-01**：当前详情的来源检查现有独立[机器 Schema](../../../packages/contracts/schemas/context-item-read.json)与[OpenAPI 描述](../../../packages/contracts/openapi/context-item-reads.json)，完整覆盖 aggregate state、直接引用位置诊断、可选严格确认准备及 confirm_allowed 关联。current 不代表外部证据或将来写权限；准备检查与普通检查使用同图/同时间且共享遍历工作预算。ETag 只绑定条目保存版本，来源或时间变化可在同 ETag 下改变提示。新 Schema 没有替换来源遍历或 Gateway 解析，不把图预算视作完整响应/数据库总限额；仅源码，未编译、测试、运行校验器/生成器/产品/API/数据库或发布。

更新：2026-11-01。本文记录开发代码，未执行编译、类型检查、测试、服务启动、迁移、部署或发布。

## 检查范围

网关增加共享的 `inspectContextSources`，用于当前上下文详情、人工确认、持久 ContextPack 编译/读取及 Proposal 创建/审核。只递归解析精确类型为 context-item 的引用，在调用者已授权的 tenant/workspace/project 范围内读取。其他类型的引用不发起网络请求，不代表外部证据已经验证。

每条本地引用须固定正安全整数 revision；被引用记录须存在、未归档、可读、状态为 proposed 或 confirmed、未过期，版本必须一致。父条目的分类不得低于子条目。父条目为 confirmed 时，其直接本地子条目也须为 confirmed，因而确认链中的后代保持确认状态；人工确认模式还要求 proposed 根条目的所有本地后代都已确认。普通 proposed 内容可引用当前 proposed 来源，但不能成为已确认来源的替代品。

同一节点在一次请求中只加载一次，每批最多 64 行，正文生成 SHA-256 摘要后不保留在图缓存中。按固定顺序遍历，检测循环、自引用、缺失版本和结构损坏。单次最多加载 4096 个节点、每个节点最多 32 条来源、路径最多 32 条边，遍历工作上限 1000000 步。超限返回 limit，不能解释为检查通过；这些是开发阶段的容量边界，不是性能验收数据。

未授权或已归档节点不继续展开。对外给出当前根条目的检查状态和时间，并可给出直接来源的位置、检查结果和可读活动来源的当前版本，不返回隐藏后代的 ID、正文、标题或分类。该检查不改变现有详情读取权限；能读取条目内容不等于它的来源链仍有效。

## 当前条目与确认

活动条目 GET 的 data 增加 sources_current 和 source_check：

```json
{
  "sources_current": false,
  "source_check": {
    "state": "stale",
    "checked_at": "2026-11-01T12:00:00.000Z",
    "scope": "local-context-items"
  }
}
```

state 为 current、stale、unavailable、expired、excluded、cycle、limit 或 invalid。它检查根条目自身的生命周期以及本地来源链；current 不代表外部证据真实、模型输出正确或存在人工审核记录。没有本地引用时仍检查根条目自身，并只表示没有待递归检查的本地依赖。

详情的内容、确认元数据和来源检查位于同一个可重复读事务；工作台显示当前检查结果与时间。归档详情和历史快照保持历史读取语义，不自动替历史版本构造当前检查结果。列表也不对每行执行整图检查；查看具体条目或实际使用时才检查。

### 直接来源修复提示

活动详情还返回可选的 `source_checks` 数组，逐项对应根条目原有 `source_refs` 中类型精确为 context-item 的直接引用。例如第一条引用固定 revision 2，但其可读活动来源已变为 revision 3：

```json
{
  "source_checks": [
    { "source_index": 0, "state": "stale", "issue": "revision", "current_revision": 3 }
  ]
}
```

`source_index` 是原来源数组的零基位置，保持原顺序，不是图中隐藏节点标识；重复引用分别保留各自位置。state 沿用总检查状态，并增加 `not-checked`，表示根自身无效/不可用或遍历未完成，不能视为通过。缺失条目也不能推断为 current。`issue` 是可选的处理提示：reference 表示本地标识或固定版本无效，revision 表示直接版本不匹配，confirmation 表示缺少该引用所需的确认，classification 表示直接来源分类高于父条目，dependency 表示该来源自身或其下游检查未通过。它只描述当前优先报告的问题，不列举所有故障；修复后需重新读取。

`current_revision` 仅在直接来源处于同项目、可读、未归档且元数据有效时返回；已过期或 excluded 但仍可读的活动记录可以显示其版本，不能因此认定可用。缺失、不可见、归档来源统一为 unavailable，不返回它们的当前版本、分类、正文或下游路径。节点超限时仍保留 limit/not-checked；外部引用不加入本地检查数组。

诊断来自原图加载及原遍历，不为页面逐条查询来源，不参与依赖摘要、不写入历史快照，也不改变保存包或建议的有效性规则。根引用缺少固定版本时只保留该根已可见引用的修复提示，无效节点仍不继续展开。

工作台按来源原顺序显示固定版本、可披露的当前版本、原因及处理建议，失效时展开；当前条目及固定历史版本链接在新标签页打开。页面最多显示 32 条引用，旧数据超限时明确提示。不会自动采用当前版本、自动确认来源或把未检查结果当作有效。普通 proposed 来源链通过检查仍不等于满足人工确认模式的全部要求，最终确认继续按更严格条件重新检查。

### 确认前预览

对已认证且具备确认权限的 human 调用者，活动 proposed 条目详情还返回 `confirmation_readiness`：

```json
{
  "confirmation_readiness": {
    "sources_current": false,
    "source_check": {
      "state": "stale",
      "checked_at": "2026-11-01T12:00:00.000Z",
      "scope": "local-context-items"
    },
    "source_checks": [
      { "source_index": 0, "state": "stale", "issue": "confirmation", "current_revision": 2 }
    ],
    "effective_expires_at": null
  },
  "confirm_allowed": false
}
```

普通 `sources_current` 仍按内容使用规则检查，proposed 条目可以引用 proposed 来源。确认预览则要求所有本地后代都处于 confirmed 且固定版本一致；根本身须有 1–32 条来源。两种检查共用已加载、已按权限过滤的图和同一 checked_at，无额外数据库查询；使用各自的遍历缓存，避免把普通模式的通过结果用于严格模式，并共享单次 1000000 步总工作上限。达到上限时预览返回 limit，不开放确认入口。

`effective_expires_at` 是本条目及检查到的本地依赖的最早到期时间，仅 sources_current=true 时用于判断当前可确认性。网关的 confirm_allowed 同时要求严格预览通过、确认身份/状态正确且该有效期尚未到达。没有确认权限、不是 proposed、归档或历史读取时不返回预览；缺少字段不能解释为具备审核权限。预览及逐条信息不写入内容快照、保存包依赖摘要或历史批准，不改变正常内容使用规则。

工作台在普通链有效但严格条件未满足时显示“Confirmation readiness”和对应逐条原因，提前提示先审核/确认来源，再核对其确认后产生的新版本并更新父引用。确认来源、修改固定版本和确认父条目仍是独立的显式操作，不自动串联执行。

人工确认在项目同步流锁后取得图中行的共享锁，并再次使用要求后代 confirmed 的检查模式。无效、循环或超限的链不能被确认；遍历后还核对条目及本地来源的有效到期时间。confirm_allowed 仍只是该次读取的入口提示，不保留版本、授权或有效期；具体来源的确认条件、权限及版本必须由写入时再次检查。

来源变化不会改写原条目的版本、历史批准或存储状态。一个历史上 confirmed 的条目可以同时 sources_current=false；它会在新的保存包中被排除，并不能为新的有效建议提供来源。当前实现是使用时递归失效判断，不是后台遍历全库、自动撤销审核或推送级联事件。

## 保存的 ContextPack

持久编译入口检查全部候选的来源链。无效链对应 `exclusions.reason=source`；根自身到期仍可使用 expired 理由。达到图检查容量上限时，整次编译返回 CONTEXT_SOURCE_LIMIT，不保存未检查完的包。通用编译器通过 `unavailable_source_ids` 接受网关判断，普通离线调用不会自行访问数据库或声称完成图检查。

选中内容的有效期取自身和有效本地后代中最早的到期时间，包的有效期再受请求 TTL 限制。原始条目的 expires_at 不被修改。每个候选的 source_manifest 增加 dependency_hash，记录由节点内容/版本/状态/分类/时间及下游摘要组合成的 SHA-256 检查摘要；检查时间和请求 trace 不参与图摘要。候选被排除后，仍保留其当时的检查摘要用于后续一致性判断。

读取保存包和原键重试编译时，在已有根条目指纹检查之外重新检查来源链及摘要。选中链失效、摘要改变或检查超限返回 CONTEXT_PACK_STALE；包本身到期仍返回 CONTEXT_PACK_EXPIRED。旧包没有 dependency_hash 时不能证明原来的来源链快照，返回 stale，需用新请求键编译；旧内容不会被原地补签或悄悄改写。没有候选的空包无需依赖摘要。

## Proposal

创建建议时，原有直接来源版本/内容指纹检查之外，递归检查本地来源并将 dependency_hash 保存进 source_manifest。无效或超限链返回 PROPOSAL_SOURCE_STALE。确认建议和读取详情的 sources_current 同时检查直接指纹及完整图摘要；来源链后来变化不能借助未变化的直接条目版本绕过检查。

含本地来源的旧建议缺少依赖摘要时，sources_current=false，不能确认；仍可在原有权限下查看和拒绝，需要新建议重新绑定当前证据。没有本地来源的建议仍依照原有外部引用规则处理，不伪装成已经验证外部证据。已完成命令的幂等重放仍返回历史回执，不再次审核，也不修改原决定。

此变更复用现有 JSONB source_manifest，没有新增数据库迁移。本轮不迁移旧包/旧建议、不运行数据修复。原有 016–022 等迁移依赖仍需由后续运维流程处理。外部证据验证、跨项目引用、后台级联事件、来源变化通知及运行验证仍待后续开发。
