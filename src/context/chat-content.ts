export type ChatContent = string | {
    type: string;
    name?: string;
    imageType?: string;
    base64Data?: string;
    [key: string]: any;
};