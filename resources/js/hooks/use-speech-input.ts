import { useCallback, useEffect, useRef, useState } from 'react';

// * The browser's speech recognition is not in TypeScript's DOM types: only what is used here.
type Recognition = {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: RecognitionEvent) => void) | null;
    onend: (() => void) | null;
    onerror: (() => void) | null;
    start: () => void;
    stop: () => void;
};

type RecognitionEvent = {
    resultIndex: number;
    results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

type RecognitionConstructor = new () => Recognition;

const constructorOf = (): RecognitionConstructor | null => {
    const scope = window as unknown as {
        SpeechRecognition?: RecognitionConstructor;
        webkitSpeechRecognition?: RecognitionConstructor;
    };

    return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

/**
 * Dictation with the browser's own speech recognition: `toggle` starts or stops listening, each finished phrase goes to `onText`.
 * `supported` is false where the browser has none (the caller hides the button).
 */
export function useSpeechInput(onText: (text: string) => void, lang = 'vi-VN') {
    const supported = typeof window !== 'undefined' && constructorOf() !== null;
    const [listening, setListening] = useState(false);
    const recognition = useRef<Recognition | null>(null);
    const handler = useRef(onText);

    handler.current = onText;

    const stop = useCallback(() => recognition.current?.stop(), []);

    const toggle = useCallback(() => {
        if (recognition.current !== null) {
            recognition.current.stop();

            return;
        }

        const Speech = constructorOf();

        if (Speech === null) {
            return;
        }

        const next = new Speech();

        next.lang = lang;
        next.continuous = true;
        next.interimResults = false;
        next.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    handler.current(event.results[i][0].transcript.trim());
                }
            }
        };
        next.onend = next.onerror = () => {
            recognition.current = null;
            setListening(false);
        };
        recognition.current = next;
        setListening(true);
        next.start();
    }, [lang]);

    // * Leaving the page stops the microphone.
    useEffect(() => () => recognition.current?.stop(), []);

    return { supported, listening, toggle, stop };
}
