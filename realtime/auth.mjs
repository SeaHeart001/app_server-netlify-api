export const AUTH_ERROR_MESSAGE = '身份信息异常或已过期';

export function createRealtimeError(statusCode, message) {
    const err = new Error(message);
    err.statusCode = statusCode;
    err.publicMessage = message;
    return err;
}

export function getBearerToken(authorization) {
    const raw = String(authorization || '');
    return raw.toLowerCase().startsWith('bearer ')
        ? raw.slice(7).trim()
        : '';
}

export function getTokenFromUrl(url) {
    if (!url) {
        return '';
    }

    try {
        const parsedUrl = new URL(url, 'http://localhost');
        return parsedUrl.searchParams.get('token') || parsedUrl.searchParams.get('access_token') || '';
    } catch (err) {
        return '';
    }
}

export function getTokenFromRequestParts({authorization, url}) {
    return getBearerToken(authorization) || getTokenFromUrl(url);
}

export function assertUserPayload(decoded) {
    if (!decoded || decoded.type !== 'user' || !decoded.id) {
        throw createRealtimeError(401, AUTH_ERROR_MESSAGE);
    }

    if (decoded.exp && Math.floor(Date.now() / 1000) >= Number(decoded.exp)) {
        throw createRealtimeError(401, AUTH_ERROR_MESSAGE);
    }

    return decoded;
}

export function getRealtimeErrorStatus(err) {
    if (err && Number(err.statusCode)) {
        return Number(err.statusCode);
    }

    if (err && err.message === AUTH_ERROR_MESSAGE) {
        return 401;
    }

    return 500;
}

export function getRealtimeErrorMessage(err, fallback = 'SSE 服务异常') {
    return err && (err.publicMessage || err.message)
        ? err.publicMessage || err.message
        : fallback;
}
