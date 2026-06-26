const {Messages} = require('../../db/message/messageModel');
const {Tasks} = require('../../db/task/taskModel');
const {createHandler, error} = require('../utils');

async function add({event, body}) {
    if (!body.tasks) {
        throw error(400, '缺少参数: tasks');
    }

    await Tasks.create({
        tasks: body.tasks,
        creator: event._user.id,
    });

    if (event._user.relation) {
        const sex = event._user.sex === 1 ? '男' : '女';
        await Messages.create({
            msg: `你的${sex}朋友新增了一条时光轴记录`,
            to: event._user.relation,
            from: event._user.id,
            msgType: 1
        });
    }

    return {message: '添加成功'};
}

async function list({event, body}) {
    const ids = [event._user.id];
    if (event._user.relation) {
        ids.push(event._user.relation);
    }

    const options = {creator: {$in: ids}};
    const page = Math.max(parseInt(body.page || 1, 10), 1);
    const size = Math.min(Math.max(parseInt(body.size || 10, 10), 1), 100);
    const total = await Tasks.countDocuments(options);
    const data = await Tasks.find(options)
        .sort({createTime: -1})
        .skip((page - 1) * size)
        .limit(size);

    return {total, data};
}

async function remove({event, body}) {
    if (!body.id) {
        throw error(400, '缺少参数: id');
    }

    const options = event._user.admin === 1
        ? {_id: body.id}
        : {_id: body.id, creator: event._user.id};
    const result = await Tasks.deleteOne(options);

    if (result.deletedCount === 0) {
        throw error(404, '记录不存在或无权删除');
    }

    return {message: '删除成功'};
}

const router = {
    add,
    list,
    remove
};

exports.handler = createHandler(router);
