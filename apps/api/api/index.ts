import type { RequestListener } from 'node:http';
import { createApp } from '../src/create-app';

let requestListener: RequestListener | null = null;

/**
 * Bootstrap the Nest app once per warm instance. Successful invocations keep
 * the same DI container and Mongoose connection alive, so warm requests skip
 * the boot/mongo handshake entirely.
 */
async function getRequestListener(): Promise<RequestListener> {
  if (!requestListener) {
    const app = await createApp();
    await app.init();
    requestListener = app.getHttpAdapter().getInstance();
  }
  return requestListener;
}

export default async function handler(
  req: Parameters<RequestListener>[0],
  res: Parameters<RequestListener>[1],
): Promise<void> {
  try {
    const listener = await getRequestListener();
    listener(req, res);
  } catch (error) {
    console.error('Failed to bootstrap the API application', error);
    res.statusCode = 500;
    res.end('Internal server error');
  }
}