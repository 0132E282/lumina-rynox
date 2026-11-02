import { useSyncExternalStore } from 'react';
import { api } from '@/lib/api';

// * Spoken answers use the browser's own speech synthesis. The state is kept outside React so a button on any message, the auto-read switch and the voice choice stay in step.
const AUTO_KEY = 'ai-chat.auto-read';
const VOICE_KEY = 'ai-chat.voice';
const SAMPLE =
    'Xin chào, mình là trợ lý của bạn. Hôm nay mình có thể giúp gì cho bạn nhé?';

type State = {
    speaking: number | string | null;
    auto: boolean;
    /** Name of the voice the person picked (null: the first Vietnamese voice of the device). */
    voice: string | null;
    /** Vietnamese voices this device offers. */
    voices: string[];
    /** Voices of the speech service (ready-made samples and the person's own); empty when the service is not set up. */
    cloud: CloudVoice[];
};

export type CloudVoice = {
    id: string;
    name: string;
    own: boolean;
    preview: string | null;
};

const CLOUD = 'cloud:';

const readStored = (key: string): string | null => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};

let state: State = {
    speaking: null,
    auto: readStored(AUTO_KEY) === '1',
    voice: readStored(VOICE_KEY),
    voices: [],
    cloud: [],
};
const listeners = new Set<() => void>();

const update = (next: Partial<State>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
};

let run = 0;

export const canSpeak = (): boolean =>
    typeof window !== 'undefined' && 'speechSynthesis' in window;

const isVietnamese = (voice: SpeechSynthesisVoice): boolean =>
    voice.lang.toLowerCase().replace('_', '-').startsWith('vi');

let context: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];

const stopCloud = (): void => {
    sources.forEach((source) => {
        source.onended = null;

        try {
            source.stop();
        } catch {
            // * Already stopped.
        }
    });
    sources = [];
};

// * Seconds of silence between two sentences: a short breath instead of a hard cut.
const BREATH = 0.12;

/** * Reads the sentences with a voice of the speech service: fetched two ahead and scheduled back to back on the audio clock, so there is no stall between sentences. Resolves false when the service fails (the caller falls back to the device voice). */
const speakCloud = async (
    voiceId: string,
    parts: Part[],
    mine: number,
): Promise<boolean> => {
    try {
        context ??= new AudioContext();
        await context.resume();

        const audio = context;
        const jobs: Promise<ArrayBuffer>[] = [];
        const ahead = (index: number) => {
            for (let at = index; at < Math.min(parts.length, index + 3); at++) {
                if (jobs[at] === undefined) {
                    jobs[at] = api
                        .post<ArrayBuffer>(
                            '/ai-chat/voices/speak',
                            { voice: voiceId, text: parts[at].text },
                            { responseType: 'arraybuffer' },
                        )
                        .then(({ data }) => data);
                    jobs[at].catch(() => undefined);
                }
            }
        };
        let nextStart = 0;
        let last: AudioBufferSourceNode | null = null;

        for (let index = 0; index < parts.length; index++) {
            ahead(index);

            const buffer = await audio.decodeAudioData(await jobs[index]);

            if (mine !== run) {
                return true;
            }

            const source = audio.createBufferSource();

            source.buffer = buffer;
            source.playbackRate.value = parts[index].rate;
            source.connect(audio.destination);

            const startAt = Math.max(audio.currentTime + 0.03, nextStart);

            source.start(startAt);
            nextStart = startAt + buffer.duration / parts[index].rate + BREATH;
            sources.push(source);
            last = source;
        }

        if (last !== null) {
            const final = last;

            await new Promise<void>((resolve) => {
                final.onended = () => resolve();
            });
        }

        return true;
    } catch {
        return false;
    }
};

export function stopSpeaking(): void {
    run++;
    stopCloud();

    if (canSpeak()) {
        window.speechSynthesis.cancel();
    }

    update({ speaking: null });
}

// * Voices load a moment after the page: wait for them (at most a second) before choosing one.
const loadVoices = (): Promise<SpeechSynthesisVoice[]> =>
    new Promise((resolve) => {
        const synth = window.speechSynthesis;
        const ready = synth.getVoices();

        if (ready.length > 0) {
            resolve(ready);

            return;
        }

        const finish = () => {
            synth.removeEventListener('voiceschanged', finish);
            window.clearTimeout(timer);
            resolve(synth.getVoices());
        };
        const timer = window.setTimeout(finish, 1000);

        synth.addEventListener('voiceschanged', finish);
    });

/** * Asks the server for the speech service's voices (none when it has no key). */
export const loadCloudVoices = (): Promise<void> =>
    api
        .get<{ voices: CloudVoice[] }>('/ai-chat/voices')
        .then(({ data }) => update({ cloud: data.voices }))
        .catch(() => undefined);

if (typeof window !== 'undefined') {
    void loadCloudVoices();
}

if (canSpeak()) {
    void loadVoices().then((voices) =>
        update({
            voices: voices.filter(isVietnamese).map((item) => item.name),
        }),
    );
}

/** * An answer without code, links and markdown marks (emoji and text faces stay: they tell how a sentence is felt). */
const plainText = (markdown: string): string =>
    markdown
        .replace(/```[\s\S]*?```/g, ' (đoạn code) ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/[*_~|#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

const EMOJI =
    /[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f\u20e3]/gu;
const FACE = /(^|\s)[:;=][-^o']?[)(DPpOo3|\\/*]+(?=\s|$)/g;

/** * Emoji and text faces are never read out ("mặt cười"...). */
const withoutFaces = (text: string): string =>
    text.replace(EMOJI, ' ').replace(FACE, ' ').replace(/\s+/g, ' ').trim();

export const spokenText = (markdown: string): string =>
    withoutFaces(plainText(markdown));

type Part = { text: string; rate: number; pitch: number };

/** * How a sentence is felt, from its emoji, text faces and "!": the speed and pitch it is read with. */
const feeling = (raw: string): { rate: number; pitch: number } => {
    if (/[😢😭😞😔😥😿💔☹🙁]|(^|\s)[:;]-?['(]/u.test(raw)) {
        return { rate: 0.92, pitch: 0.85 };
    }

    if (/[😮😲😱🤯]/u.test(raw)) {
        return { rate: 1.08, pitch: 1.25 };
    }

    if (
        /[😊😄😃😀🙂😁😍🥰☺❤💕🎉👍✨😉😎🤗🔥]|(^|\s)[:;=]-?[)Dd3]|\^\^|!/u.test(
            raw,
        )
    ) {
        return { rate: 1.07, pitch: 1.15 };
    }

    return { rate: 1, pitch: 1 };
};

// * A long text is read sentence by sentence: Chrome silently stops a single long utterance after about 15 seconds.
const sentences = (text: string): Part[] => {
    const parts = text.match(
        /[^.!?…]+[.!?…]*[\p{Extended_Pictographic}\ufe0f]*\s*/gu,
    ) ?? [text];
    const chunks: string[] = [];

    parts.forEach((part) => {
        const last = chunks.length - 1;

        if (
            last >= 0 &&
            chunks[last].length + part.length < (last === 0 ? 70 : 240)
        ) {
            chunks[last] += part;
        } else {
            chunks.push(part);
        }
    });

    return chunks
        .map((chunk) => ({ text: withoutFaces(chunk), ...feeling(chunk) }))
        .filter((part) => part.text !== '');
};

/** * Reads an answer aloud with the picked Vietnamese voice of the device (the default voice when it has none); a new call replaces the one in progress. */
export function speak(id: number | string, markdown: string): void {
    const text = plainText(markdown);

    if (!canSpeak() || spokenText(markdown) === '') {
        return;
    }

    const mine = ++run;

    window.speechSynthesis.cancel();
    stopCloud();
    update({ speaking: id });

    const chosen = state.voice;

    if (chosen?.startsWith(CLOUD)) {
        void speakCloud(chosen.slice(CLOUD.length), sentences(text), mine).then(
            (spoken) => {
                if (spoken) {
                    if (mine === run && state.speaking === id) {
                        update({ speaking: null });
                    }
                } else if (mine === run) {
                    speakWithDevice(id, text, mine);
                }
            },
        );

        return;
    }

    speakWithDevice(id, text, mine);
}

function speakWithDevice(
    id: number | string,
    text: string,
    mine: number,
): void {
    void loadVoices().then((voices) => {
        if (mine !== run) {
            return;
        }

        const vietnamese = voices.filter(isVietnamese);
        const voice =
            vietnamese.find((item) => item.name === state.voice) ??
            vietnamese[0];
        const parts = sentences(text);
        const finish = () => {
            if (mine === run && state.speaking === id) {
                update({ speaking: null });
            }
        };

        // * Browsers drop a speak() that comes right after cancel(): give it a beat.
        window.setTimeout(() => {
            if (mine !== run) {
                return;
            }

            parts.forEach((part, index) => {
                const utterance = new SpeechSynthesisUtterance(part.text);

                utterance.rate = part.rate;
                utterance.pitch = part.pitch;

                // * No Vietnamese voice on this device: leave the language unset so the default voice still speaks (a vi-VN request would stay silent).
                if (voice) {
                    utterance.voice = voice;
                    utterance.lang = voice.lang;
                }

                utterance.onerror = finish;

                if (index === parts.length - 1) {
                    utterance.onend = finish;
                }

                window.speechSynthesis.speak(utterance);
            });
        }, 60);
    });
}

const keepVoice = (name: string): void => {
    try {
        localStorage.setItem(VOICE_KEY, name);
    } catch {
        // * Storage blocked: the voice still changes for this visit.
    }

    update({ voice: name });
};

/** * Takes the next voice of the device; the caller reads again to let it be heard. */
export const cycleVoice = (): void => {
    const names = [
        ...state.cloud.map((item) => CLOUD + item.id),
        ...state.voices,
    ];

    if (names.length > 1) {
        const current = state.voice ?? state.voices[0] ?? names[0];

        keepVoice(names[(names.indexOf(current) + 1) % names.length]);
    }
};

/** * Picks a voice and reads a short sample with it, so it can be heard before it is kept. */
export const previewVoice = (name: string): void => {
    keepVoice(name);
    speak('voice-sample', SAMPLE);
};

/** * Makes a new voice of the speech service from a recording of the person's own voice, and picks it. */
export const cloneVoice = async (
    name: string,
    sample: Blob,
    consent: boolean,
): Promise<void> => {
    const form = new FormData();

    form.append('name', name);
    form.append('sample', sample, 'sample');
    form.append('consent', consent ? '1' : '0');

    const { data } = await api.post<{ id: string; voices: CloudVoice[] }>(
        '/ai-chat/voices',
        form,
    );

    update({ cloud: data.voices });
    keepVoice(CLOUD + data.id);
};

/** * Deletes a voice the person made; the choice falls back to the device voice. */
export const removeVoice = async (id: string): Promise<void> => {
    const { data } = await api.delete<{ voices: CloudVoice[] }>(
        `/ai-chat/voices/${id}`,
    );

    update({ cloud: data.voices });

    if (state.voice === CLOUD + id) {
        try {
            localStorage.removeItem(VOICE_KEY);
        } catch {
            // * Storage blocked: the choice still resets for this visit.
        }

        update({ voice: null });
    }
};

export const cloudPrefix = CLOUD;

export const setAutoRead = (auto: boolean): void => {
    try {
        localStorage.setItem(AUTO_KEY, auto ? '1' : '0');
    } catch {
        // * Storage blocked: the switch still works for this visit.
    }

    if (!auto) {
        stopSpeaking();
    }

    update({ auto });
};

/** * Reads a fresh answer only when the person switched on spoken answers. */
export const speakIfAuto = (id: number | string, markdown: string): void => {
    if (state.auto) {
        voiceAnswers.add(id);
        speak(id, markdown);
    }
};

// * Answers that came while spoken answers were on: the thread shows them as "read aloud" instead of text (until the person asks for the text).
const voiceAnswers = new Set<number | string>();

export const isVoiceAnswer = (id: number | string): boolean =>
    voiceAnswers.has(id);

export const useSpeech = (): State =>
    useSyncExternalStore(
        subscribe,
        () => state,
        () => state,
    );
