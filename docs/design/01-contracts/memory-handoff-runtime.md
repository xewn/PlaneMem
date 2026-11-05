# 旧记忆交接运行边界

2026-11-05，TODO P0-01：新增 [memory-handoff OpenAPI](../../../packages/contracts/openapi/memory-handoff.json) 和 [完整 Schema](../../../packages/contracts/schemas/memory-handoff.json)，覆盖现有两个 POST，OpenAPI 累计 86 路。本文按当前 Gateway、MemoryServiceAdapter 和 AiMemoryMcpProvider 源码记录，不改运行实现；未编译、测试、运行 provider/API/数据库或发布。

| 入口 | 路由操作 | 原输入 | 完整内层成功 |
| --- | --- | --- | --- |
| POST /v1/context/handoff | context.handoff.create | page_ref | schema_version、handoff_ref、page_ref、trace_id |
| POST /v1/context/handoff/claim | context.handoff.claim | handoff_ref，可选 claim_client_id/client_id | schema_version、status=claimed/already_claimed、page_ref |

两路使用 context.write 策略，但走旧原始请求头上下文，不调用 authenticatedContext。即使存在 Authorization 或 OIDC verifier，也没有在这两个路径验证 bearer；必填五个范围/身份头并非签名凭据，expected actor/client 头没有生效，正文身份也不进入其他写路由的相等检查。当前策略/OPA/审计和限流仍会执行，且没有父项目存在/分类查询。这是尚存的实现缺口，机器契约不将其改写为已完成的认证保证。

provider 无两种外部交接方法时，创建调用 read_page 后在当前 adapter 实例保存 handoff://ULID；内置内存页面读取核对范围，但交接 Map 仅保存页面引用和可选领取者。领取没有范围/账号入参，也不重读页面；选中客户端来自正文优先字段或原始头，首次保存，后续任何已有领取者都返回 already_claimed，不核对是否同一客户端。重启/实例切换不能依赖该 Map 恢复原交接。

MCP provider 的创建先检查原页面引用的 workspace/project 编码前缀，读取解码路径，再发 memory_handoff_begin；返回引用保留原 page_ref，不保存页面 revision/hash。领取从调用方引用解码范围/交接 ID/页面引用，未与当前头范围比较，未验证页面与交接关系；忽略选中客户端，以配置的服务身份调用 memory_handoff_accept。返回状态只区别上游精确 claimed 和其他值，不能据此证明某账号已领取。

可选头键只在 Gateway 进程缓存原 Promise/成功，正文键和原键均不传给 provider。缓存命中保留原 trace、来源、状态，不再次调用 provider；当前策略/审计仍执行。没有持久原回执、跨实例幂等、成功缓存 TTL/容量约束或未知结果对账。若远端已经成功、随后响应丢失/解析失败，接口错误不能证明没有副作用。

通用 JSON 正文上限 1 MiB，认证上下文读取前解析，超限400；无专用响应字节/整次期限或请求断开取消。MCP 默认每 RPC 10 秒，初始化/读页/创建分别计时，不是总期限；通用文本解析并不等于完整 MCP 响应验证。无 provider 不降级为成功；真实 HTTP 状态、retryable、旧固定 trace、缓存原 trace 和版本头限制见 [详细契约说明](../../../packages/contracts/openapi/README.md#旧记忆交接)。

当前 WcpClient 的 createHandoff/claimHandoff 面向持久会话交接，不能混用这些引用或推断其客户端校验适用于旧接口。此增量仅补机器契约与源码说明；后续签名身份、当前范围/归属、完整 provider 结果验证、持久幂等和 SDK/Mock 接线仍未完成。P0-01/R-001 保持未完成，evidence: []。
