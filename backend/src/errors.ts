export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const saleConfigurationError = () =>
  new AppError(503, 'SALE_CONFIGURATION_ERROR', 'Exactly one active sale must be configured.');
