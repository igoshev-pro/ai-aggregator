import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, timeout, catchError, throwError, TimeoutError } from 'rxjs';

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number = 120000) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException());
        }
        return throwError(() => err);
      }),
    );
  }
}