const {connect} = require('../db');
const {ACTIVITY_SIGNALS} = require('./features/analyticsEvents');
const {getUserIdFromToken, trackFromEvent} = require('./analytics');

const headers = {
    'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
};

function response(statusCode, body, extraHeaders) {
    return {
        statusCode,
        headers: {...headers, ...extraHeaders},
        body: body === undefined ? '' : JSON.stringify(body)
    };
}

function error(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.publicMessage = message;
    return err;
}

function getHeader(event, name) {
    const eventHeaders = event.headers || {};
    const key = Object.keys(eventHeaders).find(item => item.toLowerCase() === name.toLowerCase());
    return key ? eventHeaders[key] : undefined;
}

function getRouteName(event) {
    return event.path.split('/').filter(Boolean).pop();
}

// 把运行时相关的请求路径归一化为业务路径，用于埋点活跃信号匹配。
// Express 下 event.path 已是业务路径（如 /users/me）；
// Netlify 下 event.path 带 /.netlify/functions/<fn>/ 前缀（如 /.netlify/functions/users/me），
// 去掉该前缀后两者都能命中 ACTIVITY_SIGNALS 的业务路径键。
function normalizeBusinessPath(path) {
    if (!path) {
        return path;
    }

    let p = path;
    const marker = '/.netlify/functions';
    const idx = p.indexOf(marker);
    if (idx !== -1) {
        p = p.slice(idx + marker.length);
    }

    if (p.length > 1 && p.endsWith('/')) {
        p = p.slice(0, -1);
    }

    return p || '/';
}

function parseBody(event) {
    if (!event.body) {
        return {};
    }

    const raw = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;

    try {
        return JSON.parse(raw);
    } catch (err) {
        throw error(400, '请求体 JSON 格式错误');
    }
}

function normalize(result) {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'statusCode')) {
        return {
            ...result,
            headers: {...headers, ...(result.headers || {})}
        };
    }

    return response(200, result || {});
}

function createHandler(router, options = {}) {
    const publicRoutes = options.publicRoutes || [];
    const skipConnectRoutes = options.skipConnectRoutes || [];

    return async function handler(event, context) {
        if (context) {
            context.callbackWaitsForEmptyEventLoop = false;
        }

        if (event.httpMethod === 'OPTIONS') {
            return {...response(204), body: ''};
        }

        try {
            const routeName = getRouteName(event);
            const route = router[routeName];

            if (!route) {
                return response(404, {message: '接口不存在'});
            }

            const body = parseBody(event);

            if (!publicRoutes.includes(routeName)) {
                await connect();
            } else if (!skipConnectRoutes.includes(routeName)) {
                await connect();
            }

            const result = await route({event, context, body});

            // 活跃信号：中间件注入 _analytics
            // 归一化业务路径后再匹配，保证 Express 与 Netlify 两套运行时都能命中
            const activityPath = normalizeBusinessPath(event.path);
            const activityType = ACTIVITY_SIGNALS[activityPath];
            if (activityType) {
                const userId = getUserIdFromToken(event);
                if (userId) {
                    result._analytics = result._analytics || [];
                    result._analytics.push({userId, type: activityType, properties: {path: activityPath}});
                }
            }

            // 统一处理所有追踪事件
            if (result && Array.isArray(result._analytics)) {
                trackFromEvent(result._analytics);
                delete result._analytics;
            }

            return normalize(result);
        } catch (err) {
            if (!err.statusCode || err.statusCode >= 500) {
                console.error(err);
            }
            return response(err.statusCode || 500, {
                message: err.publicMessage || '服务器内部错误'
            });
        }
    };
}

module.exports = {createHandler, error, getHeader, headers, response, normalizeBusinessPath};
