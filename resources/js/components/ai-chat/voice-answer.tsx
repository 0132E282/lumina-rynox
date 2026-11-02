import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
    cycleVoice,
    isVoiceAnswer,
    speak,
    stopSpeaking,
    useSpeech,
} from '@/lib/speak';
import { cn } from '@/lib/utils';

/** * An answer that came while spoken answers were on: shows a "read aloud" row instead of the text (the text opens on request). Any other answer is shown as it is. */
export function VoiceAnswer({
    id,
    text,
    children,
}: {
    id: number | string;
    text: string;
    children: ReactNode;
}) {
    const { speaking, voices, cloud } = useSpeech();
    const [shown, setShown] = useState(false);

    if (!isVoiceAnswer(id)) {
        return <>{children}</>;
    }

    const reading = speaking === id;

    return (
        <>
            <span className="flex items-center gap-2 text-muted-foreground">
                <Volume2
                    aria-hidden="true"
                    className={cn(
                        'size-4 shrink-0',
                        reading &&
                            'animate-pulse text-blue-600 motion-reduce:animate-none dark:text-blue-400',
                    )}
                />
                <span>
                    {reading ? 'Đang đọc to…' : 'Đã trả lời bằng giọng nói'}
                </span>
                <button
                    type="button"
                    onClick={() => (reading ? stopSpeaking() : speak(id, text))}
                    className="rounded-sm text-xs underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {reading ? 'Dừng' : 'Đọc lại'}
                </button>
                {voices.length + cloud.length > 1 && (
                    <button
                        type="button"
                        title="Đổi sang giọng khác và đọc lại"
                        onClick={() => {
                            cycleVoice();
                            speak(id, text);
                        }}
                        className="rounded-sm text-xs underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                        Đổi giọng
                    </button>
                )}
                <button
                    type="button"
                    aria-expanded={shown}
                    onClick={() => setShown((value) => !value)}
                    className="rounded-sm text-xs underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {shown ? 'Ẩn văn bản' : 'Xem văn bản'}
                </button>
            </span>
            {shown && <div className="mt-2">{children}</div>}
        </>
    );
}
