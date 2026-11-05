# P02 原创建证明与当前会话同库桥接

2026-11-05，工厂51号执行板 GAP-04 / T03.02–05、“首件岗位执行”的原操作桥接/数据库谱系后续。状态：**源码已改，待统一验证**。本项没有执行还原、编译、类型检查、静态契约检查、测试、应用、数据库、迁移或部署。

## 源码分叉事实

实际对照旧工厂 `7886438d9b4d2cfd2752c84a707aabe02a674133` 和 main 当前源码：

| 边界 | 旧工厂 | main |
|---|---|---|
| 010 | `010_session_continuity_persistence` | 同名持久基础 |
| 011 | `011_original_operations`，保存 `wcp_continuity_operations` 与旧命令表 | `011_handoff_claim_actor` |
| 012 | `012_memory_original_commands` | `012_checkpoint_request_keys` |
| 原创建 | p02-continuity-v1 OperationRecord/OperationProof；原键、轮次、指纹和完整结果 | 自身 `wcp_session_start_commands` 原回执，格式/命令语义不同 |
| 写协调 | 全局事务锁 `(1867584,1)`、旧 SessionService/内存水合 | 按命令/会话协调和当前服务领域规则 |

不能按编号前缀跳过或覆盖迁移，不能把两个 011 当作同一迁移，不能并发启动两种写协调器。本项没有迁移执行器、数据导入、历史补写或新写兼容实现。旧工厂 checkout/master 保留，未合并其全部历史或修改其生产协议。

## 实际读取实现

`PostgresSessionOriginStore` 在**单个 REPEATABLE READ READ ONLY 事务**中读取：当前可见项目及准确 session/scope/actor/client 的公开业务图、原 operation_key 全部持久轮次、数据库完整迁移清单、同一会话的原 idempotency_key。复用现有当前会话 SQL，不从旧 Map 或主线新回执拼出旧 Proof。每条语句5秒、锁等待2秒；取消后仍等待正在执行的语句/事务退出，没有丢下后台任务。它不主动向 PostgreSQL 发送取消命令，连接排队及不合作提供者也不保证硬实时。

旧表缺失、记录缺失、目标不可见、元数据不符合界限均失败，不能改查另一个数据库或退回普通当前读取。原记录查询最多1025行，解释最多1024轮；单记录最多512KiB，总文本最多2MiB，超限SQL不向客户端回传大文本。迁移最多512行/256KiB，准确按完整version的C排序返回JSONB文本。这些是输出/解释界限，不是数据库内部计算内存上限，性能待统一验证。

`inspectSessionOrigin` 重新计算旧协议的规范化完整创建指纹，核对SQL列与原record、scope/actor/client/旧端点/配置/规格摘要/轮次。必须从1起连续，前轮全部是原 ConfirmedNoEffect，选定最后轮是原 ConfirmedEffect/version1/running。创建结果的 source_refs 必须保留实际旧 client_id 语义；原 SessionId、父会话、开始时间与当前行相同，原幂等标记必须是 `continuity:<operation_key>`。当前状态允许已结束，不恢复旧 running，也不推导执行资格。v1不允许把旧start隐式升级为main的resume_origin。

完整迁移清单文本摘要必须与独立批准的预期一致，并明确要求旧010/011和main025/044的准确标记。数据库中checksum本来是声明性字符串，**不是源码文件SHA-256或迁移执行证明**；该读取只能证明本次快照中的完整标记和原件/当前行关联，不能单独证明真实物理数据库迁移、备份恢复正确、部署版本或旧写者已停止。

输出保留每轮SQL列、`record::text`、完整迁移文本、当前公开业务文本和摘要、原选择/授权/期限及本次challenge/trace。JSONB早已规范化键序和空白，不能恢复历史HTTP传输字节；不得把这里的record摘要与P02保留的原ResultJson字节摘要混用。本解释器针对拥有数据库JSONB投影，不能当任意不可信HTTP JSON的通用解析器。它不导出全部数据库列、子运行或工具调用。

## 独立批准和网关装配

`SessionOriginAuthority` 必须由工厂ABP拥有端提供，每次重新核验当前身份、准确目标、原回执/完整历史、所选数据库连接实际归属、原/当前完整40位提交、数据库谱系、协议桥接、旧写者隔离证据及独立批准。`SessionOriginSelection` 固定上述引用/摘要、准确原操作/轮次/原record摘要、原trace/parent和完整迁移清单摘要。声明字段不是批准；不能只回显metadata、信旧签名或借用网关context.read权限作工厂迁移批准。

`SessionOriginBridge` 在事务前后调用当前批准，完整grant须相同；事务已退出才进行后次复核。30秒UTC/elapsed预算与原批准到期只收紧，取消完整等待；来源数组先复制，跨等待不能改结果。读取后发生的未来变化仍可能存在，这不是跨服务原子撤权或写隔离证明。实际生产ABP批准/数据库谱系和旧写者隔离拥有端**仍未实现**，没有允许型默认实现、生产参数或假批准。

`createPlatformServer` 增加明确的 `session_current_origin_authority` 选件，必须同时有数据库、当前配置、真实OIDC和专用当前OPA配置。选中后现有当前会话入口使用同库桥接，任意桥接错误不退回原读取；未选的普通当前会话入口保持原语义，不能因此声称已具备工厂原会话来源。既有两次当前OPA/路由策略与审计边界保留。原件批准的更短期限通过内部 source_expires_at 传到当前读取器，在后续策略/OPA等待后再次检查并收紧响应期限。

现有HTTP v1只输出原有当前会话wire，没有把完整origin证据加进已有严格响应。`observe` 提供内部完整来源对象；公开的原件/谱系取证接口、P02消费者对原件的独立比对以及E02组合还须继续开发。当前HTTP响应本身不证明启用了哪份桥接源码或取得哪个ABP批准，消费端必须绑定受控部署与独立来源，不能根据成功200猜测装配。

## 后续迁移/写兼容不能省略

正式迁移前须由ABP流程批准完整源/目标提交、逐文件迁移清单及摘要、原库/目标库谱系、原证明保全、备份恢复点、旧写者关闭/隔离和新写者切换；真实执行和验收只能在指定远端k3s，整厂开发阶段不得执行。保留原操作记录，不重写receipt_ref、dispatch_attempt或result，不填造主线原命令回执。迁移版本使用完整名称，对不匹配标记应拒绝，不静默ON CONFLICT跳过不一致内容。

本读取桥接只支持获批的“保留旧原件并关联同库当前行”模式，不批准跨库复制后凭同ID认同一来源。旧p02-continuity-v1 execute/query/close四路（含capabilities）、五种session写动作及外部memory动作的完整兼容、统一写锁与迁移切换程序仍开放，不以此读取器替代它们。继续同TODO的独立批准拥有端/公开原件取证和P02/E02接线、真实写协议迁移兼容，再原交接/页面、P23与完整业务权威及原后续；父任务不关闭。

## 未执行源码场景

纯场景覆盖连续NoEffect前缀/原Effect和当前终态、主线回执冒充、错scope/指纹/摘要/原标记/开始时间/恢复附加字段、轮次缺口/额外轮次、同编号迁移名/标记/完整清单变化、当前批准撤销或变化、缺表无回退、取消完整等待及短源期限传播。实际PostgreSQL场景带远端k3s前置守卫，使用真实当前SessionService/SQL、独立连接变更和重新连接；旧OperationRecord与批准明确为合成夹具，不能证明实际旧分支升级。全部未执行，没有给出通过数或真实迁移证据。
