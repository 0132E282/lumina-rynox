/** Fixed error codes and their process exit codes. Only these codes ever leave the package. */
export const ERROR_EXIT_CODES = {
    unknown: 1,
    not_logged_in: 10,
    composer_not_found: 11,
    timeout: 12,
    checkpoint: 13,
    invalid_input: 14,
    audience_not_set: 15,
    browser_unavailable: 16,
    image_download_failed: 17,
    image_upload_failed: 18,
};

/** Internal control-flow error carrying one fixed code from {@link ERROR_EXIT_CODES}. */
export class StepError extends Error {
    /** @param {keyof typeof ERROR_EXIT_CODES} code */
    constructor(code) {
        super(code);
        this.code = code;
    }
}

/**
 * Process exit code for a result object: 0 on success, the fixed code of the error otherwise.
 * @param {{ok: boolean, error?: string}} result
 */
export function exitCodeFor(result) {
    if (result.ok !== false) {
        return 0;
    }
    return ERROR_EXIT_CODES[result.error] ?? ERROR_EXIT_CODES.unknown;
}
