# AI Voice Assistant: Debate Coach & Interviewer

This project is a real-time, interactive AI voice assistant built using LiveKit, Google Gemini, and React. It serves as a sophisticated conversational partner capable of conducting mock interviews, engaging in debates, and performing live fact-checking as you speak.

## ✨ Key Features

* 🎙️ **Real-time Voice Interaction:** Ultra-low latency voice conversations powered by the LiveKit Agents framework and Deepgram.
* ⚖️ **Debate Coach Mode:** Engages users in dynamic debates, providing counter-arguments, structural feedback, and logical analysis.
* 👔 **Interview Mode:** Simulates professional interview scenarios to help users practice and refine their communication skills.
* 🔍 **Live Fact-Checking:** Automatically detects claims made during the conversation, verifies them using Tavily search, and displays the truthfulness rating instantly in the UI.
* 📜 **Live Transcript & Chat:** Real-time speech-to-text rendering and chat history visible directly in the application dashboard.

## 🛠️ Tech Stack

**Frontend (Web Dashboard)**
* React & Vite
* TailwindCSS & shadcn/ui (UI Components)
* LiveKit React Components (WebRTC / WebSockets)

**Backend (AI Agent)**
* Python 3.10+
* LiveKit Agents Framework
* **LLM:** Google Gemini (`google-genai`)
* **Speech-to-Text / Audio processing:** Deepgram & Silero VAD
* **Search / Fact-checking:** Tavily API

## 📂 Project Structure

* `/src/` - The React/Vite frontend. Contains UI components for the transcript, fact-check side-panel, debate mode toggles, and LiveKit room hooks.
* `/backend/` - The Python AI agent environment. Contains the core logic for the assistant (`agent.py`), context loading, the debate coach persona, and the real-time fact-checking engine.
