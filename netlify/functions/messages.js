const {Messages} = require('../../db/message/messageModel');
const {createHandler, error} = require('../utils');

async function list({event}) {
    if (!event._user.relation) {
        return {data: []};
    }

    const options = {
        from: event._user.relation,
        to: event._user.id,
        msgType: {$nin: [0]}
    };
    const data = await Messages.find(options).sort({createTime: -1});

    return {data};
}

async function isRead({event, body}) {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
        throw error(400, '缺少参数: ids');
    }

    await Messages.updateMany(
        {_id: {$in: ids}, to: event._user.id},
        {$set: {msgType: 0}}
    );

    return {message: '消息已读'};
}

async function remove({event, body}) {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length === 0) {
        throw error(400, '缺少参数: ids');
    }

    await Messages.deleteMany({
        _id: {$in: ids},
        $or: [{to: event._user.id}, {from: event._user.id}]
    });

    return {message: '删除成功'};
}

const router = {
    list,
    remove,
    isRead
};

exports.handler = createHandler(router);
