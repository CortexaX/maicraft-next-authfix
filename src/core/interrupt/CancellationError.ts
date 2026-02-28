/**
 * CancellationError - 取消错误
 *
 * 用于在 catch 中区分"取消"和"真错误"
 */

export class CancellationError extends Error {
  constructor(public readonly reason: string) {
    super(`操作被取消: ${reason}`);
    this.name = 'CancellationError';
  }
}

/**
 * 判断一个错误是否为取消错误
 */
export function isCancellationError(error: unknown): error is CancellationError {
  return error instanceof CancellationError;
}
