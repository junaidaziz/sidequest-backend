import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';

describe('ContactController (public)', () => {
  let service: { submit: jest.Mock };
  let controller: ContactController;

  beforeEach(() => {
    service = { submit: jest.fn().mockResolvedValue({ success: true, id: 'sub-1' }) };
    controller = new ContactController(service as unknown as ContactService);
  });

  it('POST /contact delegates to submit and returns the ack', async () => {
    const dto = { name: 'Ada', email: 'ada@example.com', topic: 'Hi', message: 'Hello' };
    const result = await controller.submit(dto);
    expect(service.submit).toHaveBeenCalledWith(dto);
    expect(result).toEqual({ success: true, id: 'sub-1' });
  });

  it('POST /contact is in the sensitive 5/60s throttle tier', () => {
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', ContactController.prototype.submit)).toBe(
      5,
    );
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', ContactController.prototype.submit)).toBe(
      60_000,
    );
  });
});
