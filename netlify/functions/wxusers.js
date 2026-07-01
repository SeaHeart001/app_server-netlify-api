const {connect, getJwtSecret} = require('../../db/db');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {WxUserBinding} = require('../../db/wxuser/wxUserBindingModel');
const {WxUserMessage} = require('../../db/wxuser/wxUserMessageModel');
const {createHandler, error, getHeader} = require('../utils');
const {getCurrentWxUser, sanitizeWxUser} = require('../utils/wxAuth');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const BINDING_REQUEST = 'binding_request';
const BINDING_ACCEPTED = 'binding_accepted';
const BINDING_DECLINED = 'binding_declined';
const RELATION_CHANGED = 'relation_changed';

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw error(500, `服务配置缺少 ${name}`);
    }
    return value;
}

function pickProfile(body = {}) {
    const profile = {};
    const fields = ['nickname', 'avatarUrl', 'gender', 'city', 'province', 'country', 'profileSource'];

    fields.forEach(field => {
        if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
            profile[field] = body[field];
        }
    });

    if (profile.gender !== undefined) {
        profile.gender = Number(profile.gender) || 0;
    }

    return profile;
}

function getUserId(user) {
    return String(user && (user._id || user.id || user));
}

function toObjectId(id) {
    return mongoose.Types.ObjectId(id);
}

function assertValidObjectId(value, fieldName) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
}

function createRelationKey(firstUserId, secondUserId) {
    return [String(firstUserId), String(secondUserId)].sort().join(':');
}

function sanitizeAccount(user) {
    const safeUser = sanitizeWxUser(user) || {};
    return {
        id: String(safeUser._id || safeUser.id || ''),
        openid: safeUser.openid || '',
        nickname: safeUser.nickname || '',
        avatarUrl: safeUser.avatarUrl || '',
        updatedAt: safeUser.updatedAt || ''
    };
}

function getAccountName(user) {
    const account = sanitizeAccount(user);
    return account.nickname || account.openid || '微信用户';
}

async function findActiveBinding(userId) {
    return WxUserBinding.findOne({
        members: userId,
        status: 'active'
    }).lean();
}

async function findActiveBindingByRelationKey(relationKey) {
    return WxUserBinding.findOne({
        relationKey,
        status: 'active'
    }).lean();
}

async function formatBinding(binding, currentUserId) {
    if (!binding) {
        return null;
    }

    const memberIds = (binding.members || []).map(String);
    const users = await WxUser.find({_id: {$in: memberIds}}).lean();
    const accounts = memberIds
        .map(id => users.find(user => String(user._id) === id))
        .filter(Boolean)
        .map(sanitizeAccount);
    const partner = accounts.find(account => account.id !== String(currentUserId)) || null;

    return {
        id: String(binding._id),
        relationKey: binding.relationKey,
        members: accounts,
        partner,
        status: binding.status,
        updatedAt: binding.updatedAt
    };
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
        state: doc.state,
        title: doc.title,
        content: doc.content,
        relationKey: doc.relationKey || '',
        from: sanitizeAccount(fromUser),
        to: sanitizeAccount(toUser),
        relation,
        payload: doc.payload || {},
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt
    };
}

function signWxToken(user) {
    return jwt.sign(
        {
            id: String(user._id),
            openid: user.openid,
            type: 'wxuser'
        },
        getJwtSecret(),
        {expiresIn: process.env.JWT_EXPIRES_IN || '7d'}
    );
}

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
    } catch (err) {
        console.warn('SSE publish failed', err && err.message ? err.message : err);
    }
}

async function requestCode2Session(code) {
    const params = new URLSearchParams({
        appid: getRequiredEnv('WX_APP_ID'),
        secret: getRequiredEnv('WX_APP_SECRET'),
        js_code: code,
        grant_type: 'authorization_code'
    });
    const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);

    if (!res.ok) {
        throw error(502, '微信登录服务请求失败');
    }

    const data = await res.json();

    if (data.errcode) {
        throw error(412, data.errmsg || '微信登录凭证无效');
    }

    if (!data.openid || !data.session_key) {
        throw error(502, '微信登录服务返回异常');
    }

    return data;
}

async function activateBinding(firstUserId, secondUserId) {
    const now = new Date();
    const relationKey = createRelationKey(firstUserId, secondUserId);
    const memberIds = relationKey.split(':').map(toObjectId);

    await WxUserBinding.updateMany(
        {
            members: {$in: [toObjectId(firstUserId), toObjectId(secondUserId)]},
            status: 'active',
            relationKey: {$ne: relationKey}
        },
        {$set: {status: 'inactive', updatedAt: now}}
    );

    return WxUserBinding.findOneAndUpdate(
        {relationKey},
        {
            $set: {
                members: memberIds,
                status: 'active',
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: now
            }
        },
        {new: true, upsert: true, setDefaultsOnInsert: true}
    ).lean();
}

async function expireRelatedBindingRequests(messageId, userIds) {
    const now = new Date();
    await WxUserMessage.updateMany(
        {
            _id: {$ne: messageId},
            type: BINDING_REQUEST,
            state: 'pending',
            $or: [
                {fromUser: {$in: userIds}},
                {toUser: {$in: userIds}}
            ]
        },
        {$set: {state: 'expired', handledAt: now, updatedAt: now}}
    );
}

async function login({body}) {
    if (!body.code) {
        throw error(400, '缺少参数: code');
    }

    const session = await requestCode2Session(body.code);
    await connect();

    const now = new Date();
    const update = {
        openid: session.openid,
        sessionKey: session.session_key,
        unionid: session.unionid,
        lastLoginAt: now,
        updatedAt: now
    };

    Object.keys(update).forEach(key => {
        if (update[key] === undefined) {
            delete update[key];
        }
    });

    const user = await WxUser.findOneAndUpdate(
        {openid: session.openid},
        {$set: update, $setOnInsert: {createdAt: now}},
        {new: true, upsert: true, setDefaultsOnInsert: true}
    );

    return {
        token: signWxToken(user),
        user: sanitizeWxUser(user)
    };
}

async function me({event}) {
    const user = await getCurrentWxUser(event);
    return {user: sanitizeWxUser(user)};
}

async function profile({event, body}) {
    const user = await getCurrentWxUser(event);
    const nextProfile = pickProfile(body);

    Object.assign(user, nextProfile);
    await user.save();

    return {user: sanitizeWxUser(user)};
}

async function accounts({event, body}) {
    const user = await getCurrentWxUser(event);
    const keyword = String(body.keyword || '').trim();
    const query = {
        _id: {$ne: user._id}
    };

    if (keyword) {
        query.$or = [
            {nickname: {$regex: keyword, $options: 'i'}},
            {openid: {$regex: keyword, $options: 'i'}}
        ];
    }

    const users = await WxUser.find(query)
        .sort({updatedAt: -1})
        .limit(30)
        .lean();

    return {
        accounts: users.map(sanitizeAccount)
    };
}

async function relation({event}) {
    const user = await getCurrentWxUser(event);
    const binding = await findActiveBinding(user._id);

    return {
        relation: await formatBinding(binding, getUserId(user))
    };
}

async function bindRequest({event, body}) {
    const user = await getCurrentWxUser(event);
    const selectedUserId = String(body.userId || body.selectedUserId || '').trim();

    assertValidObjectId(selectedUserId, 'userId');

    if (selectedUserId === getUserId(user)) {
        throw error(400, '不能绑定自己');
    }

    const selectedUser = await WxUser.findById(selectedUserId);
    if (!selectedUser) {
        throw error(404, '账号不存在');
    }

    const relationKey = createRelationKey(user._id, selectedUser._id);
    const activeBinding = await findActiveBindingByRelationKey(relationKey);
    if (activeBinding) {
        return {
            relation: await formatBinding(activeBinding, getUserId(user)),
            message: '双方已绑定'
        };
    }

    const now = new Date();
    const requestMessage = await WxUserMessage.findOneAndUpdate(
        {
            type: BINDING_REQUEST,
            fromUser: user._id,
            toUser: selectedUser._id,
            relationKey,
            state: 'pending'
        },
        {
            $set: {
                title: '绑定申请',
                content: `${getAccountName(user)} 请求与你绑定账号`,
                payload: {
                    relationKey
                },
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: now
            }
        },
        {new: true, upsert: true, setDefaultsOnInsert: true}
    );

    const realtimeEvent = await formatMessageEvent(requestMessage, getUserId(selectedUser));
    await publishRealtimeEvent(realtimeEvent, [getUserId(selectedUser)], event);

    return {
        request: realtimeEvent,
        message: '已发送绑定申请，等待对方确认'
    };
}

async function bindAccept({event, body}) {
    const user = await getCurrentWxUser(event);
    const messageId = String(body.messageId || body.requestId || '').trim();

    assertValidObjectId(messageId, 'messageId');

    const requestMessage = await WxUserMessage.findOne({
        _id: messageId,
        type: BINDING_REQUEST,
        toUser: user._id,
        state: 'pending'
    });

    if (!requestMessage) {
        throw error(404, '绑定申请不存在或已处理');
    }

    const requester = await WxUser.findById(requestMessage.fromUser);
    if (!requester) {
        throw error(404, '申请账号不存在');
    }

    const binding = await activateBinding(user._id, requester._id);
    const now = new Date();

    requestMessage.state = 'accepted';
    requestMessage.handledAt = now;
    requestMessage.updatedAt = now;
    await requestMessage.save();

    await expireRelatedBindingRequests(requestMessage._id, [user._id, requester._id]);

    const notice = await WxUserMessage.create({
        type: BINDING_ACCEPTED,
        fromUser: user._id,
        toUser: requester._id,
        relationKey: binding.relationKey,
        title: '绑定成功',
        content: `${getAccountName(user)} 已同意绑定账号`,
        payload: {
            relationKey: binding.relationKey
        },
        state: 'pending',
        createdAt: now,
        updatedAt: now
    });

    const accepterRelation = await formatBinding(binding, getUserId(user));
    const requesterRelation = await formatBinding(binding, getUserId(requester));
    const requesterEvent = await formatMessageEvent(notice, getUserId(requester), {relation: requesterRelation});

    await publishRealtimeEvent(requesterEvent, [getUserId(requester)], event);
    await publishRealtimeEvent({
        id: `${RELATION_CHANGED}:${binding.relationKey}:${Date.now()}`,
        type: RELATION_CHANGED,
        title: '关系已更新',
        content: '绑定关系已完成',
        relationKey: binding.relationKey,
        relation: accepterRelation
    }, [getUserId(user)], event);

    return {
        relation: accepterRelation,
        message: '已完成绑定'
    };
}

async function bindDecline({event, body}) {
    const user = await getCurrentWxUser(event);
    const messageId = String(body.messageId || body.requestId || '').trim();

    assertValidObjectId(messageId, 'messageId');

    const requestMessage = await WxUserMessage.findOne({
        _id: messageId,
        type: BINDING_REQUEST,
        toUser: user._id,
        state: 'pending'
    });

    if (!requestMessage) {
        throw error(404, '绑定申请不存在或已处理');
    }

    const requester = await WxUser.findById(requestMessage.fromUser);
    const now = new Date();

    requestMessage.state = 'declined';
    requestMessage.handledAt = now;
    requestMessage.updatedAt = now;
    await requestMessage.save();

    if (requester) {
        const notice = await WxUserMessage.create({
            type: BINDING_DECLINED,
            fromUser: user._id,
            toUser: requester._id,
            relationKey: requestMessage.relationKey,
            title: '绑定申请已拒绝',
            content: `${getAccountName(user)} 已拒绝绑定账号`,
            payload: {
                relationKey: requestMessage.relationKey
            },
            state: 'pending',
            createdAt: now,
            updatedAt: now
        });

        await publishRealtimeEvent(await formatMessageEvent(notice, getUserId(requester)), [getUserId(requester)], event);
    }

    return {
        message: '已拒绝绑定申请'
    };
}

async function events({event}) {
    const user = await getCurrentWxUser(event);
    const messages = await WxUserMessage.find({
        toUser: user._id,
        state: 'pending',
        type: {$in: [BINDING_REQUEST, BINDING_ACCEPTED, BINDING_DECLINED]}
    })
        .sort({createdAt: 1})
        .limit(30)
        .lean();

    const realtimeEvents = [];
    for (const message of messages) {
        realtimeEvents.push(await formatMessageEvent(message, getUserId(user)));
    }

    return {
        events: realtimeEvents
    };
}

async function messageRead({event, body}) {
    const user = await getCurrentWxUser(event);
    const messageId = String(body.messageId || body.id || '').trim();

    assertValidObjectId(messageId, 'messageId');

    await WxUserMessage.updateOne(
        {
            _id: messageId,
            toUser: user._id,
            type: {$in: [BINDING_ACCEPTED, BINDING_DECLINED]}
        },
        {
            $set: {
                state: 'read',
                readAt: new Date(),
                updatedAt: new Date()
            }
        }
    );

    return {ok: true};
}

async function messageAction({event, body}) {
    const action = String(body.action || '').trim();

    if (action === 'accept') {
        return bindAccept({event, body});
    }

    if (action === 'decline') {
        return bindDecline({event, body});
    }

    if (action === 'read') {
        return messageRead({event, body});
    }

    throw error(400, '消息操作无效');
}

const router = {
    login,
    me,
    profile,
    accounts,
    relation,
    bind: bindRequest,
    'bind-request': bindRequest,
    events,
    'message-action': messageAction
};

const routes = Object.keys(router);

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
