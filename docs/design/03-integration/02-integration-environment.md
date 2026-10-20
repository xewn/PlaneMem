# 集成环境和合并策略

## 分支

```text
main       生产
release/*  发布候选
 develop   集成
feature/*  单任务实现
fix/*      缺陷
```

## 合并顺序

1. P0 契约和 Compose；
2. P1/P2/P6 的独立能力；
3. P3 Session/Handoff/Sync；
4. P4 Gateway/Adapter；
5. P5 UI；
6. P7 智能能力；
7. P8 RC 和部署。

## 集成环境

每次 Merge 生成临时环境，服务版本、Plane、ai-memory、Schema 和 migration 来自同一 manifest。环境初始化：

1. 启动依赖；
2. 运行迁移；
3. 创建测试身份和 scope；
4. seed Plane 项目/WorkItem；
5. seed ai-memory wiki/fixture；
6. 注册 Webhook/MCP；
7. 执行 health/readiness；
8. 运行集成测试并保存 trace/report。

## 通过条件

所有必选测试通过、无 schema diff、无未批准 migration、事件 lag 在 SLO 内、审计写入正常、Context Resume 成功、回滚脚本已验证。
