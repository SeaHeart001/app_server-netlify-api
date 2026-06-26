const mongoose = require('mongoose');

const WxUserSchema = new mongoose.Schema({
    openid: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    unionid: {
        type: String,
        index: true,
        sparse: true
    },
    sessionKey: {
        type: String
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

WxUserSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const WxUser = mongoose.models.wxusers || mongoose.model('wxusers', WxUserSchema);

module.exports = {WxUser};
