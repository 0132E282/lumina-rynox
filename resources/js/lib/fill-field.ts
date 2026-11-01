/**
 * Types a value into a form input by its id (native setter + `input` event), the way a person would: the admin forms use uncontrolled
 * inputs, so this updates both the screen and the form state. Returns false when no such input is on the page.
 */
export function fillField(id: string, value: string): boolean {
    const element = document.getElementById(id);

    if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement)
    ) {
        return false;
    }

    const prototype =
        element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : HTMLTextAreaElement.prototype;

    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(
        element,
        value,
    );
    element.dispatchEvent(new Event('input', { bubbles: true }));

    return true;
}
