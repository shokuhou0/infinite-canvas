import type { PromptSource } from "./prompt-source-presets";
import type { RawPrompt } from "./prompt-source-runtime";

type RunOptions = { signal?: AbortSignal };

type DavidWuPrompt = {
    id?: number;
    title_en?: string;
    title_cn?: string;
    category?: string;
    category_cn?: string;
    prompt?: string;
    note?: string;
    author?: string;
    source?: string;
    needs_ref?: boolean;
    image?: string;
};

export function runLegacyPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {
    switch (source.parser) {
        case "awesome-gpt-image":
            return buildAwesomeGptImagePrompts(source.url, options);
        case "awesome-gpt4o-image-prompts":
            return buildAwesomeGpt4oImagePrompts(source.url, options);
        case "youmind-gpt-image-2":
            return buildYouMindPrompts(source.url, source.id, "gpt-image-2", options);
        case "youmind-nano-banana-pro":
            return buildYouMindPrompts(source.url, source.id, "nano-banana-pro", options);
        case "davidwu-gpt-image2-prompts":
            return buildDavidWuGptImage2Prompts(source.url, options);
        default:
            return Promise.reject(new Error(`不支持的本地提示词格式：${source.parser}`));
    }
}

async function buildAwesomeGptImagePrompts(baseUrl: string, options?: RunOptions) {
    const markdown = await fetchText(baseUrl, "README.zh-CN.md", options);
    const items: RawPrompt[] = [];
    for (const section of splitBeforeHeading(markdown, "## ")) {
        const tags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));
        for (const block of splitBeforeHeading(section, "### ")) {
            const title = firstMatch(block, /^###\s+(.+)$/m)
                .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
                .trim();
            const prompt = firstMatch(block, /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
            if (!title || !prompt) continue;
            const images = extractMarkdownImages(baseUrl, block);
            items.push(createPrompt(`awesome-gpt-image-${leftPad(items.length + 1)}`, title, prompt, images, tags));
        }
    }
    return items;
}

async function buildAwesomeGpt4oImagePrompts(baseUrl: string, options?: RunOptions) {
    const markdown = await fetchText(baseUrl, "README.zh-CN.md", options);
    const items: RawPrompt[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+(.+)$/m).trim();
        const prompt = firstMatch(block, /- \*\*提示词文本：\*\*\s*`(.*?)`/s).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(baseUrl, block);
        items.push(createPrompt(`awesome-gpt4o-image-prompts-${leftPad(items.length + 1)}`, title, prompt, images, ["gpt4o"]));
    }
    return items;
}

async function buildYouMindPrompts(baseUrl: string, idPrefix: string, modelTag: string, options?: RunOptions) {
    const markdown = await fetchText(baseUrl, "README_zh.md", options);
    const items: RawPrompt[] = [];
    for (const block of splitBeforeHeading(markdown, "### ")) {
        const title = firstMatch(block, /^###\s+No\.\s*\d+:\s*(.+)$/m).trim();
        const prompt = firstMatch(block, /#### .*?提示词\s*\r?\n\s*```[\w-]*\r?\n(.*?)\r?\n```/s).trim();
        if (!title || !prompt) continue;
        const images = extractMarkdownImages(baseUrl, block);
        items.push(createPrompt(`${idPrefix}-${leftPad(items.length + 1)}`, title, prompt, images, youMindTags(title, modelTag)));
    }
    return items;
}

async function buildDavidWuGptImage2Prompts(baseUrl: string, options?: RunOptions) {
    const data = await fetchJson<DavidWuPrompt[]>(baseUrl, "prompts.json", options);
    const items: RawPrompt[] = [];
    data.forEach((item, index) => {
        const title = (item.title_cn || item.title_en || "").trim();
        const prompt = (item.prompt || "").trim();
        if (!title || !prompt) return;
        const images = [absoluteImage(baseUrl, item.image || "")].filter(Boolean);
        const result = createPrompt(`davidwu-gpt-image2-prompts-${leftPad(item.id || index + 1)}`, title, prompt, images, davidWuTags(item));
        result.description = item.note || "";
        if (item.author) result.author = item.author;
        const sourceUrl = item.source?.trim();
        if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) result.sourceUrl = sourceUrl;
        items.push(result);
    });
    return items;
}

function createPrompt(id: string, title: string, prompt: string, images: string[], tags: string[]): RawPrompt {
    return {
        id,
        title,
        prompt,
        description: "",
        coverUrl: images[0] || "",
        referenceImageUrls: images,
        tags,
        preview: images.map((image) => `![](${image})`).join("\n\n"),
        createdAt: "",
        updatedAt: "",
    };
}

async function fetchText(baseUrl: string, file: string, options?: RunOptions) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/${file}`, { cache: "no-store", signal: options?.signal });
    if (!response.ok) throw new Error(`${file} 拉取失败（${response.status}）`);
    return response.text();
}

async function fetchJson<T>(baseUrl: string, file: string, options?: RunOptions) {
    return JSON.parse(await fetchText(baseUrl, file, options)) as T;
}

function splitBeforeHeading(markdown: string, prefix: string) {
    const blocks: string[] = [];
    let current: string[] = [];
    for (const line of markdown.split("\n")) {
        if (line.startsWith(prefix) && current.length) {
            blocks.push(current.join("\n"));
            current = [];
        }
        current.push(line);
    }
    blocks.push(current.join("\n"));
    return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
    return pattern.exec(value)?.[1] || "";
}

function extractMarkdownImages(baseUrl: string, markdown: string) {
    const markdownImages = Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g), (match) => absoluteImage(baseUrl, match[1].trim()));
    const htmlImages = Array.from(markdown.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi), (match) => absoluteImage(baseUrl, match[1].trim()));
    return Array.from(new Set([...markdownImages, ...htmlImages])).filter(Boolean);
}

function absoluteImage(baseUrl: string, image: string) {
    const value = image.trim();
    if (!value) return "";
    if (/^(?:https?:)?\/\//i.test(value) || value.startsWith("/")) return value;
    return `${baseUrl.replace(/\/$/, "")}/${value.replace(/^\.?\//, "")}`;
}

function tagsFromHeading(heading: string) {
    return splitTags(heading.replace(/[^\p{L}\p{N}/&、与 ]/gu, ""), /\s*(?:\/|&|、|与)\s*/);
}

function youMindTags(title: string, modelTag: string) {
    const [, prefix] = title.match(/^(.+?) - /) || [];
    return [modelTag, ...tagsFromHeading(prefix || "")];
}

function davidWuTags(item: DavidWuPrompt) {
    const tags = splitTags([item.category_cn, item.category, item.author, item.source].filter(Boolean).join("/"), /\//);
    if (item.needs_ref) tags.push("需要参考图");
    return tags;
}

function splitTags(value: string, pattern: RegExp) {
    return value
        .split(pattern)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}
