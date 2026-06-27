export class Skill {
    #skill;
    constructor(skill: {
        name: string;
        description: string;
        instructions: string;
    }) {
        this.#skill = skill;
    }

    getSkill() {
        return this.#skill;
    }
}

export default Skill;