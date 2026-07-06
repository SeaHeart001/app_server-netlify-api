const {router} = require('../services/files');
const {createServiceRouter} = require('./utils');

module.exports = createServiceRouter(router);
