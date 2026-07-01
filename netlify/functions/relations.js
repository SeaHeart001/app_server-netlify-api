const mongoose = require('mongoose');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {WxMessage} = require('../../db/message/wxMessageModel');
const {createHandler, error} = require('../utils');
const {getCurrentWxUser} = require('../utils/wxAuth');
const {
    BINDING_REQUEST,
    formatMessageEvent,
    publishRealtimeEvent
} = require('../utils/wxMessages');
const {
    createRelationKey,
    findActiveBindingByRelationKey,
    formatBinding,
    getAccountName,
    getUserId
} = require('../utils/wxRelations');

function assertValidObjectId(value, fieldName) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
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
    const requestMessage = await WxMessage.create({
        type: BINDING_REQUEST,
        fromUser: user._id,
        toUser: selectedUser._id,
        relationKey,
        title: '绑定申请',
        content: `${getAccountName(user)} 请求与你绑定账号`,
        payload: {
            relationKey
        },
        actionState: 'pending',
        deliveryState: 'pending',
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
