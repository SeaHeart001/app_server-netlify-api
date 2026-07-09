const {error} = require('../index');
const {handleRelationBindAccepted, handleRelationBindDeclined} = require('./relationHandler');

const ACTION_KINDS = {
    RELATION_BIND: 'relation.bind'
};

const ACCEPT_HANDLERS = {
    [ACTION_KINDS.RELATION_BIND]: handleRelationBindAccepted
};

const DECLINE_HANDLERS = {
    [ACTION_KINDS.RELATION_BIND]: handleRelationBindDeclined
};

function getActionKind(message) {
    return message && message.payload && message.payload.actionKind
        ? String(message.payload.actionKind)
        : '';
}

async function runAcceptedBusiness(context) {
    const actionKind = getActionKind(context.message);
    const handler = ACCEPT_HANDLERS[actionKind];

    if (!handler) {
        throw error(400, '该消息类型不支持同意操作');
    }

    return handler(context);
}

async function runDeclinedBusiness(context) {
    const actionKind = getActionKind(context.message);
    const handler = DECLINE_HANDLERS[actionKind];

    if (!handler) {
        return {message: '已拒绝'};
    }

    return handler(context);
}

module.exports = {
    ACTION_KINDS,
    runAcceptedBusiness,
    runDeclinedBusiness
};
