# 长安链落根合约（候选实现）

目标为 ChainMaker 2.3.x Docker Go；尚无正式网络环境，本合约尚未部署或实链验证。网络版本、SDK 版本、架构和运行时须在部署前确认。部署者的链上 sender 地址被固定为唯一写入者；部署账号与 TBaaS 调用交易实际 sender 是否一致必须实测。没有管理后台或密钥轮换功能；身份变化需新的合约和明确的迁移方案。链管理员治理权限可能允许更换/重新部署合约，不能宣称抵御链管理员。

`writeRoot` 接收字符串 `root`、`prevRoot`（64 位小写十六进制）和 `bizDate`（YYYYMMDD）。根只允许写一次；合约记录链上真实交易 ID。`readRoot` 根据 `root` 返回包含 root、prevRoot、bizDate、txId 的 JSON。首次部署初始化时读取部署者 sender，无法得到 sender 或存储失败即拒绝初始化。合约自身拒绝升级请求；最终升级治理行为仍由网络决定。

本地检查：`go test ./...`；Linux amd64 交叉编译：`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o RootAnchor .`。实际运行时架构及 SDK 兼容性确认后，按腾讯云文档用 7zip 打包并部署。此步骤与正式链端到端测试尚未完成。

正式适配器配置：`TBAAS_ACTION=InvokeChainMakerContract`、`TBAAS_VERSION=2018-04-16`、`TBAAS_REGION=ap-beijing`、`TBAAS_ROOT_FUNC=writeRoot`，`TBAAS_CONTRACT` 为实际部署名，`TBAAS_CLUSTER_ID` 与 `TBAAS_CHAIN_ID` 使用正式网络实际值，`TBAAS_CHANNEL` 留空，模板为 `{"root":"{root}","prevRoot":"{prevRoot}","bizDate":"{bizDate}"}`。

适配器确认时先查交易回执，再查此合约的 `readRoot` 并比对根、前根、日期与交易 ID。查询异常保留待确认状态与原交易号。提交失败或超时且结果未知时进入人工处理状态，禁止自动重新提交，需人工按根排查；多实例共用账号需外部统一限流。
