var express = require('express');
var router = express.Router();
const moment = require('moment');
const {auth, User} = require('../db/user/userModel');
const {Tasks} = require('../db/task/taskModel');
const {resData} = require('../utils/utils');

// 新增
router.post('/add', auth, async (req, res) => {
    Tasks.create({
        tasks: req.body.tasks,
        creator: req._user.id,
    }).then(data => {
        resData.success(res, '添加成功');
        // fixme 此处设计一个消息通知
    }).catch(e => {
        resData.error(res, e)
    });
})

// 查询任务列表
router.get('/list', auth, async (req, res) => {
    let ids = [];
    ids.push(req._user.id);
    req._user.relation && ids.push(req._user.relation);
    let options = {creator: {$in: ids}}
    const page = req.query.page || 1;
    const size = req.query.size || 20;
    Tasks.count(options, (err, count) => {
        Tasks.find(options).sort({createTime: -1}).skip((parseInt(page) - 1) * parseInt(size)).limit(parseInt(size)).then(async data => {
            let list = [];
            for(let i=0; i<data.length; i++){
                let doc = data[i]._doc
                let user = await User.findOne({_id: doc.creator}, {password: 0});
                list[i] = doc;
                list[i].time = moment(doc.createTime).format('YYYY-MM-DD')
                list[i].createUser = user;
            }
            let d = {
                total: count,
                list: list
            }
            resData.success(res, d);
        }).catch(e => {
            resData.error(res, e)
        })
    })
})

// 根据任务id删除任务列表
router.delete('/list/:id', auth, async (req, res) => {
    Tasks.deleteOne({_id: req.params.id}).then(data => {
        resData.success(res, '删除成功')
    }).catch(e => {
        resData.error(res, e)
    })
})

module.exports = router;
