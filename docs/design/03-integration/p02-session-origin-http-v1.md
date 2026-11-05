# 原会话与数据库谱系公开取证 v1

2026-11-05，TODO P0-01 机器契约源码增量：[session-origin OpenAPI](../../../packages/contracts/openapi/session-origin.json) 与 [完整 Schema](../../../packages/contracts/schemas/session-origin.json) 覆盖本页只读POST。嵌入原文分别提供完整Proof/Record/Inventory/CurrentProjection的contentSchema注解；必须另外解码验证，保留原文摘要。完整选件、当前目标、原证明三种协议各自保留；两套身份/批准不混用。独立提交计入89路源码目录，不关闭P0-01/R001、evidence为空；未编译、测试、运行校验器/生成器/产品/API/数据库或发布。

实际HTTP分类补充：认证前坏4KiB原始正文400；入口身份/能力/预期身份拒绝401或403，私有authorityFor检查错误协议/选件格式也403；进入读者后的封闭字段/配置/全零选件、错预期、缺表/缺当前或原件、后次OIDC/OPA/策略/审计/来源批准及大小/期限/取消错误统一OPERATION_UNAVAILABLE503 false。入口认证/持久审计不可用仍503 true，未捕获入口异常可500 true。此区别不能简化为所有错误同码；任何读取失败均不代表新NoEffect。查询/媒体编码/条件头无专门拒绝，正文不解压，幂等/版本头不形成原件重放/CAS。返回外层授权期限确实裁到读者30秒窗口，内部原批准期限另存，不续期。

2026-11-05，归属工厂51号执行板 GAP-04 / T03.02–05、“首件岗位执行”原件桥接后的公开取证/独立消费步骤。**源码已改，待统一验证**；没有执行还原、编译、应用、类型/静态检查、测试、策略、数据库、迁移或部署。

## 公开协议

新增只读 `POST /v1/continuity/session-origin`，协议 `p02-session-origin-v1`。它与原当前会话 `p02-session-current-v1` 分开，原接口响应没有新增原件字段。请求是严格UTF-8、最多4KiB、准确七个字符串字段，平面解析拒绝重复、转义重复、大小写别名、嵌套和非字符串值：

| 字段 | 内容 |
|---|---|
| protocol_version | p02-session-origin-v1 |
| endpoint_ref / configuration_digest | 当前受控端点标识和64位小写十六进制配置摘要 |
| session_id | 原会话的规范ULID |
| challenge | 本次新32字节随机值的64位小写十六进制形式 |
| selection_id | 非空、规范小写D格式GUID |
| selection_digest | 独立批准的完整SessionOriginSelection摘要 |

选件摘要定义为：字段递归按ordinal键排序，数组保留原次序，紧凑JSON文本的UTF-8 SHA-256；实现 `sessionOriginSelectionDigest`。当前字段只有字符串、整数和null，不接受unknown额外字段。调用方应由批准拥有端取得预期，不能先取服务自报摘要再当作独立预期。开发态旧的键插入顺序摘要不自动升级，也没有任何已部署批准据此回填。

scope由三个请求头指定后经过原Bearer验证；actor/client/能力由OIDC声明取得。`X-Trace-Id`优先于自动traceparent。请求头里的角色、主体或能力不能授予原件读取。不存在默认数据库、选件、令牌、批准或生产策略数据。

成功封套准确包含 `schema_version:1`、本次 `trace_id`、指向session_id的单条source_refs和data。data包含：

- `protocol_version`；
- `request`：准确本次七字段请求；
- `origin`：`SessionOriginObservation`完整来源；
- `authorization`：独立外部身份摘要、`planemem-session-origin:<64hex>`授权引用、最早expires_at。

origin保留完整选件/摘要、全部原记录SQL列和JSONB文本及集合摘要、末轮原record文本/摘要、完整迁移清单文本/摘要、当前公开会话原文/观察时间/摘要、准确本次target、ABP来源身份/批准引用/摘要及原批准期限 `approval_expires_at` 和预算收紧后的 `expires_at`。内部target沿用当前会话资源协议 `p02-session-current-v1`，外层公开协议仍为origin v1；二者用途不可混淆。原record文本是数据库JSONB表示，**不是历史HTTP字节**，不能直接拿它与P02原ResultJson字节摘要比较。

整个序列化成功响应最多20MiB，包含重复保留的末轮原件及字符串转义成本，超限失败、不截断。桥接本身仍有1024轮/单512KiB/总2MiB记录、512行/256KiB迁移清单和64KiB当前会话限制。正文、原件和JSON序列化的内存/吞吐成本尚未验证。

所有成功和错误禁缓存，不使用幂等HTTP结果缓存；重复相同Idempotency-Key也重新读取，不生成或重发操作。缺表/缺记录/无批准/损坏/错选件统一失败，不将404或空结果解释成原操作NoEffect；错误没有原件正文、凭据或内部异常。

## 三条权威边界

1. HTTP必须实际验证原OIDC Bearer和客户端，要求 `context.read` **以及** `context.origin.read`，admin或普通当前读取不能替代。通用路由策略和审计在读前后执行。
2. 私有 `SessionCurrentIdentityScope.forOriginRequest` 前后重新验证同一原票据，并向既有专用OPA地址发送 `session.origin.read`。OPA还须受控数据 `origin_read_enabled=true`；缺字段默认不开放原件。决定绑定准确selection_id/digest，原主体/客户端/范围/会话、端点配置、原票据摘要、有限窗口及原有三类撤销清单。origin授权引用单独命名并包含用途和选件，不能把current grant复用成origin grant。OPA未接收Bearer。
3. 实际ABP `SessionOriginAuthority` 独立批准数据库连接归属、原操作、完整版本、谱系/协议桥接/旧写者隔离和迁移清单。桥接事务前后各核一次，外层路由/OPA等待后再作末次核准；三次身份/选件/批准及原期限固定，不能借读取续期。提供者实际生产实现仍未完成，回调或测试fixture不构成批准。

正常成功路径包括HTTP入口一次OIDC验证、两次专用OIDC/OPA、三次ABP来源核准、一次只读数据库事务及两次路由审计。选件ID/摘要在第一次ABP核准后、数据库读取前核对，错选件不会查询原记录。现有普通当前读取在显式启用原件桥接时也增加了末次来源回调，修补外层等待期间批准变化未被再检查的问题；该回调是内部可信对象，不进入任何HTTP输出。

总30秒UTC/单调预算、原票据/OPA/来源最早期限只收紧；收紧后的取消信号传到OPA和桥接，已开始的等待完整结束，响应/流/事务按现有来源所有权释放。独立源最后检查发生在OPA之后，仍不提供跨服务原子撤权保证；不合作验证器、策略或数据库排队不承诺硬实时停止。

## 批准职责与后续

PlaneMem只执行经批准的来源读取，不能为工厂自己决定迁移或旧写者关闭。现有P08角色/Profile审核、P01身份映射命令批准不自动覆盖数据库谱系。P02拥有每设备外部适配配置/来源消费；实际部署、迁移、切换/回退事实须来自对应交付运行拥有端的公开合同和独立批准，不通过Node回调或P02复制一个部署权威。主仓旧DeliveryPackage中保存JSON或标记状态也不能单独充当本桥接的完整独立批准。

本项新增的是可取证的HTTP边界和当前外部授权接线；ABP批准拥有端、生产赋权/受控配置、P02独立wire解释/原件比对和出站、E02原准入关联仍须继续。完整旧新写协议、统一写协调和迁移切换程序也未完成。下一沿同TODO接这些来源与消费者，再原交接/页面、P23及完整业务权威和既定后续，不关闭父任务。

新增TypeScript场景使用实际路由/私有作用域/桥接代码，但OIDC claims、OPA HTTP、原件数据库和ABP批准是明确合成fixture。覆盖完整原件/短期批准、新nonce/重复键、缺专用能力、错选件读前拒绝、外层等待后撤权、原票据变化、审计/OPA失败、退出后旧端口、取消完整等待和选件规范摘要。Rego只新增源码场景，未执行。没有真实HTTP服务器、数据库或远端验收证据。
