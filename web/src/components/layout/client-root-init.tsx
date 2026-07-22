import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { usePromptSourceScheduler } from "@/hooks/use-prompt-source-scheduler";
import { fetchChannelModels } from "@/services/api/image";
import { exchangeNewApiHandoff } from "@/services/api/new-api-handoff";
import {
    createModelChannel,
    encodeChannelModel,
    guessCapability,
    modelOptionsFromChannels,
    type ChannelModel,
    useConfigStore,
} from "@/stores/use-config-store";

const NEW_API_CHANNEL_ID = "new-api-image";

function removeHandoffFromHash() {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    hashParams.delete("newapi_handoff");
    const nextHash = hashParams.size ? `#${hashParams.toString()}` : "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
}

function normalizeHandoffModels(names: string[]): ChannelModel[] {
    const uniqueNames = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
    const models = uniqueNames.map((name) => ({ name, capability: guessCapability(name) }));
    if (models.length && !models.some((model) => model.capability === "image")) {
        models[0] = { ...models[0], capability: "image" };
    }
    return models;
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);

    usePromptSourceScheduler();

    useEffect(() => {
        if (handledConfigParams.current) return;
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const handoffTicket = hashParams.get("newapi_handoff");
        if (handoffTicket) {
            handledConfigParams.current = true;
            removeHandoffFromHash();
            void (async () => {
                try {
                    const handoff = await exchangeNewApiHandoff(handoffTicket);
                    const previousChannel = config.channels.find((channel) => channel.id === NEW_API_CHANNEL_ID);
                    let modelNames = handoff.models;
                    if (!modelNames.length) {
                        try {
                            modelNames = await fetchChannelModels(
                                createModelChannel({
                                    id: NEW_API_CHANNEL_ID,
                                    name: "New API · Image",
                                    baseUrl: handoff.base_url,
                                    apiKey: handoff.api_key,
                                    apiFormat: "openai",
                                }),
                            );
                        } catch {
                            modelNames = previousChannel?.models.map((model) => model.name) || ["gpt-image-2"];
                        }
                    }

                    const channel = createModelChannel({
                        id: NEW_API_CHANNEL_ID,
                        name: "New API · Image",
                        baseUrl: handoff.base_url,
                        apiKey: handoff.api_key,
                        apiFormat: "openai",
                        models: normalizeHandoffModels(modelNames),
                    });
                    const channels = [channel, ...config.channels.filter((item) => item.id !== NEW_API_CHANNEL_ID)];
                    const imageModel = channel.models.find((model) => model.capability === "image") || channel.models[0];
                    const imageModelValue = imageModel ? encodeChannelModel(channel.id, imageModel.name) : "";

                    updateConfig("channels", channels);
                    updateConfig("models", modelOptionsFromChannels(channels));
                    updateConfig("baseUrl", handoff.base_url);
                    updateConfig("apiKey", handoff.api_key);
                    if (imageModelValue) {
                        updateConfig("model", imageModelValue);
                        updateConfig("imageModel", imageModelValue);
                    }
                    setConfigDialogOpen(false);
                    message.success("已安全导入 New API 的 Image 分组令牌");
                } catch (error) {
                    openConfigDialog(false);
                    message.error(error instanceof Error ? error.message : "New API 令牌导入失败，请重新打开无限画布");
                }
            })();
            return;
        }

        const searchParams = new URLSearchParams(window.location.search);
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, setConfigDialogOpen, updateConfig]);

    return <>{children}</>;
}
