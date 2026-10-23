# 发布、部署、迁移和上线

## 发布清单

```yaml
release_id: workmesh-0.1.0
plane_version: x.y.z
ai_memory_version: v3.1.1@<immutable-commit>
api_version: v1
event_schema_version: 1
mcp_wcp_version: 1
database_migration: 20261020_001
images: {}
feature_flags: {}
```

`v3.1.1` 是上游参考基线；当前 Compose 和离线 release-manifest fixture 使用 `3.0.0` 作为最低兼容/夹具版本。进入 RC、预生产或生产前，必须把 `ai_memory_version` 替换为已经验证的具体 tag、不可变 commit 和镜像 digest，并同步更新 [ai-memory 版本矩阵](../vendor/ai-memory-adoption.md)。

## 环境

- 开发：Docker Compose；
- 测试：独立 namespace 和临时集成环境；
- 生产/测试：k3s/Helm，WorkMesh、Plane、observability、security、storage 分域。

## 发布流程

1. PR 门禁；
2. Merge 集成测试；
3. Nightly 故障/安全/性能/Golden；
4. RC 备份恢复、升级回滚和功能 Smoke；SBOM/漏洞报告只作可选记录；
5. 预生产 Smoke；
6. Feature Flag 灰度；
7. 生产 Smoke 和指标观察；
8. 扩大流量；
9. 记录发布结果。

## 迁移

expand → migrate → contract；先备份和预检；应用和消费者兼容一个窗口；删除字段延后到确认无旧版本后。

## 回滚

优先关闭 Feature Flag 和回退镜像；再恢复兼容迁移；重放未确认事件；验证 Plane 投影、ai-memory wiki/index、ContextPack、审计和 Outbox；禁止用数据库手工改状态掩盖失败。

## 上线门禁

健康检查、事件延迟、审计写入、Context Resume、Plane Webhook、ai-memory recall、备份恢复和权限拒绝全部通过才能上线。
