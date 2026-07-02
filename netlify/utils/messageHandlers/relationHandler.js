const {Message} = require('../../../db/model/messageModel');
const {User} = require('../../../db/model/userModel');
const {error} = require('../index');
const {
    ACTION_STATES,
    DELIVERY_STATES,
    MESSAGE_TYPES,
    expireRelatedBindingRequests,
    formatMessageEvent,
    publishRealtimeEvent
} = require('../messages');
const {
    activateBinding,
    formatBinding,
    getAccountName,
    getUserId
} = require('../relations');

async function handleRelationBindAccepted({event, message, user}) {
    const requester = await User.findById(message.fromUser);
    if (!requester) {
        throw error(404, '申请账号不存在');
    }

    const binding = await activateBinding(user._id, requester._id);
    const now = new Date();

    await expireRelatedBindingRequests(message._id, [user._id, requester._id]);

    const notice = await Message.create({
        type: MESSAGE_TYPES.BINDING_ACCEPTED,
        fromUser: user._id,
        toUser: requester._id,
        relationKey: binding.relationKey,
        title: '绑定成功',
        content: `${getAccountName(user)} 已同意绑定账号`,
        payload: {
            relationKey: binding.relationKey
        },
        actionState: ACTION_STATES.NONE,
        deliveryState: DELIVERY_STATES.PENDING,
        createdAt: now,
        updatedAt: now
    });

    const accepterRelation = await formatBinding(binding, getUserId(user));
    const requesterRelation = await formatBinding(binding, getUserId(requester));
    const requesterEvent = await formatMessageEvent(notice, getUserId(requester), {relation: requesterRelation});

    await publishRealtimeEvent(requesterEvent, [getUserId(requester)], event);
    await publishRealtimeEvent({
        id: `${MESSAGE_TYPES.RELATION_CHANGED}:${binding.relationKey}:${Date.now()}`,
        type: MESSAGE_TYPES.RELATION_CHANGED,
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

async function handleRelationBindDeclined({event, message, user}) {
    const requester = await User.findById(message.fromUser);
    const now = new Date();

    if (requester) {
        const notice = await Message.create({
            type: MESSAGE_TYPES.BINDING_DECLINED,
            fromUser: user._id,
            toUser: requester._id,
            relationKey: message.relationKey,
            title: '绑定申请已拒绝',
            content: `${getAccountName(user)} 拒绝了绑定申请`,
            payload: {
                relationKey: message.relationKey
            },
            actionState: ACTION_STATES.NONE,
            deliveryState: DELIVERY_STATES.PENDING,
            createdAt: now,
            updatedAt: now
        });

        await publishRealtimeEvent(await formatMessageEvent(notice, getUserId(requester)), [getUserId(requester)], event);
    }

    return {
        message: '已拒绝绑定申请'
    };
}

module.exports = {
    handleRelationBindAccepted,
    handleRelationBindDeclined
};
