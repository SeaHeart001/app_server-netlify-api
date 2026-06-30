const {connect, getJwtSecret} = require('../../db/db');
const {WxUser} = require('../../db/wxuser/wxUserModel');
const jwt = require('jsonwebtoken');
const {error} = require('./index');

function sanitizeWxUser(user) {
    if (!user) {
        return null;
    }

    const doc = typeof user.toObject === 'function' ? user.toObject() : user;
    const {sessionKey, __v, ...safeUser} = doc;
    return safeUser;
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

module.exports = {getCurrentWxUser, sanitizeWxUser};
