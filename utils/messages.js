const mongoose = require('mongoose');
const {User} = require('../db/model/userModel');
const {Message} = require('../db/model/messageModel');
const {getJwtSecret} = require('../db');
const {getHeader} = require('./index');
const {findActiveBindingByRelationKey, formatBinding, sanitizeAccount} = require('./relations');
const {sendMiniProgramSubscribeMessage} = require('./subscribeMessages');

const MESSAGE_TYPES = {
    BINDING_REQUEST: 'binding_request',
    BINDING_ACCEPTED: 'binding_accepted',
    BINDING_DECLINED: 'binding_declined',
    RELATION_CHANGED: 'relation_changed',
    RELATION_MESSAGE: 'relation_message'
};

const ACTION_STATES = {
    PENDING: 'pending',
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    EXPIRED: 'expired',
    NONE: 'none'
};

const ACTION_KINDS = {
    RELATION_BIND: 'relation.bind'
};

const DELIVERY_STATES = {
    PENDING: 'pending',
    DELIVERED: 'delivered'
};

const NOTIFY_CHANNELS = {
    REALTIME: 'realtime',
    SUBSCRIBE: 'subscribe'
};

const EVENT_KINDS = {
    MESSAGE: 'message',
    SYNC: 'sync'
};

function isLocalHost(host) {
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(String(host || ''));
}

function getSseEndpoint(event) {
    if (process.env.SSE_EDGE_URL) {
        return process.env.SSE_EDGE_URL;
    }

    const host = getHeader(event, 'host');
    if (host) {
        const protocol = getHeader(event, 'x-forwarded-proto') || (isLocalHost(host) ? 'http' : 'https');
        return `${protocol}://${host}/.netlify/edge-functions/sse`;
    }

    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    if (baseUrl) {
        return `${baseUrl.replace(/\/$/, '')}/.netlify/edge-functions/sse`;
    }

    return '';
}

async function markMessageDelivered(messageId) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId)) || !Message || !Message.updateOne) {
        return;
    }

    await Message.updateOne(
        {
            _id: messageId,
            deliveryState: {$ne: DELIVERY_STATES.DELIVERED}
        },
        {
            $set: {
                deliveryState: DELIVERY_STATES.DELIVERED,
                deliveredAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
}

function getPendingBindingQuery(extra = {}) {
    return {
        ...extra,
        type: MESSAGE_TYPES.BINDING_REQUEST,
        actionState: ACTION_STATES.PENDING
    };
}

function getUnreadMessageQuery(userId) {
    return {
        toUser: userId,
        readAt: {$exists: false}
    };
}

async function expireRelatedBindingRequests(messageId, userIds) {
    const now = new Date();
    await Message.updateMany(
        {
            _id: {$ne: messageId},
            type: MESSAGE_TYPES.BINDING_REQUEST,
            actionState: ACTION_STATES.PENDING,
            $or: [
                {fromUser: {$in: userIds}},
                {toUser: {$in: userIds}}
            ]
        },
        {$set: {actionState: ACTION_STATES.EXPIRED, handledAt: now, updatedAt: now}}
    );
}

async function formatMessageEvent(message, currentUserId, options = {}) {
    if (!message) {
        return null;
    }

    const doc = typeof message.toObject === 'function' ? message.toObject() : message;
    const userIds = [doc.fromUser, doc.toUser].filter(Boolean).map(String);
    const users = await User.find({_id: {$in: userIds}}).lean();
    const fromUser = users.find(user => String(user._id) === String(doc.fromUser));
    const toUser = users.find(user => String(user._id) === String(doc.toUser));
    const relation = options.relation !== undefined
        ? options.relation
        : doc.relationKey && (
            doc.type === MESSAGE_TYPES.BINDING_ACCEPTED ||
            doc.type === MESSAGE_TYPES.RELATION_CHANGED
        )
            ? await formatBinding(await findActiveBindingByRelationKey(doc.relationKey), currentUserId)
            : null;

    return {
        id: String(doc._id),
        type: doc.type,
        eventKind: EVENT_KINDS.MESSAGE,
        actionState: doc.actionState || ACTION_STATES.NONE,
        deliveryState: doc.deliveryState || DELIVERY_STATES.PENDING,
        notifyChannels: doc.notifyChannels || [],
        subscribeState: doc.subscribeState || 'none',
        subscribeSentAt: doc.subscribeSentAt || null,
        subscribeError: doc.subscribeError || '',
        readAt: doc.readAt || null,
        handledAt: doc.handledAt || null,
        title: doc.title,
        content: doc.content,
        relationKey: doc.relationKey || '',
        from: fromUser ? sanitizeAccount(fromUser) : {
            id: '',
            account: '',
            openid: '',
            nickname: '',
            avatarUrl: '',
            updatedAt: ''
        },
        to: toUser ? sanitizeAccount(toUser) : {
            id: '',
            account: '',
            openid: '',
            nickname: '',
            avatarUrl: '',
            updatedAt: ''
        },
        relation,
        payload: doc.payload || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
}

async function publishRealtimeEvent(realtimeEvent, userIds, event) {
    const targets = Array.from(new Set((userIds || []).map(String).filter(Boolean)));
    const endpoint = getSseEndpoint(event);

    if (!targets.length || !endpoint) {
        return {ok: false, delivered: 0, skipped: true};
    }

    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-sse-secret': process.env.SSE_PUBLISH_SECRET || getJwtSecret()
            },
            body: JSON.stringify({
                userIds: targets,
                event: realtimeEvent
            })
        });

        if (!res.ok) {
            console.warn('SSE publish failed', {
                status: res.status,
                body: await res.text().catch(() => '')
            });
            return {ok: false, delivered: 0, failed: true, status: res.status};
        }

        const data = await res.json().catch(() => ({}));
        console.info('SSE publish result', {
            targets,
            delivered: data.delivered || 0,
            endpoint
        });

        if (Number(data.delivered || 0) > 0 && realtimeEvent && realtimeEvent.id) {
            await markMessageDelivered(realtimeEvent.id);
        }

        return {
            ok: true,
            delivered: Number(data.delivered || 0),
            endpoint
        };
    } catch (err) {
        console.warn('SSE publish failed', {
            endpoint,
            error: err && err.message ? err.message : String(err)
        });
        return {ok: false, delivered: 0, failed: true, error: err && err.message ? err.message : String(err)};
    }
}

async function notifyMessageEvent(message, currentUserId, userIds, event, formatOptions = {}) {
    const realtimeEvent = await formatMessageEvent(message, currentUserId, formatOptions);
    const realtimeResult = await publishRealtimeEvent(realtimeEvent, userIds, event);
    const delivered = Number((realtimeResult && realtimeResult.delivered) || 0);

    if (delivered > 0) {
        return realtimeEvent;
    }

    try {
        await sendMiniProgramSubscribeMessage({
            message,
            messageEvent: realtimeEvent
        });
    } catch (err) {
        console.warn('Mini program subscribe notification failed', err && err.message ? err.message : err);
    }

    return realtimeEvent;
}

module.exports = {
    ACTION_STATES,
    ACTION_KINDS,
    DELIVERY_STATES,
    EVENT_KINDS,
    MESSAGE_TYPES,
    NOTIFY_CHANNELS,
    expireRelatedBindingRequests,
    formatMessageEvent,
    getPendingBindingQuery,
    getUnreadMessageQuery,
    markMessageDelivered,
    notifyMessageEvent,
    publishRealtimeEvent
};
