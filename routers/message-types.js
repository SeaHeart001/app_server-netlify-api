const {router} = require('../services/message-types');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
