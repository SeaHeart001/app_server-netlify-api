const {connect} = require('../../db');
const {cleanupMessages} = require('../../services/messages');

const MESSAGE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getDelayUntilNextRun(now = new Date()) {
    const nextRun = new Date(now);
    nextRun.setHours(0, 0, 0, 0);

    if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun.getTime() - now.getTime();
}

async function runMessagesCleanup(logger = console) {
    await connect();
    const result = await cleanupMessages();

    if (logger && typeof logger.info === 'function') {
        logger.info('Messages cleanup completed', result);
    }

    return result;
}

function isJobEnabled() {
    return String(process.env.MESSAGE_CLEANUP_JOB_ENABLED || 'true').toLowerCase() !== 'false';
}

function startMessagesCleanupJob(options = {}) {
    const logger = options.logger || console;

    if (!isJobEnabled()) {
        if (logger && typeof logger.info === 'function') {
            logger.info('Messages cleanup job disabled');
        }
        return {
            stop() {}
        };
    }

    let stopped = false;
    let timer = null;

    const schedule = (delay) => {
        if (stopped) {
            return;
        }

        timer = setTimeout(execute, delay);

        if (timer && typeof timer.unref === 'function') {
            timer.unref();
        }
    };

    const execute = async () => {
        if (stopped) {
            return;
        }

        try {
            await runMessagesCleanup(logger);
        } catch (err) {
            if (logger && typeof logger.error === 'function') {
                logger.error('Messages cleanup failed', err);
            }
        } finally {
            schedule(MESSAGE_CLEANUP_INTERVAL_MS);
        }
    };

    schedule(
        Number.isFinite(options.initialDelayMs)
            ? Number(options.initialDelayMs)
            : getDelayUntilNextRun(options.now || new Date())
    );

    return {
        stop() {
            stopped = true;
            if (timer) {
                clearTimeout(timer);
            }
        }
    };
}

module.exports = {
    getDelayUntilNextRun,
    runMessagesCleanup,
    startMessagesCleanupJob
};
