const {router} = require('../services/messages');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
