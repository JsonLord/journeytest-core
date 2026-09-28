import { getModel, getModels, getProviders, type Api, type KnownProvider, type Model } from "@earendil-works/pi-ai";

export interface ReasoningModelResolutionStatus { provider?: string; model?: string; modelResolved: boolean; reason?: "missing_provider" | "missing_model" | "unsupported_provider" | "unsupported_provider_model"; supportedProviders: string[]; supportedModels?: string[] }

export function inspectReasoningModel(provider?: string, modelId?: string): ReasoningModelResolutionStatus {
  const supportedProviders = getProviders() as string[];
  if (!provider) return { provider, model: modelId, modelResolved: false, reason: "missing_provider", supportedProviders };
  if (!modelId) return { provider, model: modelId, modelResolved: false, reason: "missing_model", supportedProviders };
  if (!supportedProviders.includes(provider)) return { provider, model: modelId, modelResolved: false, reason: "unsupported_provider", supportedProviders };
  const supportedModels = getModels(provider as KnownProvider).map(model => model.id);
  if (!supportedModels.includes(modelId)) return { provider, model: modelId, modelResolved: false, reason: "unsupported_provider_model", supportedProviders, supportedModels };
  return { provider, model: modelId, modelResolved: true, supportedProviders, supportedModels };
}

export function resolveReasoningModel(provider?: string, modelId?: string): Model<Api> {
  const status = inspectReasoningModel(provider, modelId);
  if (!status.modelResolved) {
    const suffix = status.reason === "unsupported_provider" ? `\nSupported providers: ${status.supportedProviders.join(", ")}` : status.reason === "unsupported_provider_model" ? `\nSupported ${provider} models: ${(status.supportedModels ?? []).join(", ")}` : "";
    throw new Error(`Unsupported reasoning model configuration:\nprovider=${provider ?? "<missing>"}\nmodel=${modelId ?? "<missing>"}\n\nThe installed pi-ai version does not expose this provider/model pair.${suffix}`);
  }
  const model = getModel(provider as KnownProvider, modelId as never) as Model<Api> | undefined;
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") throw new Error(`Unsupported reasoning model configuration:\nprovider=${provider}\nmodel=${modelId}\n\nThe installed pi-ai version returned no valid model for this provider/model pair.`);
  return model;
}
