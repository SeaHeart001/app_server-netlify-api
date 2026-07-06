const mongoose = require('mongoose');
const {Message} = require('../db/model/messageModel');
const {error} = require('../netlify/utils');
const {getCurrentUser} = require('../netlify/utils/auth');
const {
    ACTION_STATES,
    formatMessageEvent,
    getUnreadMessageQuery,
    markMessageDelivered
} = require('../netlify/utils/messages');
const {getUserId} = require('../netlify/utils/relations');
const {runAcceptedBusiness, runDeclinedBusiness} = require('../netlify/utils/messageHandlers/messageActions');

const MESSAGE_ACTIONS = {
    ACCEPT: 'accept',
    DECLINE: 'decline',
    READ: 'read'
};

function assertValidObjectId(value, fieldName) {
    if (!value || !mongoose.Types.ObjectId.isValid(value)) {
        throw error(400, `参数 ${fieldName} 无效`);
    }
}

async function readMessage({event, body}) {
    const user = await getCurrentUser(event);
    const messageId = String(body.messageId || body.id || '').trim();

    assertValidObjectId(messageId, 'messageId');

    await Message.updateOne(
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

async function markMessageHandled(message, action) {
    const now = new Date();
    message.actionState = action === MESSAGE_ACTIONS.ACCEPT
        ? ACTION_STATES.ACCEPTED
        : ACTION_STATES.DECLINED;
    message.handledAt = now;
    message.readAt = now;
    message.updatedAt = now;
    await message.save();
}

async function handleBusinessAction({event, body, action}) {
    const user = await getCurrentUser(event);
    const messageId = String(body.messageId || body.requestId || '').trim();

    assertValidObjectId(messageId, 'messageId');

    const message = await Message.findOne({
        _id: messageId,
        toUser: user._id,
        actionState: ACTION_STATES.PENDING
    });

    if (!message) {
        throw error(404, '消息不存在或已处理');
    }

    let result;
    if (action === MESSAGE_ACTIONS.ACCEPT) {
        result = await runAcceptedBusiness({event, body, user, message});
    } else {
        result = await runDeclinedBusiness({event, body, user, message});
    }

    await markMessageHandled(message, action);
    return result;
}

async function messageAction({event, body}) {
    const action = String(body.action || '').trim();

    if (action === MESSAGE_ACTIONS.READ) {
        return readMessage({event, body});
    }

    if (action === MESSAGE_ACTIONS.ACCEPT || action === MESSAGE_ACTIONS.DECLINE) {
        return handleBusinessAction({event, body, action});
    }

    throw error(400, '消息操作无效');
}

async function events({event}) {
    const user = await getCurrentUser(event);
    const messages = await Message.find(getUnreadMessageQuery(user._id))
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

module.exports = {
    events,
    messageAction,
    router,
    routes
};
