const {router} = require('../services/files');
const {createServiceRouter} = require('../utils/express');

module.exports = createServiceRouter(router);
