const mongoose = require('mongoose');

const WxMessageSchema = new mongoose.Schema({
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
    actionState: {
        type: String,
        default: 'none',
        index: true
    },
    deliveryState: {
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

WxMessageSchema.index({toUser: 1, actionState: 1, readAt: 1, createdAt: 1});
WxMessageSchema.index({toUser: 1, deliveryState: 1, createdAt: 1});
WxMessageSchema.index({fromUser: 1, toUser: 1, type: 1, actionState: 1});

WxMessageSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const WxMessage = mongoose.models.wxusermessages || mongoose.model('wxusermessages', WxMessageSchema);

module.exports = {WxMessage};
