import { cache } from "react";
import * as memory from "./memory/settings";
import * as mongo from "./mongo/settings";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const getSettings = cache(impl.getSettings);
export const insertSettings = impl.insertSettings;
export const updateSettings = impl.updateSettings;
export const getAiApiKeyEnc = impl.getAiApiKeyEnc;
export const getJiraSecretsEnc = impl.getJiraSecretsEnc;
export const getJiraStatusMapEnc = impl.getJiraStatusMapEnc;
