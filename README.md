# Toma Ciobotenco — Sound Design Portfolio

Static site (no build step) for GitHub Pages.

- `index.html` / `style.css` — page layout and styling
- `main.js` — three.js particle cassette (reacts to the video's audio while it plays)
- `assets/cassette.bin` — particle point cloud baked from the cassette mesh of `portable_cassette_player_2k.fbx`, coloured from its diffuse texture
- `assets/cult-of-the-lamb-sound-redesign.mp4` — portfolio video

Run locally: `python3 -m http.server` in this folder, then open http://localhost:8000 (opening the file directly won't load the particles).
