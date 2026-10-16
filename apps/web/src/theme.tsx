import { useEffect, useState } from "react";

type Theme = "system" | "light" | "dark";
const KEY = "keplar.theme";

function read(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function applyStoredTheme() {
  const t = read();
  if (t !== "system") document.documentElement.dataset.theme = t;
}

const NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Theme, string> = { system: "Theme: system", light: "Theme: light", dark: "Theme: dark" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(read);
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  }, [theme]);
  return (
    <button type="button" className="icon-button" onClick={() => setTheme(NEXT[theme])} title={LABEL[theme]}>
      <span className="visually-hidden">{LABEL[theme]}. Change theme</span>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        {theme !== "light" && <path d="M9 2.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />}
        {theme === "system" && <path d="M9 2.75v12.5" stroke="currentColor" strokeWidth="1.5" />}
      </svg>
    </button>
  );
}
