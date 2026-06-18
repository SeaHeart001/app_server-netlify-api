const mongoose = require('mongoose');
const SECRET ='ewgfvwergvwsgw5454gsrgvsvsd';
// 连接数据库
const uri = "mongodb+srv://haohai:haohai@cluster0.xp0s2qx.mongodb.net/firstCloud?retryWrites=true&w=majority";
mongoose.set('useCreateIndex', true);
const connect = () => {
    mongoose.connect(uri, {
        useNewUrlParser: true,
        useCreateIndex: true,
        useFindAndModify: false,
        useUnifiedTopology: true,
    }).then(() => {
        console.log('数据库连接成功');
        const {User} = require('./user/userModel');
        User.findOne({username: 'admin'}).then((u) => {
            !u && User.create({ username: 'admin', password: 'admin', name: '管理员', avatar: '', sex: 1, admin: 1})
        })
    }).catch(err => {
        console.log('数据库连接失败, 尝试重连...')
        connect()
    })
}
connect()

function t_Socket(io, socket){
    socket.on('message', (obj) => {
        console.log(obj, 't-s')
        io.emit("message", obj)
    })
}

module.exports = {SECRET, t_Socket}
