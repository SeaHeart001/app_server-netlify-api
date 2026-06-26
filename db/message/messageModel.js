const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({

    msg: {
        type: String,
        required: true
    },

    from: {
        type: String,
        required: true
    },

    to: {
        type: String,
    },

    msgType: { // 0.日志消息 1.新增消息 2.标识消息
        type: Number
    },

    createTime: {
        type: Date,
        default: function(){
            return new Date()
        }
    },
})

const Messages = mongoose.models.messages || mongoose.model('messages', messageSchema);

module.exports = {Messages}
