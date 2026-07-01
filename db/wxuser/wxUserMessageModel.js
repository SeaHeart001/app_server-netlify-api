const mongoose = require('mongoose');

const WxUserMessageSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        index: true
    },
    fromUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'wxusers',
        required: true,
        index: true
    },
    toUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'wxusers',
        required: true,
        index: true
    },
    relationKey: {
        type: String,
        default: '',
        index: true
    },
    title: {
        type: String,
        default: ''
    },
    content: {
        type: String,
        default: ''
    },
    payload: {
        type: mongoose.Schema.Types.Mixed,
        default: function () {
            return {};
        }
    },
    state: {
        type: String,
        default: 'pending',
        index: true
    },
    deliveredAt: {
        type: Date
    },
    readAt: {
        type: Date
    },
    handledAt: {
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

WxUserMessageSchema.index({toUser: 1, state: 1, createdAt: 1});
WxUserMessageSchema.index({fromUser: 1, toUser: 1, type: 1, state: 1});

WxUserMessageSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const WxUserMessage = mongoose.models.wxusermessages || mongoose.model('wxusermessages', WxUserMessageSchema);

module.exports = {WxUserMessage};
