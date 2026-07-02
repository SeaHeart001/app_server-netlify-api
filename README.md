# app-server-netlify-api

基于 Netlify Functions + MongoDB 的小程序后端。

## 环境变量

本地开发推荐使用 `.env`，线上生产环境请在 Netlify 控制台单独配置。

- `MONGODB_URI`：MongoDB 连接串
- `JWT_SECRET`：JWT 签名密钥
- `WX_APP_ID`：微信小程序 AppID
- `WX_APP_SECRET`：微信小程序 AppSecret，只放在后端
- `GITEE_ACCESS_TOKEN`：Gitee 图床上传令牌
- `SSE_PUBLISH_SECRET`：SSE 发布校验密钥，不配置时回退到 `JWT_SECRET`
- `SSE_EDGE_URL`：SSE 地址覆盖项
- `JWT_EXPIRES_IN`：JWT 有效期，默认 `7d`
- `CORS_ORIGIN`：CORS 来源，默认 `*`
- `DNS_SERVERS`：本地 SRV 解析用 DNS 列表，例如 `8.8.8.8,1.1.1.1`

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

## 运行结构

- `netlify/functions/wxusers.js`：登录、资料回填、账号搜索、关系查询
- `netlify/functions/relations.js`：关系模块，负责发起绑定请求
- `netlify/functions/messages.js`：消息模块，负责消息动作和未读消息拉取
- `netlify/functions/files.js`：图片上传到 Gitee
- `netlify/edge-functions/sse.js`：SSE 连接和事件发布

## 数据模型

### `db/wxuser/wxUserModel.js`

微信用户账号表。

- `openid`：微信唯一用户标识，必填且唯一
- `unionid`：可选的统一用户标识
- `sessionKey`：登录会话密钥，只给后端使用
- `nickname`：展示昵称
- `avatarUrl`：头像地址
- `gender`：`0` 未知，`1` 男，`2` 女
- `city`、`province`、`country`：地区信息
- `profileSource`：资料来源，例如 `manual`、`wx` 等
- `lastLoginAt`：最后一次登录时间
- `createdAt`、`updatedAt`：时间戳

### `db/wxuser/wxUserBindingModel.js`

两个微信用户之间的绑定关系表。

- `members`：恰好两个 ObjectId，表示绑定双方
- `relationKey`：稳定排序后的关系键，由 `createRelationKey(userA, userB)` 生成
- `status`：`active` 或 `inactive`
- `createdAt`、`updatedAt`：时间戳

### `db/message/wxMessageModel.js`

消息/事件表。现在主要用于绑定请求、绑定同意/拒绝通知，以及后续扩展的其他消息类型。

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

### `wxusers`

#### `POST /wxusers/login`

微信登录接口，使用小程序 `code` 换取后台登录态。

请求体：

```json
{ "code": "wx-login-code" }
```

返回示例：

```json
{ "token": "...", "user": {} }
```

处理流程：

1. 调用微信 `jscode2session`
2. 按 `openid` 新增或更新用户
3. 返回 JWT token 和脱敏后的用户信息

#### `POST /wxusers/me`

根据 token 获取当前登录用户信息。

#### `POST /wxusers/profile`

更新本地用户资料。

请求字段：

- `nickname`：昵称
- `avatarUrl`：头像地址
- `gender`：性别
- `city`：城市
- `province`：省份
- `country`：国家
- `profileSource`：资料来源

这个接口通常用于微信授权后把昵称、头像和地区信息回填到数据库里。

#### `POST /wxusers/accounts`

搜索可用于绑定的微信账号。

请求体：

```json
{ "keyword": "可选搜索关键词" }
```

返回示例：

```json
{ "accounts": [] }
```

#### `POST /wxusers/relation`

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
{ "request": {}, "message": "..." }
```

### `messages`

#### `POST /messages/action`

消息统一动作接口。

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

## SSE

`netlify/edge-functions/sse.js` 提供以下能力：

- `GET /.netlify/edge-functions/sse`：带鉴权的 SSE 长连接
- `POST /.netlify/edge-functions/sse`：向已连接客户端发布事件

客户端需要携带：

```http
Authorization: Bearer <token>
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
- 这个接口不仅给微信头像用，也可以给封面、附件等图片资源用

## 小程序侧用法

### 通用请求

`app.request({ url, data, loadingTitle })` 会自动补上 `/.netlify/functions` 前缀。

示例：

```js
app.request({ url: "/wxusers/relation" })
app.request({ url: "/relations/bind-request", data: { userId } })
app.request({ url: "/messages/action", data: { messageId, action: "accept" } })
```

### 登录

`app.ensureLogin()` 会先调用 `wx.login` 拿 `code`，再请求 `/wxusers/login`，最后把 token 和用户资料保存起来。

### 资料回填

小程序拿到头像、昵称、地区后，可以调用 `/wxusers/profile` 回填数据库。

如果头像是先上传到 Gitee，再回写数据库，也还是走这个接口。

### 关系页

`pages/index/index.js` 主要用到：

- `/wxusers/relation`：加载当前关系
- `/wxusers/accounts`：搜索可绑定账号
- `/relations/bind-request`：发起绑定请求

### 消息处理

`app.js` 负责维护 SSE 连接。

连接成功或者登录完成后，会调用 `/messages/events` 拉取一次未处理消息，避免前台断开后漏消息。

`components/custom-nav/custom-nav.js` 作为全局消息入口，统一处理：

- 绑定请求弹窗
- 绑定同意弹窗
- 绑定拒绝提示

这个组件挂在多个页面上，所以消息处理不只发生在首页。

### 图片上传

如果前端需要上传图片，可以调用：

```js
app.uploadFile({
  filePath,
  name,
  nameMode: "overwrite"
})
```

对应后端会请求 `/files/upload`，其中：

- `overwrite` 适合头像这种只保留最新图的场景
- `timestamp` 适合保留历史版本的场景

## 开发

安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

语法检查：

```bash
npm run check
```
