export type PickedFolder = {
    /** Name of the folder (a browser never tells its path). */
    name: string;
    /** Names directly inside it: enough for the server to tell same-named folders apart. */
    entries: string[];
};

const MAX_ENTRIES = 200;

type DirectoryHandle = {
    name: string;
    entries: () => AsyncIterable<[string, unknown]>;
};

/** * The browser's own "choose a folder" dialog. Only names leave the browser, never file contents. Returns null when the person cancels. */
export async function pickFolder(): Promise<PickedFolder | null> {
    const showPicker = (
        window as {
            showDirectoryPicker?: (options?: {
                mode?: 'read';
            }) => Promise<DirectoryHandle>;
        }
    ).showDirectoryPicker;

    if (showPicker) {
        try {
            const handle = await showPicker({ mode: 'read' });
            const entries: string[] = [];

            for await (const [name] of handle.entries()) {
                entries.push(name);

                if (entries.length >= MAX_ENTRIES) {
                    break;
                }
            }

            return { name: handle.name, entries };
        } catch (caught) {
            if (
                caught instanceof DOMException &&
                caught.name === 'AbortError'
            ) {
                return null;
            }

            throw caught;
        }
    }

    // * Browsers without showDirectoryPicker (Safari, Firefox): the folder input gives the same names.
    return new Promise((resolve) => {
        const input = document.createElement('input');

        input.type = 'file';
        input.webkitdirectory = true;
        input.addEventListener('cancel', () => resolve(null));
        input.addEventListener('change', () => {
            const paths = Array.from(input.files ?? []).map(
                (file) => file.webkitRelativePath,
            );

            if (paths.length === 0) {
                resolve(null);

                return;
            }

            const [name] = paths[0].split('/');
            const entries = [
                ...new Set(paths.map((path) => path.split('/')[1])),
            ]
                .filter(Boolean)
                .slice(0, MAX_ENTRIES);

            resolve({ name, entries });
        });
        input.click();
    });
}
