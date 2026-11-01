/** * Coloured letter square used for platforms across the app (same look as the Integrations sidebar). */
export function PlatformLogo({
    letter,
    color,
}: {
    letter: string;
    color: string;
}) {
    return (
        <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-bold text-white"
            style={{ backgroundColor: color }}
        >
            {letter}
        </span>
    );
}
