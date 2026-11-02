// * Answers that just arrived and are still to be "typed" on screen. Keyed by message id and kept outside React: opening the new chat remounts the thread, and the answer must keep typing.
const typing = new Set<number | string>();

export const markTyping = (id: number | string): void => {
    typing.add(id);
};

export const isTyping = (id: number | string): boolean => typing.has(id);

export const doneTyping = (id: number | string): void => {
    typing.delete(id);
};
