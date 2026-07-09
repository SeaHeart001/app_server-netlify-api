import {AUTH_ERROR_MESSAGE, createRealtimeError} from './auth.mjs';

function getBase64Padded(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}

function base64ToBinary(value) {
    const padded = getBase64Padded(value);

    if (typeof atob === 'function') {
        return atob(padded);
    }

    if (typeof Buffer !== 'undefined') {
        return Buffer.from(padded, 'base64').toString('binary');
    }

    throw createRealtimeError(500, '当前运行时不支持 JWT 解码');
}

export function base64UrlToString(value) {
    const binary = base64ToBinary(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return new TextDecoder().decode(bytes);
}

export function arrayBufferToBase64Url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';

    for (let index = 0; index < bytes.length; index += 1) {
        binary += String.fromCharCode(bytes[index]);
    }

    const base64 = typeof btoa === 'function'
        ? btoa(binary)
        : Buffer.from(binary, 'binary').toString('base64');

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeJwtParts(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        throw createRealtimeError(401, AUTH_ERROR_MESSAGE);
    }

    try {
        return {
            header: JSON.parse(base64UrlToString(parts[0])),
            payload: JSON.parse(base64UrlToString(parts[1])),
            signature: parts[2],
            signingInput: `${parts[0]}.${parts[1]}`
        };
    } catch (err) {
        throw createRealtimeError(401, AUTH_ERROR_MESSAGE);
    }
}
