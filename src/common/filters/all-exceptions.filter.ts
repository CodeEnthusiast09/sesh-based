import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { ApiResponse } from '../interfaces/api-response.interface';
import { errorResponse } from '../utils/response.helper';

/** Machine-readable `error` values, keyed by HTTP status. */
const ERROR_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BadRequest',
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'NotFound',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TooManyRequests',
};

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const { status, body } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: HttpStatus;
    body: ApiResponse;
  } {
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        body: errorResponse('Internal server error', 'ServerError'),
      };
    }

    // getStatus() is typed as number, but always returns an HttpStatus member.
    const status: HttpStatus = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return {
        status,
        body: errorResponse(payload, this.errorName(status, false)),
      };
    }

    const { message } = payload as HttpExceptionBody;
    const resolved = message ?? exception.message;
    const isValidationFailure =
      status === HttpStatus.BAD_REQUEST && Array.isArray(resolved);

    return {
      status,
      body: errorResponse(
        resolved,
        this.errorName(status, isValidationFailure),
      ),
    };
  }

  private errorName(status: HttpStatus, isValidationFailure: boolean): string {
    if (isValidationFailure) {
      return 'ValidationError';
    }

    return (
      ERROR_BY_STATUS[status] ??
      (status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'ServerError'
        : 'BadRequest')
    );
  }
}
