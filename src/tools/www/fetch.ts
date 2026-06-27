import MCPTool from "../../core/mcp";

export const FetchTool = new MCPTool({
    name: "fetch",
    description: "Makes HTTP requests to APIs or endpoints. For testing APIs, fetching data, or making web requests. Not intended for reading web pages (HTML).",
    inputs: [{
        name: "url",
        type: "string",
        description: "The URL to fetch (e.g., 'https://api.example.com/data')",
        required: true,
    },
    {
        name: "method",
        type: "string",
        description: "HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)",
        required: false,
        default: "GET"
    },
    {
        name: "headers",
        type: "object",
        description: "HTTP headers as key-value pairs (e.g., {'Authorization': 'Bearer token', 'Content-Type': 'application/json'})",
        required: false,
    },
    {
        name: "body",
        type: "string",
        description: "Request body (required for POST, PUT, PATCH methods). Can be JSON string or form data.",
        required: false,
    },
    {
        name: "timeout",
        type: "number",
        description: "Request timeout in milliseconds (default: 30000)",
        required: false,
        default: 30000
    }],
    execute: async (_: string, inputs: Record<string, any>): Promise<any> => {
        try {
            const { url, method = "GET", headers = {}, body, timeout = 30000 } = inputs;

            if (!url || typeof url !== "string") {
                throw new Error("url must be a non-empty string");
            }

            try {
                new URL(url);
            } catch {
                throw new Error(`Invalid URL format: ${url}`);
            }

            const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
            const normalizedMethod = method.toUpperCase();
            if (!validMethods.includes(normalizedMethod)) {
                throw new Error(`Invalid HTTP method: ${method}. Must be one of: ${validMethods.join(", ")}`);
            }

            if (body && ["GET", "HEAD", "OPTIONS"].includes(normalizedMethod)) {
                throw new Error(`${normalizedMethod} requests cannot have a body`);
            }

            let parsedHeaders = headers;
            if (typeof headers === "string") {
                try {
                    parsedHeaders = JSON.parse(headers);
                } catch {
                    throw new Error("headers must be a valid JSON object");
                }
            }

            if (parsedHeaders && typeof parsedHeaders !== "object") {
                throw new Error("headers must be an object or JSON string");
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const fetchOptions: RequestInit = {
                    method: normalizedMethod,
                    headers: parsedHeaders || {},
                    signal: controller.signal,
                };

                if (body) {
                    const isJson = typeof body === "string" && (
                        body.trim().startsWith("{") || 
                        body.trim().startsWith("[")
                    );
                    
                    if (isJson && !parsedHeaders?.["Content-Type"] && !parsedHeaders?.["content-type"]) {
                        fetchOptions.headers = {
                            ...parsedHeaders,
                            "Content-Type": "application/json"
                        };
                    }
                    fetchOptions.body = body;
                }

                const response = await fetch(url, fetchOptions);

                clearTimeout(timeoutId);

                const contentType = response.headers.get("content-type") || "";
                let data;

                if (contentType.includes("application/json")) {
                    try {
                        data = await response.json();
                    } catch {
                        data = await response.text();
                    }
                } else {
                    data = await response.text();
                }

                const result = {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    data: data,
                };

                if (!response.ok) {
                    return {
                        ...result,
                        error: `HTTP ${response.status}: ${response.statusText}`,
                    };
                }

                return result;

            } finally {
                clearTimeout(timeoutId);
            }

        } catch (error) {
            let errorMessage = error instanceof Error ? error.message : String(error);

            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    errorMessage = `Request timed out after ${inputs.timeout || 30000}ms`;
                } else if (error.message.includes("ENOTFOUND")) {
                    errorMessage = `DNS resolution failed: ${inputs.url}`;
                } else if (error.message.includes("ECONNREFUSED")) {
                    errorMessage = `Connection refused: ${inputs.url}`;
                } else if (error.message.includes("ECONNRESET")) {
                    errorMessage = `Connection reset by peer: ${inputs.url}`;
                } else if (error.message.includes("ETIMEDOUT")) {
                    errorMessage = `Connection timed out: ${inputs.url}`;
                }
            }

            return {
                error: errorMessage,
            };
        }
    }
});

export default FetchTool;