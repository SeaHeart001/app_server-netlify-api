const {connect, getJwtSecret} = require('../../db/db');
const {User} = require('../../db/user/userModel');
const jwt = require('jsonwebtoken');

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

async function auth(event) {
    const authorization = getHeader(event, 'authorization') || '';
    const raw = String(authorization).split(' ').pop();

    if (!raw) {
        return response(401, {message: '请先登录'});
    }

    let decoded;
    try {
        decoded = jwt.verify(raw, getJwtSecret());
    } catch (err) {
        return response(401, {message: '身份信息异常或已过期'});
    }

    if (!decoded || !decoded.id) {
        return response(401, {message: '身份信息异常或已过期'});
    }

    await connect();

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
        return response(401, {message: '身份信息异常或已过期'});
    }

    event._user = user;
    return true;
}

function createHandler(router, options = {}) {
    const publicRoutes = options.publicRoutes || [];
    const adminRoutes = options.adminRoutes || [];

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
                const authFlag = await auth(event);
                if (authFlag !== true) {
                    return authFlag;
                }
            } else {
                await connect();
            }

            if (adminRoutes.includes(routeName) && (!event._user || event._user.admin !== 1)) {
                return response(403, {message: '没有权限执行该操作'});
            }

            return normalize(await route({event, context, body}));
        } catch (err) {
            console.error(err);
            return response(err.statusCode || 500, {
                message: err.publicMessage || '服务器内部错误'
            });
        }
    };
}

module.exports = {auth, createHandler, error, headers, response};
