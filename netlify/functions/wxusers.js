const {connect, getJwtSecret} = require('../../db/db');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const {WxUserBinding} = require('../../db/wxuser/wxUserBindingModel');
const {createHandler, error} = require('../utils');
const {getCurrentWxUser, sanitizeWxUser} = require('../utils/wxAuth');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

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
            profile[field] = body[field];
        }
    });

    if (profile.gender !== undefined) {
        profile.gender = Number(profile.gender) || 0;
    }

    return profile;
}

function getUserId(user) {
    return String(user && (user._id || user.id || user));
}

function createRelationKey(firstUserId, secondUserId) {
    return [String(firstUserId), String(secondUserId)].sort().join(':');
}

function sanitizeAccount(user) {
    const safeUser = sanitizeWxUser(user) || {};
    return {
        id: String(safeUser._id || safeUser.id || ''),
        openid: safeUser.openid || '',
        nickname: safeUser.nickname || '',
        avatarUrl: safeUser.avatarUrl || '',
        updatedAt: safeUser.updatedAt || ''
    };
}

async function findActiveBinding(userId) {
    return WxUserBinding.findOne({
        members: userId,
        status: 'active'
    }).lean();
}

async function formatBinding(binding, currentUserId) {
    if (!binding) {
        return null;
    }

    const memberIds = (binding.members || []).map(String);
    const users = await WxUser.find({_id: {$in: memberIds}}).lean();
    const accounts = memberIds
        .map(id => users.find(user => String(user._id) === id))
        .filter(Boolean)
        .map(sanitizeAccount);
    const partner = accounts.find(account => account.id !== String(currentUserId)) || null;

    return {
        id: String(binding._id),
        relationKey: binding.relationKey,
        members: accounts,
        partner,
        status: binding.status,
        updatedAt: binding.updatedAt
    };
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

async function accounts({event, body}) {
    const user = await getCurrentWxUser(event);
    const keyword = String(body.keyword || '').trim();
    const query = {
        _id: {$ne: user._id}
    };

    if (keyword) {
        query.$or = [
            {nickname: {$regex: keyword, $options: 'i'}},
            {openid: {$regex: keyword, $options: 'i'}}
        ];
    }

    const users = await WxUser.find(query)
        .sort({updatedAt: -1})
        .limit(30)
        .lean();

    return {
        accounts: users.map(sanitizeAccount)
    };
}

async function relation({event}) {
    const user = await getCurrentWxUser(event);
    const binding = await findActiveBinding(user._id);

    return {
        relation: await formatBinding(binding, getUserId(user))
    };
}

async function bind({event, body}) {
    const user = await getCurrentWxUser(event);
    const selectedUserId = String(body.userId || body.selectedUserId || '').trim();

    if (!selectedUserId) {
        throw error(400, '缺少参数: userId');
    }

    if (selectedUserId === getUserId(user)) {
        throw error(400, '不能绑定自己');
    }

    const selectedUser = await WxUser.findById(selectedUserId);
    if (!selectedUser) {
        throw error(404, '账号不存在');
    }

    const now = new Date();
    const relationKey = createRelationKey(user._id, selectedUser._id);
    const memberIds = relationKey.split(':').map(id => mongoose.Types.ObjectId(id));

    await WxUserBinding.updateMany(
        {
            members: {$in: [user._id, selectedUser._id]},
            status: 'active',
            relationKey: {$ne: relationKey}
        },
        {$set: {status: 'inactive', updatedAt: now}}
    );

    const binding = await WxUserBinding.findOneAndUpdate(
        {relationKey},
        {
            $set: {
                members: memberIds,
                status: 'active',
                updatedAt: now
            },
            $setOnInsert: {
                createdAt: now
            }
        },
        {new: true, upsert: true, setDefaultsOnInsert: true}
    ).lean();

    return {
        relation: await formatBinding(binding, getUserId(user))
    };
}

const router = {
    login,
    me,
    profile,
    accounts,
    relation,
    bind
};

exports.handler = createHandler(router, {
    publicRoutes: ['login', 'me', 'profile', 'accounts', 'relation', 'bind'],
    skipConnectRoutes: ['login', 'me', 'profile', 'accounts', 'relation', 'bind']
});
