# 部署学习教程：Render 后端连接火山引擎 PostgreSQL

适用项目：uni-app OTC 项目。学习顺序：先理解链路，再逐层配置、验证。本文记录实际操作与排错，不代表线上数据库已连接成功。

## 第一课：你到底部署了什么

```text
浏览器 H5 / 手机 App
    │ HTTPS：接口，WSS：实时行情
    ▼
Render Node.js 后端
    │ PostgreSQL 协议 + TLS，端口 5432
    ▼
火山引擎 Ubuntu 服务器中的 PostgreSQL
    ▼
服务器磁盘中的数据库文件
```

前端负责界面；Node.js 处理鉴权和业务；PostgreSQL 存用户、资产和订单。部署代码不等于保存业务数据。Map 是进程内存，重启会丢失；数据库把已提交事务持久化到磁盘。磁盘持久化仍需备份，不能代替备份。

Render 和火山引擎是两台不同的机器。Render 中 localhost 指 Render 自己，不是你的 Mac，也不是火山服务器。数据库地址应使用火山服务器的公网 IP；App 只连接后端，不拿数据库密码直接连接数据库。

## 第二课：Linux 最少要懂的概念

- root：服务器管理员账号。使用它执行命令前确认作用范围。
- sudo -u postgres：以 PostgreSQL 系统账号执行命令，不是以项目数据库账号登录。
- systemctl：管理后台服务。--user 表示当前用户的服务，不是系统服务。
- ps：查看进程。进程名相同不代表属于同一个应用，不能随便停止所有 node。
- free -h：看内存；available 比单纯 free 更适合判断还能用多少。
- df -h /：看根磁盘空间。
- 绝对路径从 / 开始，与当前目录无关。
- 终端显示 (END) 通常是分页器，按 q 返回，不是程序卡死。

本次机器 Ubuntu 24.04、2 vCPU、约 2 GB 内存。OpenClaw 使用用户级 systemd 服务；执行 disable --now 后变为 inactive/disabled，停止运行并取消自动启动，但没有卸载文件和配置，也没有删除服务器。

## 第三课：安装和验证数据库

以下在火山服务器终端执行，不在本机 Mac 执行：

```bash
apt update
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql
pg_lsclusters
sudo -u postgres psql -c "SELECT version();"
```

apt update 更新软件索引，不是升级整个系统。install 安装软件。pg_lsclusters 显示版本、端口、状态和数据目录；online 表示集群在线。systemctl 的 postgresql 总服务状态不能完全替代集群检查。

创建项目账号与数据库（已有时不要重复创建）：

```bash
sudo -u postgres createuser --pwprompt otc_app
sudo -u postgres createdb --owner=otc_app otc_app
psql -h 127.0.0.1 -U otc_app -d otc_app -W -c "SELECT current_user, current_database();"
```

用户名和数据库名都用 otc_app 只是命名选择，它们是不同对象。密码输入不显示字符。两个输出都是 otc_app，说明本机 TCP 密码登录成功，还没有证明 Render 能访问。

## 第四课：理解四层连接条件

1. 网络地址：有公网 IP，客户端能到达。
2. 监听：PostgreSQL 监听服务器网络接口，而非只监听 localhost。
3. 防火墙：云安全组和操作系统防火墙允许来源和端口。
4. 数据库认证与 TLS：pg_hba.conf 允许账号、数据库、来源，并验证密码与证书。

某一层通过不代表全部通过。UFW inactive 只表示 Ubuntu 的 UFW 没启用，云安全组仍生效。

查看配置：

```bash
sudo -u postgres psql -P pager=off -c "SHOW config_file; SHOW hba_file; SHOW listen_addresses; SHOW ssl;"
```

本次配置文件在 /etc/postgresql/16/main/ 下。其他机器需以 SHOW 的实际结果为准，不要盲目沿用版本号。

## 第五课：Render 出口网段与安全组

Render 控制台：进入 otc-app → Connect → Outbound。复制当时显示的全部 CIDR 范围。它们是共享出口网段，不是你服务的独占地址；未来有变化需更新规则。

pg_hba.conf 为每个网段添加如下规则，把示例网段换成实际值：

```text
hostssl otc_app otc_app <Render出口CIDR> scram-sha-256
```

各列含义：必须 TLS / 数据库 / 用户 / 来源网段 / 密码认证方式。不要原样复制尖括号占位符。规则按顺序匹配，需要检查是否存在更早的宽泛规则。

启用网络监听：

```bash
sudo -u postgres psql -c "ALTER SYSTEM SET listen_addresses = '*';"
systemctl restart postgresql@16-main
```

星号表示监听全部接口，不等于所有人获准访问；访问范围由安全组及数据库认证共同限制。ALTER SYSTEM 写入 postgresql.auto.conf，可能覆盖主配置文件的同名设置。

检查语法：

```bash
sudo -u postgres psql -P pager=off -c "SHOW listen_addresses; SELECT line_number,error FROM pg_hba_file_rules WHERE error IS NOT NULL;"
```

0 rows 仅表示没有规则解析错误，不证明某个来源已经成功连接。

火山安全组：实例 → 安全组 → 配置规则 → 入方向。策略允许、TCP、5432，源地址填 Render 网段。多个源可放一条规则。不要把数据库端口对 0.0.0.0/0 放开。不要误删远程连接所需规则。

## 第六课：TLS 为什么还要证书

ssl=on 表示具备加密能力，不代表客户端信任当前证书。Ubuntu 默认 snakeoil 是测试用自签名证书。

本次没有域名，选择专用私有 CA 签发带公网 IP SAN 的服务器证书：

- ca.crt：CA 公开证书，配置到 Render 作为信任依据。
- ca.key：CA 私钥，只留在安全位置，不上传 Render，不截图。
- server.crt：数据库服务器证书。
- server.key：服务器私钥，postgres 所有、权限 600。
- SAN：证书实际绑定的 IP 或域名，客户端据此验证服务器身份。CN 文字本身不能替代 SAN。

CA 有效期与服务器证书有效期不同；这次服务器证书为 365 天，到期前需续签并重新加载。公网 IP 变更后也需要更新证书与连接地址。

验证生成结果：

```bash
openssl verify -CAfile ca.crt -verify_ip <实际公网IP> server.crt
```

显示 OK 说明本地信任链与 IP 匹配，尚未验证公网连接。证书配置到 PostgreSQL 后，检查 SHOW ssl_cert_file 和集群 online。不要用关闭证书校验绕过错误。

## 第七课：环境变量，不是源码里的密码

Render → otc-app → Environment → Edit，每个变量新增一行，已有的不要覆盖。

| 变量 | 作用 |
|---|---|
| DATABASE_URL | postgresql://账号:URL编码后的密码@公网IP:5432/数据库 |
| DATABASE_CA_CERT | 完整 ca.crt 内容，含 BEGIN/END CERTIFICATE |
| NODE_ENV | production，启用生产校验和默认关闭演示行为 |
| JWT_SECRET | 至少 32 字符的随机密钥，已有值尽量保留 |
| ADMIN_TOKEN | 监控统计接口的独立管理员凭据，不放前端 |
| SEED_DEMO_DATA | 正常部署为 false |
| SIMULATE_MERCHANT | 正常部署为 false |
| TRUST_PROXY_HOPS | 仅单层可信代理场景设 1 |
| CORS_ORIGINS | 允许跨域访问的前端来源列表 |

DATABASE_CA_CERT 与 DATABASE_URL 必须同时保留。当前代码配置 CA 时拒绝连接串中的 sslmode/sslcert/sslkey/sslrootcert 参数，避免驱动覆盖显式 TLS 校验配置。

密码中的 @、#、%、: 等需要 URL 编码。不要发送完整连接串截图；也不要把 .env 提交到 Git。JWT_SECRET 用于签名登录凭证，不是数据库密码，变更会影响旧登录状态。

## 第八课：代码怎样到 Render

```text
本地修改 → Git 提交 → 推送 GitHub 分支 → Render 拉取该分支
         → 安装依赖 → npm start → 数据库初始化 → 健康检查
```

Render 要部署的分支必须包含改动。仅在 Mac 上改文件不会自动生效。当前发布分支为 codex/postgres-persistence；不要误选内容未更新的 main。

本次设置：

```text
Root Directory: server
Build Command: npx --yes pnpm@12.4.2 install --frozen-lockfile
Start Command: npm start
```

Node 主版本固定 22.x，避免 >=22 自动选中更高版本。frozen-lockfile 代表严格按照锁文件安装，锁文件过期就失败；正确做法是本地更新并提交，而不是永久关闭校验。

本次 ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE 的具体原因是缺少 pnpm 自身的版本锁记录。同步后在没有 node_modules 的临时目录验证冻结安装成功，并推送修复。最后已推送的修复提交为 573cf85；之后以最新部署提交为准。

Render 点击 Manual Deploy → Deploy latest commit。先确认日志里的分支与提交，再看失败发生在哪一步。

## 第九课：前端源码为什么改了还没生效

这个仓库由 Node 托管 server/public 下的 H5 编译产物，Render 的后端构建命令不会自动编译 uni-app。

```text
pages/login/login.vue 修改
    → HBuilderX 发行 H5
    → 将新产物同步到 server/public
    → 提交并推送
    → Render 部署
    → 浏览器刷新验证
```

删除演示账号提示时只改源码，线上旧 JS 仍有文字，所以页面继续显示。源码、发布产物和缓存是三层不同状态。此次为修正线上旧提示，直接同步修补已有登录发布脚本；下次完整构建仍应由源码生成并替换产物，避免长期手工维护压缩 JS。

JS/CSS/HTML 现在使用 no-cache，让浏览器重新验证文件；no-cache 不等于不允许存储。之前已有长期缓存时，可在 Chrome 按 Cmd+Shift+R 强制刷新，或打开 DevTools 勾选 Disable cache 后刷新。

手机安装版也不会自动同步网页产物，需要另外更新 App 资源或重新安装。

## 第十课：看日志的顺序

| 现象 | 优先检查 |
|---|---|
| 安装依赖时报错 | Node/pnpm 版本、package.json 与锁文件 |
| 启动提示缺少配置 | Render 环境变量，不是本机 .env |
| 连接超时 | 公网地址、云安全组、端口、监听、防火墙 |
| connection refused | 地址是否正确、数据库是否监听且在线 |
| no pg_hba.conf entry | 来源是否在规则内、账号/库名、是否 TLS |
| password authentication failed | 账号密码、密码 URL 编码 |
| certificate verify failed | CA、证书有效期、IP SAN、实际连接地址 |
| Storage: PostgreSQL | 表示启动完成数据库初始化，继续测业务 |
| 页面还有旧文案 | server/public 是否更新、部署分支和浏览器缓存 |

不要只看 Deploy failed 标题，找日志中最早出现的具体错误。不要把构建失败误判成数据库密码错误。

## 第十一课：最终验收与备份

1. 日志确认 Storage: PostgreSQL。
2. 健康接口返回 storage=postgres。
3. 注册新账号，确认数据库产生用户记录。
4. 重启/重新部署后依然可以登录。
5. 在隔离测试数据下验证订单、冻结资产和流水；生产默认无赠送余额和样例广告。
6. 备份到独立存储并验证恢复，不能只依赖同一服务器上的数据盘。

本项目本机曾通过 18 项回归测试；后续发布前接口回归通过，数据库集成测试因未提供测试库而跳过。两种测试记录不可混为一谈。当前远端成功状态要以上线日志和业务验收为准，不能用本机测试替代。

## 自测题

1. 为什么 App 不能拿 DATABASE_URL 直接连接数据库？
2. Render 和数据库分开部署后，localhost 指哪台机器？
3. 安全组已放行，为什么仍可能连不上？
4. ssl=on 为什么不代表身份验证已完成？
5. 为什么 app 有数据不等于备份做好了？
6. 为什么源码删除文字后线上还能显示？
7. 发生构建失败时，为什么暂时不用改数据库？
8. 如何证明重启后数据真的保留？

学习时每完成一课，都尝试不看文档，用自己的话解释“改了什么、为什么改、怎样验证”。先掌握链路与验证方法，再记命令。
