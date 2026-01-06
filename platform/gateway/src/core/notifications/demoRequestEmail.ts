import { logger } from "../../../../../shared/utils/logger";

type DemoRequestPayload = {
  fullName: string;
  workEmail: string;
  company: string;
  message?: string;
  requestId?: string;
};

export const sendDemoRequestEmail = async (payload: DemoRequestPayload) => {
  logger.info({
    event: "demo_request_received",
    fullName: payload.fullName,
    workEmail: payload.workEmail,
    company: payload.company,
    message: payload.message ? payload.message : null,
    timestampUtc: new Date().toISOString(),
    requestId: payload.requestId ?? null,
    source: "public-site"
  });
};
