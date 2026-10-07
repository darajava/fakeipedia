"use client";

import { useSyncExternalStore } from "react";

const storageKey = "fakeipedia-theme";

function subscribe(onChange: () => void) {
  const root = document.documentElement;
  const observer = new MutationObserver(onChange);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const followSystem = () => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "light" || saved === "dark") return;
    } catch { /* Storage can be unavailable in private browsing. */ }
    root.dataset.theme = media.matches ? "dark" : "light";
  };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    root.dataset.theme = event.newValue === "light" || event.newValue === "dark"
      ? event.newValue : media.matches ? "dark" : "light";
  };
  media.addEventListener("change", followSystem);
  window.addEventListener("storage", syncStorage);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", followSystem);
    window.removeEventListener("storage", syncStorage);
  };
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe,
    () => document.documentElement.dataset.theme === "dark", () => false);

  function toggle() {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(storageKey, theme); } catch { /* Still switch this page. */ }
  }

  return (
    <div className="header-actions">
      <button type="button" className="theme-toggle" aria-label="Dark mode" title={dark ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={dark} onClick={toggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M20.5 13.2A8.6 8.6 0 0 1 10.8 3.5a8.6 8.6 0 1 0 9.7 9.7Z" />
        </svg>
      </button>
    </div>
  );
}
