# OpenAPI 源码契约

这里的文档描述已有HTTP实现，尚未经过OpenAPI校验器、生成器、编译、类型检查、测试或运行验证。文档中的版本不表示已发布或部署；目前只有下述保存包目录切片，尚不是完整WCP接口目录。

## 保存包元数据目录

`context-pack-directory.json`采用OpenAPI 3.1.0，包子路径为`@planemem/contracts/openapi/context-pack-directory.json`，仅覆盖`GET /v1/context-packs`。成功JSON复用`../schemas/context-pack-directory.json`完整资源及其标量/游标锚点；错误沿`packages/contracts/src/errors.ts`的五字段封套。此文件是接口文档，不是生产路由或新的运行时校验器。

本地消费时保留`openapi/`与`schemas/`的相邻目录关系，为解析器提供文档的本地基址，并注册完整目录Schema的`$id`。通过包子路径获得内容后，也要显式配置本地资源映射；只复制OpenAPI文本而丢失基址不能可靠解析相对引用。`planemem.local`仅是Schema标识，不是下载地址。无需加载完整包读取或比较Schema。外部Schema、锚点、2020-12及Reference Object描述覆盖的工具兼容性仍待验证；本轮不执行加载或生成示例。

### 请求与响应

- 使用当前Gateway地址与Bearer令牌，提供`x-tenant-id`、`x-workspace-id`、`x-project-id`三范围头，必须与可信授权范围一致。真实actor/client/角色/能力来自已验证身份。处理器要求未过期会话及规范后的实际`context.read`；既有认证层可能将`workbench.read`或指定工作台客户端的`Base`映射为该能力，单有admin不够。
- HTTP的`x-expected-actor-id`、`x-expected-client-id`可分别省略，提供时必须与可信身份相等；它们不是身份来源。CLI JSON成对约束不属于本HTTP参数规则。客户端字段按共享isSyncIdentifier规则；不要误套CLI额外排除DEL的规则。
- 当前server优先采用非空`traceparent`，其次非空`x-trace-id`，均缺省则生成`trace_http_<ULID>`。这里把traceparent当不透明标识，没有执行W3C Trace Context解析。成功读取要求有效共享trace，完整返回体与`x-trace-id`头保持所选值。
- 只接受各至多一次的`pack_id`、`limit`、`cursor`查询。limit为1–100，省略25，URL须为无符号、无前导零的十进制整数；响应query显式带limit。未知/重复/空参数无效。公开GET不带JSON正文；`content-length`仅可缺省或字面量`0`，拒绝transfer-encoding和文档列出的写入、条件缓存及Range头。OpenAPI的参数表和自定义扩展不能独立强制这些额外规则。
- 200完整响应只含六字段元数据，精确筛选找不到或不可见的包返回空页，父项目不可见返回404。所有应用JSON响应发送`cache-control: private, no-store`，成功页带`x-trace-id`且没有ETag，不返回304。提前认证/输入拒绝可能没有`x-trace-id`响应头，必须保留并读取错误体trace；不承诺WWW-Authenticate或Retry-After头。

| HTTP状态 | 当前主要错误码与语义 |
| --- | --- |
| 400 | INVALID_INPUT：查询/禁止条件/游标失效，retryable=false；其他边界错误仍沿公共封套 |
| 401 | UNAUTHENTICATED：缺失或拒绝凭据，retryable=false |
| 403 | DENIED：范围/原身份不符、策略拒绝或执行期间到期，retryable=false |
| 404 | CONTEXT_PACK_NOT_FOUND：父项目不可见，retryable=false；不同于精确包查询空页 |
| 429 | RATE_LIMITED：通用actor/path限流为true，目录两容量占满为false |
| 500 | CONTEXT_PACK_INVALID为false；意外命令错误INTERNAL_ERROR默认序列化为true |
| 503 | 存储不可用/目录等待超时为false；认证不可用/审计持久化不可用为true |

表中的布尔值是原始HTTP错误体的`retryable`。SDK和MCP固定错误映射可能另置false，不能反推原始HTTP封套；retryable不表示客户端自动重试、切换账号或刷新游标。`details`保留开放诊断对象，错误码不是穷尽枚举，外层代理或HTTP解析失败也不保证应用JSON形状。

### 运行时边界

`x-runtime-limits`、`x-rejected-request-headers`、`x-required-normalized-capabilities`和`x-wcp-operation`是说明性扩展。原实现负责规范查询4 KiB、单记录2 KiB、成功封套256 KiB，以及普通JSON/UTF-16/跨字段关系。4 KiB是解析后查询预算，不是原始URL限制；16 KiB错误上限由各客户端读取器施加，不表示服务端统一错误大小限制。

目录处理器每router两笔容量、30秒等待期限，外层认证、策略/审计和响应发送不在该期限内；数据库操作超时后未必可取消，底层结束才释放槽位。查询和Schema不能证明数据库扫描成本或整个HTTP耗时上界。

真实可见性过滤先于limit+1，版本/ID降序与绑定游标、规范原请求、唯一ID及完整续页由原实现检查。游标不是授权或跨页快照；目录不检查完整包正文/hash/来源，过期或来源变化仍可列出。完整包读取、编译、MCP资源候选目录和其他WCP路径不属于本文档。

源码依据为Gateway的`server.ts`、`authenticated-context.ts`、`http.ts`、`router.ts`、`context-pack-directory.ts`，以及共享目录解析器/错误封套；使用说明见[ContextPack契约](../../../docs/design/01-contracts/context-pack-runtime.md)和[独立目录结构](../schemas/README.md#保存-contextpack-元数据目录)。R-003保持未完成、`evidence: []`。全量OpenAPI、自动一致性、本地解析/生成工具和真实客户端兼容证据待补；仅源码文档人工审阅与格式文本检查，未执行校验器/生成器、编译、类型检查、测试、API/数据库或发布。
