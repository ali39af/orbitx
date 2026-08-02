import type MCPTool from "./mcp.js";

export class Skill {
    #skill;
    constructor(skill: {
        name: string;
        description: string;
        instructions: string;
        tools: MCPTool<any>[]
    }) {
        this.#skill = skill;
    }

    getSkill() {
        return this.#skill;
    }
}

export default Skill;