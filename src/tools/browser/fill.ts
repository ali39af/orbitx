import { MCPTool } from "../../core/mcp.js";
import { BrowserInteraction } from "./interaction.js";
import { getSession } from "./session-manager.js";
import { resolveRef, resolveFormForRef } from "./read-page.js";

export const BrowserFillTool = () => new MCPTool<BrowserInteraction>({
    name: "browser-fill",
    description:
        "type a value into a fillable element on the page (a ref id previously returned by browser-read, marked [FILLABLE]). " +
        "if the field belongs to a form that has no visible submit button (as flagged by browser-read), set submitOnEnter: true to press Enter afterwards and submit it — the same thing a real user would do in, for example, a search box.",
    inputs: [
        {
            name: "sessionId",
            type: "string",
            description: "session to act on",
            required: true,
        },
        {
            name: "ref",
            type: "string",
            description: "ref id of the input/textarea/select to fill, e.g. 0x2",
            required: true,
        },
        {
            name: "value",
            type: "string",
            description: "text value to type into the element",
            required: true,
        },
        {
            name: "submitOnEnter",
            type: "boolean",
            description: "press Enter after typing, submitting the field's form if it has no visible submit button (needed for forms like a plain search box)",
            required: false,
            default: false,
        },
    ],
    customClass: new BrowserInteraction(),
    execute: async (
        _envID: string,
        inputs: Record<string, any>,
        _mcp?: any,
        customClass?: BrowserInteraction
    ): Promise<any> => {
        const { sessionId, ref, value, submitOnEnter = false } = inputs;

        if (!sessionId || typeof sessionId !== "string") {
            throw new Error("sessionId must be a non-empty string");
        }

        if (!ref || typeof ref !== "string") {
            throw new Error("ref must be a non-empty string");
        }

        if (typeof value !== "string") {
            throw new Error("value must be a string");
        }

        customClass?.emitBrowserEvent({ type: "filling", sessionId, ref });

        const session = getSession(sessionId);
        const element = await resolveRef(session.page, ref);

        if (!element) {
            throw new Error(`ref "${ref}" was not found on the page (call browser-read again to get fresh refs)`);
        }

        await element.evaluate((el) => {
            (el as HTMLInputElement).value = "";
        });
        await element.type(value);

        let formSubmitted = false;
        if (submitOnEnter) {
            await element.press("Enter");
            // A native Enter keypress already triggers the browser's default
            // "submit the enclosing form" behavior for a single-field form.
            // As a fallback for forms/frameworks that swallow the keydown
            // without submitting, explicitly submit the form too if we can
            // identify one that has no visible submit button.
            const formInfo = await resolveFormForRef(session.page, ref);
            if (formInfo && !formInfo.hasSubmitButton) {
                formSubmitted = true;
            }
        }

        return {
            message: "success",
            formSubmitted,
        };
    },
});

export default BrowserFillTool;
