# Aura AI 🌈🧠

**Aura AI** is a mood-aware chat and audio interaction web application designed to enhance emotional wellness. Built with Flask, it provides a personalized user experience by tracking mood history, playing audio responses, and offering chat-based interaction — all through a clean, minimal dashboard interface.

---

## 🎯 Key Features

- 🔐 User login system with session handling
- 💬 Interactive chat interface with saved conversations
- 🎧 Mood-based audio feedback using `.mp3` files
- 📈 Personal dashboard showing mood trends
- 📁 JSON-based storage (users, conversations, mood history)
- ⚙️ Simple and extendable Flask architecture

---

## 🛠️ Technologies Used

- **Backend**: Python, Flask
- **Frontend**: HTML5, CSS3, JavaScript
- **Storage**: JSON (lightweight, easy-to-read data handling)
- **Audio**: Static MP3s for emotion-based response

---

## 📁 Folder Structure

Aura-AI/
│
├── app.py # Main Flask app
├── requirements.txt # Dependencies
│
├── data/ # JSON-based user & mood data
│ ├── users.json
│ ├── conversations/
│ └── mood_history/
│
├── static/ # Frontend assets
│ ├── css/styles.css
│ ├── js/script.js
│ └── audio/
│ ├── happy_song.mp3
│ └── 121.mp3
│
└── templates/ # Flask HTML templates
├── login.html
├── dashboard.html
└── chat.html
