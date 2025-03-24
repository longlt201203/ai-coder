export interface ContextItem {
    type: "file" | "selection" | "text" | "current-file";
    content: string;
    metadata?: {
      fileName?: string;
      language?: string;
      path?: string;
      lineStart?: number;
      lineEnd?: number;
    };
  }