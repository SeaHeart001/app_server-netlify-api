const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        index: true
    },
    fromUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
        required: true,
        index: true
    },
    toUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
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
    notifyChannels: {
        type: [String],
        default: function () {
            return [];
        }
    },
    deliveryState: {
        type: String,
        default: 'pending',
        index: true
    },
    subscribeState: {
        type: String,
        default: 'none',
        index: true
    },
    subscribeSentAt: {
        type: Date
    },
    subscribeError: {
        type: String,
        default: ''
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

MessageSchema.index({toUser: 1, actionState: 1, readAt: 1, createdAt: 1});
MessageSchema.index({toUser: 1, deliveryState: 1, createdAt: 1});
MessageSchema.index({fromUser: 1, toUser: 1, type: 1, actionState: 1});

MessageSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const Message = mongoose.models.messages || mongoose.model('messages', MessageSchema);

module.exports = {Message};
