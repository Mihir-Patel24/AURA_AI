document.addEventListener('DOMContentLoaded', () => {
    // --- Shared Utilities ---
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
        // Check for saved dark mode preference
        if (localStorage.getItem('auraAiDarkMode') === 'enabled') {
            document.body.classList.add('dark-mode');
            darkModeToggle.innerHTML = '<i class="fas fa-sun"></i>';
        }

        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('auraAiDarkMode', 'enabled');
                darkModeToggle.innerHTML = '<i class="fas fa-sun"></i>';
            } else {
                localStorage.setItem('auraAiDarkMode', 'disabled');
                darkModeToggle.innerHTML = '<i class="fas fa-moon"></i>';
            }
        });
    }

    const currentYearSpan = document.getElementById('currentYear');
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }

    // --- Page Specific Initialization ---
    if (document.getElementById('chatbox')) { // Check if we are on the chat page
        initChatPage();
    }
    // Login page doesn't need specific JS other than dark mode/year handled above
    // Dashboard page also doesn't need specific JS other than dark mode/year
});


function initChatPage() {
    // DOM Elements - IDs must match chat.html
    const video = document.getElementById('videoFeed');
    const canvas = document.getElementById('canvas'); // Keep canvas even if hidden, for drawing
    const context = canvas.getContext('2d');
    const moodTextEl = document.getElementById('moodText'); // For the mood text itself
    const chatbox = document.getElementById('chatbox');
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    const voiceButton = document.getElementById('voiceButton');
    const voiceStatusEl = document.getElementById('voiceStatus');
    const songPlayer = document.getElementById('songPlayer');
    const activitySuggestionEl = document.getElementById('activitySuggestion');

    // State variables
    let moodDetectionInterval;
    let currentMood = 'neutral';
    let isBotSpeaking = false;
    let proactiveGreetingSent = false;
    let recognition;
    let isRecognizing = false;

    // --- Web Speech API Setup ---
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            isRecognizing = true;
            voiceStatusEl.textContent = 'Listening...';
            voiceButton.classList.add('recording'); // You might need CSS for .recording
            voiceButton.innerHTML = '<i class="fas fa-stop-circle"></i>';
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            userInput.value = transcript;
            sendMessage(); // Automatically send after voice input
        };

        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            let errorMsg = `Error: ${event.error}`;
            if (event.error === 'no-speech') errorMsg = 'No speech detected. Try again.';
            else if (event.error === 'audio-capture') errorMsg = 'Microphone error. Check permissions.';
            else if (event.error === 'not-allowed') errorMsg = 'Mic access denied. Please allow.';
            voiceStatusEl.textContent = errorMsg;
        };

        recognition.onend = () => {
            isRecognizing = false;
            voiceStatusEl.textContent = 'Voice input: Inactive';
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '<i class="fas fa-microphone"></i>';
        };
    } else {
        voiceButton.disabled = true;
        voiceStatusEl.textContent = 'Speech recognition not supported.';
    }

    voiceButton.addEventListener('click', () => {
        if (!recognition) return;
        if (isRecognizing) {
            recognition.stop();
        } else {
            try {
                navigator.mediaDevices.getUserMedia({ audio: true }) // Prompt for mic permission early
                    .then(() => recognition.start())
                    .catch(err => {
                        console.error("Mic permission or start error:", err);
                        voiceStatusEl.textContent = "Mic access denied or error.";
                    });
            } catch (e) {
                console.error("Error starting recognition:", e);
                voiceStatusEl.textContent = "Could not start voice input.";
            }
        }
    });


    // --- Video and Mood Detection ---
    async function setupCamera() {
        if (!video) {
            console.error("Video element not found for camera setup.");
            moodTextEl.textContent = "Video Error";
            return;
        }
        // Set canvas dimensions based on video element (even if CSS scales video)
        canvas.width = video.videoWidth || video.width || 320;
        canvas.height = video.videoHeight || video.height || 240;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
            video.srcObject = stream;
            video.onloadedmetadata = () => {
                video.play().catch(e => console.error("Video play error:", e)); // Ensure video plays
                
                // Set canvas dimensions again after metadata loaded, if they changed
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                if (moodDetectionInterval) clearInterval(moodDetectionInterval);
                setTimeout(() => {
                    moodDetectionInterval = setInterval(captureAndSendFrame, 5000);
                    captureAndSendFrame(); // Initial capture
                }, 1000);

                if (!proactiveGreetingSent) {
                    setTimeout(() => {
                        sendProactiveGreeting();
                        proactiveGreetingSent = true;
                    }, 2500);
                }
            };
        } catch (err) {
            console.error("Error accessing camera: ", err);
            moodTextEl.textContent = "Camera Error";
            addMessageToChatbox("Aura", "I can't access your camera for mood detection. We can still chat!", "bot");
            if (!proactiveGreetingSent) {
                setTimeout(() => {
                    sendProactiveGreeting();
                    proactiveGreetingSent = true;
                }, 1500);
            }
        }
    }

    function captureAndSendFrame() {
        if (video.paused || video.ended || video.readyState < video.HAVE_ENOUGH_DATA) {
            return;
        }
        // Ensure canvas dimensions match current video dimensions if dynamic
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataURL = canvas.toDataURL('image/jpeg', 0.7); // Quality 0.7

        fetch('/process_video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: imageDataURL })
        })
        .then(response => {
            if (!response.ok) {
                if (response.status === 401) console.warn("Mood detection: Not authenticated (401).");
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.mood) {
                currentMood = data.mood;
                moodTextEl.textContent = data.mood.charAt(0).toUpperCase() + data.mood.slice(1);
                // Update badge color based on mood (optional)
                moodTextEl.className = `badge bg-${getMoodColor(currentMood)} mood-badge`;
            } else if (data.error) {
                console.error("Mood detection server error:", data.error, data.error_detail);
                moodTextEl.textContent = "Error";
            }
        })
        .catch(error => {
            console.error('Error sending video frame:', error);
            moodTextEl.textContent = "Network Error";
        });
    }
    
    function getMoodColor(mood) {
        switch (mood.toLowerCase()) {
            case 'happy': return 'success';
            case 'sad': return 'info';
            case 'angry': return 'danger';
            case 'surprised': return 'warning';
            case 'neutral': return 'secondary';
            default: return 'primary';
        }
    }


    // --- Chat Functionality ---
    function addMessageToChatbox(sender, message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', type === 'user' ? 'user-message' : 'bot-message');
        // Sanitize message text before inserting as HTML to prevent XSS
        const p = document.createElement('p');
        p.textContent = message; 
        messageDiv.appendChild(p);
        chatbox.appendChild(messageDiv);
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    function speak(text) {
        if (isBotSpeaking || !('speechSynthesis' in window) || !speechSynthesis) {
            console.log("Speech synthesis busy, not supported, or not available.");
            return;
        }
        speechSynthesis.cancel(); // Cancel any previous speech
        isBotSpeaking = true;
        const utterance = new SpeechSynthesisUtterance(text);
        // You can add voice selection logic here if desired
        // const voices = speechSynthesis.getVoices();
        // utterance.voice = voices.find(v => v.name === "Google UK English Female") || voices[0];
        utterance.onend = () => { isBotSpeaking = false; };
        utterance.onerror = (e) => {
            console.error("Speech synthesis error:", e);
            isBotSpeaking = false;
        };
        speechSynthesis.speak(utterance);
    }
    
    let thinkingMessageElement = null;

    function showThinkingMessage() {
        if (thinkingMessageElement) return; 
        thinkingMessageElement = document.createElement('div');
        thinkingMessageElement.classList.add('message', 'bot-message');
        const p = document.createElement('p');
        p.textContent = "Aura is thinking..."; // Or use an icon/spinner
        thinkingMessageElement.appendChild(p);
        chatbox.appendChild(thinkingMessageElement);
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    function updateOrRemoveThinkingMessage(newText) {
        if (thinkingMessageElement) {
            if (newText) {
                thinkingMessageElement.querySelector('p').textContent = newText;
                thinkingMessageElement = null; 
            } else {
                thinkingMessageElement.remove();
                thinkingMessageElement = null;
            }
        } else if (newText) {
             addMessageToChatbox("Aura", newText, "bot");
        }
        chatbox.scrollTop = chatbox.scrollHeight;
    }

    async function sendProactiveGreeting() {
        showThinkingMessage();
        try {
            const response = await fetch('/chat_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: "", mood: currentMood })
            });
            if (!response.ok) {
                if (response.status === 401) console.warn("Proactive greeting: Not authenticated (401).");
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            updateOrRemoveThinkingMessage(data.reply);
            speak(data.reply);
            handleAction(data.action, data.action_payload);
        } catch (error) {
            console.error('Error sending proactive greeting:', error);
            updateOrRemoveThinkingMessage("Hi there! I had a little trouble starting. How can I help?");
        }
    }

    async function sendMessage() {
        const messageText = userInput.value.trim();
        if (!messageText) return;

        addMessageToChatbox("You", messageText, "user");
        userInput.value = '';
        showThinkingMessage();

        try {
            const response = await fetch('/chat_message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: messageText, mood: currentMood })
            });
            if (!response.ok) {
                if (response.status === 401) console.warn("Send message: Not authenticated (401).");
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            updateOrRemoveThinkingMessage(data.reply);
            speak(data.reply);
            handleAction(data.action, data.action_payload);
        } catch (error) {
            console.error('Error sending message:', error);
            updateOrRemoveThinkingMessage("Sorry, I'm having trouble connecting. Please try again.");
        }
    }

    function handleAction(action, payload) {
        songPlayer.pause();
        songPlayer.src = "";
        activitySuggestionEl.classList.add('d-none'); // Bootstrap class to hide
        activitySuggestionEl.textContent = '';

        if (action === "play_song" && payload && payload.song_url) {
            songPlayer.src = payload.song_url;
            songPlayer.play().catch(e => console.error("Error playing song:", e));
            activitySuggestionEl.textContent = "Now playing an uplifting song for you! 🎶";
            activitySuggestionEl.classList.remove('d-none');
        } else if (action === "suggest_activity" && payload && payload.activity_text) {
            activitySuggestionEl.textContent = payload.activity_text;
            activitySuggestionEl.classList.remove('d-none');
        }
    }

    sendButton.addEventListener('click', sendMessage);
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // --- Initialization ---
    if (video && moodTextEl && chatbox && userInput && sendButton && voiceButton && voiceStatusEl && songPlayer && activitySuggestionEl) {
        setupCamera(); // Start camera and mood detection loop
    } else {
        console.error("One or more critical chat page elements were not found. Chat functionality may be impaired.");
    }
}