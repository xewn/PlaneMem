# 持久项目搜索（开发状态）

2026-11-02：仅修改源码与文档，未编译、类型检查、测试、启动服务、执行迁移或发布。031 全文索引迁移仅写文件，性能及权限行为尚无本次运行证据。

2026-11-04：新增搜索详情返回导航与失败恢复源码，保留原查询/筛选/分页及所选类型和 ID；无 API、schema 或依赖变化，未编译、类型检查、测试、运行页面、调用接口或发布。

## 读取入口

`POST /v1/search`，操作 project.search。令牌鉴权和 context.read 必需，范围由当前 tenant/workspace/project 确定；不要求写客户端或请求键，误带请求键也绕过响应缓存。每次直接读取 PostgreSQL 当前 wcp_work_items / wcp_context_items，不依赖进程内命中缓存。

```json
{"query":"handoff notes","type":"all","mode":"fts","include_inactive_context":false,"limit":20}
```

- query 必须是 1–500 字符的非空文本，去除首尾空白，禁止 NUL 和无效代理字符。
- type 为 all/work_item/context_item，默认 all。
- mode 为 fts/substring，默认 fts。fts 使用 simple 配置的 plainto_tsquery，词语按 AND 匹配，不解析高级查询操作符；substring 使用不区分大小写的字面包含，百分号和下划线不作通配符。未分词中文、词语片段或部分标识可选择 substring。
- include_inactive_context 默认 false：上下文仅包含未到期 confirmed/proposed。true 可搜索已记录过期、时间到期及 excluded；所有模式都排除归档/删除。工作项所有保存状态均可搜索。
- limit 默认 20，允许 1–50；cursor 为上次 data.next_cursor。未知字段、错误类型、null 默认字段及无效游标返回 INVALID_INPUT。

## 可见性和结果

SQL 同时限定当前项目可见且未删除、条目范围、分类和删除状态；无 data.restricted.read 时排除 restricted。不可见或不存在的项目返回空命中，不揭示隐藏数量。数据库未配置或读取失败返回 SEARCH_STORAGE_UNAVAILABLE / 503，损坏返回 SEARCH_RESULT_INVALID / 500，不静默回退到内存索引。

响应使用 WCP 封套。data 包含规范化 query/type/mode/include_inactive_context、scope、hits、可选 next_cursor、backend=postgres 和 vector_used=false。每条命中有 type/id/title/snippet/version/status/classification/updated_at/expires_at/score/source_refs；version 为无损正 BIGINT 十进制字符串，表示本地保存版本。snippet 为正文开头最多 360 个数据库字符，不高亮、不注入 HTML、不承诺包含全部匹配词。

工作项搜索标题、外部 ID、描述、负责人；上下文搜索标题和正文，JSON 字符串提取正文，旧对象转文本。title（工作项含外部 ID）权重 A，正文权重 B。全文分数使用 ts_rank_cd 的 32 归一化，substring 分数为 0。排序为分数降序、更新时间降序、类型及 ID 升序。

游标保留分数和数据库微秒时间，绑定范围、restricted 权限、query/type/mode/include_inactive_context；limit 可调整。每页重新核对授权并读取数据。修改查询、类型、模式、包含失效条目选项或权限后应回到第一页。分页不是跨请求快照，并发编辑和过期可能使结果移动或当前页变空；没有 next_cursor 表示本次读取已无后续命中。

共享 parseProjectSearchQuery / parseProjectSearchPage 校验输入、请求回显、命中类型/状态、重复标识、版本、来源、页大小和下一页形状。SDK/CLI/Web 还核对响应 scope 与请求范围。命中不代表来源链有效、可立即审核或 Plane 当前状态；使用内容前打开详情。

## 入口和索引

- SDK `searchProject(input)`。
- CLI `workctx search --json-file search.json`，无需 --key；继续时保留查询，把 data.next_cursor 放入下一次 JSON 的 cursor。
- MCP `search_project_records`，只读、context.read。
- 工作台 `/search`，顶部搜索和侧栏接入。筛选提交从第一页开始，翻页保留筛选；提供类型、词语/字面模式、包含失效上下文、来源展开及详情导航。

`031_project_search_fts.sql` 为工作项和上下文增加部分 GIN 表达式索引，排除已删除记录；表达式与查询一致，索引更新随原表事务完成，现有记录会在实际创建索引时进入索引。没有复制内容的异步搜索表。迁移未执行时查询仍可计算表达式，但没有相应索引优化；substring 不使用这些全文索引，尚无扫描性能验证。

## 工作台搜索返回与重试

`apps/web-console/src/app/search/navigation.ts` 统一解析 `/search` 的 q/type/mode/inactive/cursor/item/item_type。前五项保持原有含义，页面请求仍固定每页 20 条。item 和 item_type 是仅用于页面选择的导航字段，不传给搜索接口；两者必须同时有效，类型为 work_item/context_item，并与当前非 all 类型筛选一致。空搜索不能携带游标或所选结果。所有查询字段只接受单一字符串，拒绝重复、数组、未知字段和非法值，不截断用户输入。

搜索结果的工作项详情或 Context 条目链接携带固定内部 return_to，包含原规范查询、类型、匹配方式、失效上下文选项、游标及精确所选类型/ID。工作项详情沿用原刷新和失败重试表单；新增搜索返回分支，Back to results 回到搜索，Open in board/list 进入默认工作项目录并选择同一 ID，不把全文搜索条件解释成工作项目录筛选。来自工作项目录的旧返回语义不变。

Context 搜索入口为 `/context?item=...&return_to=...`，先完整校验匹配的搜索返回地址，再读取目录和指定条目。该入口仅接受 item/return_to，提供 Back to search results 和 Refresh item；整页读取失败时保留相同返回链接和 Retry item。条目读取失败时仍保留明确的原 ID，不改选其他条目。用户改用 Context 的目录筛选、分页或另选条目后转为普通浏览，不把原搜索选择附到别的条目上。

返回地址只接受字面 `/search?` 开头、最多 16384 个 JavaScript 字符单位的路径，拒绝外部/协议相对/其他路径、片段、反斜杠、原始控制字符、重复和未知查询字段，以及与详情不相符的选择。解析后重新构造固定内部 URL，所有值经 URLSearchParams 编码；不直接展示输入地址，也不自动重定向。ID 使用既有搜索命中标识规则；同一个 ID 的两种记录类型不会互相替代。无效返回参数在详情数据读取前拒绝。

返回搜索后，当前页仍包含原结果时显示 Previously selected；不再出现时明确提示该结果不在当前页，不默认换成另一条。翻页、返回首页以及重新提交筛选会清除旧选择。查询读取失败时保留可编辑筛选表单，Retry this search page 使用原游标和选择重新读取；First page with these filters 只清除分页与选择，便于处理过期或因权限变化而失效的游标。

导航不保存结果正文、快照、令牌或身份，也不写浏览器存储。链接不证明原记录仍可见、仍处于原页或来源仍有效；每次读取继续使用当前项目和权限，服务端仍负责游标范围检查。内容编辑、审核和 ContextPack 编译不因返回路径改变权限或原请求语义。真实浏览器导航、Unicode/特殊字符、重复参数、分类/项目变化及失败恢复的运行证据仍待补充。

## 剩余范围

原 `/v1/context/search` 与 search_project_context/context_search 的后续数据库读取、分类/失效字段和 context_index 回执开发见 [旧索引持久读取](legacy-search-runtime.md)，依赖未执行的 032 迁移。其外部记忆仍未形成原子补偿闭环；本入口继续只读工作项/ContextItem 当前表，不混入旧复制命中。可选 pgvector、embedding、融合排名、索引重建运维接口及性能基线尚未完成。P2-03 保持未完成。
