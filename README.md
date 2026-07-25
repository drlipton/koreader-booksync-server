# 📚 KOReader BookSync & WebDAV Server

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![KOReader](https://img.shields.io/badge/KOReader-Cloud%20Storage%20%26%20Kosync-blue.svg)](https://koreader.rocks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An all-in-one, lightweight **WebDAV Server**, **Mobile Book Manager**, and **KOReader Reading Progress Sync (Kosync) Server** built specifically for KOReader e-readers (Kindle, Kobo, Android, PocketBook, PC).

---

## ✨ Features

- 📖 **WebDAV Cloud Storage**: RFC 4918 compliant WebDAV server optimized for KOReader's Cloud Storage module.
- 🔄 **Integrated Progress Sync (Kosync)**: Built-in Kosync REST API for syncing page numbers, reading percentages, and bookmarks across multiple e-readers.
- 📱 **Mobile Web Manager**: Modern, responsive dark-mode web dashboard to upload, search, manage, and organize EPUBs, PDFs, MOBIs, and CBZ comics from your phone or desktop.
- 🎨 **EPUB Metadata & Cover Extractor**: Automatically parses EPUB titles, authors, and extracts cover thumbnails right in the Web UI.
- ⚡ **Smart Cross-Device Sync Matcher**: Syncs reading progress across devices seamlessly even if file hashes vary slightly between devices.
- 🔐 **Permissive Auth Engine**: Zero-friction setup supporting both authenticated and anonymous connections.
- 🤖 **Systemd Integration**: Automatic background daemon configuration for Linux systems with auto-restart on boot.

---

## 🚀 Quick Start (1-Command Installation)

Run the included automated setup script on your Linux machine or Raspberry Pi:

```bash
git clone https://github.com/drlipton/koreader-booksync-server.git
cd koreader-booksync-server
./setup.sh
```

The installer will install NPM dependencies, set up directory structures, configure a systemd user daemon (`koreader-sync.service`), and start the server automatically!

---

## 📱 KOReader Configuration Guide

### 1. WebDAV Book Downloads
1. Open KOReader on your e-Reader.
2. Tap top menu -> **Cloud Storage** -> **Add new cloud storage** -> **WebDAV**.
3. Fill in the fields:
   - **Server URL**: `http://<YOUR_SERVER_IP>:8085/dav/`
   - **Username**: *(leave blank or enter any username)*
   - **Password**: *(leave blank or enter any password)*
   - **Start folder**: `/`
4. Tap **Connect**. You can now browse, search, and download your books wirelessly!

### 2. Reading Position Sync (Kosync)
1. Tap top menu -> **Settings (gear icon)** -> **Progress sync**.
2. Set **Custom sync server** to: `http://<YOUR_SERVER_IP>:8085/`
3. Tap **Log in** or **Create account** and enter your username (e.g. `joel`) and password.
4. Your page number and reading percentage will now sync automatically between all your devices!

---

## 📂 Project Structure

```text
├── src/
│   ├── server.js          # Express & WebDAV server implementation
│   ├── epub-helper.js     # EPUB metadata & cover image extractor
│   └── kosync.js          # Kosync API & cross-device progress matcher
├── public/                # Mobile Web Manager frontend
│   ├── index.html         # Web UI HTML
│   ├── style.css          # Glassmorphism dark mode CSS
│   └── app.js             # Client UI logic & QR code helper
├── setup.sh               # Automated Linux setup script
├── package.json           # Dependencies
└── README.md              # Documentation
```

---

## 🛠️ Systemd Management Commands

```bash
# Check service status
systemctl --user status koreader-sync

# Restart server
systemctl --user restart koreader-sync

# View live service logs
journalctl --user -u koreader-sync -f
```

---

## 📄 License

MIT License. Free to use, modify, and distribute for personal e-reading setups!
