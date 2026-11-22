export interface ProcoreApiResponse {
  status: number;
  data: unknown;
  pagination?: {
    current_page: number;
    per_page: number;
    has_next: boolean;
    total?: number;
  };
  rate_limit?: {
    remaining: number;
    limit: number;
    reset_at: number;
  };
  /**
   * Set when a failure is returned without retrying it (a 5xx on POST/PATCH,
   * which Procore may already have applied). Handlers show it to the caller.
   */
  notice?: string;
}

export interface ProcoreApiError {
  status: number;
  message: string;
  details?: unknown;
}

export interface ApiCallOptions {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  body?: Record<string, unknown>;
  companyId?: number;
  page?: number;
  perPage?: number;
}
