const {getJwtSecret} = require('../../db/db');
const {Messages} = require('../../db/message/messageModel');
const {User} = require('../../db/user/userModel');
const {createHandler, error} = require('../utils');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

function assertRequired(body, fields) {
    const missing = fields.filter(field => body[field] === undefined || body[field] === null || body[field] === '');
    if (missing.length > 0) {
        throw error(400, `缺少参数: ${missing.join(', ')}`);
    }
}

function sanitizeUser(user) {
    if (!user) {
        return null;
    }

    const doc = typeof user.toObject === 'function' ? user.toObject() : user;
    const {password, __v, ...safeUser} = doc;
    return safeUser;
}

async function login({body}) {
    assertRequired(body, ['username', 'password']);

    const user = await User.findOne({username: body.username});

    if (!user) {
        throw error(412, '用户不存在');
    }

    const isPasswordValid = bcrypt.compareSync(body.password, user.password);

    if (!isPasswordValid) {
        throw error(412, '密码错误或无效');
    }

    const token = jwt.sign(
        {id: String(user._id)},
        getJwtSecret(),
        {expiresIn: process.env.JWT_EXPIRES_IN || '7d'}
    );

    const safeUser = sanitizeUser(user);
    let relationUser = null;

    if (user.relation) {
        relationUser = sanitizeUser(await User.findById(user.relation).select('-password'));
    }

    if (user.admin !== 1 && user.relation) {
        await Messages.create({
            msg: `“${user.name}”已上线`,
            to: user.relation,
            from: user.id,
            msgType: 0
        });
    }

    return {
        token,
        user: {...safeUser, relation: relationUser}
    };
}

async function register({body}) {
    assertRequired(body, ['username', 'password', 'name', 'sex']);

    const exists = await User.findOne({username: body.username});

    if (exists) {
        throw error(412, '账号已存在');
    }

    await User.create({
        username: body.username,
        password: body.password,
        name: body.name,
        avatar: body.avatar || '',
        sex: body.sex,
        admin: body.admin === 1 ? 1 : 0,
        relation: body.relation
    });

    return {message: '注册成功'};
}

async function set({event, body}) {
    const id = body.id || event._user.id;

    if (event._user.admin !== 1 && String(id) !== String(event._user.id)) {
        throw error(403, '没有权限修改该用户');
    }

    const user = await User.findById(id);
    if (!user) {
        throw error(404, '用户不存在');
    }

    const fields = event._user.admin === 1
        ? ['username', 'password', 'name', 'avatar', 'sex', 'admin', 'relation']
        : ['password', 'name', 'avatar', 'sex'];

    fields.forEach(field => {
        if (body[field] !== undefined) {
            user[field] = body[field];
        }
    });

    await user.save();

    return {message: '修改成功'};
}

async function list({body}) {
    const page = Math.max(parseInt(body.page || 1, 10), 1);
    const size = Math.min(Math.max(parseInt(body.size || 5, 10), 1), 100);
    const options = {admin: 0};

    const total = await User.countDocuments(options);
    const users = await User.find(options)
        .select('-password')
        .skip((page - 1) * size)
        .limit(size)
        .lean();

    const data = await Promise.all(users.map(async user => {
        const relationUser = user.relation
            ? await User.findById(user.relation).select('-password').lean()
            : null;

        return {...user, relationUser};
    }));

    return {data, total};
}

async function remove({event, body}) {
    const ids = Array.isArray(body.ids) ? body.ids : [];

    if (ids.length === 0) {
        throw error(400, '缺少参数: ids');
    }

    await User.deleteMany({
        _id: {$in: ids.filter(id => String(id) !== String(event._user.id))}
    });

    return {message: '删除成功'};
}

async function relation({body}) {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    if (ids.length !== 2) {
        throw error(400, 'ids 必须包含两个用户 ID');
    }

    const [data0, data1] = await Promise.all([
        User.findById(ids[0]),
        User.findById(ids[1])
    ]);

    if (!data0 || !data1) {
        throw error(404, '用户不存在');
    }

    data0.relation = data1.id;
    data1.relation = data0.id;

    await Promise.all([data0.save(), data1.save()]);

    return {message: '匹配成功'};
}

const router = {
    register,
    login,
    list,
    remove,
    relation,
    set
};

exports.handler = createHandler(router, {
    publicRoutes: ['login'],
    adminRoutes: ['register', 'list', 'remove', 'relation']
});
