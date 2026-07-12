import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from '../types/jwt-payload.interface';

/**
 * createParamDecorator returns a decorator; the underlying factory is stored in
 * route-args metadata. We extract and invoke it directly to test its logic.
 */
function getFactory(): (data: unknown, ctx: ExecutionContext) => AuthUser {
  class Probe {
    handler(@CurrentUser() _user: AuthUser): void {
      void _user;
    }
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  const key = Object.keys(metadata)[0];
  return metadata[key].factory;
}

describe('CurrentUser decorator', () => {
  it('extracts request.user from the execution context', () => {
    const user: AuthUser = { userId: 'user-1', email: 'ada@example.com', isGuest: false };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext;

    const factory = getFactory();

    expect(factory(undefined, ctx)).toEqual(user);
  });
});
