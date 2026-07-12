import { Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { requestLoggingMiddleware } from './request-logging.middleware';

const VALID_UUID = 'a1b2c3d4-e5f6-4a5b-8c9d-0123456789ab';

function buildReqRes(headers: Record<string, string> = {}) {
  const finishHandlers: Array<() => void> = [];
  const req = {
    method: 'GET',
    originalUrl: '/home?token=secret',
    path: '/home',
    headers: { ...headers },
  } as unknown as Request;
  const res = {
    statusCode: 200,
    setHeader: jest.fn(),
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'finish') finishHandlers.push(handler);
    }),
  } as unknown as Response;
  return { req, res, triggerFinish: () => finishHandlers.forEach((h) => h()) };
}

describe('requestLoggingMiddleware', () => {
  it('generates a request id and echoes it in the response header', () => {
    const middleware = requestLoggingMiddleware();
    const { req, res } = buildReqRes();
    const next = jest.fn();

    middleware(req, res, next);

    expect(req.headers['x-request-id']).toEqual(expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.headers['x-request-id']);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reuses a UUID-shaped inbound x-request-id instead of generating a new one', () => {
    const middleware = requestLoggingMiddleware();
    const { req, res } = buildReqRes({ 'x-request-id': VALID_UUID });
    const next = jest.fn();

    middleware(req, res, next);

    expect(req.headers['x-request-id']).toBe(VALID_UUID);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', VALID_UUID);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('discards a malformed/malicious inbound x-request-id and generates a fresh one', () => {
    const middleware = requestLoggingMiddleware();
    const injected = 'abc]\nGET /admin 200 +1ms [forged';
    const { req, res } = buildReqRes({ 'x-request-id': injected });
    const next = jest.fn();

    middleware(req, res, next);

    expect(req.headers['x-request-id']).not.toBe(injected);
    expect(req.headers['x-request-id']).toEqual(expect.any(String));
    expect((req.headers['x-request-id'] as string).includes('\n')).toBe(false);
  });

  it('uses the first value when x-request-id arrives as an array (duplicate headers)', () => {
    const middleware = requestLoggingMiddleware();
    const { req, res } = buildReqRes();
    req.headers['x-request-id'] = [VALID_UUID, 'a-second-value'] as unknown as string;
    const next = jest.fn();

    middleware(req, res, next);

    expect(req.headers['x-request-id']).toBe(VALID_UUID);
  });

  it('logs method/path/status/duration once the response finishes, excluding the query string', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const middleware = requestLoggingMiddleware();
    const { req, res, triggerFinish } = buildReqRes({ 'x-request-id': VALID_UUID });
    const next = jest.fn();

    middleware(req, res, next);
    triggerFinish();

    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^GET \/home 200 \+\d+ms/));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`[${VALID_UUID}]`));
    expect(logSpy).toHaveBeenCalledWith(expect.not.stringContaining('token=secret'));
    logSpy.mockRestore();
  });
});
