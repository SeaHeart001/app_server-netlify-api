const {WxMessage} = require('../../db/message/wxMessageModel');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {createHandler, error} = require('../utils');
const {getCurrentWxUser} = require('../utils/wxAuth');
const {
    BINDING_ACCEPTED,
    BINDING_DECLINED,
    RELATION_CHANGED,
    expireRelatedBindingRequests,
    formatMessageEvent,
    getPendingBindingQuery,
    getUnreadMessageQuery,
    markMessageDelivered,
    publishRealtimeEvent
} = require('../utils/wxMessages');
const {
    activateBinding,
    formatBinding,
    getAccountName,
    getUserId
} = require('../utils/wxRelations');

function assertValidObjectId(value, fieldName) {
    if (!value || !require('mongoose').Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
}

async function readMessage({event, body}) {
    const user = await getCurrentWxUser(event);
    const messageId = String(body.messageId || body.id || '').trim();

    assertValidObjectId(messageId, 'messageId');

    await WxMessage.updateOne(
        {
            _id: messageId,
            toUser: user._id,
            readAt: {$exists: false}
        },
        {
            $set: {
                readAt: new Date(),
                updatedAt: new Date()
            }
        }
    );

    return {ok: true};
}

async function bindAccept({event, body}) {
    const user = await getCurrentWxUser(event);
    const messageId = String(body.messageId || body.requestId || '').trim();

    assertValidObjectId(messageId, 'messageId');

    const requestMessage = await WxMessage.findOne(getPendingBindingQuery({
        _id: messageId,
        toUser: user._id
    }));

    if (!requestMessage) {
        throw error(404, '绑定申请不存在或已处理');
    }

    const requester = await WxUser.findById(requestMessage.fromUser);
    if (!requester) {
        throw error(404, '申请账号不存在');
    }

    const binding = await activateBinding(user._id, requester._id);
    const now = new Date();

    requestMessage.actionState = 'accepted';
    requestMessage.handledAt = now;
    requestMessage.readAt = now;
    requestMessage.updatedAt = now;
    await requestMessage.save();

    await expireRelatedBindingRequests(requestMessage._id, [user._id, requester._id]);

    const notice = await WxMessage.create({
        type: BINDING_ACCEPTED,
        fromUser: user._id,
        toUser: requester._id,
        relationKey: binding.relationKey,
        title: '绑定成功',
        content: `${getAccountName(user)} 已同意绑定账号`,
        payload: {
            relationKey: binding.relationKey
        },
        actionState: 'none',
        deliveryState: 'pending',
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

    const requestMessage = await WxMessage.findOne(getPendingBindingQuery({
        _id: messageId,
        toUser: user._id
    }));

    if (!requestMessage) {
        throw error(404, '绑定申请不存在或已处理');
    }

    const requester = await WxUser.findById(requestMessage.fromUser);
    const now = new Date();

    requestMessage.actionState = 'declined';
    requestMessage.handledAt = now;
    requestMessage.readAt = now;
    requestMessage.updatedAt = now;
    await requestMessage.save();

    if (requester) {
        const notice = await WxMessage.create({
            type: BINDING_DECLINED,
            fromUser: user._id,
            toUser: requester._id,
            relationKey: requestMessage.relationKey,
            title: '绑定申请已拒绝',
            content: `${getAccountName(user)} 拒绝了绑定申请`,
            payload: {
                relationKey: requestMessage.relationKey
            },
            actionState: 'none',
            deliveryState: 'pending',
            createdAt: now,
            updatedAt: now
        });

        await publishRealtimeEvent(await formatMessageEvent(notice, getUserId(requester)), [getUserId(requester)], event);
    }

    return {
        message: '已拒绝绑定申请'
    };
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
        return readMessage({event, body});
    }

    throw error(400, '消息操作无效');
}

async function events({event}) {
    const user = await getCurrentWxUser(event);
    const messages = await WxMessage.find(getUnreadMessageQuery(user._id))
        .sort({createdAt: 1})
        .limit(30)
        .lean();

    const realtimeEvents = [];
    for (const message of messages) {
        realtimeEvents.push(await formatMessageEvent(message, getUserId(user)));
    }

    await Promise.all(messages.map(message => markMessageDelivered(message._id)));

    return {
        events: realtimeEvents
    };
}

const router = {
    action: messageAction,
    events
};

const routes = Object.keys(router);

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
