import React from "react";

interface SettingsGroupProps {
  title?: string;
  description?: string;
  children: React.ReactNode;
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  title,
  description,
  children,
}) => {
  return (
    <div className="space-y-2">
      {title && (
        <div className="px-4">
          <h2 className="text-xs font-medium text-ink-3 uppercase tracking-wide">
            {title}
          </h2>
          {description && (
            <p className="text-xs text-ink-3 mt-1">{description}</p>
          )}
        </div>
      )}
      <div className="bg-surface border border-line rounded-xl overflow-visible shadow-[0_0_0_1px_rgba(255,255,255,0.02)] transition-colors duration-200">
        <div className="divide-y divide-line">{children}</div>
      </div>
    </div>
  );
};
