# 显式模型草稿生成

更新：2026-11-04。仅源码和文档，未调用模型、运行 CLI、编译、类型检查、测试、打开数据库或发布。接口兼容性和真实生成质量尚无运行证据。

`generateProposalDraft(input, provider, options)` 与 `proposal-worker generate` 增加单次模型生成入口。输入是用户选择的来源摘录；输出是已有 `CreateProposalRequest` 草稿，可审阅后使用原 enqueue/flush 提交流程。生成不创建建议记录、不打开队列、不提交网关、不审核，也不修改 Plane 或 ContextItem。

## 配置与操作

来源也可先通过 [prepare-generation](proposal-generation-sources-runtime.md) 从网关按指定条目/版本读取。该独立命令核对原账号/客户端及当前读取权限，保存兼容本节 sources.json 的完整输入；生成步骤本身仍只使用已经准备的文件，不重新读取网关。

提供独立 provider.json，包含完整端点、明确的模型标识及允许发送的数据分类上限。下例只有配置形状，模型值必须替换成部署支持的标识；本轮没有创建或执行示例文件：

```json
{
  "endpoint": "https://provider.example.com/v1/chat/completions",
  "model": "configured-model-id",
  "max_classification": "internal",
  "response_format": "json_schema",
  "max_completion_tokens": 4096,
  "timeout_ms": 60000
}
```

端点完整保留部署路径，不自动拼接路径或选择供应商。要求 HTTPS，只有 localhost/127.0.0.1/[::1] 可使用 HTTP；拒绝 URL 凭据、查询、片段及 HTTP 重定向。max_classification 必填，为 public/internal/confidential/restricted；生成分类取输入及全部来源分类最高值，超出上限在请求前拒绝。这个配置检查不能代替组织的数据出口策略或网关权限。

凭据使用 `PROPOSAL_GENERATION_API_KEY`；库调用使用 options.api_key，可选 signal 和 fetch。凭据不写入配置、草稿或结果；本命令不读取网关提交令牌。参数对象及 JSON 文件只接受已知字段。

sources.json 使用下列结构，替换来源 ID、版本和摘录；本地 context-item 引用必须固定正整数 revision：

```json
{
  "kind": "next_step",
  "task": "根据这些材料提出下一步行动，明确尚待核实的依赖。",
  "classification": "internal",
  "ttl_seconds": 604800,
  "sources": [
    {
      "ref": { "type": "context-item", "id": "01JAAAAAAAAAAAAAAAAAAAAAAA", "revision": 1 },
      "excerpt": "由用户从选定来源复制的实际内容。",
      "classification": "internal"
    }
  ]
}
```

```text
pnpm proposal-worker generate --provider provider.json --file sources.json --output new-draft.json
pnpm proposal-worker enqueue --queue queue.sqlite --binding binding.json --file new-draft.json --key proposal-generated-001
```

两个步骤独立执行。审阅草稿、来源和目标项目后再入队，随后显式 flush 才会向网关提交。生成后的模型/提示标识会随草稿进入原建议 provenance；用户编辑或另行生成时应保留真实标识并使用合适的新请求键，不覆盖已有未知提交任务。

## 生成边界

固定提示版本为 `proposal-draft/1`，要求区分已观察事实、期望行动与未验证推断，并把摘录当作资料。传给模型的任务包含建议类型、来源编号、固定引用和摘录。来源最多 32 条，同一 type/id 不得重复；每段摘录最多 65536 字符，任务最多 4000 字符，完整输入最多 512 KiB。摘录只做文本规范化，不联网提取、核对原文、鉴权或检查版本是否仍然有效；分类由输入者明确声明。

模型只能返回 title/content；额外字段、非 JSON、缺失或非法内容均拒绝。kind、source_refs、classification、ttl_seconds 和 prompt_version 由原输入及固定实现产生，响应不能改写。标题/正文使用共享 Proposal 创建校验，草稿 JSON 文件限制为 1 MiB 以兼容现有 enqueue。未固定本次提交目标项目，也不认证外部来源；后续网关仍检查目标项目、本地固定版本、分类和当前来源链。提示与结构校验不能证明模型事实正确或杜绝提示注入，需要人工审阅。

返回 schema_version、trace_id、generated_at、prompt_version、requested_model、returned_model、provider_response_id、source_refs 和 draft。草稿 model_version 使用响应报告的模型标识；请求模型与返回模型分别保留，支持别名解析后的记录，不把供应商报告当作独立模型认证。原 generate 输出文件只含标准草稿，完整生成元数据在命令 JSON 输出中。新增 generate-prepared 从完整准备记录生成，保存原准备记录、无凭据模型配置和完整生成结果；inspect-generation 离线核对，enqueue-generated 在打开队列前检查原绑定，详见 [完整记录与目标绑定](proposal-generation-record-runtime.md)。记录摘要不证明模型执行或当前权限，不会改变原普通草稿流程。

## 适配器协议与失败

适配器发送非流式 POST：Bearer 凭据、JSON 请求、X-Client-Request-Id，字段包括 model、messages、n=1、stream=false、store=false、max_completion_tokens 和 response_format。默认 json_schema 使用严格对象约束，仅允许 title/content；部署可显式选择 json_object，接收后仍执行相同本地校验。不会在失败后自动切换格式、模型或端点，也不会自动重试。

当前实现要求响应 Content-Type 为 application/json，object=chat.completion、一个 index=0 的 choice、finish_reason=stop、assistant 消息和非空 model/id。拒绝 refusal、工具调用、旧 function_call、截断结果和不完整内容。整个响应读取最多 1 MiB，错误状态不解析或回显供应商正文。max_completion_tokens 默认 4096，允许 1–32768；timeout_ms 默认 60000，允许 1000–120000。该范围是本地参数限制，不保证任一模型都支持。

同一等待期限覆盖请求准备、网络及正文读取，支持显式取消；即使自定义 fetch 不响应取消，本地等待也会结束，迟到响应尝试释放。超时或断连后的 provider_dispatch=attempted 仅表示已尝试调用，供应商可能仍完成或计费；not-sent 表示尚未派发。没有供应商幂等协议或持久生成请求日志，重复 generate 会创建新的模型请求。

CLI 先确认目标父目录存在且目标文件未占用，再生成。保存使用同目录独占临时文件、同步和完整读回，之后以硬链接发布新文件并再次读回，不提供覆盖回退；文件系统须支持硬链接。不宣称跨崩溃目录持久性或持续防篡改。输出被占用、磁盘/权限/链接失败时退出 1，并在错误 JSON 的 generation 保留已生成的完整结果，包含可手动恢复的 draft；output 保存目标/阶段和可能遗留的临时文件位置。不要仅因保存失败重新请求模型。正常输出包含 output.state=saved；清理失败时另报 temporary_path/cleanup_pending。

## 文档与剩余范围

协议参考入口为官方 Chat Completions API 文档：`https://platform.openai.com/docs/api-reference/chat/create`。本轮尝试读取官方页面，但当前连接未取得完整可用正文，因此上述条目明确描述本适配器要求，不声明供应商兼容验证完成。

指定当前 ContextItem 的权限读取和完整生成输入准备已接独立 prepare-generation 源码；新增 [生成调用持久请求](proposal-generation-request-runtime.md) 在独立 journal 中保存原请求、领取和结果，保守阻止已有领取再次派发，支持状态查询及成功结果取回。旧 generate/generate-prepared 不自动接入 journal。仍缺真实供应商兼容和质量证据、后台来源发现/刷新、供应商未知调用对账/受控恢复、生成审计、费用记录、自动调度、Embedding 与 Golden 评测。建议提交后的人工审核继续沿用原持久 Gateway 流程；本次不改变审核权限或 verified 状态来源。
