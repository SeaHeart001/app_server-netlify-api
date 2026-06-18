const {Messages} = require('../../db/message/messageModel');
const {auth} = require('../utils/index')
const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}
async function list({event}) {
    let options = {
        from: event._user.relation,
        to: event._user.id,
        msgType: {$nin: [0]}
    };
    let data = await Messages.find(options).sort({createTime: -1})
    return {
        statusCode: 200,
        body: JSON.stringify({data})
    };
}

async function isRead({body}) {
    let ids = body.ids;
    let data = await Messages.find({_id: {$in: ids}});
    data.forEach(item => {
        item.msgType = 0
        item.save()
    })

    return {
        statusCode: 200,
        body: JSON.stringify({message: '消息已读'})
    };
}

async function remove({body}) {
    let ids = body.ids;
    await Messages.remove({_id: {$in: ids}})
    return {
        statusCode: 200,
        body: JSON.stringify({message: '删除成功'})
    };
}

const router = {
    list, remove, isRead
}

exports.handler = async function (event, context) {
    const path = event.path.split('/').pop();
    let body = event.body && JSON.parse(event.body);
    let authFlag = await auth(event);
    if (authFlag !== true) {
        return authFlag
    }
    return router[path]({event, body})
};