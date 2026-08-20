import { Context, Env, HTTPException } from 'hono'
import { Env as AppEnv } from '../types/env'

export async function errorHandler(err: Error, c: Context<AppEnv>) {
  console.error('Error:', err)

  // HTTP exceptions (intentional)
  if (err instanceof HTTPException) {
    return c.json({
      error: err.message,
      status: err.status,
    }, err.status)
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    return c.json({
      error: 'Validation Error',
      message: 'Invalid request data',
      details: err.errors,
    }, 400)
  }

  // JWT errors
  if (err.name === 'JwtError' || err.message.includes('JWT')) {
    return c.json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    }, 401)
  }

  // D1/Database errors
  if (err.message.includes('D1') || err.message.includes('database') || err.message.includes('SQL')) {
    console.error('Database error:', err)
    return c.json({
      error: 'Internal Server Error',
      message: 'Database operation failed',
    }, 500)
  }

  // R2 errors
  if (err.message.includes('R2') || err.message.includes('object storage')) {
    console.error('R2 error:', err)
    return c.json({
      error: 'Internal Server Error',
      message: 'Storage operation failed',
    }, 500)
  }

  // Queue errors
  if (err.message.includes('Queue') || err.message.includes('queue')) {
    console.error('Queue error:', err)
    return c.json({
      error: 'Internal Server Error',
      message: 'Background job processing failed',
    }, 500)
  }

  // External API errors
  if (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('timeout')) {
    console.error('External API error:', err)
    return c.json({
      error: 'Bad Gateway',
      message: 'External service unavailable',
    }, 502)
  }

  // Generic error
  const requestId = c.get('requestId') || 'unknown'
  console.error(`[${requestId}] Unhandled error:`, err)

  return c.json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred',
    requestId,
  }, 500)
}

export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(message, 400, 'BAD_REQUEST', details)
  }

  static unauthorized(message: string = 'Unauthorized') {
    return new AppError(message, 401, 'UNAUTHORIZED')
  }

  static forbidden(message: string = 'Forbidden') {
    return new AppError(message, 403, 'FORBIDDEN')
  }

  static notFound(message: string = 'Not Found') {
    return new AppError(message, 404, 'NOT_FOUND')
  }

  static conflict(message: string, details?: unknown) {
    return new AppError(message, 409, 'CONFLICT', details)
  }

  static tooManyRequests(message: string = 'Too Many Requests') {
    return new AppError(message, 429, 'RATE_LIMITED')
  }

  static internal(message: string = 'Internal Server Error', details?: unknown) {
    return new AppError(message, 500, 'INTERNAL_ERROR', details)
  }

  static badGateway(message: string = 'Bad Gateway') {
    return new AppError(message, 502, 'BAD_GATEWAY')
  }

  static serviceUnavailable(message: string = 'Service Unavailable') {
    return new AppError(message, 503, 'SERVICE_UNAVAILABLE')
  }
}