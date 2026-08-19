# Gen-Z Meet — Full Stack (CodeAlpha Internship Project)
A modern, high-contrast, real-time video conferencing and collaboration workspace built with React, WebRTC, Firebase, and Express.

---

## ✨ Features

- 📹 **Multi-User Video & Audio (WebRTC)**
  - Mesh peer-to-peer real-time video and audio streaming.
  - Multi-tier device fallback for camera and microphone access.
  - Interactive grid tiles for host and participants with live status indicators.

- 🎙️ **Live Transcription & Audio Visualizer**
  - Real-time in-browser speech-to-text transcription powered by the Web Speech API.
  - Reactive audio wave visualizer for speaking activity.

- 🎨 **Collaborative Real-Time Whiteboard**
  - Interactive drawing canvas with pen, shapes (rectangle, circle, line), eraser, color pickers, and stroke sizes.
  - Real-time multi-user synchronization via Firestore.
  - Export whiteboard drawings directly as PNG.

- 📁 **In-Meeting File Sharing**
  - Streamlined file uploads (documents, images, slides) during active rooms.
  - Real-time file list updates and instant download access for all participants.

- 🖥️ **Screen Sharing**
  - One-click screen, window, or browser tab sharing using `getDisplayMedia`.

- 💬 **Live In-Room Chat**
  - Instant text messaging with timestamped messages and participant identity.

- 🤖 **AI-Powered Meeting Notes**
  - Post-meeting AI summary generating Key Points, Decisions, Action Items, and Next Steps.

- 🔐 **Authentication & Shareable Links**
  - Firebase Authentication (Email/Password & Session management).
  - Guest access mode allowing participants to join via unique meeting links with custom display names.

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, TailwindCSS, Lucide Icons |
| **Real-Time & Signaling** | WebRTC (Mesh), Firebase Firestore |
| **Authentication** | Firebase Auth |
| **Backend API** | Node.js, Express 5, TypeScript |
| **Database & ORM** | PostgreSQL, Drizzle ORM |
| **Monorepo Tooling** | PNPM Workspaces |

---

## 📂 Project Structure

```
gen-z-meet/
├── artifacts/
│   ├── gen-z-meet/              # Frontend React application (Vite)
│   │   ├── src/
│   │   │   ├── components/      # UI Shell, Whiteboard, File Sharing, Chat
│   │   │   ├── lib/             # WebRTC, Firebase, Auth Context, Files API
│   │   │   └── pages/           # Meeting Room, Dashboard, History, Profile
│   │   └── vite.config.ts
│   └── api-server/              # Express API Server
│       └── src/
│           ├── routes/          # Meetings, Files, Notes, Profile routes
│           └── index.ts
├── lib/
│   ├── api-spec/                # OpenAPI specification & codegen
│   └── db/                      # PostgreSQL Drizzle schema & migrations
├── package.json
└── pnpm-workspace.yaml
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js** 20+
- **PNPM** 9+ (`npm install -g pnpm`)

### 2. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/Haseeba-rani/gen-z-meet.git
cd gen-z-meet
pnpm install
```

### 3. Environment Configuration
Create an `.env` file in `artifacts/gen-z-meet/.env` with your Firebase project configuration:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 4. Running the Development Server
Start both the frontend and API server concurrently:
```bash
pnpm run dev
```

- **Frontend App**: `http://localhost:5173`
- **API Server**: `http://localhost:8080`

---

## 🧪 Available Scripts

| Command | Description |
| :--- | :--- |
| `pnpm run dev` | Runs frontend and API server in parallel |
| `pnpm run dev:frontend` | Runs only the Vite frontend app |
| `pnpm run dev:api` | Runs only the Express API backend |
| `pnpm run build` | Typechecks and compiles all packages for production |
| `pnpm run typecheck` | Validates TypeScript across all workspaces |

---

## 📜 License
MIT License.
