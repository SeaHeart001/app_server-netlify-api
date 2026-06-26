const mongoose = require('mongoose');
const UserSchema = new mongoose.Schema({

    username:{
        type:String,
        required: true,
        unique: true //字段是否唯一
    },

    password:{
        type:String,
        required: true,
        set(val){
            // 通过bcryptjs对密码加密返回值 第一个值返回值， 第二个密码强度
            return require('bcryptjs').hashSync(val,10)
        }
    },

    name: {
        type: String,
        required: true
    },

    avatar: {
        type: String,
        // required: true
    },

    admin: {
        type: Number,
        default: 0
    },

    sex: {
        type: Number,
        required: true
    },

    relation: {
        type: String
    }

})

const User = mongoose.models.users || mongoose.model('users', UserSchema)

module.exports = {User}
