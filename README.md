# app-server-netlify-api

Netlify Functions + MongoDB backend.

## Required environment variables

Local development uses `.env`. Netlify production must configure these separately in Netlify environment variables:

- `MONGODB_URI`: MongoDB Atlas connection string
- `JWT_SECRET`: JWT signing secret
- `WX_APP_ID`: WeChat Mini Program AppID
- `WX_APP_SECRET`: WeChat Mini Program AppSecret. Keep this on the backend only.
- `JWT_EXPIRES_IN`: optional, defaults to `7d`
- `CORS_ORIGIN`: optional, defaults to `*`
- `DNS_SERVERS`: optional local DNS override, for example `8.8.8.8,1.1.1.1`

## Netlify environment variables

In Netlify UI, go to:

`Project configuration > Environment variables`

Add `MONGODB_URI`, `JWT_SECRET`, `WX_APP_ID`, and `WX_APP_SECRET`. If scopes are available, the scope must include `Functions`.

You can also import a local env file:

```bash
npx netlify login
npx netlify link
npx netlify env:import .env
```

After changing production environment variables, redeploy the site.

## Local development

```bash
npm install
npm run dev
```

Check syntax:

```bash
npm run check
```
