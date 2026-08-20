const usersRouter = require('./users');
const relationsRouter = require('./relations');
const messagesRouter = require('./messages');
const messageTypesRouter = require('./message-types');
const filesRouter = require('./files');
const reportRouter = require('./report');
const sseRouter = require('./sse');

function mountRouters(app) {
    app.use('/users', usersRouter);
    app.use('/relations', relationsRouter);
    app.use('/messages', messagesRouter);
    app.use('/message-types', messageTypesRouter);
    app.use('/files', filesRouter);
    app.use('/report', reportRouter);
    app.use('/sse', sseRouter);
}

module.exports = {
    mountRouters
};
