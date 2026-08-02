import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";
import { submitForm } from "./read-page.js";

export const BrowserSubmitFormTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-submit-form",
    description:
        "submit a <form> on the page by its ref id (the [FORM] ref shown by browser-read). " +
        "use this for forms that have no visible submit button — e.g. a search box where the only way to search is pressing Enter — since there is nothing to browser-click. " +
        "this has the same effect as focusing a field inside the form and pressing Enter.",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to act on",
            required: true,
        },
        {
            name: "formRef",
            type: "string",
            description: "ref id of the form to submit, e.g. 0x7",
            required: true,
        },
    ],
    customClass: new BrowserInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: any,
        customClass?: BrowserInteraction
    ): Promise<any> => {
        const { sessionId, formRef } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!formRef || typeof formRef !== "string") {
            throw new Error("formRef must be a non-empty string");
        }

        customClass?.emitBrowserEvent({ type: "submitting-form", sessionId, formRef });

        const session = getSession(sessionId);
        const submitted = await submitForm(session.page, formRef);

        if (!submitted) {
            throw new Error(`formRef "${formRef}" was not found on the page (call browser-read again to get a fresh form ref)`);
        }

        return {
            message: "success",
        };
    },
});

export default BrowserSubmitFormTool;
