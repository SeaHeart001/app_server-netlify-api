const {Tasks} = require('../../db/task/taskModel');
const {Messages} = require('../../db/message/messageModel');
const {auth} = require('../utils/index')
const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
async function add({event, body}){
    await Tasks.create({
        tasks: body.tasks,
        creator: event._user.id,
    })
    // fixme 此处设计一个消息通知
    let sex = ''
    if(event._user.sex === 1){
        sex = '男'
    }else{
        sex = '女'
    }
    await Messages.create({
        msg: `你的${sex}朋友新增了一条时光轴记录`,
        to: event._user.relation,
        from: event._user.id,
        msgType: 1
    })

    return {
        statusCode: 200,
        body: JSON.stringify({message: '添加成功'})
    };
}

async function list({event, body}) {
    let ids = [];
    ids.push(event._user.id);
    event._user.relation && ids.push(event._user.relation);
    let options = {creator: {$in: ids}}
    const page = body.page || 1;
    const size = body.size || 10;
    let total = await Tasks.count(options)
    let data = await Tasks.find(options).sort({createTime: -1}).skip((parseInt(page) - 1) * parseInt(size)).limit(parseInt(size))
    return {
        statusCode: 200,
        body: JSON.stringify({total, data})
    };
}

async function remove({body}) {
    let id = body.id;
    await Tasks.deleteOne({_id: id})
    return {
        statusCode: 200,
        body: JSON.stringify({message: '删除成功'})
    };
}

const router = {
    add, list, remove
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