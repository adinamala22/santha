import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import { DomainError } from './domain-error';

/** Error body: `{ error: { code, message, details?, requestId } }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof DomainError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof ZodValidationException) {
      status = 400;
      code = 'VALIDATION_FAILED';
      message = 'Request validation failed';
      const err = exception.getZodError() as { issues?: Array<{ path: PropertyKey[]; message: string }> };
      details = { issues: (err.issues ?? []).map((i) => ({ path: i.path.map(String).join('.'), message: i.message })) };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR';
      message = exception.message;
    } else if ((exception as { type?: string; status?: number }).type === 'entity.too.large') {
      // body-parser: request body over the limit (e.g. a huge photo upload).
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      message = 'This file is too large.';
    } else {
      this.logger.error({ err: exception, requestId }, 'Unhandled exception');
    }

    res.status(status).json({ error: { code, message, ...(details ? { details } : {}), requestId } });
  }
}
