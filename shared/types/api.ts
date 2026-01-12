import type { Request } from "express";
import type { Role } from "./domain";

export type RequestContext = {
  requestId: string;
  userId?: string;
  tenantId?: string;
  role?: Role;
  ip?: string;
  userAgent?: string;
};

export type RequestWithContext<TParams = any, TResBody = any, TReqBody = any, TQuery = any> = Request<
  TParams,
  TResBody,
  TReqBody,
  TQuery
> & { context?: RequestContext };
