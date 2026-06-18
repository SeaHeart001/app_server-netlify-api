const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const {SECRET} = require('../db');

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

const User = mongoose.model('users', UserSchema)

const auth = (req, res, next) => {

    const raw = req.headers.authorization ? String(req.headers.authorization).split(' ').pop() : '';
    // 验证
    jwt.verify(raw, SECRET,  async function (err, decode){
        if(decode && decode.id){
            req._user = await User.findById(decode.id, {password: 0});
            next();
        }
        if(err){
            setTimeout(() => {
                res.status(422).send({
                    code: 0,
                    message: '身份信息异常或已过期'
                })
            }, 6000)

        }
    })
}

module.exports = {User, auth, SECRET}
