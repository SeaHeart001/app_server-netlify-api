const {connect} = require('../../db');
const {User} = require('../../db/model/userModel');
const {createHandler, error} = require('../utils');
const {getCurrentUser, sanitizeUser, signUserToken} = require('../utils/auth');
const {
    findActiveBinding,
    formatBinding,
    getUserId,
    sanitizeAccount
} = require('../utils/relations');
const bcrypt = require('bcryptjs');

const ACCOUNT_MIN_LENGTH = 3;
const ACCOUNT_MAX_LENGTH = 64;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 128;
const TEXT_LIMITS = {
    nickname: 40,
    avatarUrl: 500,
    city: 80,
    province: 80,
    country: 80,
    profileSource: 40
};

function normalizeAccount(value) {
    return String(value || '').trim().toLowerCase();
}

function trimText(value, maxLength) {
    return String(value || '').trim().slice(0, maxLength);
}

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw error(500, `服务配置缺少 ${name}`);
    }
    return value;
}

function pickProfile(body = {}) {
    const profile = {};
    const fields = ['nickname', 'avatarUrl', 'gender', 'city', 'province', 'country', 'profileSource'];

    fields.forEach(field => {
        if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
            profile[field] = TEXT_LIMITS[field]
                ? trimText(body[field], TEXT_LIMITS[field])
                : body[field];
        }
    });

    if (profile.gender !== undefined) {
        profile.gender = Number(profile.gender) || 0;
    }

    return profile;
}

function assertAccount(account) {
    if (!account || account.length < ACCOUNT_MIN_LENGTH) {
        throw error(400, `账号至少需要 ${ACCOUNT_MIN_LENGTH} 个字符`);
    }

    if (account.length > ACCOUNT_MAX_LENGTH) {
        throw error(400, `账号不能超过 ${ACCOUNT_MAX_LENGTH} 个字符`);
    }
}

function assertPassword(password) {
    if (!password || password.length < PASSWORD_MIN_LENGTH) {
        throw error(400, `密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符`);
    }

    if (password.length > PASSWORD_MAX_LENGTH) {
        throw error(400, `密码不能超过 ${PASSWORD_MAX_LENGTH} 个字符`);
    }
}

function isDuplicateKeyError(err) {
    return err && Number(err.code) === 11000;
}

async function register({body}) {
    const account = normalizeAccount(body.account || body.username || body.mobile || body.email);
    const password = String(body.password || '');

    assertAccount(account);
    assertPassword(password);

    await connect();

    const existingUser = await User.findOne({account});
    if (existingUser) {
        throw error(409, '账号已存在');
    }

    let user;
    try {
        const now = new Date();
        user = await User.create({
            account,
            passwordHash: await bcrypt.hash(password, 10),
            loginSource: 'password',
            ...pickProfile(body),
            lastLoginAt: now,
            createdAt: now,
            updatedAt: now
        });
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            throw error(409, '账号已存在');
        }
        throw err;
    }

    return {
        token: signUserToken(user),
        user: sanitizeUser(user)
    };
}

async function loginByPassword(body) {
    const account = normalizeAccount(body.account || body.username || body.mobile || body.email);
    const password = String(body.password || '');

    assertAccount(account);
    assertPassword(password);

    await connect();

    const user = await User.findOne({account});
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw error(401, '账号或密码错误');
    }

    user.lastLoginAt = new Date();
    user.loginSource = 'password';
    await user.save();

    return {
        token: signUserToken(user),
        user: sanitizeUser(user)
    };
}

async function requestCodeSession(code) {
    const params = new URLSearchParams({
        appid: getRequiredEnv('WX_APP_ID'),
        secret: getRequiredEnv('WX_APP_SECRET'),
        js_code: code,
        grant_type: 'authorization_code'
    });
    const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);

    if (!res.ok) {
        throw error(502, '小程序登录服务请求失败');
    }

    const data = await res.json();

    if (data.errcode) {
        throw error(412, data.errmsg || '小程序登录凭证无效');
    }

    if (!data.openid) {
        throw error(502, '小程序登录服务返回异常');
    }

    return data;
}

async function loginByCode(body) {
    const code = String(body.code || '').trim();
    if (!code) {
        throw error(400, '缺少参数: code');
    }

    const session = await requestCodeSession(code);
    await connect();

    const now = new Date();
    const update = {
        openid: session.openid,
        unionid: session.unionid,
        loginSource: 'mini_program',
        lastLoginAt: now,
        updatedAt: now
    };

    Object.keys(update).forEach(key => {
        if (update[key] === undefined) {
            delete update[key];
        }
    });

    let user;
    try {
        user = await User.findOneAndUpdate(
            {openid: session.openid},
            {$set: update, $setOnInsert: {createdAt: now}},
            {new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true}
        );
    } catch (err) {
        if (isDuplicateKeyError(err)) {
            throw error(409, '用户身份已存在，请重新登录');
        }
        throw err;
    }

    return {
        token: signUserToken(user),
        user: sanitizeUser(user)
    };
}

async function login({body}) {
    if (body.code) {
        return loginByCode(body);
    }

    return loginByPassword(body);
}

async function me({event}) {
    const user = await getCurrentUser(event);
    return {user: sanitizeUser(user)};
}

async function profile({event, body}) {
    const user = await getCurrentUser(event);
    const nextProfile = pickProfile(body);

    Object.assign(user, nextProfile);
    await user.save();

    return {user: sanitizeUser(user)};
}

async function accounts({event, body}) {
    const user = await getCurrentUser(event);
    const keyword = String(body.keyword || '').trim();
    const query = {
        _id: {$ne: user._id}
    };

    if (keyword) {
        query.$or = [
            {nickname: {$regex: keyword, $options: 'i'}},
            {account: {$regex: keyword, $options: 'i'}},
            {openid: {$regex: keyword, $options: 'i'}}
        ];
    }

    const users = await User.find(query)
        .sort({updatedAt: -1})
        .limit(30)
        .lean();

    return {
        accounts: users.map(sanitizeAccount)
    };
}

async function relation({event}) {
    const user = await getCurrentUser(event);
    const binding = await findActiveBinding(user._id);

    return {
        relation: await formatBinding(binding, getUserId(user))
    };
}

const router = {
    register,
    login,
    me,
    profile,
    accounts,
    relation
};

const routes = Object.keys(router);

exports.handler = createHandler(router, {
    publicRoutes: routes,
    skipConnectRoutes: routes
});
