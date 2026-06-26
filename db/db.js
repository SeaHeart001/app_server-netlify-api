const mongoose = require('mongoose');
const dns = require('dns');

require('dotenv').config({override: process.env.NODE_ENV !== 'production'});

if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(',').map(server => server.trim()).filter(Boolean));
}

let connectionPromise;
let seedPromise;

function createConfigError(message) {
    const error = new Error(message);
    error.statusCode = 500;
    error.publicMessage = message;
    return error;
}

function getMongoUri() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) {
        throw createConfigError('服务配置缺少 MONGODB_URI。Netlify 部署后需要在 Project configuration > Environment variables 中设置，并确保变量对 Functions 运行时可用。');
    }
    return uri;
}

function getJwtSecret() {
    const secret = process.env.JWT_SECRET || process.env.SECRET;
    if (!secret) {
        throw createConfigError('服务配置缺少 JWT_SECRET。Netlify 部署后需要在 Project configuration > Environment variables 中设置，并确保变量对 Functions 运行时可用。');
    }
    return secret;
}

async function seedDefaultAdmin() {
    if (seedPromise) {
        return seedPromise;
    }

    seedPromise = (async () => {
        const username = process.env.DEFAULT_ADMIN_USERNAME;
        const password = process.env.DEFAULT_ADMIN_PASSWORD;

        if (!username || !password) {
            return;
        }

        const {User} = require('./user/userModel');
        const exists = await User.findOne({username});

        if (!exists) {
            await User.create({
                username,
                password,
                name: process.env.DEFAULT_ADMIN_NAME || '管理员',
                avatar: process.env.DEFAULT_ADMIN_AVATAR || '',
                sex: Number(process.env.DEFAULT_ADMIN_SEX || 1),
                admin: 1
            });
        }
    })();

    return seedPromise;
}

async function connect() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!connectionPromise) {
        mongoose.set('useCreateIndex', true);

        connectionPromise = mongoose.connect(getMongoUri(), {
            useNewUrlParser: true,
            useCreateIndex: true,
            useFindAndModify: false,
            useUnifiedTopology: true,
        }).then(async () => {
            await seedDefaultAdmin();
            return mongoose.connection;
        }).catch(err => {
            connectionPromise = null;
            throw err;
        });
    }

    return connectionPromise;
}

function t_Socket(io, socket) {
    socket.on('message', (obj) => {
        console.log(obj, 't-s');
        io.emit('message', obj);
    });
}

module.exports = {connect, getJwtSecret, t_Socket};
