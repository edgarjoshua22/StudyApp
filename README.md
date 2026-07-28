# StudyApp

Duolingo-inspired mobile learning app. Upload course handouts (PDFs), get a personalized hexagonal learning path, an AI tutor grounded in your own materials, and AI-generated quizzes.

## What it does

- **Upload handouts** — PDFs (including scanned/image-only via Gemini vision) get chunked, embedded, and stored for retrieval
- **StudyBuddy chat** — RAG-based AI tutor over your materials, with Google web search fallback
- **Concept brain** — knowledge graph extracted from your handouts, connected across documents and prerequisite courses
- **Beehive learning path** — hexagonal Duolingo-style path auto-derived from your materials, paced against exam dates
- **Quizzes** — auto-generated per lesson/topic/classroom
- **Gamification** — XP, streaks, daily goals, quests
- **Reminders** — local notifications + calendar integration for exams

## Tech stack

| Layer | Tech |
|---|---|
| Mobile | React Native (Expo 54), React 19, React Navigation |
| Backend | Python FastAPI |
| AI | Google Gemini (text generation + embeddings) |
| Database | Supabase (PostgreSQL + Storage) |
| Dev tunnel | ngrok |

```
Mobile App (Expo)  ──REST──>  Backend (FastAPI)  ──>  Google Gemini
                                     │
                                     v
                              Supabase (Postgres + Storage)
```

## Project structure

```
App.js              app entry
components/          screens (Classrooms, LessonPath, Chat, Quiz, Streak, Quests, ...)
lib/                 client helpers (api, supabase, notifications)
backend/             FastAPI service (main.py, llm.py, auth.py, cache.py)
assets/              icons, splash, images
android/             native Android project
```

## Getting started

### Mobile app

```bash
npm install
npx expo start
```

Requires a `.env.local` with:
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_API_URL=
```

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Requires a `.env` with Supabase and Gemini API credentials (see `backend/main.py` for expected variables).

## License

Private project, all rights reserved.
