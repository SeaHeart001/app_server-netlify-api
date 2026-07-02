const mongoose = require('mongoose');

const LOGIN_SOURCES = ['password', 'mini_program'];

const UserSchema = new mongoose.Schema({
    account: {
        type: String,
        unique: true,
        index: true,
        sparse: true,
        trim: true,
        lowercase: true
    },
    passwordHash: {
        type: String,
        default: ''
    },
    openid: {
        type: String,
        unique: true,
        index: true,
        sparse: true
    },
    unionid: {
        type: String,
        index: true,
        sparse: true
    },
    loginSource: {
        type: String,
        enum: [...LOGIN_SOURCES, ''],
        default: ''
    },
    nickname: {
        type: String,
        default: ''
    },
    avatarUrl: {
        type: String,
        default: ''
    },
    gender: {
        type: Number,
        default: 0
    },
    city: {
        type: String,
        default: ''
    },
    province: {
        type: String,
        default: ''
    },
    country: {
        type: String,
        default: ''
    },
    profileSource: {
        type: String,
        default: ''
    },
    lastLoginAt: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: function () {
            return new Date();
        }
    },
    updatedAt: {
        type: Date,
        default: function () {
            return new Date();
        }
    }
});

UserSchema.pre('validate', function (next) {
    if (!this.account && !this.openid) {
        next(new Error('user requires account or openid'));
        return;
    }

    if (this.account && !this.passwordHash) {
        next(new Error('password user requires passwordHash'));
        return;
    }

    next();
});

UserSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const User = mongoose.models.users || mongoose.model('users', UserSchema);

module.exports = {LOGIN_SOURCES, User};
