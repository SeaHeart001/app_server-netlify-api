const mongoose = require('mongoose');
const {User} = require('../db/model/userModel');
const {Message} = require('../db/model/messageModel');
const {error} = require('../utils');
const {getCurrentUser} = require('../utils/auth');
const {
    ACTION_STATES,
    DELIVERY_STATES,
    MESSAGE_TYPES,
    NOTIFY_CHANNELS,
    notifyMessageEvent
} = require('../utils/messages');
const {ACTION_KINDS} = require('../utils/messageHandlers/messageActions');
const {
    createRelationKey,
    findActiveBinding,
    findActiveBindingByRelationKey,
    formatBinding,
    getAccountName,
    getUserId
} = require('../utils/relations');

const RELATION_MESSAGE_TITLE_MAX_LENGTH = 20;
const RELATION_MESSAGE_CONTENT_MAX_LENGTH = 60;
const DEFAULT_RELATION_MESSAGE_TITLE = '消息通知';
const DEFAULT_RELATION_MESSAGE_CONTENT = '对方拍了拍你';

function assertValidObjectId(value, fieldName) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
}

function normalizeRelationMessageTitle(value) {
    const title = String(value || '').trim();
    return (title || DEFAULT_RELATION_MESSAGE_TITLE).slice(0, RELATION_MESSAGE_TITLE_MAX_LENGTH);
}

function normalizeRelationMessageContent(value) {
    const content = String(value || '').trim();
    return (content || DEFAULT_RELATION_MESSAGE_CONTENT).slice(0, RELATION_MESSAGE_CONTENT_MAX_LENGTH);
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

    const now = new Date();
    const title = normalizeRelationMessageTitle(body.title);
    const content = normalizeRelationMessageContent(body.content || body.message || body.text);
    const notice = await Message.create({
        type: MESSAGE_TYPES.RELATION_MESSAGE,
        fromUser: user._id,
        toUser: targetUser._id,
        relationKey: binding.relationKey,
        title,
        content,
        payload: {
            relationKey: binding.relationKey
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
        event: realtimeEvent
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
