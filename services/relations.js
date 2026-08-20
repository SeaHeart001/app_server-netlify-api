const mongoose = require('mongoose');
const {User} = require('../db/model/userModel');
const {Message} = require('../db/model/messageModel');
const {MessageType} = require('../db/model/messageTypeModel');
const {error} = require('../utils');
const {getCurrentUser} = require('../utils/auth');
const {
    ACTION_KINDS,
    ACTION_STATES,
    DELIVERY_STATES,
    MESSAGE_TYPES,
    NOTIFY_CHANNELS,
    notifyMessageEvent
} = require('../utils/messages');
const {ANALYTICS_TYPES} = require('../utils/features/analyticsEvents');
const {
    createRelationKey,
    findActiveBinding,
    findActiveBindingByRelationKey,
    formatBinding,
    getAccountName,
    getUserId
} = require('../utils/relations');

function assertValidObjectId(value, fieldName) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
}

async function bindRequest({event, body}) {
    const user = await getCurrentUser(event);
    const selectedUserId = String(body.userId || body.selectedUserId || '').trim();

    assertValidObjectId(selectedUserId, 'userId');

    if (selectedUserId === getUserId(user)) {
        throw error(400, '不能绑定自己');
    }

    const selectedUser = await User.findById(selectedUserId);
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
    const requestMessage = await Message.create({
        type: MESSAGE_TYPES.BINDING_REQUEST,
        fromUser: user._id,
        toUser: selectedUser._id,
        relationKey,
        title: '绑定申请',
        content: `${getAccountName(user)} 请求与你绑定账号`,
        payload: {
            actionKind: ACTION_KINDS.RELATION_BIND,
            relationKey
        },
        actionState: ACTION_STATES.PENDING,
        notifyChannels: [NOTIFY_CHANNELS.REALTIME, NOTIFY_CHANNELS.SUBSCRIBE],
        deliveryState: DELIVERY_STATES.PENDING,
        createdAt: now,
        updatedAt: now
    });

    const realtimeEvent = await notifyMessageEvent(requestMessage, getUserId(selectedUser), [getUserId(selectedUser)], event);

    return {
        request: realtimeEvent,
        message: '已发送绑定申请，等待对方确认'
    };
}

async function sendMessage({event, body}) {
    const user = await getCurrentUser(event);
    const binding = await findActiveBinding(user._id);

    if (!binding) {
        throw error(404, '当前账号还没有绑定关系');
    }

    const currentUserId = getUserId(user);
    const targetUserId = (binding.members || [])
        .map(String)
        .find(memberId => memberId !== currentUserId);

    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
        throw error(500, '绑定关系数据异常');
    }

    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
        throw error(404, '绑定账号不存在');
    }

    const messageTypeDoc = await MessageType.findOne({code: body.messageType || 'pat'});
    if (!messageTypeDoc) {
        throw error(400, '消息类型不存在');
    }

    const now = new Date();
    const title = messageTypeDoc.defaultTitle;
    const content = messageTypeDoc.defaultContent;

    const notice = await Message.create({
        type: MESSAGE_TYPES.RELATION_MESSAGE,
        fromUser: user._id,
        toUser: targetUser._id,
        relationKey: binding.relationKey,
        title,
        content,
        messageType: messageTypeDoc.code,
        payload: {
            relationKey: binding.relationKey,
            messageType: messageTypeDoc.code
        },
        actionState: ACTION_STATES.NONE,
        notifyChannels: [NOTIFY_CHANNELS.REALTIME, NOTIFY_CHANNELS.SUBSCRIBE],
        deliveryState: DELIVERY_STATES.PENDING,
        createdAt: now,
        updatedAt: now
    });

    const realtimeEvent = await notifyMessageEvent(
        notice,
        getUserId(targetUser),
        [getUserId(targetUser)],
        event,
        {relation: await formatBinding(binding, getUserId(targetUser))}
    );

    return {
        message: '已发送',
        event: realtimeEvent,
        targetUserId: getUserId(targetUser),
        _analytics: [{
            userId: currentUserId,
            type: ANALYTICS_TYPES.RELATION_MESSAGE,
            properties: {
                targetUserId: getUserId(targetUser),
                messageType: messageTypeDoc.code,
                messageTypeName: messageTypeDoc.name
            }
        }]
    };
}

const router = {
    'bind-request': bindRequest,
    message: sendMessage
};

const routes = Object.keys(router);

module.exports = {
    bindRequest,
    sendMessage,
    router,
    routes
};
