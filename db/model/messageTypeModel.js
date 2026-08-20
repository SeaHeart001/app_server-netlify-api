const mongoose = require('mongoose');

const MessageTypeSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    defaultTitle: {
        type: String,
        default: '消息通知'
    },
    defaultContent: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        default: 'interaction',
        enum: ['interaction']
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

MessageTypeSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

const MessageType = mongoose.models.messageTypes || mongoose.model('messageTypes', MessageTypeSchema);

module.exports = {MessageType};
