const express = require('express');
const {headers: defaultHeaders} = require('./index');
const {ACTIVITY_SIGNALS} = require('./features/analyticsEvents');
const {getUserIdFromToken, trackFromEvent} = require('./analytics');

function buildEvent(req) {
    return {
        body: req.rawBody,
        headers: req.headers || {},
        httpMethod: req.method,
        isBase64Encoded: false,
        path: req.originalUrl.split('?')[0],
        queryStringParameters: req.query || {}
    };
}

function sendResult(res, result) {
    if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'statusCode')) {
        res.status(result.statusCode);
        Object.entries(result.headers || {}).forEach(([key, value]) => {
            res.setHeader(key, value);
        });

        if (result.body === undefined || result.body === '') {
            res.end();
            return;
        }

        res.send(result.body);
        return;
    }

    res.status(200).json(result || {});
}

function sendError(res, err) {
    const statusCode = err.statusCode || err.status || 500;

    if (statusCode >= 500) {
        console.error(err);
    }

    res.status(statusCode).json({
        message: err.publicMessage || (statusCode < 500 ? err.message : '服务器内部错误')
    });
}

function createServiceRouter(serviceRouter) {
    const router = express.Router();

    router.all('/:routeName', async (req, res) => {
        const routeName = req.params.routeName;
        const route = serviceRouter[routeName];

        if (!route) {
            res.status(404).json({message: '接口不存在'});
            return;
        }

        try {
            const event = buildEvent(req);
            const result = await route({
                event,
                context: {},
                body: req.body || {}
            });

            // 活跃信号：中间件注入 _analytics
            const activityType = ACTIVITY_SIGNALS[event.path];
            if (activityType) {
                const userId = getUserIdFromToken(event);
                if (userId) {
                    result._analytics = result._analytics || [];
                    result._analytics.push({userId, type: activityType, properties: {path: event.path}});
                }
            }

            // 统一处理所有追踪事件
            if (result && Array.isArray(result._analytics)) {
                trackFromEvent(result._analytics);
                delete result._analytics;
            }

            await sendResult(res, result);
        } catch (err) {
            sendError(res, err);
        }
    });

    return router;
}

function applyResponseHeaders(req, res, next) {
    Object.entries(defaultHeaders).forEach(([key, value]) => {
        if (key.toLowerCase() === 'content-type') {
            return;
        }
        res.setHeader(key, value);
    });
    next();
}

module.exports = {
    applyResponseHeaders,
    createServiceRouter,
    sendError
};
