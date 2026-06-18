const {SECRET} = require('../../db/db');
const {User} = require('../../db/user/userModel');
const jwt = require('jsonwebtoken');

const auth = (event) => {
    const raw = event.headers.authorization ? String(event.headers.authorization).split(' ').pop() : '';
    // 验证
    return new Promise((resolve, reject) => {
        jwt.verify(raw, SECRET,  async function (err, decode){
            if(decode && decode.id){
                event._user = await User.findById(decode.id, {password: 0});
                resolve(true)
            }
            if(err){
                resolve({
                    statusCode: 412,
                    body: JSON.stringify({
                        message: '身份信息异常或已过期'
                    })
                })
            }
        })
    })
}

module.exports = { auth }