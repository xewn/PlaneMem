# 当前会话真实授权来源与工厂协议边界

2026-11-05，对应工厂51号TODO GAP-04 / T03.02–05、“首件岗位执行”。源码已改，待统一验证；本次没有执行应用、策略、数据库或任何测试。

## 实际授权接线

主线新增 `SessionCurrentIdentityScope`，由 `createPlatformServer` 在明确提供 `session_current_configuration`、`session_current_opa` 和已有 OIDC 验证器时组装。OPA选件包含准确HTTPS决策地址和64位小写十六进制 `policy_revision`；不允许URL凭据、query、fragment、重定向或其他OPA文档路径。它与原测试/嵌入使用的 `session_current_authority` 互斥。没有这些真实来源配置时仍无法取得允许结果，没有默认允许策略或生产目标。

新HTTP入口先经过主线实际 `authenticatedContext`，从原Bearer票据取得scope/subject/client/能力/角色/到期。随后只在该请求私有AsyncLocalStorage中保存原凭据和完整已验证身份投影，不将Bearer放入CommandRequest、HTTP输出或审计。任何等待结束后仍须属于同一活跃请求；退出时清空凭据并标记失效，捕获旧端口、嵌套进入、脱离作用域和跨请求混用均拒绝。

每次当前会话读取顺序为：原HTTP认证与路由策略/审计 → 原Bearer重新验证 → 当前OPA对象决定 → 单条准确数据库来源 → 路由策略/审计复查 → 原Bearer重新验证 → 当前OPA对象决定 → 返回前窗口/身份/原授权一致检查。正常路径共三次认证验证（含HTTP入口）和两次专用OPA请求。固定scope、原actor/client、已验证角色/能力、actor_type、原票据期限与trace；不能换票据或续期。identity_digest绑定完整已验证身份投影及原Authorization字节摘要，Bearer不外发给OPA。

私有请求比较包含trace，公开identity_digest不含trace，公开authorization_ref包含准确策略地址/修订/完整数据摘要和资源归属但不含challenge/trace。完整grant.target及响应仍准确绑定这两个关联值。这样相同原票据/策略/资源的新鲜观察可以比较身份与策略来源，不会因换新nonce本身伪装成权限变化；不能因此重放旧响应，调用方仍必须核对每次新challenge。

OPA收到准确session/归属/端点/配置/challenge/trace和已验证身份、票据期限与SHA-256。实际生产SQL仍核对session完整拥有者及同语句项目可见性，当前接口只允许原actor/client，不能代读其他所有者；restricted项目仍保守拒绝。OPA当前策略和数据库归属共同构成该外部读取动作的准入，不能替代ABP工厂P01/P02/P08/P09/P23的业务权限、审批或模块认证。

## 受控策略数据

专用规则位于 `deploy/opa/session-current.rego`，入口为 `/v1/data/planemem/session_current/decision`。不复用通用authz的admin兜底。部署拥有者须另行提供 `data.planemem.session_current_policy`，字段如下：

| 字段 | 含义 |
|---|---|
| enabled | 当前是否允许此策略 |
| revision | 与网关准确匹配的受控策略修订标识，64位小写十六进制 |
| endpoint_ref / configuration_digest | 当前允许的准确外部绑定 |
| valid_from_epoch_seconds / expires_at_epoch_seconds | 明确有限的UTC有效窗口，以整数秒表示 |
| revoked_subjects / revoked_clients / revoked_token_digests | 当前撤销清单；三者都必须显式提供数组 |

没有随源码写入任何允许型生产数据，也没有修改部署清单或调用OPA。现有compose样例只加载原policy.rego，不会自动启用此文件；最终部署配置必须单独明确加载新规则、受控数据及TLS边界，仍只在指定远端k3s执行。

OPA输出allow、准确revision、完整策略数据的 `crypto.sha256(json.marshal(policy))`、端点/配置及策略和原票据的最早到期。网关独立核对全部字段、原期限和预期修订。两次完整数据摘要不同即使仍allow也拒绝；任何主体/客户端/票据撤销、禁用、超期或归属变化拒绝。policy_revision是可信OPA拥有者提供并由网关预期配置限定的修订声明，不是服务端代码测量或独立审批签名；数据摘要也不是OPA二进制证明。保护OPA服务与数据写权限仍属于部署拥有者责任。

专用调用只有固定HTTPS POST，不转发Bearer/cookie，禁重定向/隐式凭据/缓存，不重试；返回严格UTF-8、8KiB、准确字段集且拒绝重复/大小写别名。错误统一脱敏。每次5秒AbortController覆盖获取和正文读取，原请求取消同步传播，正文读取器始终释放；已有OIDC验证器的JWKS缓存、网络与撤销语义保持，重新验签本身不证明即时撤销，专用OPA撤销清单提供额外当前来源。未对整个既有OIDC实现作升级。

读取总预算仍为原30秒UTC/elapsed，等待不续期，释放后再检查。无法配合取消的验证器/传输替身仍完整await，不能宣称硬实时截止。顺序复查不是跨服务原子撤权；OPA决策独立保全/访问审计集成不在本项范围，现有两次路由审计保持且失败阻断。所有成本、超时和容量仍待统一验证。

## 两条现有代码基线不能混用

下表由实际源码对照得到，不是部署或运行验证：

| 边界 | 工厂旧PlaneMem分支7886438 | 主线13c40d8及本项 |
|---|---|---|
| 原操作协议 | p02-continuity-v1的capabilities/execute/query/close，保留原OperationProof和派发轮次 | 没有安装旧原操作协议；有独立session/start/command/resume等主线回执 |
| 原操作存储 | wcp_continuity_operations与legacy命令表、旧写事务锁 | 自身持久会话/回执/项目可见性及迁移演进；不能由同名字段推断旧表协议兼容 |
| 当前身份 | 旧分支通用头部身份；当前读取的独立权威未实现 | 本项当前读取强制真实OIDC，再由原Bearer复查及受控OPA授权 |
| 当前会话投影 | 已知旧Session业务字段，无resume_origin | 旧字段保留并额外支持resume_origin，必须与父会话一致且严格解释 |
| P02既有消费者 | PlaneMemContinuityClient调用旧四路，ContextSessionStartOriginalContract解释旧原Proof | 不能把主线start回执包装成旧Proof，不能伪造receipt_ref/dispatch/result证明兼容 |
| 新当前来源 | 固定p02-session-current-v1但未连真实授权 | 本项协议读取及实际授权适配，仍需真实配置与部署证据 |

因此旧P02写/查原件继续保留原协议及来源版本；当前读取新增P02专用消费者时必须明确端点、完整版本、数据库谱系和原SessionId关联，拒绝仅凭同scope/同ID去另一套部署查一个相似会话。不得复制改写原回执、把主线空404解释成旧操作NoEffect、自动切换版本、直接混跑不同写锁或盲目复用迁移编号。本项**没有完成两条写协议/数据库迁移兼容**；具体拥有端桥接/迁移与证明必须继续沿原TODO开发，不能因为当前读取相似就关闭该缺口。

## 待统一验证与后续

TypeScript场景使用真实私有作用域、读取器与路由，OIDC claims及OPA响应明确为夹具；覆盖双次实际调用、伪造初始身份、后置身份/能力/策略/期限变化、缺私有作用域、结束后旧端口、并发隔离、取消、重复/错误/超限回包和端点约束。Rego场景独立放在tests/p3，覆盖拥有者、admin无绕过、撤销清单、过期和数据变化摘要；不会随deploy/opa目录自动装入服务。没有执行这些场景、OPA语法/类型检查或远端调用。

下一继续同TODO的P02专用出站/当前授权与显式来源版本关联，同时处理上述原操作/数据库谱系兼容缺口，再E02原/当前会话组合、交接创建/原页面、P23和完整业务权威及既定后续。生产受控配置、独立批准、完整工厂执行链和统一验证仍未完成。
