export default abstract class MCPStorage {
    abstract get(
        key: string
    ): Promise<string>;

    abstract set(
        key: string,
        value: string
    ): Promise<void>;
}