import { useEffect, useState } from "react";

const ACCENTS = [
  "text-accent-blue",
  "text-accent-red",
  "text-accent-yellow",
  "text-accent-green",
] as const;

/**
 * Giant wordmark. Hovering a letter tints it with a cycling accent color.
 * Only the final character auto-cycles through the accents on a loop.
 */
export function Wordmark({ text }: { text: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const lastIndex = text.length - 1;

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 900);
    return () => window.clearInterval(id);
  }, []);

  return (
    <h1 className="wordmark flex w-full items-center justify-center text-center text-[19vw] whitespace-pre select-none">
      {text.split("").map((char, i) => {
        const isLast = i === lastIndex;
        const color =
          hovered === i
            ? ACCENTS[i % ACCENTS.length]
            : isLast
              ? ACCENTS[tick % ACCENTS.length]
              : "text-foreground";

        return (
          <span
            key={`${char}-${i}`}
            onPointerEnter={() => setHovered(i)}
            onPointerLeave={() => setHovered((h) => (h === i ? null : h))}
            className={`transition-colors duration-500 ${color}`}
          >
            {char}
          </span>
        );
      })}
    </h1>
  );
}

export default Wordmark;
