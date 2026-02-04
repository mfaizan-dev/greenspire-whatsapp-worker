import { createWasender, type RetryConfig } from "wasenderapi";

const apiKey = process.env.WASENDER_API_KEY;
const personalAccessToken = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;

const retryOptions: RetryConfig = {
  enabled: true,
  maxRetries: 3,
};

export const wasender = createWasender(
  apiKey,
  personalAccessToken,
  undefined,
  undefined,
  retryOptions,
  undefined
);

export const isWasenderConfigured = (): boolean => {
  return Boolean(apiKey || personalAccessToken);
};
