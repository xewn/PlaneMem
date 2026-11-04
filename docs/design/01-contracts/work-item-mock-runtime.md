# 工作项目录与详情 Mock（源码阶段）

2026-11-04新增SDK `MockWorkItemStore`、`MockWorkItemSeed`、`MockWorkItemSession`及可选`MockWcpServer({work_items:{store,session}})`。支持现有`POST /v1/workbench/query`的`work_items`目录和`work_item`详情两个操作，直接接入`listWorkItemProjections`及`getWorkItemProjection`。只开发源码文档并人工审阅，未编译、类型检查、测试、执行SDK/Mock/产品/API/数据库或发布。

## 数据集与模拟身份

构造输入为`{scope:{tenant_id,workspace_id,project_id},items:[完整WorkItemProjection...]}`。数据集固定在一个项目内，最多1000条、整个JSON最多16 MiB、单条最多256 KiB；普通JSON、属性、节点与深度边界沿syncJsonSnapshot。构造时复制全部数据、拒绝重复本地ID或未知投影/来源字段，并复用共享详情解析。保留原version十进制字符串、来源引用、描述、负责人和记录trace；不从external_id猜测本地ID或创建版本。

种子的created_at/updated_at及非null due_at必须是有效UTC时间，固定3或6位小数、年份0001–9999。原时间字符串保留，排序位置补齐到6位微秒，不把数据库微秒舍入成毫秒。外部ID、标题、负责人、描述和记录trace拒绝NUL及孤立代理字符；owner允许空串和原空白，不清洗负责人。数据集没有写接口、删除标志或后台同步；已删除/不存在情形可通过不加入种子表示，不能据此宣称已有删除生命周期。

`connect(session)`或MockWcpServer配置会复制完整会话：identity、expires_at、project_readable、read_work_items、read_restricted及visible_item_ids。三项范围必须等于store范围；可见ID须属于种子、最多1000且不重复，空数组明确表示没有可见工作项。布尔权限必须显式填写；过期时间使用同一有效3/6位UTC格式，允许配置已过期会话以模拟拒绝。SDK自身context仍遵守其ULID构造规则。

请求范围头必须逐项匹配模拟身份；若提供expected actor/client头，也只作相等条件，不授予能力。Authorization或其他头不能替代显式会话权限。项目不可读、缺少read_work_items或到期拒绝；受限记录还须read_restricted。列表在筛选分页前检查可见集合和分类；详情对缺失/不可见记录统一返回WORK_ITEM_NOT_FOUND，不返回隐藏记录。

## 查询、顺序与续页

列表复用parseWorkItemListQuery和parseWorkItemProjectionList：query/status/priority/精确owner/assignment/cursor/limit，默认25、最多100条。assignment严格区分保存owner空串与非空，unassigned与非空精确owner互斥；精确owner不作trim或大小写归一。query在external_id、title、owner以单空格拼接后的文本中做字面子串查询，使用JavaScript toLowerCase；它不保证与真实PostgreSQL数据库locale的小写规则完全一致，百分号/下划线没有通配含义。

记录按微秒updated_at倒序、Unicode标量ID升序；这是明确的Mock排序规则，真实数据库默认ID collation仍需兼容证据。可见性和全部筛选先执行，再取limit+1判断是否继续；返回完整data数组和可选外层next_cursor，不返回截断记录，不自动翻页。

Mock游标使用独立规范base64url元组，绑定摘要包含store标识、完整模拟身份、原到期、权限、排序后的可见ID集合和所有规范筛选；不包含trace或limit，允许续页更换追踪号及调整页大小。跨store、账号/客户端、续期、权限、可见集合或筛选变更后须重回首页；可见集合仅输入顺序变化不影响绑定。摘要不是签名或授权令牌，不能脱离每次读取的身份检查；Mock游标不能拿到生产服务使用，也不能接受生产游标。SDK仅把next_cursor原样传回。

详情使用`{operation:'work_item',item_id}`，只接受本地ID。其他workbench操作、URL查询参数、其他方法或路径拒绝，未配置work_items时保持既有Mock路由行为。

## 输出与等待边界

响应维持schema_version/data/trace_id/source_refs形状；外层来源明确为`{type:'mock-work-item-store',id:store标识}`，不伪造PostgreSQL读取或持久审计。每条记录保留原source_refs及记录trace；外层trace使用本次请求的x-trace-id或备用traceparent。返回前再次完整解析并复制，调用者修改种子、会话或返回结果不会改动store内部数据。

请求头最多16 KiB、正文最多8 KiB，大小写重复头拒绝；不接受写键、版本条件、条件缓存或范围请求。默认json及bounded-json响应均支持，bounded-json必须明确max_response_bytes；完整成功响应最多2 MiB，也遵守调用方更小的正安全整数上限。超限整份失败，可减小limit重读首页或保持原位置重读，不截断正文或静默少给条数。配置与返回仍受共享JSON复杂度限制。

头部捕获后创建30秒本地预算，覆盖输入解析、游标摘要、筛选与完整响应复制；直接transport请求可传signal。SDK上述两个既有方法目前未增加options参数，不宣称它们新增主动取消接口。每store最多两笔活动请求，取消/超时停止外层等待；如果底层SHA-256尚未结束，名额保留到其结束，迟到结果不会返回。数据集始终只读，错误使用固定允许列表及原trace、retryable=false，不回显底层异常。模拟到期在工作前后检查，不构成真实服务器令牌撤销或数据库事务。

## 接线示例

以下为未执行的开发示例，没有运行结果或测试证据：

```ts
import { validateRequestContext } from '@planemem/contracts';
import { MockWorkItemStore, MockWcpServer, WcpClient } from '@planemem/sdk';

const identity = {
  tenant_id: '01J000000000000000000000001',
  workspace_id: '01J000000000000000000000002',
  project_id: '01J000000000000000000000003',
  actor_id: '01J000000000000000000000004',
  client_id: 'editor',
};
const store = new MockWorkItemStore({
  scope: {
    tenant_id: identity.tenant_id,
    workspace_id: identity.workspace_id,
    project_id: identity.project_id,
  },
  items: [{
    id: 'local-work-1', external_id: 'PLAN-1', title: 'Draft specification',
    status: 'todo', priority: 'P1', owner: '', progress: 0, description: 'Development fixture',
    due_at: null, classification: 'internal', version: '1',
    source_refs: [{ type: 'plane-work-item', id: 'fixture-external-1' }],
    trace_id: 'trace_fixture_record',
    created_at: '2026-11-04T00:00:00.000Z',
    updated_at: '2026-11-04T00:00:00.000001Z',
  }],
});
const transport = new MockWcpServer({
  work_items: {
    store,
    session: {
      identity, expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      project_readable: true, read_work_items: true, read_restricted: false,
      visible_item_ids: ['local-work-1'],
    },
  },
});
const client = new WcpClient(transport, validateRequestContext({ ...identity, trace_id: 'trace_mock_read' }));
const page = await client.listWorkItemProjections({ assignment: 'unassigned', limit: 25 });
const detail = await client.getWorkItemProjection('local-work-1');
// 若page.next_cursor存在，另一次显式调用保留原筛选并把它作为cursor传回。
```

无真实鉴权、Policy/OPA、项目来源图、审计、Plane查询、SQL排序/锁、持久化、并发修改或重启恢复。完整WCP Mock覆盖、动态工作项/删除/权限模拟、真实客户端与数据库locale/分页证据仍未完成；R-001/R-002保持未完成且evidence为空。
