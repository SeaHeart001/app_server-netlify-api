const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const {User, auth, SECRET} = require('../db/user/userModel');

const {resData} = require('../utils/utils')

// 登录
router.post('/login', async (req, res) => {
    const user = await User.findOne({
        username: req.body.username
    })

    if (!user) {
        resData.error(res, "用户不存在")
        return
    }

    const isPasswordValid = require('bcryptjs').compareSync(
        req.body.password,
        user.password
    )

    if (!isPasswordValid) {
        resData.error(res, "密码错误或无效")
        return
    }

    const token = jwt.sign({
        id: String(user._id)
    }, SECRET);

    let {username, name, avatar, admin, sex, relation} = user;

    let relationUser;

    if(relation){
        relationUser = await User.findOne({
            _id: relation
        }, {password: 0})
    }
    // 生成token
    resData.success(res, {
        token,
        user: {username, name, avatar, admin, sex, relation: relationUser}
    })
})

// (管理员)
// 注册
router.post('/register', async (req, res) => {

    const resUser = await User.findOne({
        username: req.body.username
    })

    if (resUser) {
        resData.error(res, '账号已存在')
        return
    }

    const user = await User.create({...req.body})

    // 返回出去
    resData.success(res, {
        message: '注册成功',
    })

})

// 查询人员列表
router.get('/list', auth, async (req, res) => {

    let options = {admin: 0};
    const page = req.query.page || 1;
    const size = req.query.size || 5;
    User.count(options, (err, count) => {
        User.find(options).skip((parseInt(page) - 1) * parseInt(size)).limit(parseInt(size)).then(data => {
            let d = {
                total: count,
                data: data
            }
            resData.success(res, d)
        }).catch(e => {
            resData.error(res, e)
        })
    })


})

router.delete('/list/:ids', auth, async (req, res) => {
    let ids = req.params.ids.split();
    User.remove({_id: {$in: ids}}).then(data => {
        resData.success(res, '删除成功')
    }).catch(e => {
        resData.error(res, e)
    })
})

// 判定人员关系
router.post('/relation', auth, async (req, res) => {
    let id_0 = req.body.ids[0];
    let id_1 = req.body.ids[1];
    let data_0 = await User.findOne({_id: id_0}, {relation: 0});
    let data_1 = await User.findOne({_id: id_1}, {relation: 0});
    data_0.relation = data_1.id;
    data_0.save();
    data_1.relation = data_0.id
    data_1.save();
    resData.success(res, {
        message: '匹配成功'
    })
})

module.exports = router;
