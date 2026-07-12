import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface CapturedResponse {
  statusCode: number;
  body: Record<string, unknown> | null;
}

function buildHost(captured: CapturedResponse): ArgumentsHost {
  const response = {
    status: (code: number) => {
      captured.statusCode = code;
      return {
        json: (payload: Record<string, unknown>) => {
          captured.body = payload;
        },
      };
    },
  };
  const request = { url: '/auth/login', method: 'POST' };
  return {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  it('formats an HttpException with an object message (validation array)', () => {
    const captured: CapturedResponse = { statusCode: 0, body: null };

    filter.catch(new BadRequestException(['email must be an email']), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(captured.body).toMatchObject({
      statusCode: 400,
      path: '/auth/login',
      message: ['email must be an email'],
    });
  });

  it('formats an HttpException carrying a string response', () => {
    const captured: CapturedResponse = { statusCode: 0, body: null };

    filter.catch(new HttpException('teapot', HttpStatus.I_AM_A_TEAPOT), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.I_AM_A_TEAPOT);
    expect(captured.body).toMatchObject({ message: 'teapot' });
  });

  it('uses the exception message for a standard NotFoundException', () => {
    const captured: CapturedResponse = { statusCode: 0, body: null };

    filter.catch(new NotFoundException('missing'), buildHost(captured));

    expect(captured.body).toMatchObject({ statusCode: 404, message: 'missing' });
  });

  it('maps an unknown error to 500 and logs it', () => {
    const captured: CapturedResponse = { statusCode: 0, body: null };
    const logSpy = jest.spyOn(filter['logger'], 'error');

    filter.catch(new Error('boom'), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body).toMatchObject({ message: 'Internal server error' });
    expect(logSpy).toHaveBeenCalled();
  });

  it('falls back to a generic message for a wrapped 500 with no useful body', () => {
    const captured: CapturedResponse = { statusCode: 0, body: null };

    filter.catch(new InternalServerErrorException(), buildHost(captured));

    expect(captured.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(captured.body?.message).toBeDefined();
  });
});
