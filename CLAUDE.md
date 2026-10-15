# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JS Tetris (HTML5 Canvas, no dependencies, no build, no tests, no linter). README and UI text are in Spanish.

## Running

Open `index.html` directly, or serve statically (`python -m http.server 8000`, `npx serve .`). Verify changes manually in the browser.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css`, and `game.js` (all logic, loaded as a classic script with `'use strict'`; no modules).

Key points in `game.js` that span multiple functions:

- **State is module-level globals** (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `animId`, ...) declared in one `let` and reset by `init()`. Restart button just calls `init()`.
- **Piece encoding**: `PIECES[type]` matrices store the type index (1–8; 8 = the "tuerca" ring with an empty center) in filled cells; the same index is stored in `board` after `merge()` and is the index into `COLORS`. `0` = empty. Changing piece order means keeping `COLORS` and `PIECES` aligned. `randomPiece()` draws uniformly from `1..PIECES.length - 1`.
- **Piece lifecycle**: `spawn()` promotes `next` → `current`, generates a new `next`, and calls `endGame()` if the spawn position collides. `lockPiece()` = `merge()` → `clearLines()` → `spawn()`. Hard drop, soft drop (when blocked) and the gravity tick in `loop()` all funnel through `lockPiece()`.
- **Game loop**: `requestAnimationFrame` `loop(ts)` accumulates `dropAccum` and drops one row when it exceeds `dropInterval` (recomputed in `clearLines()` from level). Pause/game over use `cancelAnimationFrame(animId)`; resuming resets `lastTime` and restarts `loop`.
- **Rendering**: `draw()` repaints everything each frame (grid, board, ghost via `ghostY()` at alpha 0.2, current piece). `drawNext()` only runs from `spawn()`. Both use `drawBlock(context, x, y, colorIndex, size, alpha)`.
- **Canvas size is coupled** to constants: `index.html` `<canvas id="board">` must be `COLS*BLOCK` × `ROWS*BLOCK` (300×600), and the next-piece canvas is 120×120 (4 cells × 30).
- Rotation (`tryRotate`) is simple CW rotation with horizontal-only kicks `[0, -1, 1, -2, 2]` (not SRS).
