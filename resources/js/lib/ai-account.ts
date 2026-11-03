/** * "Claude (Anthropic)" becomes "Claude": the provider's short name for dense rows. */
export function vendorShortName(vendor: string): string {
    return vendor.split(' (')[0];
}

/** * A generated name ends with the token type: "OpenAI / Codex · Session token 2" reads "OpenAI / Codex CLI 2" (the account runs the vendor's CLI). */
export function accountDisplayName(name: string): string {
    return name.replace(/ · Session token(?= \d+$|$)/, ' CLI');
}
