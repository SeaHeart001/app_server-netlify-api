require('dotenv').config({override: process.env.NODE_ENV !== 'production'});

const app = require('./app');
const {startMessagesCleanupJob} = require('./routers/jobs/messagesCleanup');

const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
    console.info(`Express server listening on http://localhost:${port}`);
    startMessagesCleanupJob();
});
