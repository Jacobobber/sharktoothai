/*
 * Copyright (c) 2024 Jacob Malm. All rights reserved.
 * Proprietary and confidential configuration. Unauthorized redistribution or commercial use is prohibited without prior written consent.
 */

import dotenv from "dotenv";
dotenv.config();
import { loadEnv } from "./config/env";

export type AppConfig = {
  env: string;
  port: number;
};

const envConfig = loadEnv();

export const config: AppConfig = {
  env: process.env.NODE_ENV ?? "development",
  port: envConfig.port
};
