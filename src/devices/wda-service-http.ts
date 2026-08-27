import http, { type IncomingMessage, type ServerResponse } from 'node:http';

import type { DeviceConnections } from './connection-manager.js';
import type {
    WdaServiceDevicesResponse,
    WdaServiceErrorResponse,
    WdaServiceHealthResponse,
} from './wda-service-protocol.js';

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
    response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function createWdaServiceHttpServer(
    connections: DeviceConnections,
    onShutdown: () => void,
    isReady: () => boolean = () => true,
): http.Server {
    return http.createServer((request: IncomingMessage, response: ServerResponse) => {
        void (async () => {
            const method = request.method ?? 'GET';
            const url = new URL(request.url ?? '/', 'http://localhost');
            if (method === 'GET' && url.pathname === '/health') {
                const ready = isReady();
                const body: WdaServiceHealthResponse = {
                    status: ready ? 'ok' : 'starting',
                    devices: connections.statuses(),
                };
                sendJson(response, ready ? 200 : 503, body);
                return;
            }
            if (method === 'GET' && url.pathname === '/devices') {
                const body: WdaServiceDevicesResponse = { devices: connections.statuses() };
                sendJson(response, 200, body);
                return;
            }
            const reconnect = method === 'POST'
                ? /^\/devices\/([^/]+)\/reconnect$/.exec(url.pathname)
                : null;
            if (reconnect) {
                const status = await connections.reconnect(decodeURIComponent(reconnect[1]!));
                if (!status) {
                    const body: WdaServiceErrorResponse = { error: 'Unknown device' };
                    sendJson(response, 404, body);
                    return;
                }
                sendJson(response, 200, status);
                return;
            }
            if (method === 'POST' && url.pathname === '/shutdown') {
                sendJson(response, 202, { status: 'stopping' });
                setImmediate(onShutdown);
                return;
            }
            const body: WdaServiceErrorResponse = { error: 'Not found' };
            sendJson(response, 404, body);
        })().catch((error: unknown) => {
            if (response.headersSent) {
                response.destroy(error instanceof Error ? error : undefined);
                return;
            }
            const body: WdaServiceErrorResponse = { error: errorMessage(error) };
            sendJson(response, 500, body);
        });
    });
}
