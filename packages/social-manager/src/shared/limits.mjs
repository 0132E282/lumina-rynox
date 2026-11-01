/** Limits shared by every provider; a provider overrides single keys (see its `*_LIMITS`). */
export const DEFAULT_LIMITS = {
    groupScrollRounds: 12,
    groupsMax: 200,
    groupNameMax: 150,
    textMaxLength: 3000,
    typingDelayMs: 25,
    stepTimeoutMs: 20_000,
    confirmTimeoutMs: 45_000,
    imageMaxBytes: 10 * 1024 * 1024,
    imageDownloadTimeoutMs: 20_000,
    imageMaxCount: 9,
    imageUploadTimeoutMs: 40_000,
    apiRequestTimeoutMs: 30_000,
    postDeadlineMs: 150_000, // * below the 180 s a caller (e.g. a Laravel Process timeout) may allow
    loginDeadlineMs: 10 * 60_000,
    loginPollMs: 2_000,
};
