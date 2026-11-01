import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { cn } from '@/lib/utils';

const clock = (seconds: number) => {
    const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;

    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
};

const BAR_COUNT = 36;

/** * A stable pseudo-waveform per message (the real one is not stored), so a message always looks the same. */
function waveformOf(seed: string): number[] {
    let hash = 0;

    for (let index = 0; index < seed.length; index++) {
        hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
    }

    const noise = Array.from({ length: BAR_COUNT + 4 }, () => {
        hash = (hash * 1664525 + 1013904223) >>> 0;

        return (hash >>> 8) % 100;
    });

    // * Spiky like a real voice: short bars read as dots between the tall ones.
    return Array.from({ length: BAR_COUNT }, (_, index) => {
        const edge = Math.min(index, BAR_COUNT - 1 - index);
        const fade = Math.min(1, 0.35 + edge / 5);
        const value = noise[index + 2] > 38 ? noise[index + 2] : 6;

        return Math.round(Math.max(8, value * fade));
    });
}

/** * Voice message player: round play button, seekable bar and time, in place of the browser's default controls. */
export function AudioMessage({ src }: { src: string }) {
    const audio = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);

    // * Only one voice message plays at a time.
    useEffect(() => {
        const element = audio.current;
        const pauseOthers = (event: Event) => {
            if (event.target !== element) {
                element?.pause();
            }
        };

        document.addEventListener('play', pauseOthers, true);

        return () => document.removeEventListener('play', pauseOthers, true);
    }, []);

    // * `timeupdate` fires only a few times a second; while playing, the bar follows every frame so it moves smoothly.
    useEffect(() => {
        const element = audio.current;

        if (!playing || element === null) {
            return;
        }

        let frame = requestAnimationFrame(function tick() {
            setCurrent(element.currentTime);
            frame = requestAnimationFrame(tick);
        });

        return () => cancelAnimationFrame(frame);
    }, [playing]);

    const toggle = () => {
        const element = audio.current;

        if (element === null) {
            return;
        }

        if (element.paused) {
            void element.play();
        } else {
            element.pause();
        }
    };

    const progress = duration > 0 ? current / duration : 0;
    const bars = useMemo(() => waveformOf(src), [src]);

    const seek = (event: MouseEvent<HTMLDivElement>) => {
        const element = audio.current;
        const box = event.currentTarget.getBoundingClientRect();

        if (element === null || !Number.isFinite(duration) || duration <= 0) {
            return;
        }

        element.currentTime =
            Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) *
            duration;
        setCurrent(element.currentTime);
    };

    return (
        <div
            className={cn(
                'flex w-80 max-w-full items-center gap-3 rounded-full px-4 py-2.5',
                'bg-primary text-primary-foreground',
            )}
        >
            <audio
                ref={audio}
                src={src}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => {
                    setPlaying(false);
                    setCurrent(0);
                }}
                onTimeUpdate={(event) =>
                    setCurrent(event.currentTarget.currentTime)
                }
                onLoadedMetadata={(event) =>
                    setDuration(event.currentTarget.duration)
                }
                onDurationChange={(event) =>
                    setDuration(event.currentTarget.duration)
                }
            >
                <track kind="captions" />
            </audio>
            <button
                type="button"
                onClick={toggle}
                aria-label={playing ? 'Tạm dừng' : 'Phát tin nhắn thoại'}
                className="flex size-6 shrink-0 items-center justify-center rounded-full p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
                {playing ? (
                    <Pause aria-hidden="true" className="size-5 fill-current" />
                ) : (
                    <Play aria-hidden="true" className="size-5 fill-current" />
                )}
            </button>
            <div
                role="slider"
                tabIndex={0}
                aria-label="Vị trí phát"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration) || 0}
                aria-valuenow={Math.round(current)}
                onClick={seek}
                onKeyDown={(event) => {
                    const element = audio.current;

                    if (element === null) {
                        return;
                    }

                    if (event.key === 'ArrowRight') {
                        element.currentTime += 5;
                    } else if (event.key === 'ArrowLeft') {
                        element.currentTime -= 5;
                    }
                }}
                className="flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-between"
            >
                {bars.map((height, index) => (
                    <span
                        key={index}
                        style={{ height: `${height}%` }}
                        className={cn(
                            'w-[3px] shrink-0 rounded-full transition-colors duration-150',
                            (index + 0.5) / bars.length <= progress
                                ? 'bg-current'
                                : 'bg-current opacity-35',
                        )}
                    />
                ))}
            </div>
            <span className="shrink-0 text-xs tabular-nums">
                {clock(playing || current > 0 ? current : duration)}
            </span>
        </div>
    );
}
