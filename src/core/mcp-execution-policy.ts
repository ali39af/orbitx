export interface MCPToolCallRequest {
    toolName: string;
    inputs: Record<string, any>;
    envID: string;
    toolCallId?: string;
}

export abstract class MCPExecutionPolicy {
    abstract authorize(request: MCPToolCallRequest): Promise<boolean> | boolean;
}

export class MCPBypassExecutionPolicy extends MCPExecutionPolicy {
    authorize(): boolean {
        return true;
    }
}

export default MCPExecutionPolicy;
