const path = require('path');
const express = require('express');
const {mountRouters} = require('./routers');
const {applyResponseHeaders, sendError} = require('./utils/express');

const app = express();

app.disable('x-powered-by');

app.use(applyResponseHeaders);

app.options('*', (req, res) => {
    res.status(204).end();
});

app.use(express.json({
    limit: process.env.JSON_BODY_LIMIT || '8mb'
}));
app.use(express.urlencoded({
    extended: true,
    limit: process.env.JSON_BODY_LIMIT || '8mb'
}));

mountRouters(app);

app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res) => {
    res.status(404).json({message: '接口不存在'});
});

app.use((err, req, res, next) => {
    sendError(res, err);
});

module.exports = app;
