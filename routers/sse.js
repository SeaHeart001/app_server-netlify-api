const express = require('express');
const jwt = require('jsonwebtoken');
const {getJwtSecret} = require('../db');

const HEARTBEAT_INTERVAL = 15000;
const EVENT_PADDING = `:${' '.repeat(2048)}\n\n`;
const channelStorePromise = import('../realtime/channelStore.mjs');

async function getRealtimeChannelStore() {
    return channelStorePromise;
}

function getToken(req) {
    const auth = req.headers.authorization || '';
    const token = auth.toLowerCase().startsWith('bearer ')
        ? auth.slice(7).trim()
        : '';

    if (token) {
        return token;
    }

    return String(req.query.token || '');
}

function verifyUserToken(token) {
    let decoded;
    try {
        decoded = jwt.verify(token, getJwtSecret());
    } catch (err) {
        const authError = new Error('身份信息异常或已过期');
        authError.statusCode = 401;
        authError.publicMessage = authError.message;
        throw authError;
    }

    if (!decoded || decoded.type !== 'user' || !decoded.id) {
        const authError = new Error('身份信息异常或已过期');
        authError.statusCode = 401;
        authError.publicMessage = authError.message;
        throw authError;
    }

    return decoded;
}

function writeEvent(res, name, data) {
    res.write(`event: ${name}\ndata: ${JSON.stringify(data || {})}\n\n${EVENT_PADDING}`);
}

async function openStream(req, res) {
    const channelStore = await getRealtimeChannelStore();
    const decoded = verifyUserToken(getToken(req));
    const userId = String(decoded.id);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    const client = channelStore.createRealtimeClient({
        userId,
        send(event) {
            writeEvent(res, 'message', event);
        }
    });
    let closed = false;

    const cleanup = function () {
        if (closed) {
            return;
        }

        closed = true;
        clearInterval(heartbeat);
        channelStore.removeRealtimeClient(client);
        try {
            res.end();
        } catch (err) {
            // The response may already be closed by the client.
        }
    };

    const heartbeat = setInterval(() => {
        try {
            writeEvent(res, 'heartbeat', {at: Date.now()});
        } catch (err) {
            cleanup();
        }
    }, HEARTBEAT_INTERVAL);

    channelStore.addRealtimeClient(client);
    console.info('SSE client connected', {
        userId,
        totalClients: channelStore.getTotalClientCount(),
        channels: channelStore.getChannelCount()
    });
    writeEvent(res, 'ready', {userId, at: Date.now()});

    req.on('close', cleanup);
    req.on('error', cleanup);
}

async function publish(req, res) {
    const channelStore = await getRealtimeChannelStore();
    const secret = process.env.SSE_PUBLISH_SECRET || getJwtSecret();
    const providedSecret = req.headers['x-sse-secret'] || '';

    if (!secret || providedSecret !== secret) {
        res.status(401).json({message: '无权发布消息'});
        return;
    }

    const body = req.body || {};
    const event = body.event;
    const userIds = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];

    if (!event || !userIds.length) {
        res.status(400).json({message: '缺少发布参数'});
        return;
    }

    const publishResult = channelStore.publishToRealtimeClients(userIds, event);

    console.info('SSE publish', {
        userIds,
        delivered: publishResult.delivered,
        totalClients: publishResult.totalClients,
        channels: publishResult.channels
    });

    res.status(200).json({ok: true, delivered: publishResult.delivered});
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

module.exports = router;
