const {Marvels} = require('../../db/marvel/marvelModel');
const {Messages} = require('../../db/message/messageModel');
const {auth} = require('../utils/index')
const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}
async function add({body}){
    await Marvels.create({
        name: body.name,
        avatar: body.avatar,
        score: []
    })
    return {
        statusCode: 200,
        body: JSON.stringify({message: '添加成功'})
    };
}

async function set({event, body}){
    let marvel = await Marvels.findOne({_id: body.id});
    if(marvel.score.indexOf(event._user.id) === -1){
        marvel.score.push(event._user.id);
        // fixme 消息通知, 请求点亮
        let _msgDoc = {
            to: event._user.relation,
            from: event._user.id,
            msgType: 2
        }
        let sex = ''
        if(event._user.sex === 1){
            sex = '男'
        }else{
            sex = '女'
        }
        if(marvel.score.indexOf(event._user.relation) === -1){
            _msgDoc.msg = `你的${sex}朋友请求点亮“${marvel.name}”`
        }else{
            _msgDoc.msg = `恭喜你们，“${marvel.name}”已成功点亮`
        }
        marvel.save();
        await Messages.create(_msgDoc);
        return {
            statusCode: 200,
            body: JSON.stringify({message: '操作成功'})
        };
    }else{
        return {
            statusCode: 200,
            body: JSON.stringify({message: '请勿重复操作'})
        };
    }
}

async function list({event, body}) {
    let list = await Marvels.find({})
    let data = list;
    if(event._user.admin !== 1){
        data = [];
        // 计算得分
        list.forEach(item => {
            let doc = item._doc;
            let obj = {...doc}
            let num = 0;
            if(obj.score.indexOf(event._user.id) > -1){
                num++
            }
            if(obj.score.indexOf(event._user.relation) > -1){
                num++
            }
            obj.scoreNum = num;
            data.push(obj)
        })
        // 排序
        // data.sort((a, b) => {
        //     return b.scoreNum - a.scoreNum
        // })
    }
    return {
        statusCode: 200,
        body: JSON.stringify({data})
    };
}

async function remove({body}) {
    let ids = body.ids;
    await Marvels.remove({_id: {$in: ids}})
    return {
        statusCode: 200,
        body: JSON.stringify({message: '删除成功'})
    };
}

const router = {
    add, set, list, remove
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