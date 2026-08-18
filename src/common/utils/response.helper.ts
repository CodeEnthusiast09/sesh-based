import {
  ApiResponse,
  PaginatedResponse,
  PaginationMeta,
} from '../interfaces/api-response.interface';

export const successResponse = <T>(
  message: string,
  data?: T,
): ApiResponse<T> => ({
  success: true,
  message,
  data,
});

export const errorResponse = (
  message: string | string[],
  error?: string,
): ApiResponse => ({
  success: false,
  message,
  error,
});

export const paginatedResponse = <T>(
  message: string,
  data: T[],
  meta: PaginationMeta,
): PaginatedResponse<T> => ({
  success: true,
  message,
  data,
  meta,
});
