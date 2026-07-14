import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { IDEMPOTENCY_KEY_HEADER, IdempotencyKeyHeader } from './idempotency-key.decorator';

/**
 * createParamDecorator returns a decorator; the underlying factory is stored in
 * route-args metadata. We extract and invoke it directly to test its logic.
 */
function getFactory(): (data: unknown, ctx: ExecutionContext) => string | undefined {
  class Probe {
    handler(@IdempotencyKeyHeader() _key: string | undefined): void {
      void _key;
    }
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

function ctxWithHeaders(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('IdempotencyKeyHeader decorator', () => {
  const factory = getFactory();

  it('returns the trimmed header value when present', () => {
    expect(factory(undefined, ctxWithHeaders({ [IDEMPOTENCY_KEY_HEADER]: '  key-1  ' }))).toBe(
      'key-1',
    );
  });

  it('returns undefined when the header is absent', () => {
    expect(factory(undefined, ctxWithHeaders({}))).toBeUndefined();
  });

  it('returns undefined when the header is blank', () => {
    expect(factory(undefined, ctxWithHeaders({ [IDEMPOTENCY_KEY_HEADER]: '   ' }))).toBeUndefined();
  });

  it('takes the first value when the header is sent multiple times', () => {
    expect(factory(undefined, ctxWithHeaders({ [IDEMPOTENCY_KEY_HEADER]: ['a', 'b'] }))).toBe('a');
  });
});
