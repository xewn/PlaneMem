# 原创建结果历史文件

2026-11-04，仅源码文档与人工审阅，未编译、类型检查、测试、运行产品/浏览器/接口/数据库或发布。

## 完整观察与当前提交分开

固定原创建页接收并核验有效发送回执或只读查询封套后，保存一份内存观察：完整原请求、完整响应、响应来源和本地观察时间。发送动作返回完整封套而非仅data，浏览器再次核验revision、ETag、server_cursor、来源与命令回执；查询继续核对原身份、键和完整草稿。错误/超时/取消或无效响应不构造历史。

最新观察与最近已确认观察独立保留。创建确认后仍允许用户明确只读查询，后续not-observed或查询失败不清除原已确认回执，不重新开放发送入口。后续recorded须与已确认观察的建议ID/状态/版本/事件ID/事件时间/cursor一致，trace与replayed不用于比较；不同则保留新观察供导出、提示冲突并维持旧确认。页面最多保留最新观察、已确认观察与一份独立审阅候选；要保留其他轮次需及时导出，没有自动留存队列。每次新收到的结果具有自己的观察时间和trace，导出/重载不重写时间或响应。

## 格式、限额与校验

独立v1文档为`{schema_version:1,kind:'proposal-creation-observation',original,observed_at,source,receipt}`；source仅submission或receipt-query。original使用既有1 MiB固定创建请求格式，保留网关及五字段身份、原键、完整草稿/来源/派生关系。observed_at为规范UTC毫秒时间，表示页面观察时间，不替代服务端事件时间。

submission的receipt最多64 KiB，严格包含schema_version、trace_id、data、source_refs、revision、etag和server_cursor。data严格包含proposal_id/status/revision/event_id/occurred_at/replayed；状态proposed、revision=1，外层版本和ETag一致，cursor正安全整数，事件与建议ID为ULID，事件时间规范UTC，来源恰为该建议的revision 1。发送响应不包含原草稿，关联来自原页面操作与服务器动作回传的同一完整原请求；文件不能证明该关联真实。

receipt-query的receipt复用2 MiB原创建回执封套解析，绑定original中的identity/request_key/draft，区分recorded与not-observed。not-observed不含结果或来源；recorded保留原建议ID、事件、版本、时间、cursor与current_state='not-checked'。整体观察最多4 MiB，文件封套`{document,document_sha256}`最多4 MiB+1024字节。文件、文档、发送回执拒绝缺失/多余字段；解析前后规范JSON必须相同，禁止丢弃或规范化原文中的字段。

规范JSON按对象键排序、数组顺序保留；SHA-256覆盖完整观察。导入先检查文件大小，读取后核对实际字节数，严格UTF-8，再核验完整结构、原绑定和摘要。不接受原请求文件、审核历史或备份文件冒充创建历史。摘要只说明内部一致，不认证来源、权限、原请求与发送响应的真实关联或当前建议状态。

## 审阅、导出与取回原请求

当前创建页提供Inspect latest received result for export，存在不同已确认观察时另提供对应入口。准备候选先固定完整规范文档，再计算摘要；哈希失败不改变已收到的结果。面板显示来源、观察时间、原身份、请求键、trace、摘要；已确认结果额外展示建议/事件/版本/时间/cursor，未见结果明确不证明失败或取消。完整文件可展开复制。

Export inspected creation history重新核验完整候选后请求下载`proposal-creation-history.json`。Export its original request从同一已核验候选提取既有格式的`proposal-original.json`，可通过原创建恢复页载入后显式查询回执或按原规则确认重试；提取本身不保存浏览器副本、不查询或发送。下载只报告已发起，需用户确认文件实际落盘；失败保留完整候选供复制或重试。

`/proposals/creation-history`提供独立文件审阅页，通过当前可信绑定限制载入范围，不依赖当前建议仍存在或可审核。原创建页和创建恢复页提供导航。独立页面初次获取绑定仍需要当前登录；文件校验在浏览器进行，不把文件上传为审核证据。导入只能改变历史审阅候选，不能回填父页面的已确认状态、禁止/解除发送或替换原请求；不通过导入文件自动获取发送资格。

## 操作边界与剩余范围

准备、导入与导出共用30秒文件/摘要等待；父创建页通过同步互斥阻止它们与保存/发送/查询并发，并清除旧发送确认。文件操作使用自己的等待控制器，原创建的停止等待按钮仅在其自身操作期间显示。卸载中止等待、释放本次所持锁并忽略迟到文件或哈希结果；失败保留旧审阅候选、源文件及已收到的观察。仅新候选完整核验成功后替换当前审阅项。

无新增浏览器库、schema、迁移、依赖或公共服务器API。创建历史浏览器持久目录、整批备份/恢复/清理、自动留存、跨页面协调与运行兼容证据仍缺。R-009/P7-01保持未完成，源码不作为已运行验证证据。
