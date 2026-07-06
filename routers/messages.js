const {router} = require('../services/messages');
const {createServiceRouter} = require('./utils');

module.exports = createServiceRouter(router);
