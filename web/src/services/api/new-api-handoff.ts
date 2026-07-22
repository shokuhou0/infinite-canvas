import axios from "axios";

import { NEW_API_BASE_URL } from "@/constant/runtime-config";

type NewApiHandoffData = {
    base_url: string;
    api_key: string;
    group: string;
    models: string[];
};

type NewApiHandoffResponse = {
    success: boolean;
    code?: string;
    message?: string;
    data?: NewApiHandoffData;
};

export async function exchangeNewApiHandoff(ticket: string): Promise<NewApiHandoffData> {
    try {
        const response = await axios.post<NewApiHandoffResponse>(
            `${NEW_API_BASE_URL.replace(/\/$/, "")}/api/canvas/handoff/exchange`,
            { ticket },
            {
                headers: { "Content-Type": "application/json" },
                withCredentials: false,
            },
        );
        if (!response.data.success || !response.data.data) {
            throw new Error("无法兑换 New API 画布登录凭据");
        }
        return response.data.data;
    } catch (error) {
        const code = axios.isAxiosError<NewApiHandoffResponse>(error) ? error.response?.data?.code : undefined;
        if (code === "CANVAS_TICKET_INVALID") {
            throw new Error("交接凭据已失效，请返回 New API 重新打开无限画布");
        }
        if (code === "CANVAS_ORIGIN_FORBIDDEN") {
            throw new Error("当前画布地址未获 New API 授权，请联系管理员检查地址配置");
        }
        throw new Error("New API 令牌导入失败，请返回 New API 重试");
    }
}
