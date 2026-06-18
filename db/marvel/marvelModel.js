const mongoose = require('mongoose');

const marvelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },

    avatar: {
        type: String,
        required: true
    },

    score: {
        // id为key, 存入即被点亮，需要两人同时存在
        type: Array,
        default: function () {
            return []
        }

    },

    createTime: {
        type: Date,
        default: function(){
            return new Date()
        }
    },
})

const Marvels = mongoose.model('marvels', marvelSchema);

module.exports = {Marvels}
