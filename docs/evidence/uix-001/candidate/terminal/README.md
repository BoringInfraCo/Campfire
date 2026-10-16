# Terminal frame captures

These files are captures of the pty frame for visual review of clipping. They are not a human observation and not Terminal.app chrome.

`ana-lab-80x24.txt` and `ana-lab-80x24.png` are the 80×24 frame. `ana-lab-120x36.txt` and `ana-lab-120x36.png` are the 120×36 frame. Each text file is the last complete frame after the final clear, with CSI/OSC and cursor controls removed. Each screenshot is that text in a monospace `pre` on `#171717`, not a terminal emulator window.

Vitest: `npx vitest run tests/unit/uix-001-dashboard-pty.test.ts` — pass, 4 tests.
