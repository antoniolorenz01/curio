// Plain CSS inside a closed shadow root: the page's styles can't leak in, ours can't leak out.
export const styles = `
:host {
  all: initial;
  --bg: #ffffff;
  --fg: #1c1917;
  --muted: #78716c;
  --border: #e7e5e4;
  --subtle: #f5f5f4;
  --accent: #b45309;
  --accent-fg: #ffffff;
  --bad: #b91c1c;
  --shadow: 0 8px 28px rgb(0 0 0 / 0.14), 0 2px 6px rgb(0 0 0 / 0.08);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :host {
    --bg: #1f1e1c;
    --fg: #f5f5f4;
    --muted: #a8a29e;
    --border: #3a3633;
    --subtle: #2a2826;
    --accent: #f59e0b;
    --accent-fg: #1c1917;
    --bad: #f87171;
    --shadow: 0 8px 28px rgb(0 0 0 / 0.5), 0 2px 6px rgb(0 0 0 / 0.3);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; margin: 0; }
button { font: inherit; color: inherit; cursor: pointer; border: 0; background: none; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.bubble {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg);
  font: 600 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
  box-shadow: var(--shadow);
  animation: pop 0.12s ease-out;
}
.bubble:hover { background: var(--subtle); }
.mark { width: 20px; height: 20px; flex: none; }

.panel {
  position: fixed;
  z-index: 2147483647;
  right: 20px;
  bottom: 20px;
  width: min(320px, calc(100vw - 32px));
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg);
  color: var(--fg);
  font: 400 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif;
  box-shadow: var(--shadow);
  animation: rise 0.16s ease-out;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  overscroll-behavior: contain;
}
.panel.compact { width: auto; max-width: min(320px, calc(100vw - 32px)); padding: 8px 12px; color: var(--muted); }
.panel.error { color: var(--bad); }

.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.tag { font-size: 11px; font-weight: 600; color: var(--accent); }
.close { width: 22px; height: 22px; border-radius: 6px; color: var(--muted); font-size: 14px; line-height: 1; }
.close:hover { background: var(--subtle); color: var(--fg); }
.text { font-size: 14px; line-height: 1.5; white-space: pre-line; }

.thread:empty { display: none; }
.more { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
.more .q { margin-bottom: 4px; color: var(--muted); font-size: 12px; font-weight: 600; }
.more .a { font-size: 13px; line-height: 1.5; white-space: pre-line; }
.more .a.failed { color: var(--bad); }
.explore { display: flex; gap: 6px; margin-top: 10px; }
.ask { display: flex; flex: 1; gap: 6px; }
.input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  color: var(--fg);
  font: inherit;
  font-size: 12px;
}
.input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.btn {
  height: 26px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg);
  font-size: 12px;
  font-weight: 500;
}
.btn:hover { background: var(--subtle); }
.btn.primary { border-color: var(--fg); background: var(--fg); color: var(--bg); }
.btn.primary:hover { opacity: 0.9; }
.btn.ghost { border-color: transparent; color: var(--muted); margin-left: auto; }
.btn.ghost:hover { color: var(--fg); }
.btn:disabled { opacity: 0.6; cursor: default; }

.dots::after { content: '…'; animation: blink 1s steps(3) infinite; }

@keyframes pop { from { transform: scale(0.85); opacity: 0; } }
@keyframes rise { from { transform: translateY(8px); opacity: 0; } }
@keyframes blink { 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .bubble, .panel, .dots::after { animation: none; } }
`;
