const mongoose = require('mongoose');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {WxMessage} = require('../../db/message/wxMessageModel');
const {getJwtSecret} = require('../../db/db');
const {getHeader} = require('./index');
const {findActiveBindingByRelationKey, formatBinding} = require('./wxRelations');

const BINDING_REQUEST = 'binding_request';
const BINDING_ACCEPTED = 'binding_accepted';
const BINDING_DECLINED = 'binding_declined';
const RELATION_CHANGED = 'relation_changed';

function getSseEndpoint(event) {
    if (process.env.SSE_EDGE_URL) {
        return process.env.SSE_EDGE_URL;
    }

    const host = getHeader(event, 'host');
    if (host) {
        const protocol = getHeader(event, 'x-forwarded-proto') || (host.indexOf('localhost') > -1 ? 'http' : 'https');
        return `${protocol}://${host}/.netlify/edge-functions/sse`;
    }

    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    if (baseUrl) {
        return `${baseUrl.replace(/\/$/, '')}/.netlify/edge-functions/sse`;
    }

    return '';
}

async function markMessageDelivered(messageId) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId)) || !WxMessage || !WxMessage.updateOne) {
        return;
    }

    await WxMessage.updateOne(
        {
            _id: messageId,
            deliveryState: {$ne: 'delivered'}
        },
        {
            $set: {
                deliveryState: 'delivered',
                deliveredAt: new Date(),
                updatedAt: new Date()
            }
        }
    );
}

function getPendingBindingQuery(extra = {}) {
    return {
        ...extra,
        type: BINDING_REQUEST,
        actionState: 'pending'
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
    await WxMessage.updateMany(
        {
            _id: {$ne: messageId},
            type: BINDING_REQUEST,
            actionState: 'pending',
            $or: [
                {fromUser: {$in: userIds}},
                {toUser: {$in: userIds}}
            ]
        },
        {$set: {actionState: 'expired', handledAt: now, updatedAt: now}}
    );
}

async function formatMessageEvent(message, currentUserId, options = {}) {
    if (!message) {
        return null;
    }

    const doc = typeof message.toObject === 'function' ? message.toObject() : message;
    const userIds = [doc.fromUser, doc.toUser].filter(Boolean).map(String);
    const users = await WxUser.find({_id: {$in: userIds}}).lean();
    const fromUser = users.find(user => String(user._id) === String(doc.fromUser));
    const toUser = users.find(user => String(user._id) === String(doc.toUser));
    const relation = options.relation !== undefined
        ? options.relation
        : doc.relationKey && (doc.type === BINDING_ACCEPTED || doc.type === RELATION_CHANGED)
            ? await formatBinding(await findActiveBindingByRelationKey(doc.relationKey), currentUserId)
            : null;

    return {
        id: String(doc._id),
        type: doc.type,
        actionState: doc.actionState || 'none',
        deliveryState: doc.deliveryState || 'pending',
        readAt: doc.readAt || null,
        handledAt: doc.handledAt || null,
        title: doc.title,
        content: doc.content,
        relationKey: doc.relationKey || '',
        from: fromUser ? {
            id: String(fromUser._id),
            openid: fromUser.openid || '',
            nickname: fromUser.nickname || '',
            avatarUrl: fromUser.avatarUrl || '',
            updatedAt: fromUser.updatedAt || ''
        } : {
            id: '',
            openid: '',
            nickname: '',
            avatarUrl: '',
            updatedAt: ''
        },
        to: toUser ? {
            id: String(toUser._id),
            openid: toUser.openid || '',
            nickname: toUser.nickname || '',
            avatarUrl: toUser.avatarUrl || '',
            updatedAt: toUser.updatedAt || ''
        } : {
            id: '',
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
        return;
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
            return;
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
    } catch (err) {
        console.warn('SSE publish failed', err && err.message ? err.message : err);
    }
}

module.exports = {
    BINDING_ACCEPTED,
    BINDING_DECLINED,
    BINDING_REQUEST,
    RELATION_CHANGED,
    expireRelatedBindingRequests,
    formatMessageEvent,
    getPendingBindingQuery,
    getUnreadMessageQuery,
    markMessageDelivered,
    publishRealtimeEvent
};
