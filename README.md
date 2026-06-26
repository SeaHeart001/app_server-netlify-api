# app-server-netlify-api

Netlify Functions + MongoDB 后台。

## 必需环境变量

本地开发使用 `.env`，线上 Netlify 部署必须在 Netlify 项目环境变量中单独配置：

- `MONGODB_URI`: MongoDB Atlas 连接串
- `JWT_SECRET`: JWT 签名密钥
- `JWT_EXPIRES_IN`: 可选，默认 `7d`
- `CORS_ORIGIN`: 可选，默认 `*`
- `DNS_SERVERS`: 可选，本地 DNS 拒绝解析 MongoDB Atlas SRV 记录时使用，例如 `8.8.8.8,1.1.1.1`

## Netlify 部署配置

在 Netlify UI 中进入：

`Project configuration > Environment variables`

添加 `MONGODB_URI` 和 `JWT_SECRET`。如果当前套餐支持变量 Scope，Scope 必须包含 `Functions`，否则 Netlify Functions 运行时读不到。

也可以用 Netlify CLI：

```bash
npx netlify login
npx netlify link
npx netlify env:set MONGODB_URI "<mongodb-uri>" --context production --scope functions --secret
npx netlify env:set JWT_SECRET "<jwt-secret>" --context production --scope functions --secret
```

修改线上环境变量后需要重新部署，已部署的 Functions 不会自动拿到后设置的变量。


## 本地开发

```bash
npm install
npm run dev
```

检查语法：

```bash
npm run check
```
