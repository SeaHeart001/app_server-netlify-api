const {User, SECRET} = require('../../db/user/userModel');
const {Messages} = require('../../db/message/messageModel');
const {auth} = require('../utils/index')
const jwt = require('jsonwebtoken');
const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
async function login({body}) {
    // your server-side functionality
    const user = await User.findOne({
        username: body.username
    })

    if (!user) {
        return {
            headers,
            statusCode: 412,
            body: JSON.stringify({
                message: "用户不存在",
            })
        };
    }

    const isPasswordValid = require('bcryptjs').compareSync(
        body.password,
        user.password
    )

    if (!isPasswordValid) {
        return {
            headers,
            statusCode: 412,
            body: JSON.stringify({
                message: "密码错误或无效",
            })
        };
    }

    const token = jwt.sign({
        id: String(user._id)
    }, SECRET);

    let {username, name, avatar, admin, sex, relation, _id} = user;

    let relationUser;

    if (relation) {
        relationUser = await User.findOne({
            _id: relation
        }, {password: 0})
    }
    if(admin !== 1){
        await Messages.create({
            msg: `“${name}”已上线`,
            to: relation,
            from: _id,
            msgType: 0
        })
    }

    // 生成token
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({
            token,
            user: {username, name, avatar, admin, sex, _id, relation: relationUser}
        })
    };
}

async function register({body}) {
    const resUser = await User.findOne({
        username: body.username
    })

    if (resUser) {
        return {
            headers,
            statusCode: 412,
            body: JSON.stringify({
                message: "账号已存在",
            })
        };
    }
    await User.create({...body})
    // 返回出去
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({
            message: "注册成功",
        })
    };
}

async function set({body}){
    const user = await User.findOne({_id: body.id});
    for(let k in user){
        user[k] = body[k]
    }
    user.save();
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({
            message: "修改成功",
        })
    };
}

async function list({body}) {
    let options = {admin: 0};
    const page = body.page || 1;
    const size = body.size || 5;
    let total = await User.count(options);
    let list = await User.find(options).skip((parseInt(page) - 1) * parseInt(size)).limit(parseInt(size))
    let data = [];
    for(let i=0; i< list.length; i++){
        let obj = {...list[i]._doc};
        obj.relationUser = await User.findOne({_id: list[i].relation}, {password: 0})
        data.push(obj)
    }
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({data, total})
    };
}

async function remove({body}) {
    let ids = body.ids;
    await User.remove({_id: {$in: ids}})
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({message: '删除成功'})
    };
}

async function relation({body}) {
    let id_0 = body.ids[0];
    let id_1 = body.ids[1];
    let data_0 = await User.findOne({_id: id_0}, {relation: 0});
    let data_1 = await User.findOne({_id: id_1}, {relation: 0});
    data_0.relation = data_1.id;
    data_0.save();
    data_1.relation = data_0.id
    data_1.save();
    return {
        headers,
        statusCode: 200,
        body: JSON.stringify({message: '匹配成功'})
    };
}

const router = {
    register, login, list, remove, relation, set
}

exports.handler = async function (event, context) {
    const path = event.path.split('/').pop();
    let body = event.body && JSON.parse(event.body);
    let authFlag = await auth(event);
    if (path !== 'login' && authFlag !== true) {
        return {headers, ...authFlag}
    }
    return router[path]({event, body})
};