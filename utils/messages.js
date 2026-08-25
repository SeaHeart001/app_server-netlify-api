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

// 送达回执判定：推送 SSE 后等待一个窗口，窗口内消息被前端确认
// （readAt 写入或 deliveryState 标记）即视为“接收方在小程序内”，
// 不发订阅消息；窗口内无确认则降级为微信订阅消息。
// 回执来源：通知类消息弹窗时前端自动调 /messages/action（read），
// 重连拉取 /messages/events 未读时后端标记 deliveryState，均为现有行为，前端零新增调用
const DEFAULT_DELIVERY_ACK_WAIT_SECONDS = 5;

// Ably 广播骨干：Netlify Edge 是多 isolate 环境，各 isolate 的内存连接表互不可见，
// 发布端经 Ably REST 扇出后，由持有连接的 isolate 订阅接收（见 realtime/ablyBridge.mjs）
const ABLY_REST_HOST = 'https://rest.ably.io';
const ABLY_MESSAGE_NAME = 'realtime';
const DELIVERY_BACKGROUND_PATH = '/.netlify/functions/message-delivery-background';
const DELIVERY_BACKGROUND_REQUEST_TIMEOUT = 3000;

function isLocalHost(host) {
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(String(host || ''));
}

function getRequestBaseUrl(event) {
    const host = getHeader(event, 'host');
    if (host) {
        const protocol = getHeader(event, 'x-forwarded-proto') || (isLocalHost(host) ? 'http' : 'https');
        return `${protocol}://${host}`;
    }

    const baseUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
    if (baseUrl) {
        return baseUrl.replace(/\/$/, '');
    }

    return '';
}

function getSseEndpoint(event) {
    if (process.env.SSE_EDGE_URL) {
        return process.env.SSE_EDGE_URL;
    }

    const baseUrl = getRequestBaseUrl(event);
    return baseUrl ? `${baseUrl}/.netlify/edge-functions/sse` : '';
}

function isNetlifyFunctionEvent(event) {
    return Boolean(
        process.env.NETLIFY ||
        process.env.SITE_ID ||
        (event && /^\/.netlify\/functions\//.test(String(event.path || '')))
    );
}

function getDeliveryBackgroundEndpoint(event) {
    const baseUrl = getRequestBaseUrl(event);
    return baseUrl ? `${baseUrl}${DELIVERY_BACKGROUND_PATH}` : '';
}

async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {...options, signal: controller.signal});
    } finally {
        clearTimeout(timeout);
    }
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

async function publishViaAbly(realtimeEvent, targets, apiKey) {
    const authorization = `Basic ${Buffer.from(apiKey).toString('base64')}`;
    const publishedTargets = [];

    // 频道约定：每用户一个频道 user:{userId}，与 edge 侧订阅一致
    for (const userId of targets) {
        const channel = encodeURIComponent(`user:${userId}`);

        try {
            const res = await fetch(`${ABLY_REST_HOST}/channels/${channel}/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    authorization
                },
                body: JSON.stringify({
                    name: ABLY_MESSAGE_NAME,
                    data: JSON.stringify(realtimeEvent)
                })
            });

            if (!res.ok) {
                console.warn('Ably publish failed', {
                    userId,
                    status: res.status,
                    body: await res.text().catch(() => '')
                });
                continue;
            }

            publishedTargets.push(userId);
        } catch (err) {
            console.warn('Ably publish failed', {
                userId,
                error: err && err.message ? err.message : String(err)
            });
        }
    }

    const failedTargets = targets.filter(userId => !publishedTargets.includes(userId));
    console.info('Ably publish result', {targets, published: publishedTargets.length, failedTargets});
    return {
        ok: failedTargets.length === 0,
        published: publishedTargets.length,
        publishedTargets,
        failedTargets,
        via: 'ably'
    };
}

async function publishViaSse(realtimeEvent, targets, event) {
    const endpoint = getSseEndpoint(event);

    if (!endpoint) {
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

async function publishRealtimeEvent(realtimeEvent, userIds, event) {
    const targets = Array.from(new Set((userIds || []).map(String).filter(Boolean)));

    if (!targets.length) {
        return {ok: false, delivered: 0, skipped: true};
    }

    // 优先 Ably 广播通道：保证事件能到达持有连接的任意 isolate。
    // Ably 部分失败时，只将失败频道降级到原 SSE 直推路径，避免静默丢失。
    const ablyApiKey = process.env.ABLY_API_KEY;
    if (ablyApiKey) {
        const ablyResult = await publishViaAbly(realtimeEvent, targets, ablyApiKey);
        if (ablyResult.ok) {
            return ablyResult;
        }

        const fallbackResult = await publishViaSse(realtimeEvent, ablyResult.failedTargets, event);
        console.warn('Ably publish degraded to SSE', {
            failedTargets: ablyResult.failedTargets,
            fallbackOk: fallbackResult.ok
        });
        return {
            ...fallbackResult,
            ably: ablyResult,
            via: 'ably+sse-fallback'
        };
    }

    return publishViaSse(realtimeEvent, targets, event);
}

function getDeliveryAckWaitMs() {
    const seconds = Number(process.env.DELIVERY_ACK_WAIT_SECONDS || DEFAULT_DELIVERY_ACK_WAIT_SECONDS);
    const validSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_DELIVERY_ACK_WAIT_SECONDS;
    return validSeconds * 1000;
}

// 等待送达回执：先睡完判定窗口，再查消息最新状态。
// readAt 已写（前端收到消息后自动确认）或 deliveryState 已标记
// （本地直推成功 / 客户端拉取未读）都视为“接收方在小程序内收到了”；
// 查库判定不依赖 edge isolate 内存状态，天然免疫多 isolate 路由问题
async function waitForDeliveryAck(messageId) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId))) {
        return false;
    }

    await new Promise(resolve => setTimeout(resolve, getDeliveryAckWaitMs()));

    const doc = await Message.findById(messageId)
        .select('readAt deliveryState')
        .lean();

    return Boolean(doc && (doc.readAt || doc.deliveryState === DELIVERY_STATES.DELIVERED));
}

async function completeDeliveryAttempt(messageId) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId))) {
        return {ok: false, skipped: true, reason: 'invalid_message_id'};
    }

    if (await waitForDeliveryAck(messageId)) {
        await markMessageDelivered(messageId);
        return {ok: true, delivered: true, skipped: true, reason: 'acknowledged'};
    }

    // Claim the fallback only once. A Netlify background retry or a local
    // process restart must not send duplicate WeChat subscription messages.
    const message = await Message.findOneAndUpdate(
        {
            _id: messageId,
            readAt: {$exists: false},
            deliveryState: {$ne: DELIVERY_STATES.DELIVERED},
            subscribeState: 'none'
        },
        {
            $set: {
                subscribeState: 'pending',
                subscribeError: '',
                updatedAt: new Date()
            }
        },
        {new: true}
    );

    if (!message) {
        return {ok: true, skipped: true, reason: 'already_acknowledged_or_processed'};
    }

    const messageEvent = await formatMessageEvent(message, String(message.toUser));
    return sendMiniProgramSubscribeMessage({message, messageEvent});
}

function scheduleLocalDeliveryAttempt(messageId) {
    const timer = setTimeout(() => {
        completeDeliveryAttempt(messageId).catch(err => {
            console.warn('Local delivery fallback failed', err && err.message ? err.message : err);
        });
    }, 0);

    if (timer && typeof timer.unref === 'function') {
        timer.unref();
    }
}

async function queueDeliveryAttempt(messageId, event) {
    if (!messageId || !mongoose.Types.ObjectId.isValid(String(messageId))) {
        return {ok: false, skipped: true, reason: 'invalid_message_id'};
    }

    if (!isNetlifyFunctionEvent(event)) {
        scheduleLocalDeliveryAttempt(messageId);
        return {ok: true, queued: true, via: 'local_timer'};
    }

    const endpoint = getDeliveryBackgroundEndpoint(event);
    if (!endpoint) {
        console.warn('Delivery fallback could not be queued: missing Netlify function endpoint');
        return {ok: false, queued: false, reason: 'missing_endpoint'};
    }

    try {
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-message-delivery-secret': process.env.SSE_PUBLISH_SECRET || getJwtSecret()
            },
            body: JSON.stringify({messageId: String(messageId)})
        }, DELIVERY_BACKGROUND_REQUEST_TIMEOUT);

        if (!res.ok && res.status !== 202) {
            throw new Error(`background function responded ${res.status}`);
        }

        return {ok: true, queued: true, via: 'netlify_background'};
    } catch (err) {
        console.warn('Delivery fallback could not be queued', {
            messageId: String(messageId),
            error: err && err.message ? err.message : String(err)
        });
        return {ok: false, queued: false, reason: 'background_enqueue_failed'};
    }
}

async function notifyMessageEvent(message, currentUserId, userIds, event, formatOptions = {}) {
    const realtimeEvent = await formatMessageEvent(message, currentUserId, formatOptions);

    // SSE 实时推送：在线用户通过此通道在小程序内实时接收（Ably 或本地通道）
    await publishRealtimeEvent(realtimeEvent, userIds, event);

    // 送达确认和订阅消息降级不能阻塞业务接口。Netlify 通过 Background
    // Function 等待 ACK；Express 进程则用不阻塞响应的本地定时任务处理。
    await queueDeliveryAttempt(realtimeEvent && realtimeEvent.id, event);

    return realtimeEvent;
}

module.exports = {
    ACTION_STATES,
    ACTION_KINDS,
    completeDeliveryAttempt,
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
    publishRealtimeEvent,
    queueDeliveryAttempt,
    waitForDeliveryAck
};
