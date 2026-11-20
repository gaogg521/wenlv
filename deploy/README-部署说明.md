# 文旅小程序后端 · 公网部署说明

> 部署日期：2026-11-18
> 服务器：62.234.93.202（腾讯云 CentOS 8，8 核 / 15G / 493G）
> 目的：让小程序在**任何网络**下都能访问后端，不依赖开发机开机

## 一、架构

```
手机微信
  └─ https://api.1work.vip  (443, Let's Encrypt 证书)
       └─ nginx (本机 443)
            └─ proxy_pass → 127.0.0.1:18080
                 └─ 容器 wanderlust-api (Node 20, 内网 8080)
                      └─ wanderlust-mysql (MySQL 8.4, 127.0.0.1:3307)
```

## 二、关键资源

| 项目 | 值 |
|---|---|
| 域名 | `api.1work.vip`（A 记录 → 62.234.93.202） |
| API 容器 | `wanderlust-api`，镜像 `wanderlust-api:v2`，端口 `127.0.0.1:18080` |
| 数据库容器 | `wanderlust-mysql`，端口 `127.0.0.1:3307`，数据卷 `/opt/wanderlust/mysql` |
| Docker 网络 | `wanderlust-net`（API 通过容器名 `wanderlust-mysql` 访问数据库） |
| 应用目录 | `/opt/wanderlust/api` |
| 环境变量 | `/opt/wanderlust/api/.env.production`（权限 600） |
| 静态资源 | `/opt/wanderlust/api/static`（61MB / 955 文件，**挂载到容器 `/app/static`**） |
| nginx 站点 | `/etc/nginx/conf.d/api.1work.vip.conf` |
| 证书 | `/etc/letsencrypt/live/api.1work.vip/`，到期 2027-02-16 |
| 续期后重载 | `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` |
| 配置备份 | `/root/backup/nginx-conf-20261118-122509.tar.gz` |

## 三、常用运维命令

```bash
# 看服务状态
docker ps --filter name=wanderlust

# 看 API 日志
docker logs --tail 100 wanderlust-api

# 重启 API（改完环境变量后）
docker rm -f wanderlust-api
docker run -d --name wanderlust-api --restart always \
  --network wanderlust-net -p 127.0.0.1:18080:8080 \
  -v /opt/wanderlust/api/static:/app/static \
  --env-file /opt/wanderlust/api/.env.production wanderlust-api:v2

# 或者用 compose（compose 文件里已固化 static 挂载）
cd /opt/wanderlust && docker compose -f api-compose.yml up -d --force-recreate

# 代码更新后重新构建部署
cd /opt/wanderlust/api && docker build -t wanderlust-api:v3 .
# 然后把上面 run 命令里的 v2 换成 v3

# 进数据库
docker exec -it wanderlust-mysql mysql -uroot -p wanderlust

# 证书续期演练（跳过随机延迟）
certbot renew --dry-run --cert-name api.1work.vip --no-random-sleep-on-renew
```

## 四、回滚

nginx 部分出问题，一条命令还原：

```bash
cd /root/backup && tar xzf nginx-conf-20261118-122509.tar.gz -C / \
  && rm -f /etc/nginx/conf.d/api.1work.vip.conf \
  && nginx -t && nginx -s reload
```

完全下线本套服务（不影响 onework）：

```bash
docker rm -f wanderlust-api wanderlust-mysql
rm -f /etc/nginx/conf.d/api.1work.vip.conf && nginx -s reload
```

## 五、必须知道的约束

1. **数据是快照，不是实时同步**
   服务器上的库是 2026-11-18 12:33 从本地 `wanderlust` 导出的副本。之后在本地产生的数据**不会自动同步**。
   需要重新同步时：
   ```bash
   # 本地导出
   mysqldump -h127.0.0.1 -uroot -proot --single-transaction --set-gtid-purged=OFF \
     --no-tablespaces wanderlust | gzip > dump.sql.gz
   # 上传后在服务器导入
   gunzip -c dump.sql.gz | docker exec -i wanderlust-mysql mysql -uroot -p wanderlust
   ```

2. **密钥口径**
   - `SECRETS_KEY` = SHA-256(旧的默认 JWT_SECRET)，用于解开历史加密凭据
   - `JWT_SECRET` 已换成新随机值 → **旧的登录 token 全部失效**，需重新登录
   - `PASS_SECRET` 保持原值 → 已发出的核销码仍然有效
   - 5 条 SMTP 凭据在本地库里本就解不开（历史遗留），非本次部署引入

3. **静态资源必须挂载（已踩坑）**
   `api/static` 存放 uploads / receipts，Dockerfile 未包含该目录。重建容器时**必须**加
   `-v /opt/wanderlust/api/static:/app/static`，否则所有图片返回 404。
   用 `deploy/docker-compose.api.yml` 可避免遗漏。

4. **端口占用**
   3307 / 18080 已分配给本套服务。onework 使用 80 / 443 / 8791 / 29880，互不冲突。

5. **既有隐患（与本次部署无关）**
   `work.1oneclaw.com` 证书 2027-01-20 到期，续期演练报错
   `43.163.105.71: Error reading HTTP response body: reader size limit exceeded`
   —— 需要在到期前修复，否则 onework 官网会掉证书。

## 六、小程序端待办（需本人在微信公众平台操作）

1. 「开发管理 → 开发设置 → 服务器域名」→ request 合法域名加 `https://api.1work.vip`
2. 开发者工具打开 `wanderlust/mini-a`（AppID `wx0103e7893d828452`）→ 上传
3. 后台设为体验版 → 添加体验成员 → 手机扫码验证

代码侧已完成：`mini-a/app.js`、`mini-b/app.js` 的 `API_BASE_RELEASE` 与 `API_BASE_LAN` 均已指向 `https://api.1work.vip`。
