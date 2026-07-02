const mongoose = require('mongoose');
const {User} = require('../../db/model/userModel');
const {Message} = require('../../db/model/messageModel');
const {createHandler, error} = require('../utils');
const {getCurrentUser} = require('../utils/auth');
const {
    ACTION_STATES,
    DELIVERY_STATES,
    MESSAGE_TYPES,
    formatMessageEvent,
    publishRealtimeEvent
} = require('../utils/messages');
const {ACTION_KINDS} = require('../utils/messageHandlers/messageActions');
const {
    createRelationKey,
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
        deliveryState: DELIVERY_STATES.PENDING,
        createdAt: now,
        updatedAt: now
    });

    const realtimeEvent = await formatMessageEvent(requestMessage, getUserId(selectedUser));
    await publishRealtimeEvent(realtimeEvent, [getUserId(selectedUser)], event);

    return {
        request: realtimeEvent,
        message: '已发送绑定申请，等待对方确认'
    };
}

const router = {
    'bind-request': bindRequest
};

const routes = Object.keys(router);

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
