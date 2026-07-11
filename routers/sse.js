const express = require('express');
const jwt = require('jsonwebtoken');
const {getJwtSecret} = require('../db');

const realtimePromise = Promise.all([
    import('../realtime/constants.mjs'),
    import('../realtime/auth.mjs'),
    import('../realtime/sseCodec.mjs'),
    import('../realtime/session.mjs'),
    import('../realtime/publisher.mjs'),
    import('../realtime/channelStore.mjs')
]).then(([constants, auth, sseCodec, session, publisher, channelStore]) => ({
    ...constants,
    ...auth,
    ...sseCodec,
    ...session,
    ...publisher,
    ...channelStore
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

    res.status(200);
    setHeaders(res, realtime.SSE_STREAM_HEADERS);
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const cleanup = realtime.openRealtimeSession({
        userId,
        clientId,
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

    req.on('close', cleanup);
    req.on('error', cleanup);
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
