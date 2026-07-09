import {EVENT_PADDING} from './constants.mjs';

export function formatSseEvent(name, data) {
    return `event: ${name}\ndata: ${JSON.stringify(data || {})}\n\n${EVENT_PADDING}`;
}

export function encodeSseEvent(encoder, name, data) {
    return encoder.encode(formatSseEvent(name, data));
}
