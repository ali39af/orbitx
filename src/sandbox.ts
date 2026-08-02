import MCPFSStorage from "./core/mcp-fs-storage.js";
import MCPIPCConnection from "./core/mcp-ipc-connection.js";
import MCPRNG from "./core/mcp-rng.js";
import MCPServer from "./core/mcp-server.js";
import { BashTools } from "./tools/bash/index.js";
import { BrowserTools } from "./tools/browser/index.js";
import { FsTools } from "./tools/fs/index.js";
import { PresentTools } from "./tools/present/index.js";
import { TodoTools } from "./tools/todo/index.js";
import { UtilTools } from "./tools/utils/index.js";

console.log("Starting Sandbox MCP Server ...");
const _MCPConnectionPath = process.env.MCPConnectionPath || "/tmp/mcp-server/socket.sock";
const _MCPConnection = new MCPIPCConnection(_MCPConnectionPath);
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
console.log(`MCP Server Stared at "${_MCPConnectionPath}" with ${tools.map(t => t.getOptions().name)}`)