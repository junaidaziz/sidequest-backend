import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MulterError } from 'multer';

interface ErrorResponseBody {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    // Multer throws its own error class (not an HttpException) when an
    // upload exceeds configured limits — map that to 413, not the generic
    // 500 every other unrecognized error gets.
    const isPayloadTooLarge =
      exception instanceof MulterError && exception.code === 'LIMIT_FILE_SIZE';
    const status = isPayloadTooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : isHttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;
    const message = isPayloadTooLarge
      ? 'File too large'
      : this.extractMessage(exceptionResponse, exception, isHttpException);

    const body: ErrorResponseBody = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    };

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${request.method} ${request.url}`, (exception as Error)?.stack);
    }

    response.status(status).json(body);
  }

  private extractMessage(
    exceptionResponse: unknown,
    exception: unknown,
    isHttpException: boolean,
  ): string | string[] {
    if (isHttpException && typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const candidate = (exceptionResponse as { message?: string | string[] }).message;
      if (candidate) return candidate;
    }
    if (isHttpException && typeof exceptionResponse === 'string') {
      return exceptionResponse;
    }
    return 'Internal server error';
  }
}
