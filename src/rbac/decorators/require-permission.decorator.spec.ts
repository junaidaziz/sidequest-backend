import { REQUIRE_PERMISSION_KEY, RequirePermission } from './require-permission.decorator';

describe('RequirePermission', () => {
  it('sets the permission list metadata on the handler', () => {
    class Sample {
      @RequirePermission('roles.manage', 'roles.assign')
      handler() {}
    }
    const metadata = Reflect.getMetadata(
      REQUIRE_PERMISSION_KEY,
      Sample.prototype.handler,
    ) as string[];
    expect(metadata).toEqual(['roles.manage', 'roles.assign']);
  });
});
