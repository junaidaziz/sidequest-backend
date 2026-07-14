import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IdempotencyService } from './idempotency.service';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ENDPOINT = 'POST /tasks';
const KEY = 'client-key-abc';
const PENDING_MARKER = { __idempotencyPending: true };

interface PrismaMock {
  idempotencyKey: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let prisma: PrismaMock;

  beforeEach(() => {
    prisma = {
      idempotencyKey: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new IdempotencyService(prisma as unknown as PrismaService);
  });

  it('runs the operation without any bookkeeping when no key is supplied', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true });

    const result = await service.run({
      userId: USER_ID,
      key: undefined,
      endpoint: ENDPOINT,
      execute,
    });

    expect(result).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyKey.findUnique).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('reserves the key, executes, then stores the response on first call with a key', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    const execute = jest
      .fn()
      .mockResolvedValue({ id: 'task-1', createdAt: new Date('2026-07-14T00:00:00.000Z') });

    const result = await service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute });

    expect(result).toEqual({ id: 'task-1', createdAt: new Date('2026-07-14T00:00:00.000Z') });
    // The reservation is written BEFORE execute runs, with a pending marker
    // — not the real response — since the real response isn't known yet.
    expect(prisma.idempotencyKey.create).toHaveBeenCalledWith({
      data: { userId: USER_ID, key: KEY, endpoint: ENDPOINT, responseBody: PENDING_MARKER },
    });
    const createOrder = prisma.idempotencyKey.create.mock.invocationCallOrder[0];
    const executeOrder = execute.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(executeOrder);
    // Once execute resolves, the reservation is updated to the real,
    // JSON-normalized response (Date -> ISO string).
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
      where: { userId_key_endpoint: { userId: USER_ID, key: KEY, endpoint: ENDPOINT } },
      data: { responseBody: { id: 'task-1', createdAt: '2026-07-14T00:00:00.000Z' } },
    });
  });

  it('returns the stored response verbatim on a repeat call without re-executing', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      responseBody: { id: 'task-1', status: 'Approved' },
    });
    const execute = jest.fn();

    const result = await service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute });

    expect(result).toEqual({ id: 'task-1', status: 'Approved' });
    expect(execute).not.toHaveBeenCalled();
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('on a concurrent reservation race (P2002) where the winner already finished, replays its response without executing', async () => {
    prisma.idempotencyKey.findUnique
      .mockResolvedValueOnce(null) // initial lookup: nothing yet
      .mockResolvedValueOnce({ responseBody: { id: 'winner' } }); // re-read after losing the reservation race
    prisma.idempotencyKey.create.mockRejectedValue(uniqueViolation());
    const execute = jest.fn().mockResolvedValue({ id: 'loser' });

    const result = await service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute });

    expect(result).toEqual({ id: 'winner' });
    // The reservation is attempted BEFORE execute — losing that race means
    // this caller's execute() must never run at all, not just be discarded.
    expect(execute).not.toHaveBeenCalled();
  });

  it('on a concurrent reservation race (P2002) where the winner is still executing, refuses to execute and reports 409', async () => {
    prisma.idempotencyKey.findUnique
      .mockResolvedValueOnce(null) // initial lookup: nothing yet
      .mockResolvedValueOnce({ responseBody: PENDING_MARKER }); // re-read: still in flight
    prisma.idempotencyKey.create.mockRejectedValue(uniqueViolation());
    const execute = jest.fn().mockResolvedValue({ id: 'loser' });

    await expect(
      service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('releases the reservation if execute() throws, so a retry with the same key is not stuck forever', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockResolvedValue({});
    const execute = jest.fn().mockRejectedValue(new Error('downstream failure'));

    await expect(
      service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute }),
    ).rejects.toThrow('downstream failure');

    expect(prisma.idempotencyKey.delete).toHaveBeenCalledWith({
      where: { userId_key_endpoint: { userId: USER_ID, key: KEY, endpoint: ENDPOINT } },
    });
    expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('rethrows a non-unique-constraint error from the reservation create without executing', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.idempotencyKey.create.mockRejectedValue(new Error('connection lost'));
    const execute = jest.fn().mockResolvedValue({ id: 'x' });

    await expect(
      service.run({ userId: USER_ID, key: KEY, endpoint: ENDPOINT, execute }),
    ).rejects.toThrow('connection lost');
    expect(execute).not.toHaveBeenCalled();
  });
});
