/** * "Claude (Anthropic)" becomes "Claude": the provider's short name for dense rows. */
export function vendorShortName(vendor: string): string {
    return vendor.split(' (')[0];
}
