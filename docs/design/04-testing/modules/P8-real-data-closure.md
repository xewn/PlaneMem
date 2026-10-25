# P8 真实数据数据库闭环独立测试

## 测试目标

用真实 PostgreSQL、真实 Workctx runtime 和真实 Plane webhook 请求证明：事件、投影、搜索、审计的数据库行可回查；Workctx 重启或 k3s Deployment 滚动重启后，查询和幂等行为不改变。

## 用例矩阵

| ID | 环境 | 操作 | 数据库断言 | 运行时断言 |
|---|---|---|---|---|
| T8.4-C01 | Compose | POST 新 ProjectCreated | `wcp_events=1`、`wcp_projection_states=1`、`wcp_context_hits=1`、审计=1 | 200 accepted、trace/source_refs 保留 |
| T8.4-C02 | Compose | 同 event/delivery 重投 | 四表无新增事件/投影/hit | 200 duplicate、effect_applied=false |
| T8.4-C03 | Compose | 重启 workctx 后 search | 行数不变 | hit 可查，source_refs/external_id 一致 |
| T8.4-C04 | Compose | 重启后再次投递 | 行数不变，审计按新进程交付增加 | 仍为 duplicate |
| T8.4-K01 | k3s | 同一事件写入 `.233` PostgreSQL | 真实数据库四表闭环 | 3/3 Pod Ready、服务可访问 |
| T8.4-K02 | k3s | Deployment rolling restart | 行数不变 | 新 Pod hydrate 成功、search 恢复 |
| T8.4-K03 | k3s | 重启后 duplicate | event/projection/hit 不增加 | 200 duplicate、审计可回查 |
| T8.4-D01 | Compose/k3s | 查询不同 scope | 不产生任何新行 | 空结果或统一 deny，不能泄露正文 |

## 固定命令

```powershell
pnpm typecheck
pnpm lint
pnpm test
$env:REAL_DATA_CLOSURE='1'
$env:WORKCTX_IMAGE='registry.hedou.top:5000/planemem/platform:0.1.0-runtime-closure'
node --import tsx --test tests/p8/t8-real-data-closure.test.mjs
```

k3s 测试需要从 `planemem-runtime-secrets` 读取 `DATABASE_URL` 和 `PLANE_WEBHOOK_SECRET` 到进程环境，不把值写入报告：

```powershell
$env:KUBECONFIG='F:\PlaneMem\artifacts\k3s\kubeconfig-231.yaml'
$env:K3S_REAL_DATA_CLOSURE='1'
node --import tsx --test tests/p8/t8-k3s-real-data-closure.test.mjs
```

测试会自行创建临时 port-forward，执行 `kubectl rollout restart deployment/planemem -n planemem-test`，等待 rollout 完成，再重新建立 forward。

## 数据回查 SQL

每次运行使用唯一 `event_id`、`aggregate_id`、`external_id` 和 `trace_id`，只统计本次键值：

```sql
SELECT count(*) FROM wcp_events WHERE event_id = :event_id;
SELECT count(*) FROM wcp_projection_states WHERE external_id = :external_id;
SELECT count(*) FROM wcp_context_hits WHERE id = 'plane:Project:' || :external_id;
SELECT count(*) FROM wcp_audit_records WHERE trace_id = :webhook_trace_id;
```

通过阈值为 Compose 和 k3s 两个环境都满足：首次 accepted 后 `1/1/1/1`，重启后再次 duplicate 为 `1/1/1/2`；搜索结果长度为 1，source reference id 等于本次 external_id。

## 失败诊断

- 400：先读取响应错误封套，检查 aggregate_id 是否为 ULID、事件时间是否 `Z`、JSONB 是否对象/数组。
- 503：检查 009 migration、DATABASE_URL 主机、PostgreSQL 连接和 SQL 锁；不得把错误改成 200。
- 启动循环：查看 Pod logs 的 hydrate 事件 ID和 `kubectl describe pod`，按事件顺序修复数据或迁移。
- search 丢失：检查 `wcp_context_hits`、scope 三元组和 Pod 启动恢复日志。
- k3s `ErrImagePull`：逐节点检查归档 hash、tag 和 digest alias，再重试 Helm；不跳过 digest。

## 证据要求

报告必须保存命令、时间、镜像 digest、migration 版本、节点分布、event_id/external_id/trace_id 的脱敏摘要、四表计数、首次失败（如果有）和最终状态。禁止写入密码、完整连接串、签名 secret 或不属于本次 scope 的正文。
