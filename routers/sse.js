const express = require('express');
const jwt = require('jsonwebtoken');
const {getJwtSecret} = require('../db');

const HEARTBEAT_INTERVAL = 15000;
const EVENT_PADDING = `:${' '.repeat(2048)}\n\n`;

const state = global.__sseState || {
    channels: new Map()
};

global.__sseState = state;

function getTotalClientCount() {
    let count = 0;
    state.channels.forEach(clients => {
        count += clients.size;
    });
    return count;
}

function addClient(userId, client) {
    const key = String(userId);
    const clients = state.channels.get(key) || new Set();
    clients.add(client);
    state.channels.set(key, clients);
}

function removeClient(userId, client) {
    const key = String(userId);
    const clients = state.channels.get(key);
    if (!clients) {
        return;
    }

    clients.delete(client);
    if (!clients.size) {
        state.channels.delete(key);
    }
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

function sendClientEvent(client, event) {
    if (!event) {
        return false;
    }

    const eventId = event.id ? String(event.id) : '';
    if (eventId && client.sentIds.has(eventId)) {
        return false;
    }

    client.send(event);
    if (eventId) {
        client.sentIds.add(eventId);
    }
    return true;
}

function openStream(req, res) {
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

    const client = {
        userId,
        sentIds: new Set(),
        send(event) {
            writeEvent(res, 'message', event);
        }
    };
    let closed = false;

    const cleanup = function () {
        if (closed) {
            return;
        }

        closed = true;
        clearInterval(heartbeat);
        removeClient(userId, client);
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

    addClient(userId, client);
    console.info('SSE client connected', {
        userId,
        totalClients: getTotalClientCount(),
        channels: state.channels.size
    });
    writeEvent(res, 'ready', {userId, at: Date.now()});

    req.on('close', cleanup);
    req.on('error', cleanup);
}

function publish(req, res) {
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

    let delivered = 0;
    userIds.forEach(userId => {
        const clients = state.channels.get(String(userId));
        if (!clients) {
            return;
        }

        Array.from(clients).forEach(client => {
            try {
                if (sendClientEvent(client, event)) {
                    delivered += 1;
                }
            } catch (err) {
                clients.delete(client);
            }
        });
    });

    console.info('SSE publish', {
        userIds,
        delivered,
        totalClients: getTotalClientCount(),
        channels: state.channels.size
    });

    res.status(200).json({ok: true, delivered});
}

const router = express.Router();

router.get('/', (req, res, next) => {
    try {
        openStream(req, res);
    } catch (err) {
        next(err);
    }
});

router.post('/', (req, res, next) => {
    try {
        publish(req, res);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
