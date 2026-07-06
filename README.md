# app-server-netlify-api

基于 Netlify Functions / Express + MongoDB 的通用前端后端服务。

这版接口、模型和工具文件使用通用命名。用户体系同时支持小程序 `code` 登录和网页账号密码注册登录，两种登录来源复用同一个 `users` 模型、同一套关系/消息/文件接口。

当前代码支持两种后端运行方式：

- Netlify Functions：适合继续使用 Netlify 部署，接口入口在 `netlify/functions`
- Express：适合部署为常驻 Node 服务，接口入口在 `routers`

两种运行方式共用 `services` 里的业务代码，避免维护两套业务实现。

## 环境变量

本地开发推荐使用 `.env`。Netlify 线上生产环境请在 Netlify 控制台配置；Express 生产环境请通过进程环境变量、Docker 环境变量或部署平台环境变量配置。

- `MONGODB_URI`：MongoDB 连接串
- `JWT_SECRET`：JWT 签名密钥
- `WX_APP_ID`：小程序 AppID
- `WX_APP_SECRET`：小程序 AppSecret，只放在后端
- `GITEE_ACCESS_TOKEN`：Gitee 图床上传令牌
- `SSE_PUBLISH_SECRET`：SSE 发布校验密钥，不配置时回退到 `JWT_SECRET`
- `SSE_EDGE_URL`：SSE 发布地址覆盖项；Express 运行并启用实时推送时应配置为 `https://your-express-api.example.com/sse`
- `JWT_EXPIRES_IN`：JWT 有效期，默认 `7d`
- `CORS_ORIGIN`：CORS 来源，默认 `*`
- `DNS_SERVERS`：本地 SRV 解析用 DNS 列表，例如 `8.8.8.8,1.1.1.1`
- `PORT`：Express 监听端口，默认 `3000`
- `JSON_BODY_LIMIT`：Express JSON 请求体大小限制，默认 `8mb`

### Netlify 线上配置

进入 Netlify 项目后，在 `Project configuration > Environment variables` 中添加上述变量。

如果项目已经绑定了作用域，变量作用域需要包含 `Functions`。

本地如果想把 `.env` 导入到 Netlify，可以执行：

```bash
npx netlify login
npx netlify link
npx netlify env:import .env
```

修改线上环境变量后，需要重新部署站点。

## 代码结构

- `services/*.js`：接口业务代码，Netlify Functions 和 Express Routers 共用
- `routers/*.js`：Express 路由入口，只挂载短路径，例如 `/users/login`
- `app.js`：Express 应用配置
- `server.js`：Express 本地/服务器启动入口
- `netlify/functions/users.js`：注册、登录、资料更新、账号搜索、关系查询
- `netlify/functions/relations.js`：关系模块，负责发起绑定请求
- `netlify/functions/messages.js`：消息模块，负责消息动作和未读消息拉取
- `netlify/functions/files.js`：图片上传到 Gitee
- `netlify/edge-functions/sse.js`：SSE 连接和事件发布
- `netlify/utils/auth.js`：JWT 鉴权和用户脱敏
- `netlify/utils/relations.js`：关系查询、格式化和创建
- `netlify/utils/messages.js`：消息格式化、未读查询和 SSE 发布

### 调用链

Netlify 调用链：

```text
netlify/functions/*.js -> netlify/utils/createHandler -> services/*.js -> db/model/*.js
```

Express 调用链：

```text
server.js -> app.js -> routers/*.js -> routers/utils.js -> services/*.js -> db/model/*.js
```

Express 的 `routers/utils.js` 会把 `req` 适配成 service 所需的 `{ event, context, body }` 结构，保证业务代码和 Netlify Functions 共用。

### 路径规则

HTTP 业务接口在两种运行方式下使用同一组业务路径：

- `/users/register`
- `/users/login`
- `/users/me`
- `/users/profile`
- `/users/accounts`
- `/users/relation`
- `/relations/bind-request`
- `/messages/action`
- `/messages/events`
- `/files/upload`

区别只在 `baseUrl`：

```js
// Netlify
const baseUrl = "https://your-site.netlify.app/.netlify/functions";

// Express
const baseUrl = "https://your-express-api.example.com";
```

所以前端请求保持：

```js
request("/users/login", data);
```

SSE 路径目前两套运行方式不同：

```text
Netlify: GET /.netlify/edge-functions/sse
Express: GET /sse
```

如果前端要同时兼容两套后端，建议把 SSE 地址也做成独立配置，例如 `sseUrl`。

## 数据模型

### `db/model/userModel.js`

通用用户账号表，集合名为 `users`。

- `account`：网页端登录账号，唯一、小写存储；小程序用户可以为空
- `passwordHash`：网页端密码哈希，只给后端使用，不会返回前端；小程序用户可以为空
- `openid`：小程序用户唯一标识；网页账号可以为空
- `unionid`：可选的统一用户标识
- `loginSource`：最近一次登录来源，例如 `password`、`mini_program`
- `nickname`：展示昵称
- `avatarUrl`：头像地址
- `gender`：`0` 未知，`1` 男，`2` 女
- `city`、`province`、`country`：地区信息
- `profileSource`：资料来源，例如 `manual`
- `lastLoginAt`：最后一次登录时间
- `createdAt`、`updatedAt`：时间戳

### `db/model/relationModel.js`

两个用户之间的绑定关系表，集合名为 `userbindings`。

- `members`：恰好两个 ObjectId，表示绑定双方
- `relationKey`：稳定排序后的关系键，由 `createRelationKey(userA, userB)` 生成
- `status`：`active` 或 `inactive`
- `createdAt`、`updatedAt`：时间戳

### `db/model/messageModel.js`

消息/事件表，集合名为 `messages`。现在主要用于绑定请求、绑定同意/拒绝通知，以及后续扩展的其他消息类型。

- `type`：消息类型，例如 `binding_request`、`binding_accepted`、`binding_declined`、`relation_changed`
- `fromUser`：发送方用户 ID
- `toUser`：接收方用户 ID
- `relationKey`：与关系相关的消息所使用的关系键
- `title`：客户端展示标题
- `content`：消息正文
- `payload`：可扩展业务数据
- `actionState`：消息处理状态
- `deliveryState`：SSE 投递状态
- `deliveredAt`：SSE 成功投递时间
- `readAt`：客户端确认/已读时间
- `handledAt`：绑定请求被同意或拒绝的时间
- `createdAt`、`updatedAt`：时间戳

`actionState` 的含义：

- `pending`：请求等待对方处理
- `accepted`：请求已同意
- `declined`：请求已拒绝
- `expired`：请求已过期
- `none`：无需对方做决策的通知类消息

`deliveryState` 的含义：

- `pending`：待投递
- `delivered`：已投递

补充说明：

- 当前前端判断“未处理/未读”主要看 `readAt` 是否为空
- `deliveryState` 只表示消息是否已经送达到前台连接，不等于用户已经处理

## 接口说明

下面统一按业务路径描述。Netlify 运行时需要在业务路径前拼接 `/.netlify/functions`，Express 运行时直接使用业务路径。

当前 HTTP 业务接口按 `POST` 调用设计。Express 适配层目前使用 `router.all('/:routeName')` 复用 Netlify 的单级动作路由模式，所以代码层面对普通业务接口没有强制限制方法；前端和文档仍统一按 `POST` 对接。

当前接口都是“模块 + 单级动作名”的结构，例如 `/users/login`、`/messages/action`。如果后续出现多级路径，例如 `/users/profile/avatar`，需要把 Express router 改成显式路由或通配路由。

### `users`

#### `POST /users/register`

注册网页端普通账号，并返回登录态。小程序用户不需要调用注册接口，直接调用 `/users/login` 传 `code` 即可。

请求体：

```json
{
  "account": "demo",
  "password": "123456",
  "nickname": "演示账号",
  "avatarUrl": ""
}
```

返回示例：

```json
{
  "token": "...",
  "user": {
    "_id": "...",
    "account": "demo",
    "nickname": "演示账号",
    "avatarUrl": ""
  }
}
```

字段规则：

- `account` 至少 3 个字符，会统一转成小写
- `password` 至少 6 个字符
- 可同时传入 `nickname`、`avatarUrl`、`gender`、`city`、`province`、`country`、`profileSource`

#### `POST /users/login`

统一登录接口。传 `account/password` 时走网页账号密码登录，传 `code` 时走小程序登录。

网页登录请求体：

```json
{
  "account": "demo",
  "password": "123456"
}
```

小程序登录请求体：

```json
{ "code": "login-code" }
```

网页登录会按 `account` 查询用户并校验 `passwordHash`。

小程序登录会调用 `jscode2session`，按 `openid` 新增或更新同一个 `users` 集合里的用户。

返回示例：

```json
{
  "token": "...",
  "user": {}
}
```

#### `POST /users/me`

根据 token 获取当前登录用户信息。

#### `POST /users/profile`

更新当前用户资料。

请求字段：

- `nickname`：昵称
- `avatarUrl`：头像地址
- `gender`：性别
- `city`：城市
- `province`：省份
- `country`：国家
- `profileSource`：资料来源

#### `POST /users/accounts`

搜索可用于绑定的账号。

请求体：

```json
{ "keyword": "可选搜索关键词" }
```

返回示例：

```json
{ "accounts": [] }
```

搜索范围：

- `nickname`
- `account`
- `openid`

#### `POST /users/relation`

查询当前用户是否已有生效关系。

返回的关系字段：

- `id`
- `relationKey`
- `members`
- `partner`：对方用户信息
- `status`
- `updatedAt`

### `relations`

#### `POST /relations/bind-request`

关系模块接口，负责发起绑定请求。

请求体：

```json
{ "userId": "目标用户 ObjectId" }
```

规则：

- 不能自己绑定自己
- 如果当前已经存在关系，直接返回现有关系
- 否则创建一条 `binding_request` 消息，`actionState` 为 `pending`

返回示例：

```json
{ "request": {}, "message": "已发送绑定申请，等待对方确认" }
```

### `messages`

#### `POST /messages/action`

消息统一动作接口。

这个接口只负责统一鉴权、读取消息、判断动作，并统一把消息写成 `accepted` 或 `declined`。具体业务副作用会按 `payload.actionKind` 分发到 `netlify/utils/messageHandlers/*`。当前绑定关系使用 `actionKind: "relation.bind"`，由 `messageHandlers/relationHandler.js` 处理；后续新增类似“需要对方同意”的业务时，新增一个 handler 并注册到 `messageHandlers/messageActions.js` 即可。

请求体：

```json
{
  "messageId": "message-object-id",
  "action": "accept | decline | read"
}
```

行为说明：

- `accept`：同意绑定请求，创建关系，给发起方发送成功通知，并给自己发送关系变更通知
- `decline`：拒绝绑定请求，给发起方发送拒绝通知
- `read`：把通知消息标记为已读

#### `POST /messages/events`

获取当前用户未处理消息。

返回示例：

```json
{ "events": [] }
```

返回的事件已经做了前端所需的字段归一化，包含：

- `id`
- `type`
- `actionState`
- `deliveryState`
- `readAt`
- `handledAt`
- `title`
- `content`
- `relationKey`
- `from`
- `to`
- `relation`
- `payload`
- `createdAt`
- `updatedAt`

### `messages` 的判断约定

- 只要 `readAt` 为空，就可以认为这条消息还没有被前端确认
- 如果你只是想判断“有没有未处理消息”，优先查 `readAt`
- 如果要判断“是否已经通过 SSE 发到前台”，再看 `deliveryState`

### 消息枚举

`MESSAGE_TYPES` 定义在 `netlify/utils/messages.js`：

- `binding_request`：绑定申请，需要接收方同意或拒绝
- `binding_accepted`：绑定申请已同意，发给申请方的通知
- `binding_declined`：绑定申请已拒绝，发给申请方的通知
- `relation_changed`：关系已变更的实时事件，不一定落库成普通消息

`ACTION_STATES`：

- `pending`：等待处理
- `accepted`：已同意
- `declined`：已拒绝
- `expired`：已过期
- `none`：无需处理，只做通知

`DELIVERY_STATES`：

- `pending`：待投递
- `delivered`：已经通过 SSE 投递到在线客户端

`ACTION_KINDS` 定义在 `netlify/utils/messageHandlers/messageActions.js`：

- `relation.bind`：绑定关系申请

### 新增双向确认业务

如果后续新增一个“需要对方同意/拒绝”的业务，建议沿用现有消息动作机制：

1. 创建一条 `messages` 记录
2. `actionState` 写 `pending`
3. `payload.actionKind` 写新的业务动作，例如 `task.confirm`
4. 在 `netlify/utils/messageHandlers` 下新增业务 handler
5. 在 `messageActions.js` 的 `ACCEPT_HANDLERS` / `DECLINE_HANDLERS` 注册
6. 前端仍调用 `/messages/action`，传 `messageId` 和 `action`

这样前端不需要为每种双向确认业务新增一个接口，只需要根据消息展示弹窗，再把同意/拒绝结果交给 `/messages/action`。

### 绑定关系完整流程

发起方：

1. 调用 `POST /relations/bind-request`
2. 请求体传 `{ "userId": "目标用户 ObjectId" }`
3. 后端创建 `binding_request` 消息，写入 `payload.actionKind = "relation.bind"`
4. 后端尝试通过 SSE 推给接收方

接收方：

1. 在线时通过 SSE 收到 `binding_request`
2. 不在线时，重新进入前台后调用 `POST /messages/events` 拉取未读消息
3. 同意时调用 `POST /messages/action`，传 `{ "messageId": "...", "action": "accept" }`
4. 拒绝时调用 `POST /messages/action`，传 `{ "messageId": "...", "action": "decline" }`

同意后的后端行为：

- 创建或激活 `relation`
- 把其他相关待处理绑定申请置为 `expired`
- 给发起方创建 `binding_accepted` 通知
- 给双方发布关系变化实时事件

拒绝后的后端行为：

- 当前请求消息置为 `declined`
- 给发起方创建 `binding_declined` 通知

## SSE

SSE 用于在线实时消息。Netlify 和 Express 各有自己的 SSE 入口。

Netlify：

- `GET /.netlify/edge-functions/sse`：带鉴权的 SSE 长连接
- `POST /.netlify/edge-functions/sse`：向已连接客户端发布事件

Express：

- `GET /sse`：带鉴权的 SSE 长连接
- `POST /sse`：向已连接客户端发布事件

客户端建立连接时需要携带 token，可以放在请求头，也可以放在 query 中：

请求头方式：

```http
Authorization: Bearer <token>
```

query 方式：

```text
/sse?token=<token>
```

后端内部发布事件时使用 `POST` SSE 地址，并通过 `x-sse-secret` 校验。Netlify 环境默认会推到 `/.netlify/edge-functions/sse`；Express 环境因为入口是 `/sse`，生产环境需要配置：

```env
SSE_EDGE_URL=https://your-express-api.example.com/sse
```

发布的数据结构示例：

```json
{
  "userIds": ["target-user-id"],
  "event": {
    "id": "message-id",
    "type": "binding_request"
  }
}
```

注意：

- Express SSE 当前使用进程内存保存连接，只适合单实例部署
- 如果 Express 后续多实例部署，需要改成 Redis pub/sub 或负载均衡 sticky session
- Nginx 反代 SSE 时需要关闭响应缓冲，并调大超时时间

## 文件上传

#### `POST /files/upload`

把图片字节上传到 Gitee，返回可预览的公网地址。

请求体：

```json
{
  "fileName": "avatar.jpg",
  "contentType": "image/jpeg",
  "base64": "...",
  "directory": "profiles",
  "name": "avatar",
  "nameMode": "overwrite | timestamp"
}
```

字段含义：

- `fileName`：原始文件名
- `contentType`：文件 MIME 类型
- `base64`：文件内容的 base64
- `directory`：逻辑目录名
- `name`：文件逻辑名称
- `nameMode`：命名模式

`nameMode` 的含义：

- `overwrite`：沿用同一个逻辑文件名，覆盖旧图
- `timestamp`：在文件名后追加时间戳，保留历史文件

行为说明：

- 支持的类型：`jpg`、`jpeg`、`png`、`webp`、`gif`
- 单文件大小限制：`2MB`
- 路径会按当前用户 ID 做隔离
- `overwrite` 会尽量复用同一个逻辑路径并更新 Gitee 文件
- 如果使用 `overwrite`，保存后会清理同目录下旧的同名文件

返回示例：

```json
{
  "url": "public preview url",
  "rawUrl": "raw gitee url",
  "path": "files/<userId>/avatar.jpg",
  "name": "avatar.jpg",
  "directory": "files/<userId>",
  "nameMode": "overwrite",
  "operation": "created | updated",
  "sha": "..."
}
```

补充说明：

- `url` 用于页面预览
- `rawUrl` 是否能匿名访问，取决于 Gitee 仓库是否允许公开读取
- 这个接口可以给头像、封面、附件等图片资源使用

## 前端侧用法

### 通用请求

普通前端只需要维护一个 HTTP `baseUrl`，业务路径保持一致：

```js
// Netlify
const baseUrl = "https://your-site.netlify.app/.netlify/functions";

// Express
// const baseUrl = "https://your-express-api.example.com";

async function request(path, data, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(data || {})
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || "请求失败");
  }
  return result;
}
```

示例：

```js
await request("/users/register", { account: "demo", password: "123456" });
await request("/users/login", { account: "demo", password: "123456" });
await request("/users/relation", {}, token);
await request("/relations/bind-request", { userId }, token);
await request("/messages/action", { messageId, action: "accept" }, token);
```

小程序登录示例：

```js
wx.login({
  success(res) {
    request("/users/login", { code: res.code });
  }
});
```

### 登录态

注册或登录成功后，前端需要保存 `token`。不管是网页账号密码登录还是小程序 `code` 登录，后续需要登录态的接口都放到请求头：

```http
Authorization: Bearer <token>
```

### 资料回填

前端拿到头像、昵称、地区后，可以调用 `/users/profile` 回填数据库。

如果头像是先上传到 Gitee，再回写数据库，也还是走这个接口。

### 关系页

关系页主要用到：

- `/users/relation`：加载当前关系
- `/users/accounts`：搜索可绑定账号
- `/relations/bind-request`：发起绑定请求

### 消息处理

前端可以建立 SSE 连接。两套运行方式的 SSE 地址不同，建议单独配置 `sseUrl`：

```js
// Netlify
const sseUrl = "https://your-site.netlify.app/.netlify/edge-functions/sse";

// Express
// const sseUrl = "https://your-express-api.example.com/sse";

const source = new EventSource(`${sseUrl}?token=${encodeURIComponent(token)}`);

source.addEventListener("message", event => {
  const data = JSON.parse(event.data);
  console.log(data);
});
```

连接成功或者登录完成后，建议再调用一次 `/messages/events` 拉取未处理消息，避免前台断开后漏消息。

### 图片上传

前端把图片转成 base64 后，请求 `/files/upload`：

```js
await request("/files/upload", {
  fileName: "avatar.jpg",
  contentType: "image/jpeg",
  base64,
  directory: "profiles",
  name: "avatar",
  nameMode: "overwrite"
}, token);
```

其中：

- `overwrite` 适合头像这种只保留最新图的场景
- `timestamp` 适合保留历史版本的场景

## 生产部署

### Netlify Functions

Netlify 部署继续使用原有结构：

```text
netlify/functions/*.js
netlify/edge-functions/sse.js
```

部署后 HTTP `baseUrl`：

```text
https://your-site.netlify.app/.netlify/functions
```

SSE 地址：

```text
https://your-site.netlify.app/.netlify/edge-functions/sse
```

环境变量在 Netlify 控制台配置，变量作用域需要覆盖 Functions。修改环境变量后需要重新部署。

### Express

Express 部署入口是：

```bash
node server.js
```

部署后 HTTP `baseUrl`：

```text
https://your-express-api.example.com
```

SSE 地址：

```text
https://your-express-api.example.com/sse
```

如果启用实时消息，Express 环境需要配置：

```env
SSE_EDGE_URL=https://your-express-api.example.com/sse
```

推荐使用 Docker 镜像部署 Express，而不是把后端代码用 Webpack 打成单文件。这个项目是普通 Node CommonJS 服务，运行时依赖 Mongoose、环境变量、静态目录和 SSE，Webpack 收益不大，反而容易引入动态依赖和运行时路径问题。

Dockerfile 示例：

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
```

构建并运行：

```bash
docker build -t app-server-netlify-api .
docker run -d \
  --name app-server-netlify-api \
  -p 3000:3000 \
  --env-file .env.production \
  app-server-netlify-api
```

如果不用 Docker，也可以用 PM2 管理常驻进程：

```bash
npm ci --omit=dev
NODE_ENV=production pm2 start server.js --name app-server-netlify-api
pm2 save
```

生产环境通常还需要在前面放 Nginx 或云厂商网关处理 HTTPS、域名和反向代理。SSE 反代需要注意关闭缓冲，例如 Nginx 可参考：

```nginx
location /sse {
  proxy_pass http://127.0.0.1:3000/sse;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 1h;
}
```

## 开发

安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

启动 Express：

```bash
npm run dev:express
```

`npm run dev` 仍然启动 Netlify 本地开发服务；`npm run dev:express` 启动原始 Express 服务，默认端口是 `3000`，可以通过 `PORT` 环境变量修改。

语法检查：

```bash
npm run check
```
