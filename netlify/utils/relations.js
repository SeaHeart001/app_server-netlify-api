const mongoose = require('mongoose');
const {User} = require('../../db/model/userModel');
const {Relation} = require('../../db/model/relationModel');
const {sanitizeUser} = require('./auth');

function getUserId(user) {
    return String(user && (user._id || user.id || user));
}

function createRelationKey(firstUserId, secondUserId) {
    return [String(firstUserId), String(secondUserId)].sort().join(':');
}

function sanitizeAccount(user) {
    const safeUser = sanitizeUser(user) || {};
    return {
        id: String(safeUser._id || safeUser.id || ''),
        account: safeUser.account || '',
        openid: safeUser.openid || '',
        nickname: safeUser.nickname || '',
        avatarUrl: safeUser.avatarUrl || '',
        updatedAt: safeUser.updatedAt || ''
    };
}

function getAccountName(user) {
    const account = sanitizeAccount(user);
    return account.nickname || account.account || account.openid || '用户';
}

async function findActiveBinding(userId) {
    return Relation.findOne({
        members: userId,
        status: 'active'
    }).lean();
}

async function findActiveBindingByRelationKey(relationKey) {
    return Relation.findOne({
        relationKey,
        status: 'active'
    }).lean();
}

async function formatBinding(binding, currentUserId) {
    if (!binding) {
        return null;
    }

    const memberIds = (binding.members || []).map(String);
    const users = await User.find({_id: {$in: memberIds}}).lean();
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

async function activateBinding(firstUserId, secondUserId) {
    const now = new Date();
    const relationKey = createRelationKey(firstUserId, secondUserId);
    const memberIds = relationKey.split(':').map(id => mongoose.Types.ObjectId(id));

    await Relation.updateMany(
        {
            members: {$in: [mongoose.Types.ObjectId(firstUserId), mongoose.Types.ObjectId(secondUserId)]},
            status: 'active',
            relationKey: {$ne: relationKey}
        },
        {$set: {status: 'inactive', updatedAt: now}}
    );

    return Relation.findOneAndUpdate(
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
}

module.exports = {
    activateBinding,
    createRelationKey,
    findActiveBinding,
    findActiveBindingByRelationKey,
    formatBinding,
    getAccountName,
    getUserId,
    sanitizeAccount
};
