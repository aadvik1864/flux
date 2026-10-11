import { resolve } from "node:path";
import { config } from "dotenv";
import { parseRuntimeConfig } from "./runtime-config";

config({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export const env = parseRuntimeConfig(process.env);
