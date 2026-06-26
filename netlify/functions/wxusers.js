const {connect, getJwtSecret} = require('../../db/db');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {createHandler, error} = require('../utils');
const jwt = require('jsonwebtoken');

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw error(500, `服务配置缺少 ${name}`);
    }
    return value;
}

function sanitizeWxUser(user) {
    if (!user) {
        return null;
    }

    const doc = typeof user.toObject === 'function' ? user.toObject() : user;
    const {sessionKey, __v, ...safeUser} = doc;
    return safeUser;
}

function pickProfile(body = {}) {
    const profile = {};
    const fields = ['nickname', 'avatarUrl', 'gender', 'city', 'province', 'country', 'profileSource'];

    fields.forEach(field => {
        if (body[field] !== undefined && body[field] !== null && body[field] !== '') {
            profile[field] = body[field];
        }
    });

    if (profile.gender !== undefined) {
        profile.gender = Number(profile.gender) || 0;
    }

    return profile;
}

function signWxToken(user) {
    return jwt.sign(
        {
            id: String(user._id),
            openid: user.openid,
            type: 'wxuser'
        },
        getJwtSecret(),
        {expiresIn: process.env.JWT_EXPIRES_IN || '7d'}
    );
}

async function requestCode2Session(code) {
    const params = new URLSearchParams({
        appid: getRequiredEnv('WX_APP_ID'),
        secret: getRequiredEnv('WX_APP_SECRET'),
        js_code: code,
        grant_type: 'authorization_code'
    });
    const res = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params.toString()}`);

    if (!res.ok) {
        throw error(502, '微信登录服务请求失败');
    }

    const data = await res.json();

    if (data.errcode) {
        throw error(412, data.errmsg || '微信登录凭证无效');
    }

    if (!data.openid || !data.session_key) {
        throw error(502, '微信登录服务返回异常');
    }

    return data;
}

async function login({body}) {
    if (!body.code) {
        throw error(400, '缺少参数: code');
    }

    const session = await requestCode2Session(body.code);
    await connect();

    const now = new Date();
    const update = {
        openid: session.openid,
        sessionKey: session.session_key,
        unionid: session.unionid,
        lastLoginAt: now,
        updatedAt: now
    };

    Object.keys(update).forEach(key => {
        if (update[key] === undefined) {
            delete update[key];
        }
    });

    const user = await WxUser.findOneAndUpdate(
        {openid: session.openid},
        {$set: update, $setOnInsert: {createdAt: now}},
        {new: true, upsert: true, setDefaultsOnInsert: true}
    );

    return {
        token: signWxToken(user),
        user: sanitizeWxUser(user)
    };
}

async function getCurrentWxUser(event) {
    const headerKey = Object.keys(event.headers || {}).find(key => key.toLowerCase() === 'authorization');
    const raw = headerKey ? String(event.headers[headerKey]).split(' ').pop() : '';

    if (!raw) {
        throw error(401, '请先登录');
    }

    let decoded;
    try {
        decoded = jwt.verify(raw, getJwtSecret());
    } catch (err) {
        throw error(401, '身份信息异常或已过期');
    }

    if (!decoded || decoded.type !== 'wxuser' || !decoded.id) {
        throw error(401, '身份信息异常或已过期');
    }

    await connect();

    const user = await WxUser.findById(decoded.id);
    if (!user) {
        throw error(401, '身份信息异常或已过期');
    }

    return user;
}

async function me({event}) {
    const user = await getCurrentWxUser(event);
    return {user: sanitizeWxUser(user)};
}

async function profile({event, body}) {
    const user = await getCurrentWxUser(event);
    const nextProfile = pickProfile(body);

    Object.assign(user, nextProfile);
    await user.save();

    return {user: sanitizeWxUser(user)};
}

const router = {
    login,
    me,
    profile
};

exports.handler = createHandler(router, {
    publicRoutes: ['login', 'me', 'profile'],
    skipConnectRoutes: ['login', 'me', 'profile']
});
