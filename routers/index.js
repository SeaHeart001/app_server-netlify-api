const usersRouter = require('./users');
const relationsRouter = require('./relations');
const messagesRouter = require('./messages');
const filesRouter = require('./files');
const sseRouter = require('./sse');

function mountRouters(app) {
    app.use('/users', usersRouter);
    app.use('/relations', relationsRouter);
    app.use('/messages', messagesRouter);
    app.use('/files', filesRouter);
    app.use('/sse', sseRouter);
}

module.exports = {
    mountRouters
};
