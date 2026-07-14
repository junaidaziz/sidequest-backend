import { plainToInstance } from 'class-transformer';
import { ListNotificationsQueryDto } from './list-notifications-query.dto';

/**
 * The `unreadOnly` transform must treat the query string "false" as false —
 * `@Type(() => Boolean)` would coerce it to true (any non-empty string is
 * truthy), so this guards the explicit parse.
 */
describe('ListNotificationsQueryDto', () => {
  it('parses the string "true" to boolean true', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, { unreadOnly: 'true' });
    expect(dto.unreadOnly).toBe(true);
  });

  it('parses the string "false" to boolean false (not truthy-coerced)', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, { unreadOnly: 'false' });
    expect(dto.unreadOnly).toBe(false);
  });

  it('passes a real boolean true through unchanged', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, { unreadOnly: true });
    expect(dto.unreadOnly).toBe(true);
  });

  it('coerces numeric strings for limit/offset', () => {
    const dto = plainToInstance(ListNotificationsQueryDto, { limit: '25', offset: '5' });
    expect(dto.limit).toBe(25);
    expect(dto.offset).toBe(5);
  });
});
