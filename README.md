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
- `MESSAGE_CLEANUP_JOB_ENABLED`：Express 消息清理定时任务开关，默认启用；设为 `false` 可关闭

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
- `realtime/*.mjs`：实时消息共享模块，供 Netlify Edge SSE 和 Express SSE 共用
- `routers/*.js`：Express 路由入口，只挂载短路径，例如 `/users/login`
- `routers/jobs/messagesCleanup.js`：消息清理定时任务，供 Express 启动后按日执行，不暴露 HTTP 接口
- `db/model/*.js`：Mongoose 数据模型
- `app.js`：Express 应用配置
- `server.js`：Express 本地/服务器启动入口
- `netlify/functions/users.js`：注册、登录、资料更新、账号搜索、关系查询
- `netlify/functions/relations.js`：关系模块，负责发起绑定请求
- `netlify/functions/messages.js`：消息模块，负责消息动作和未读消息拉取
- `netlify/functions/message-types.js`：消息类型管理，负责消息类型的增删改查
- `netlify/functions/report.js`：年度报告生成
- `netlify/functions/messages-cleanup-scheduled.js`：Netlify 定时函数，清理 7 天前已读/已处置消息
- `netlify/functions/files.js`：图片上传到 Gitee
- `netlify/edge-functions/sse.js`：SSE 连接和事件发布
- `utils/auth.js`：JWT 鉴权和用户脱敏
- `utils/express.js`：Express 请求适配、响应适配和 service router 创建
- `utils/relations.js`：关系查询、格式化和创建
- `utils/messages.js`：消息格式化、未读查询和 SSE 发布
- `utils/subscribeMessages.js`：小程序订阅消息 access_token 缓存、发送和状态回写
- `utils/analytics.js`：埋点写入，把 `_analytics` 声明写入 `analyticsEvents` 集合
- `utils/features/analyticsEvents.js`：埋点事件类型常量 `ANALYTICS_TYPES` 和活跃信号配置 `ACTIVITY_SIGNALS`
- `utils/reportConfig.js`：年度报告文案配置，统计行和事件行模板分开定义，改文案只改这里
- `utils/features/*`：业务特性模块，包括埋点常量与活跃信号（`analyticsEvents`）、双向确认动作分发（`messageActions`）和具体业务 handler（`relationHandler`）

### 调用链

Netlify 调用链：

```text
netlify/functions/*.js -> utils/createHandler -> services/*.js -> db/model/*.js
```

Express 调用链：

```text
server.js -> app.js -> routers/*.js -> utils/express.js -> services/*.js -> db/model/*.js
```

Express 的 `utils/express.js` 会把 `req` 适配成 service 所需的 `{ event, context, body }` 结构，保证业务代码和 Netlify Functions 共用。

SSE 调用链：

```text
netlify/edge-functions/sse.js -> realtime/*.mjs
routers/sse.js -> realtime/*.mjs
```

两套 SSE 入口只保留运行时适配：Netlify Edge 负责 `Request/Response/ReadableStream`，Express 负责 `req/res.write()`。通用逻辑放在 `realtime`：

- `constants.mjs`：心跳间隔、padding、SSE 事件名和响应头
- `sseCodec.mjs`：SSE 文本编码
- `auth.mjs`、`jwt.mjs`：token 提取、JWT payload 校验和通用解码工具
- `channelStore.mjs`：连接分组、增删、按用户投递和消息去重
- `session.mjs`：连接生命周期、ready 事件、heartbeat 和 cleanup
- `publisher.mjs`：发布鉴权、参数校验和 delivered 统计

### 路径规则

HTTP 业务接口在两种运行方式下使用同一组业务路径：

- `/users/register`
- `/users/login`
- `/users/me`
- `/users/profile`
- `/users/accounts`
- `/users/relation`
- `/relations/bind-request`
- `/relations/message`
- `/messages/action`
- `/messages/events`
- `/message-types/create`
- `/message-types/list`
- `/message-types/update`
- `/files/upload`
- `/report/report`

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

消息/事件表，集合名为 `messages`。现在主要用于绑定请求、绑定同意/拒绝通知、关系内单向通知，以及后续扩展的其他用户消息类型。

- `type`：消息类型，例如 `binding_request`、`binding_accepted`、`binding_declined`、`relation_message`
- `fromUser`：发送方用户 ID
- `toUser`：接收方用户 ID
- `relationKey`：与关系相关的消息所使用的关系键
- `title`：客户端展示标题
- `content`：消息正文
- `messageType`：消息类型标识，对应 `messageTypes` 集合中的 `code`，例如 `pat`、`bump`
- `payload`：可扩展业务数据
- `actionState`：消息处理状态
- `notifyChannels`：消息通知渠道，例如 `realtime`、`subscribe`
- `deliveryState`：SSE 投递状态
- `deliveredAt`：SSE 成功投递时间
- `subscribeState`：小程序订阅消息发送状态
- `subscribeSentAt`：小程序订阅消息发送成功时间
- `subscribeError`：小程序订阅消息失败或跳过原因
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

`notifyChannels` 的含义：

- `realtime`：通过 SSE 实时推送
- `subscribe`：通过小程序订阅消息发送微信服务通知

`subscribeState` 的含义：

- `none`：未配置订阅消息发送
- `pending`：准备发送或正在发送
- `sent`：发送成功
- `skipped`：因缺少模板、openid 等条件跳过
- `failed`：微信接口返回失败或发送异常

补充说明：

- `eventKind` 是接口/SSE 返回事件上的字段，不是 `messages` 表字段
- `relation_changed` 这类同步事件通常不落库，只通过 SSE 发布给页面刷新状态
- 当前前端判断“未处理/未读”主要看 `readAt` 是否为空
- `deliveryState` 只表示消息是否已经送达到前台连接，不等于用户已经处理
- 小程序订阅消息是旁路通知，失败不会影响主业务流程

### `db/model/messageTypeModel.js`

消息类型配置表，集合名为 `messageTypes`。用于动态管理关系内消息的类型，前端根据此配置渲染操作按钮，后端根据此配置生成消息内容。

- `code`：类型标识，唯一，例如 `pat`、`bump`
- `name`：展示名称，例如 `拍一拍`、`碰一碰`
- `defaultTitle`：默认消息标题，例如 `消息通知`
- `defaultContent`：默认消息内容，例如 `对方拍了拍你`
- `category`：类型分类
  - `interaction`：互动类，内容固定，使用 `defaultContent`
- `createdAt`、`updatedAt`：时间戳

首次调用 `list` 接口时，如果集合为空，会自动初始化默认类型：

```json
[
  {"code": "pat", "name": "拍一拍", "defaultContent": "对方拍了拍你", "category": "interaction"}
]
```

后续新增消息类型（如“碰一碰”）只需调用 `create` 接口，不改代码。

### `db/model/analyticsEventModel.js`

埋点事件表，集合名为 `analyticsEvents`，用于生成年度报告。

- `userId`：事件归属用户
- `type`：事件类型，例如 `activity.query`、`relation.message`、`action.accepted`
- `year`：事件发生年份，报告按年统计
- `properties`：事件属性，自由结构，报告模板从这里取变量
- `createdAt`：事件时间

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

#### `POST /relations/message`

关系内单向消息接口。当前用户必须已经有 active 绑定关系，后端会自动找到绑定的另一个用户并发送消息。

请求体：

```json
{
  "messageType": "pat"
}
```

字段说明：

- `messageType`：消息类型标识，对应 `messageTypes` 集合中的 `code`；不传时默认 `pat`

规则：

- 后端根据 `messageType` 查询消息类型配置，自动生成 `title` 和 `content`
- 创建一条 `relation_message` 消息，`messageType` 字段写入消息记录，返回事件 `eventKind` 为 `message`，`actionState` 为 `none`
- `notifyChannels` 同时包含 `realtime` 和 `subscribe`
- 在线用户通过 SSE 收到弹窗；不在线时后端会尝试发送小程序订阅消息
- 如果该业务还需要刷新页面，后端应额外发布一条 `eventKind: "sync"` 的同步事件

返回示例：

```json
{ "message": "已发送", "event": {} }
```

### `messages`

#### `POST /messages/action`

消息统一动作接口。

这个接口只负责统一鉴权、读取消息、判断动作，并统一把消息写成 `accepted` 或 `declined`。具体业务副作用会按 `payload.actionKind` 分发到 `utils/features/*`。当前绑定关系使用 `actionKind: "relation.bind"`，由 `features/relationHandler.js` 处理；后续新增类似“需要对方同意”的业务时，新增一个 handler 并注册到 `features/messageActions.js` 即可。

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

#### 定时清理消息

当前没有开放手动清理接口。清理逻辑由 `services/messages.js` 中的 `cleanupMessages()` 提供。

Netlify 使用定时函数 `netlify/functions/messages-cleanup-scheduled.js` 每天执行一次。

Express 模式在 `server.js` 启动成功后调用 `routers/jobs/messagesCleanup.js` 注册进程内定时任务，默认每天本地时间 0 点执行一次。需要关闭时配置：

```bash
MESSAGE_CLEANUP_JOB_ENABLED=false
```

如果 Express 后续部署为多实例，每个实例都会注册自己的定时任务，清理操作本身按条件删除不会影响待处理消息，但会存在重复执行。多实例生产部署时再考虑改成单独调度任务。

清理保留期固定为 7 天，按 `updatedAt` 计算。清理条件：

- 永远不清理 `actionState === "pending"` 的待处理消息
- 清理 7 天前 `actionState` 为 `accepted`、`declined`、`expired` 的已处置消息
- 清理 7 天前 `actionState === "none"` 且 `readAt` 存在的已读普通通知
- 不清理 `actionState === "none"` 但 `readAt` 为空的未读普通通知

Netlify 定时配置在 `netlify.toml`：

```toml
[functions."messages-cleanup-scheduled"]
  schedule = "@daily"
```

返回的事件已经做了前端所需的字段归一化，包含：

- `id`
- `type`
- `eventKind`
- `actionState`
- `deliveryState`
- `notifyChannels`
- `subscribeState`
- `subscribeSentAt`
- `subscribeError`
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

- `eventKind` 表示前端处理用途：
  - `message`：用户可见消息，交给公共消息组件弹窗、确认、已读
  - `sync`：页面同步事件，只给页面刷新状态，不弹窗、不已读
- `eventKind: "message"` 的用户可见消息必须先写入 `messages` 表，再通过 SSE 推给前端；如果 SSE 没收到，前端后续还能通过 `/messages/events` 拉取未读消息补偿
- `eventKind: "sync"` 的页面同步事件通常不写入 `messages` 表，只通过 SSE 临时发布；例如 `relation_changed` 只用于通知当前在线页面刷新关系状态，离线丢失也不影响最终数据，因为页面重新进入时应主动调用业务查询接口刷新
- 只要 `readAt` 为空，就可以认为这条消息还没有被前端确认
- 如果你只是想判断“有没有未处理消息”，优先查 `readAt`
- 如果要判断“是否已经通过 SSE 发到前台”，再看 `deliveryState`
- `notifyChannels` 只表示通知渠道，不表示页面是否刷新

### `message-types`

消息类型管理接口，用于动态管理关系内消息的类型配置。前端根据类型列表渲染操作按钮，后端根据类型配置生成消息内容。

#### `POST /message-types/list`

查询所有消息类型。首次调用时如果集合为空，会自动初始化默认类型（`pat`）。

返回示例：

```json
{
  "types": [
    {"code": "pat", "name": "拍一拍", "defaultTitle": "消息通知", "defaultContent": "对方拍了拍你", "category": "interaction"}
  ]
}
```

#### `POST /message-types/create`

新增消息类型。

请求体：

```json
{
  "code": "bump",
  "name": "碰一碰",
  "defaultTitle": "消息通知",
  "defaultContent": "对方碰了碰你",
  "category": "interaction"
}
```

字段规则：

- `code`：必填，类型标识，唯一
- `name`：必填，展示名称
- `defaultTitle`：可选，默认 `消息通知`
- `defaultContent`：可选，默认空字符串
- `category`：可选，默认 `interaction`

返回示例：

```json
{ "type": {"code": "bump", "name": "碰一碰", "defaultTitle": "消息通知", "defaultContent": "对方碰了碰你", "category": "interaction"} }
```

#### `POST /message-types/update`

修改消息类型。

请求体：

```json
{
  "code": "pat",
  "name": "拍两拍",
  "defaultContent": "对方拍两拍了你"
}
```

字段规则：

- `code`：必填，用于查找要修改的类型
- 其他字段均可选，只更新传入的字段

### `report`

年度报告接口，基于埋点事件生成当年的年度报告。

#### `POST /report/report`

请求需要携带 `Authorization: Bearer <token>`，请求体为空。

返回示例：

```json
{
  "year": 2026,
  "lines": [
    "2026 年，你活跃了 30 天",
    "你 2026-02-14 那天23:41 还在",
    "你最活跃的一天是 2026-02-14（12次）",
    "最长连续活跃 7 天",
    "2026-01-01 与 xxx 绑定成功",
    "你拍一拍了 5 次"
  ]
}
```

- `year`：报告年份，固定为当前年
- `lines`：报告文案，由内置统计和事件配置拼接而成，缺变量的行会自动跳过

### 埋点与年度报告

埋点只有一条链路：

```text
service/handler 返回值带 _analytics -> 中间件统一处理 -> 写入 analyticsEvents 集合
```

两类事件的来源不同：

- 业务事件：在 service 或 handler 的返回值中声明，例如 `/relations/message` 发送成功后声明 `relation.message`，双向确认 handler 声明 `action.accepted`
- 活跃信号：配置在 `utils/features/analyticsEvents.js` 的 `ACTIVITY_SIGNALS`（path 到 type 的映射），中间件命中后自动注入 `_analytics`，不需要业务代码感知

事件字符串统一定义，代码里不写死：

- 埋点事件类型：`utils/features/analyticsEvents.js` 的 `ANALYTICS_TYPES`
- 双向确认业务动作：`utils/messages.js` 的 `ACTION_KINDS`

当前埋点事件：

| type | 触发时机 | properties |
| --- | --- | --- |
| `activity.query` | 访问活跃信号接口（`/users/me`、`/users/relation`、`/users/accounts`、`/messages/events`），中间件自动注入 | `path` |
| `relation.message` | 发送关系内消息 | `targetUserId`、`messageType`、`messageTypeName` |
| `action.accepted` | 双向确认成功，用 `actionKind` 区分具体业务 | `actionKind`、`targetUserId` |

报告文案配置独立在 `utils/reportConfig.js`，改文案不需要动 `services/report.js`：

- `STATS_TEMPLATES`：统计行，每条都是可自定义模板，变量来自内置计算 `computeStats`（活跃天数、最晚活跃、最活跃的一天、最长连续活跃）
- `EVENT_TEMPLATES`：事件行，每项独立配置，按 `type` 查询 `analyticsEvents`
  - `filter`：可选，对 `properties` 字段追加过滤条件，例如 `{actionKind: ACTION_KINDS.RELATION_BIND}`
  - `mode: 'count'`：只统计条数，模板可用 `{count}`
  - 默认逐条列出，`properties` 自动展开为模板变量，另有 `{date}`、`{datetime}`

消息类统计一个消息类型写一条，例如：

```js
{type: ANALYTICS_TYPES.RELATION_MESSAGE, filter: {messageType: 'pat'}, mode: 'count', template: '你拍一拍了 {count} 次'}
```

新增消息类型时，在 `EVENT_TEMPLATES` 里加一条对应的配置即可。

### 消息枚举

`EVENT_KINDS` 定义在 `utils/messages.js`：

- `message`：用户消息，来自 `messages` 表格式化结果，前端公共消息组件会处理
- `sync`：同步事件，通常不落库，页面按 `type` 自行刷新状态

`MESSAGE_TYPES` 定义在 `utils/messages.js`：

- `binding_request`：绑定申请，需要接收方同意或拒绝
- `binding_accepted`：绑定申请已同意，发给申请方的通知
- `binding_declined`：绑定申请已拒绝，发给申请方的通知
- `relation_changed`：关系已变更的实时事件，不一定落库成普通消息
- `relation_message`：关系内单向消息，无需接收方同意或拒绝

`ACTION_STATES`：

- `pending`：等待处理
- `accepted`：已同意
- `declined`：已拒绝
- `expired`：已过期
- `none`：无需处理，只做通知

`DELIVERY_STATES`：

- `pending`：待投递
- `delivered`：已经通过 SSE 投递到在线客户端

`ACTION_KINDS` 定义在 `utils/messages.js`：

- `relation.bind`：绑定关系申请

### 小程序订阅消息策略

当前不单独维护在线状态。后端会先尝试 SSE 推送，如果本次 SSE 返回 `delivered > 0`，说明已有前台连接收到消息，就跳过小程序订阅消息；如果 `delivered === 0`，再按 `notifyChannels` 是否包含 `subscribe` 尝试发送一条小程序订阅消息。

这个判断是当前项目的最小改动方案，适合单实例或 SSE 发布能命中同一连接存储的场景。Netlify Edge 多实例下连接内存不共享，可能出现用户在线但 `delivered === 0` 的情况，此时仍可能发送订阅消息。

目前开启 `subscribe` 的消息：

- `binding_request`：双向确认消息，需要对方同意或拒绝
- `binding_accepted`：单向通知，告诉申请方绑定成功
- `binding_declined`：单向通知，告诉申请方绑定被拒绝
- `relation_message`：关系内单向消息，告诉对方有新的消息

目前不推订阅消息的事件：

- `relation_changed`：只用于前台刷新关系状态，不发送微信服务通知
- 其他未显式写入 `notifyChannels: ["subscribe"]` 的消息

订阅消息当前使用模板字段：

```json
{
  "thing1": "通知类型，对应消息标题",
  "thing3": "消息来自，对应发送方昵称/账号/openid",
  "thing5": "备注，对应消息内容"
}
```

微信模板需要和这些字段匹配。订阅消息模板 ID、跳转页面和小程序版本目前写在 `utils/subscribeMessages.js` 顶部常量中。用户必须在小程序前端通过 `wx.requestSubscribeMessage` 订阅过对应模板，否则微信接口可能返回拒收或未授权错误，后端会把结果写入 `subscribeState/subscribeError`，但不会中断业务。

后端通过微信 `stable_token` 接口获取小程序 `access_token` 并做内存缓存。发送订阅消息时如果微信返回 `40001`、`40014`、`42001`，会清理缓存、重新获取 stable token 并重试一次，避免旧 token 或多实例 token 竞争导致的 `access_token is invalid or not latest`。

### 新增双向确认业务

如果后续新增一个“需要对方同意/拒绝”的业务，建议沿用现有消息动作机制：

1. 创建一条 `messages` 记录
2. `actionState` 写 `pending`
3. 如果需要微信服务通知，`notifyChannels` 写入 `["realtime", "subscribe"]`
4. `payload.actionKind` 写新的业务动作，先在 `utils/messages.js` 的 `ACTION_KINDS` 加枚举，例如 `TASK_CONFIRM: 'task.confirm'`
5. 在 `utils/features` 下新增业务 handler
6. 在 `messageActions.js` 的 `ACCEPT_HANDLERS` / `DECLINE_HANDLERS` 注册
7. handler 返回值中通过 `_analytics` 声明埋点事件，`type` 统一用 `ANALYTICS_TYPES.ACTION_ACCEPTED`，`properties.actionKind` 写对应的 `ACTION_KINDS` 枚举
8. 前端仍调用 `/messages/action`，传 `messageId` 和 `action`

这样前端不需要为每种双向确认业务新增一个接口，只需要根据消息展示弹窗，再把同意/拒绝结果交给 `/messages/action`。

需要只刷新页面、不弹窗时，不创建用户消息，直接发布 `eventKind: "sync"` 的 SSE 事件。需要“弹窗 + 刷新”时，现阶段约定由后端分别发送一条 `eventKind: "message"` 用户消息和一条 `eventKind: "sync"` 页面同步事件。

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
- 给同意方发布 `eventKind: "sync"` 的 `relation_changed` 事件
- 发起方收到 `binding_accepted` 用户消息后也会重新加载关系

拒绝后的后端行为：

- 当前请求消息置为 `declined`
- 给发起方创建 `binding_declined` 通知

## SSE

SSE 用于在线实时消息。Netlify 和 Express 各有自己的 SSE 入口。

Netlify：

- `GET /.netlify/edge-functions/sse`：带鉴权的 SSE 长连接
- `POST /.netlify/edge-functions/sse`：向已连接客户端发布事件
- `DELETE /.netlify/edge-functions/sse`：客户端主动关闭当前 `clientId` 对应的 SSE 连接

Express：

- `GET /sse`：带鉴权的 SSE 长连接
- `POST /sse`：向已连接客户端发布事件
- `DELETE /sse`：客户端主动关闭当前 `clientId` 对应的 SSE 连接

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

本地 Netlify 开发时，如果请求 `Host` 是 `localhost`、`127.0.0.1`、`10.*`、`192.168.*` 或 `172.16.*` 到 `172.31.*`，后端会按 `http` 拼接 SSE 发布地址；其他域名默认按 `https`。如果日志出现 `SSE publish failed`，现在会打印实际 `endpoint`，优先检查协议、端口和路径是否可从函数进程访问。

发布的数据结构示例：

```json
{
  "userIds": ["target-user-id"],
  "event": {
    "id": "message-id",
    "type": "binding_request",
    "eventKind": "message"
  }
}
```

注意：

- `eventKind: "message"` 代表用户可见消息，前端公共消息组件会弹窗或确认
- `eventKind: "sync"` 代表页面同步事件，只用于页面刷新状态
- SSE 连接支持通过 query `clientId` 或请求头 `x-sse-client-id` 传入客户端标识；后端会按 `userId + clientId` 替换旧连接，避免同一设备重复连接导致同一条消息被投递多次
- 小程序进入后台时应调用 SSE `DELETE` 入口主动关闭当前 `clientId`，否则微信或运行时可能短时间保留网络连接，导致后端仍返回 `delivered > 0`
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
- `/relations/message`：给已绑定的对方发送单向消息，传 `{ "messageType": "pat" }`

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

当前小程序前端的处理约定：

- `app.js` 负责建立 SSE、解析事件、拉取 `/messages/events`，并把事件分发给监听器
- `message-host` 只处理 `eventKind === "message"` 的用户消息
- `actionState === "pending"` 时弹同意/拒绝，并调用 `/messages/action`
- `actionState === "none"` 时弹普通通知，并调用 `/messages/action` 标记已读
- 页面组件自己监听 `eventKind === "sync"` 或关心的消息 `type`，例如首页监听 `relation_changed` / `binding_accepted` 后调用 `/users/relation`
- 前端不再从 `message-host` 本地广播 `relation_changed`，关系刷新依赖后端 SSE 同步事件或页面自身 `onShow`

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
