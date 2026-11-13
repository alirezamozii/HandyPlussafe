import React from "react";

export type GradeLetter = "A" | "B" | "C" | "D" | "F" | "none";

interface GradeChipProps {
  letter: GradeLetter;
  /** What the chip says: "A+", "B−", or "—" / "?" when there's no grade. */
  label: string;
  /** Optional international accuracy percentage (e.g., 97 for 97% accuracy). */
  accuracy?: number;
  /** Narrow, for past five languages in a row of columns. */
  dense?: boolean;
}

// Each letter's full class set, so no two classes compete for a property.
const LETTER_CLASSES: Record<GradeLetter, string> = {
  A: "text-on-accent font-bold border-transparent bg-logo-primary",
  B: "text-text font-bold border-transparent bg-line",
  C: "text-text font-bold bg-transparent border-ink-3",
  D: "text-text font-bold bg-transparent border-dashed border-ink-3",
  F: "text-text font-bold bg-transparent border-transparent",
  none: "text-ink-3 font-medium bg-transparent border-transparent",
};

/** A model's accuracy grade for one language, with optional percentage for international clarity. */
export const GradeChip: React.FC<GradeChipProps> = ({
  letter,
  label,
  accuracy,
  dense = false,
}) => {
  const showPercent = !dense && accuracy != null && letter !== "none";
  return (
    <span
      className={`inline-flex items-center justify-center gap-[3px] rounded-chip border font-display leading-none h-[22px] ${
        dense
          ? "min-w-[24px] px-[3px] text-tag"
          : showPercent
            ? "min-w-[54px] px-[6px] text-small"
            : "min-w-[30px] px-[5px] text-small"
      } ${LETTER_CLASSES[letter]}`}
    >
      {/* Trim to cap height so the letter is centered. */}
      <span className="block [text-box:trim-both_cap_alphabetic]">{label}</span>
      {showPercent && (
        <span className="text-[10px] font-mono font-semibold opacity-80 tabular-nums [text-box:trim-both_cap_alphabetic]">
          {accuracy}%
        </span>
      )}
    </span>
  );
};
