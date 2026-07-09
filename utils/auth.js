const {connect, getJwtSecret} = require('../db');
const {User} = require('../db/model/userModel');
const jwt = require('jsonwebtoken');
const {error} = require('./index');

function sanitizeUser(user) {
    if (!user) {
        return null;
    }

    const doc = typeof user.toObject === 'function' ? user.toObject() : user;
    const {passwordHash, __v, ...safeUser} = doc;
    return safeUser;
}

function signUserToken(user) {
    return jwt.sign(
        {
            id: String(user._id),
            account: user.account,
            openid: user.openid,
            type: 'user'
        },
        getJwtSecret(),
        {expiresIn: process.env.JWT_EXPIRES_IN || '7d'}
    );
}

async function getCurrentUser(event) {
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

    if (!decoded || decoded.type !== 'user' || !decoded.id) {
        throw error(401, '身份信息异常或已过期');
    }

    await connect();

    const user = await User.findById(decoded.id);
    if (!user) {
        throw error(401, '身份信息异常或已过期');
    }

    return user;
}

module.exports = {getCurrentUser, sanitizeUser, signUserToken};
