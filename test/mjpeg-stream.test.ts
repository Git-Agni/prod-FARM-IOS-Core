import assert from 'node:assert/strict';
import test from 'node:test';

import { WdaRemoteControl } from '../src/devices/wda-remote.js';

function streamingResponse(): Response {
    const body = new ReadableStream<Uint8Array>({ start() { /* never ends */ } });
    return new Response(body, { status: 200, headers: { 'content-type': 'multipart/x-mixed-replace; boundary=x' } });
}

test('getMjpegStream ties the upstream fetch to the caller signal', async () => {
    let seenSignal: AbortSignal | undefined;
    const remote = new WdaRemoteControl({
        deviceUdid: 'udid-1',
        mjpegUrl: 'http://127.0.0.1:9100',
        fetchImpl: (async (_url: string, init?: RequestInit) => {
            seenSignal = init?.signal ?? undefined;
            return streamingResponse();
        }) as typeof fetch,
    });

    const client = new AbortController();
    const response = await remote.getMjpegStream('udid-1', client.signal);
    assert.ok(response.body, 'stream body is returned');
    assert.ok(seenSignal, 'fetch received an abort signal');
    assert.equal(seenSignal!.aborted, false);

    client.abort();
    assert.equal(seenSignal!.aborted, true, 'aborting the client signal aborts the upstream fetch');
});

test('getMjpegStream still works without a caller signal', async () => {
    const remote = new WdaRemoteControl({
        deviceUdid: 'udid-1', mjpegUrl: 'http://127.0.0.1:9100',
        fetchImpl: (async () => streamingResponse()) as typeof fetch,
    });
    const response = await remote.getMjpegStream('udid-1');
    assert.equal(response.status, 200);
});
