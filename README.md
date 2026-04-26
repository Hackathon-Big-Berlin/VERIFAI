# AI Voice Assistant: Debate Coach & Interviewer

This project is a real-time, voice fact checker for the ai-coustics/telli track built using the partner technologies Google Gemini, Lovable, Tavily and Gradium. It takes in speech using LiveKit STT and preprocesses it with ai-coustics. This is then run through a fact-checking pipeline utilizing Tavily for research and Google Gemini for claim extraction and finalizing the verdict of the claim. We use a sliding window of context so that the verdicts are sent to the frontend in real time. These are displayed on a modern dashboard designed using Lovable.

## Key Features

* **Live fact checking:** Low latency voice conversations where facts can be checked live, in order to prevent the spreading of misinformation and ensure speakers give evidence-backed arguments.

* **Live Transcript & Chat:** Real-time speech-to-text rendering visible directly in the application.

* **Debate Coach Mode:** The user can enter debate mode and converse with a specialized debate partner, that tells gives you advice on where you went wrong in your argument and points that you should've included. At the end of the debate the user receieves an evaluation score which rates how the project will be run.
  
* **Interview Mode:** This is for journalists that want instant feedback for when a claim is false, so that they can react instantly. When a claim is flagged as false, a voice notification is sent instantly and spoken out loud using the Gradium TTS plugin for LiveKit.
  
## Tech Stack

**Frontend**
* Lovable (CSS, TailwindCSS, React, TypeScript)

**Backend**
* Python
* LiveKit Agents Framework
* **LLM:** Google Gemini
* **Speech-to-Text / Audio processing:** Deepgram and ai-coustics
* **Deep research of claims:** Tavily API
* **TTS:** Gradium

## Installation
### Prepare
1. Install ```python``` and ```uv``` 
1. Configure the following API keys in a ```.env ```file in the backend folder: GEMINI_API_KEY, TAVILY_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, DEEPGRAM_API_KEY, VITE_LIVEKIT_URL, VITE_LIVEKIT_TOKEN, GRADIUM_API_KEY
3. run ```python3 -m venv venv```
4. run ```venv\Scripts\activate```
5. run ```pip install -e ".[dev]"```
6. run ```npm install```
### Run
1. Terminal 1: ```npm run dev```
2. Terminal 2: ```cd backend, uv run python src/agent.py dev```
