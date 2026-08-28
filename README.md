# Project Zenith Scaffold

Build this exact landing page design as the home page, and set up the project backend — this is a hackathon scaffold, no other features yet:

VISUAL STYLE:
- Full-screen, near-black background (almost pure black, very slightly blue-tinted dark)
- One giant, bold word centered on the screen, sized to fill most of the screen width (responsive, huge on desktop, still readable on mobile): "PROJECT 5"
- FONT: do not add or import any custom font (no Google Fonts, no font files). Use the browser's plain default system font stack only, rendered bold, with letters pulled tightly together (tight/negative letter-spacing).
- Behind the word, an animated canvas backdrop: soft dots slowly drifting around the screen, each dot connected to nearby dots with thin, faint lines (like a loose constellation/web effect). The whole field gently shifts/parallaxes based on mouse position, and dots + lines near the cursor brighten slightly. Respect prefers-reduced-motion (freeze the drift if the user has that setting on).
- A soft ambient glow in the center behind the text, plus a vignette (darker edges, lighter center) so the wordmark stays the visual focus
- Hovering over individual letters in the wordmark changes that letter's color — cycle through blue, red, yellow, green across different letters as hover accents
- The very LAST character of the word (only the last character, index = word length minus 1) should auto-cycle continuously through those same colors on a loop, even without hovering, as a subtle branding flourish. No other letter should auto-cycle.
- Below the wordmark: a white pill-shaped "Sign in with Google" button with the standard multi-color Google "G" icon, black text, that scales up slightly on hover
- Text/foreground color: white. Accent colors: blue, red, yellow, green (soft, not neon — muted/desaturated tones)
- No navbar, no footer, no other page content — just the centered wordmark, backdrop animation, and sign-in button
- Use React + Tailwind + shadcn/ui, keep it clean and componentized (e.g. a separate backdrop component for the animated canvas)

BACKEND SETUP:
- Enable Lovable Cloud for this project (database, authentication, file storage, and backend functions) so the environment is ready to build on.
- Separately, enable the Lovable AI Gateway / built-in AI connector so it's provisioned and ready. Do NOT set or prefer any specific model — leave it at default, do not configure or select Claude.

This is one of 5 scaffold projects for a one-day hackathon called DevFest — we'll build the actual feature on top of this once we pick an idea, so just get this landing page and backend environment set up correctly and don't add anything beyond it.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fa9b4353-448c-4ac4-85ed-cda4336fd31f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
