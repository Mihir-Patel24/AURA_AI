import os
import json
import datetime
import base64
import cv2
import numpy as np
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from deepface import DeepFace
import google.generativeai as genai
from dotenv import load_dotenv
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- Gemini API Configuration ---
GEMINI_API_KEY ="AIzaSyCO19-BFJxgNokSstOO30Iox2CRdo_TBfg"
if not GEMINI_API_KEY:
    print("Error: GEMINI_API_KEY not found in .env file. Please set it.")
    # For critical errors like this, you might want to exit or raise an exception
    # raise ValueError("GEMINI_API_KEY not found in .env file.")
else:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_model = genai.GenerativeModel('gemini-2.5-flash-preview-05-20')
    except Exception as e:
        print(f"Error configuring Gemini API: {e}")
        gemini_model = None # Handle cases where Gemini might not be available


# --- Data Storage Paths ---
DATA_DIR = 'data'
USERS_FILE = os.path.join(DATA_DIR, 'users.json')
CONVERSATIONS_DIR = os.path.join(DATA_DIR, 'conversations')
MOOD_HISTORY_DIR = os.path.join(DATA_DIR, 'mood_history')

# --- Ensure data directories exist ---
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(CONVERSATIONS_DIR, exist_ok=True)
os.makedirs(MOOD_HISTORY_DIR, exist_ok=True)

# --- Helper Functions ---
def load_users():
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, 'w') as f: # Create if not exists
            json.dump({}, f)
        return {}
    try:
        with open(USERS_FILE, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError:
        return {} # Return empty if file is corrupted

def save_users(users):
    with open(USERS_FILE, 'w') as f:
        json.dump(users, f, indent=4)

def get_user_conversation_file(username):
    return os.path.join(CONVERSATIONS_DIR, f"{secure_filename(username)}_conversation.json")

def get_user_mood_history_file(username):
    return os.path.join(MOOD_HISTORY_DIR, f"{secure_filename(username)}_mood_history.json")

def save_conversation(username, user_message, bot_message):
    if not username: return
    filepath = get_user_conversation_file(username)
    history = []
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []
    history.append({
        "user": user_message,
        "bot": bot_message,
        "timestamp": datetime.datetime.now().isoformat()
    })
    with open(filepath, 'w') as f:
        json.dump(history, f, indent=4)

def load_conversation(username):
    if not username: return []
    filepath = get_user_conversation_file(username)
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []
    return []

def save_mood_entry(username, mood):
    if not username: return
    filepath = get_user_mood_history_file(username)
    history = []
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []
    history.append({
        "mood": mood,
        "timestamp": datetime.datetime.now().isoformat()
    })
    with open(filepath, 'w') as f:
        json.dump(history, f, indent=4)

def load_mood_history(username):
    if not username: return []
    filepath = get_user_mood_history_file(username)
    if os.path.exists(filepath):
        with open(filepath, 'r') as f:
            try:
                return json.load(f)
            except json.JSONDecodeError:
                return []
    return []

# --- Routes ---
@app.route('/')
def index():
    if 'username' in session:
        return redirect(url_for('chat_page'))
    return redirect(url_for('login_page'))

@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            return render_template('login.html', error="Username and password are required.")

        users = load_users()
        if username in users and users[username] == password: # Plain text comparison (BAD for prod)
            session['username'] = username
            return redirect(url_for('chat_page'))
        else:
            return render_template('login.html', error="Invalid username or password.")
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    username = request.form.get('username')
    password = request.form.get('password')

    if not username or not password:
        return render_template('login.html', error="Username and password are required for registration.", is_register_error=True)

    users = load_users()
    if username in users:
        return render_template('login.html', error="Username already exists. Please choose another.", is_register_error=True)

    users[username] = password # Store plain text password - BAD for production!
    save_users(users)
    session['username'] = username
    return redirect(url_for('chat_page'))


@app.route('/logout')
def logout():
    session.pop('username', None)
    return redirect(url_for('login_page'))

@app.route('/chat')
def chat_page():
    if 'username' not in session:
        return redirect(url_for('login_page'))
    return render_template('chat.html', username=session['username'])

@app.route('/dashboard')
def dashboard_page():
    if 'username' not in session:
        return redirect(url_for('login_page'))
    mood_data = load_mood_history(session['username'])
    return render_template('dashboard.html', username=session['username'], mood_history=mood_data)

@app.route('/process_video', methods=['POST'])
def process_video():
    if 'username' not in session:
        return jsonify({"error": "Not authenticated"}), 401

    data = request.get_json()
    if not data or 'image' not in data:
        return jsonify({"error": "No image data"}), 400

    image_data = data['image'].split(',')[1]

    try:
        nparr = np.frombuffer(base64.b64decode(image_data), np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({"error": "Could not decode image"}), 400

        # Using a lightweight detector and emotion model for potentially faster processing
        # Consider 'retinaface' or 'mtcnn' if 'opencv' struggles with detection.
        # 'SFace' is a light model for recognition, not directly for emotion, but DeepFace handles this.
        analysis_results = DeepFace.analyze(
            frame,
            actions=['emotion'],
            detector_backend='opencv', # or 'ssd', 'dlib', 'mtcnn', 'retinaface'
            enforce_detection=False # Don't error if no face found, just return empty/neutral
        )

        dominant_emotion = "neutral"
        if isinstance(analysis_results, list) and len(analysis_results) > 0 and 'dominant_emotion' in analysis_results[0]:
            dominant_emotion = analysis_results[0]['dominant_emotion']
        elif isinstance(analysis_results, dict) and 'dominant_emotion' in analysis_results: # Should not happen with enforce_detection=False for list output
             dominant_emotion = analysis_results['dominant_emotion']

        save_mood_entry(session['username'], dominant_emotion)
        return jsonify({"mood": dominant_emotion})

    except Exception as e:
        print(f"Error in mood detection: {e}")
        return jsonify({"mood": "neutral", "error_detail": str(e)})


@app.route('/chat_message', methods=['POST'])
def chat_message():
    if 'username' not in session:
        return jsonify({"error": "Not authenticated"}), 401
    if not gemini_model:
        return jsonify({"reply": "Sorry, the chat service is currently unavailable.", "error_detail": "Gemini model not loaded."})


    data = request.get_json()
    user_input = data.get('message', '')
    current_mood = data.get('mood', 'neutral')

    bot_response = "I'm sorry, I couldn't generate a response at this moment."
    action = None
    action_payload = None

    try:
        prompt = f"""You are an empathetic and uplifting chatbot named Aura.
The user is currently feeling: {current_mood}.
The user said: "{user_input}"

Respond in a friendly, supportive, and concise way to uplift their mood if they seem sad, angry, or stressed.
If the user is sad, you can suggest listening to a happy song.
If the user is angry, you can suggest a brief calming exercise.
If the user is happy or neutral, just have a pleasant conversation.
Keep your responses to 1-2 sentences.
Do not explicitly say "I am an AI". Behave like a companion.
"""

        if not user_input and current_mood != "neutral":
            prompt = f"""You are an empathetic and uplifting chatbot named Aura.
The user is currently feeling: {current_mood}.
They haven't said anything yet. Start a gentle conversation to check in on them or offer a small uplifting thought.
If they are sad, you can suggest listening to a happy song.
If they are angry, you can suggest a brief calming exercise.
Keep your responses to 1-2 sentences.
"""
        elif not user_input and current_mood == "neutral":
             prompt = "You are a friendly chatbot named Aura. Greet the user warmly and ask how their day is going. Keep it short."

        gemini_response = gemini_model.generate_content(prompt)
        bot_response = gemini_response.text

        if "sad" in current_mood.lower():
            if "song" in bot_response.lower() or "music" in bot_response.lower():
                 action = "play_song"
                 action_payload = {"song_url": url_for('static', filename='audio/121.mp3')}
        elif "angry" in current_mood.lower():
            if "calm" in bot_response.lower() or "breathe" in bot_response.lower() or "relax" in bot_response.lower():
                action = "suggest_activity"
                action_payload = {"activity_text": "How about a quick calming exercise? Try taking a few deep breaths: inhale for 4 counts, hold for 4, and exhale slowly for 6."}

        save_conversation(session['username'], user_input or f"({current_mood} detected - proactive)", bot_response)
        return jsonify({
            "reply": bot_response,
            "action": action,
            "action_payload": action_payload
        })

    except Exception as e:
        print(f"Error in Gemini chat: {e}")
        save_conversation(session['username'], user_input or f"({current_mood} detected - proactive)", bot_response)
        return jsonify({"reply": bot_response, "error_detail": str(e)})

if __name__ == '__main__':
    audio_dir = os.path.join('static', 'audio')
    os.makedirs(audio_dir, exist_ok=True)
    song_path = os.path.join(audio_dir, '121.mp3')
    if not os.path.exists(song_path):
        try:
            with open(song_path, 'wb') as f: # Creates a tiny, silent placeholder MP3. Replace with a real one.
                f.write(b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\xbb\x00\x00\x00\xee\x02\x00\x02\x00\x10\x00data\x00\x00\x00\x00')
            print(f"Created dummy '{song_path}'. Please replace it with a real MP3 file for the 'sad' mood.")
        except Exception as e_song:
            print(f"Could not create dummy song: {e_song}. Please add '121.mp3' to 'static/audio/'.")

    app.run(debug=True, host='0.0.0.0', port=5000)