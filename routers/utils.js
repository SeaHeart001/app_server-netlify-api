const express = require('express');
const {headers: defaultHeaders} = require('../utils');

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
            await sendResult(res, await route({
                event: buildEvent(req),
                context: {},
                body: req.body || {}
            }));
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
