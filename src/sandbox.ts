import type MCPConnection from "./core/mcp-connection.js";
import MCPFSStorage from "./core/mcp-fs-storage.js";
import MCPIPCConnection from "./core/mcp-ipc-connection.js";
import MCPRNG from "./core/mcp-rng.js";
import MCPServer from "./core/mcp-server.js";
import MCPWSConnection from "./core/mcp-ws-connection.js";
import { BashTools } from "./tools/bash/index.js";
import { BrowserTools } from "./tools/browser/index.js";
import { FsTools } from "./tools/fs/index.js";
import { PresentTools } from "./tools/present/index.js";
import { TodoTools } from "./tools/todo/index.js";
import { UtilTools } from "./tools/utils/index.js";

console.log("Starting Sandbox MCP Server ...");
const _ConnectionMode: "WS" | "IPC" = process.env?.CONNECTION_MODE == "WS" ? "WS" : "IPC";
const _ConnectionPath = process.env.CONNECTION_PATH || "/tmp/mcp-server/socket.sock";
const _ConnectionHost = process.env.CONNECTION_HOST || "0.0.0.0";
const _ConnectionPort = Number(process.env.CONNECTION_PORT || 9257);
let _MCPConnection: MCPConnection | undefined;
if (_ConnectionMode == "IPC")
    _MCPConnection = new MCPIPCConnection({
        socketPath: _ConnectionPath,
        mode: "server"
    });
else
    _MCPConnection = new MCPWSConnection({
        mode: "server",
        host: _ConnectionHost,
        port: _ConnectionPort,
        token: process.env.CONNECTION_TOKEN || "1234"
    });
const _MCPStorage = new MCPFSStorage("/home/ubuntu/mcp-data");
const _MCPRNG = new MCPRNG(_MCPStorage);
const _MCPServer = new MCPServer(_MCPConnection, _MCPStorage, _MCPRNG);
const tools = [
    ...BashTools(),
    ...BrowserTools(),
    ...FsTools(),
    ...PresentTools(),
    ...TodoTools(),
    ...UtilTools()
];
tools.forEach(tool => _MCPServer.registerTool(tool));
console.log(`MCP Server Stared at "${_ConnectionMode == "IPC" ? _ConnectionPath : _ConnectionHost + ":" + _ConnectionPort}" with ${tools.map(t => t.getOptions().name)}`);