const express = require('express');
const jwt = require('jsonwebtoken');
const {getJwtSecret} = require('../db');

const realtimePromise = Promise.all([
    import('../realtime/constants.mjs'),
    import('../realtime/auth.mjs'),
    import('../realtime/sseCodec.mjs'),
    import('../realtime/session.mjs'),
    import('../realtime/publisher.mjs'),
    import('../realtime/channelStore.mjs'),
    import('../realtime/ablyBridge.mjs')
]).then(([constants, auth, sseCodec, session, publisher, channelStore, ablyBridge]) => ({
    ...constants,
    ...auth,
    ...sseCodec,
    ...session,
    ...publisher,
    ...channelStore,
    ...ablyBridge
}));

async function getRealtime() {
    return realtimePromise;
}

function getRequestUrl(req) {
    return `${req.protocol || 'http'}://${req.headers.host || 'localhost'}${req.originalUrl || req.url || ''}`;
}

function setHeaders(res, headers) {
    Object.entries(headers || {}).forEach(([key, value]) => {
        res.setHeader(key, value);
    });
}

function verifyUserToken(token, realtime) {
    let decoded;
    try {
        decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
        throw realtime.createRealtimeError(401, realtime.AUTH_ERROR_MESSAGE);
    }

    return realtime.assertUserPayload(decoded);
}

async function openStream(req, res) {
    const realtime = await getRealtime();
    const token = realtime.getTokenFromRequestParts({
        authorization: req.headers.authorization || '',
        url: getRequestUrl(req)
    });
    const decoded = verifyUserToken(token, realtime);
    const userId = String(decoded.id);
    const clientId = realtime.getClientIdFromRequestParts({
        clientId: req.headers['x-sse-client-id'] || '',
        url: getRequestUrl(req)
    });

    // Send the stream headers before registering this connection. The client
    // still receives no `ready` event until the Ably subscription is usable.
    res.status(200);
    setHeaders(res, realtime.SSE_STREAM_HEADERS);
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const sessionCleanup = realtime.openRealtimeSession({
        userId,
        clientId,
        deferReady: true,
        sendEvent(name, data) {
            res.write(realtime.formatSseEvent(name, data));
        },
        close() {
            try {
                res.end();
            } catch (err) {
                // The response may already be closed by the client.
            }
        },
        logger: console,
        logLabel: 'SSE client connected'
    });

    let cleaned = false;
    const cleanup = function () {
        // req 的 close / error 可能先后触发，只清理一次
        if (cleaned) {
            return;
        }
        cleaned = true;
        sessionCleanup();
        // 本进程内该用户最后一条连接关闭后释放 Ably 订阅
        // （内部带宽限期复查，连接替换时不会误释放）
        realtime.releaseUserSubscription(userId);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    // Ably：确保本进程已订阅该用户的频道（与 Edge 版对称），
    // 配置 ABLY_API_KEY 时发布端经 Ably 扇出的事件才能投递到这条连接；
    // 未配置时为空操作，行为退化为原内存直推
    try {
        await realtime.ensureUserSubscription(userId);
    } catch (err) {
        cleanup();
        throw err;
    }

    sessionCleanup.sendReady();
}

async function publish(req, res) {
    const realtime = await getRealtime();
    const result = realtime.publishRealtimePayload({
        body: req.body || {},
        secret: process.env.SSE_PUBLISH_SECRET || getJwtSecret(),
        providedSecret: req.headers['x-sse-secret'] || '',
        logger: console,
        logLabel: 'SSE publish'
    });

    res.status(200).json(result);
}

async function closeClient(req, res) {
    const realtime = await getRealtime();
    const token = realtime.getTokenFromRequestParts({
        authorization: req.headers.authorization || '',
        url: getRequestUrl(req)
    });
    const decoded = verifyUserToken(token, realtime);
    const userId = String(decoded.id);
    const clientId = realtime.getClientIdFromRequestParts({
        clientId: req.headers['x-sse-client-id'] || '',
        url: getRequestUrl(req)
    });
    const result = realtime.closeRealtimeClients({userId, clientId});

    console.info('SSE client close requested', {
        userId,
        clientId,
        closed: result.closed,
        totalClients: result.totalClients,
        channels: result.channels
    });

    res.status(200).json({
        ok: true,
        closed: result.closed
    });
}

const router = express.Router();

router.get('/', async (req, res, next) => {
    try {
        await openStream(req, res);
    } catch (err) {
        next(err);
    }
});

router.post('/', async (req, res, next) => {
    try {
        await publish(req, res);
    } catch (err) {
        next(err);
    }
});

router.delete('/', async (req, res, next) => {
    try {
        await closeClient(req, res);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
