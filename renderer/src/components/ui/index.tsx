import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

// Shared control primitives. Centralizes the dark pro-CAD button styling that
// was previously hardcoded per call-site (toolbar, composer, tree).

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Toolbar pill. `active` = currently-selected/toggled-on state. */
export function ToolbarButton({
  active,
  className,
  ...props
}: BtnProps & { active?: boolean }) {
  return (
    <button
      {...props}
      className={cn(
        "px-3 py-0.5 rounded text-xs font-medium transition-colors disabled:opacity-40",
        active
          ? "bg-white/10 text-gray-100"
          : "text-gray-400 hover:text-gray-200 hover:bg-white/5",
        className,
      )}
    />
  );
}

/** Outlined action button (Re-render, Export, etc.). */
export function ActionButton({ className, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cn(
        "px-2 py-0.5 text-xs border border-white/10 rounded text-gray-300",
        "hover:border-white/30 hover:text-gray-100 transition-colors disabled:opacity-40",
        className,
      )}
    />
  );
}

/** Square icon button. */
export function IconButton({ className, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cn(
        "grid place-items-center w-7 h-7 rounded text-gray-400",
        "hover:text-gray-100 hover:bg-white/5 transition-colors disabled:opacity-40",
        className,
      )}
    />
  );
}

/** Small suggestion chip (composer quick-actions). */
export function Chip({ className, ...props }: BtnProps) {
  return (
    <button
      {...props}
      className={cn(
        "px-2 py-0.5 text-[11px] rounded-full border border-white/10 text-gray-400",
        "hover:border-white/30 hover:text-gray-200 transition-colors",
        className,
      )}
    />
  );
}

/** Thin vertical divider for separating toolbar control groups. */
export function Divider() {
  return <div className="w-px h-4 bg-white/10 mx-1.5" />;
}

/** A segmented group of mutually-exclusive options. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  render?: (v: T) => ReactNode;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {options.map((opt) => (
        <ToolbarButton
          key={opt}
          active={value === opt}
          onClick={() => onChange(opt)}
        >
          {render ? render(opt) : opt}
        </ToolbarButton>
      ))}
    </div>
  );
}
