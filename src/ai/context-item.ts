export interface ContextItem {
  type: "file" | "selection" | "text" | "current-file" | "directory";
  content: string;
  path?: string;
  metadata?: {
    fileName?: string;
    language?: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
  };
}