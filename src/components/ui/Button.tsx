import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | "primary"
    | "primary-soft"
    | "secondary"
    | "outline"
    | "warning"
    | "danger"
    | "danger-ghost"
    | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button: React.FC<ButtonProps> = ({
  children,
  className = "",
  variant = "primary",
  size = "md",
  ...props
}) => {
  const baseClasses =
    "font-medium rounded-lg border focus:outline-none transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer active:scale-[0.99]";

  const variantClasses = {
    primary:
      "text-on-accent font-semibold bg-background-ui border-background-ui hover:brightness-105 shadow-[0_0_20px_rgba(212,255,0,0.16)] focus:ring-2 focus:ring-logo-primary/50",
    "primary-soft":
      "text-text bg-logo-primary/15 border-logo-primary/30 hover:bg-logo-primary/25 focus:ring-1 focus:ring-logo-primary",
    secondary:
      "bg-surface-elevated text-text border-line hover:bg-logo-primary/15 hover:border-logo-primary focus:outline-none",
    // For screens where secondary's fill reads as disabled (onboarding)
    outline:
      "text-text bg-surface border-line-strong hover:border-logo-primary focus-visible:ring-1 focus-visible:ring-logo-primary",
    // Secondary's neutral resting look, but hover/focus use the semantic
    // --color-warning token (theme.css)
    warning:
      "text-text bg-surface-elevated border-line hover:bg-warning-wash hover:border-warning focus:ring-1 focus:ring-warning",
    danger:
      "text-background bg-error border-error hover:bg-error/80 hover:border-error/80 focus:ring-1 focus:ring-error",
    "danger-ghost":
      "text-error border-transparent hover:bg-error-wash focus:bg-error-wash",
    ghost:
      "text-current border-transparent hover:bg-wash hover:border-logo-primary focus:bg-line",
  };

  const sizeClasses = {
    sm: "px-2 py-1 text-xs",
    md: "px-4 py-[5px] text-sm",
    lg: "px-4 py-2 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};
