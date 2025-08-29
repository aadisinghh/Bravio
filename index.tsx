/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Chat } from "@google/genai";

// AppState defines the possible operational states of the voice assistant.
type AppState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING";

// TranscriptItem represents a single entry in the conversation history.
type TranscriptItem = {
  author: "user" | "assistant";
  text: string;
};

// --- Speech Recognition Setup ---
// Cross-browser compatibility for the Web Speech API.
const SpeechRecognition =
  (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

// Configure speech recognition instance if it's available.
if (recognition) {
  recognition.continuous = false; // Stop listening after the user stops speaking.
  recognition.lang = "en-US";
  recognition.interimResults = false; // Get final results only.
  recognition.maxAlternatives = 1;
}

const ASSISTANT_NAME = "Bravio";

// --- UI Components ---
const UserIcon = () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 12C14.2091 12 16 10.2091 16 8C16 5.79086 14.2091 4 12 4C9.79086 4 8 5.79086 8 8C8 10.2091 9.79086 12 12 12Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M20 21C20 16.5817 16.4183 13 12 13C7.58172 13 4 16.5817 4 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const AssistantIcon = () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 4.5C15.9375 4.5 19.5 7.0625 19.5 12C19.5 16.9375 15.9375 19.5 12 19.5C8.0625 19.5 4.5 16.9375 4.5 12C4.5 7.0625 8.0625 4.5 12 4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 12H12.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 12H9.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M15 12H15.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const SendIcon = () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M22 2L11 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);

const MicrophoneIcon = () => (
    <svg className="icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M12 19v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
);


const App: React.FC = () => {
  // --- State Management ---
  const [appState, setAppState] = useState<AppState>("IDLE");
  const [statusText, setStatusText] = useState(`Click the orb or type a command...`);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [speechRate, setSpeechRate] = useState(1);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string | null>(null);
  const [criticalError, setCriticalError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");

  // --- Refs for persistent objects ---
  const geminiChat = useRef<Chat | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);

  /**
   * Effect hook for one-time initialization of the application.
   * Checks for browser support and API key, and initializes the Gemini chat model.
   * Sets a critical error state if any of these steps fail.
   */
  useEffect(() => {
    // 1. Check for browser support for Web Speech API.
    if (!recognition) {
      setCriticalError("Sorry, your browser doesn't support the Web Speech API.");
      return;
    }

    // 2. Check for the Gemini API Key.
    if (!process.env.API_KEY) {
      console.error("API_KEY environment variable not set.");
      setCriticalError("Configuration Error: Gemini API key is missing. Please set the API_KEY environment variable.");
      return;
    }

    // 3. Initialize the Gemini Chat model.
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      geminiChat.current = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
          systemInstruction:
            `You are ${ASSISTANT_NAME}, a friendly and helpful voice assistant. Your responses should be concise, clear, and suitable for being spoken aloud. Avoid overly complex sentences or formatting that doesn't translate well to speech.`,
        },
      });
    } catch (error) {
        console.error("Failed to initialize Gemini:", error);
        setCriticalError("Error: Could not connect to the AI service. Check the console for details.");
    }
  }, []); // Empty dependency array ensures this effect runs only once on mount.


  /**
   * Effect hook to load and manage available speech synthesis voices.
   */
  useEffect(() => {
    const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        const englishVoices = voices.filter(voice => voice.lang.startsWith('en'));
        setAvailableVoices(englishVoices);
        // Set a default voice if none is selected.
        if (englishVoices.length > 0 && !selectedVoiceURI) {
            setSelectedVoiceURI(englishVoices[0].voiceURI);
        }
    };
    // Voices may load asynchronously.
    window.speechSynthesis.onvoiceschanged = loadVoices;
    loadVoices();
    return () => {
        // Clean up the event listener on component unmount.
        window.speechSynthesis.onvoiceschanged = null;
    };
  }, [selectedVoiceURI]); // Reruns if selectedVoiceURI changes to ensure consistency.

  /**
   * Speaks the given text using the Web Speech API and updates the UI.
   * Wrapped in useCallback for performance optimization.
   */
  const speakAndDisplay = useCallback((text: string, author: "user" | "assistant" = "assistant") => {
      setTranscript((prev) => [...prev, { author, text }]);
      
      setAppState("SPEAKING");
      setStatusText("Speaking...");
  
      const utterance = new SpeechSynthesisUtterance(text);
      const selectedVoice = availableVoices.find(v => v.voiceURI === selectedVoiceURI);
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }
      utterance.rate = speechRate;
      utterance.onend = () => {
        setAppState("IDLE");
        setStatusText(`Click the orb or type a command...`);
      };
      // Make sure speech synthesis is not in a paused state from previous errors.
      window.speechSynthesis.cancel(); 
      window.speechSynthesis.speak(utterance);
  }, [availableVoices, selectedVoiceURI, speechRate]);

  /**
   * Central function to process a command (from voice or text).
   * It sends the command to Gemini and handles the response.
   */
  const processCommand = useCallback(async (command: string) => {
    setTranscript((prev) => [...prev, { author: "user", text: command }]);
    setAppState("THINKING");
    setStatusText("Thinking...");

    try {
        if (!geminiChat.current) {
          throw new Error("Gemini chat is not initialized.");
        }
        
        // Check for network connection before making the API call.
        if (!navigator.onLine) {
            throw new Error("network-offline");
        }
        
        const result = await geminiChat.current.sendMessage({ message: command });
        // The result.text can sometimes be empty if the model has nothing to say or
        // if the response is filtered. We need to handle this gracefully.
        const assistantMessage = result.text?.trim();
        
        if (assistantMessage) {
            speakAndDisplay(assistantMessage);
        } else {
            // Provide feedback if the response is empty to avoid silent failures.
            const emptyResponseMessage = "I'm sorry, I couldn't generate a response for that. Please try another question.";
            speakAndDisplay(emptyResponseMessage);
        }

    } catch (error) {
        console.error("Gemini API error:", error);
        let errorMessage = "Sorry, an unexpected issue occurred. Please try again.";
        
        // Customize error message based on error type
        if (error instanceof Error && error.message === "network-offline") {
            errorMessage = "It seems you're offline. Please check your internet connection and try again.";
        } else {
            // A more specific message for API-side issues.
            errorMessage = "I'm sorry, an issue occurred with the AI service. Please try your request again in a moment.";
        }
        
        speakAndDisplay(errorMessage);
    }
  }, [speakAndDisplay]);

  /**
   * Handles the 'result' event from the SpeechRecognition API.
   * Processes the user's command and sends it to the Gemini API.
   */
  const handleResult = useCallback(async (event: any) => {
    const userMessage = event.results[0][0].transcript;
    const wakeWord = ASSISTANT_NAME.toLowerCase();

    // Check if the user's speech starts with the wake word.
    if (userMessage.toLowerCase().trim().startsWith(wakeWord)) {
      const command = userMessage.trim().substring(wakeWord.length).trim();
      
      if (!command) {
          speakAndDisplay("I'm listening. Please state your command.");
          return;
      }
      processCommand(command);

    } else {
      // Guide the user if they forget the wake word.
      const errorMessage = `Please start your command with my name, "${ASSISTANT_NAME}".`;
      speakAndDisplay(errorMessage, "assistant"); 
    }
  }, [speakAndDisplay, processCommand]);

  /** Handles the 'end' event, resetting state if listening stops unexpectedly. */
  const handleEnd = useCallback(() => {
    // Only reset state if we were in the listening state. This prevents
    // conflicts with other state transitions.
    if (appState === "LISTENING") {
      setAppState("IDLE");
      setStatusText(`Click the orb or type a command...`);
    }
  }, [appState]);

  /** Handles speech recognition errors with user-friendly messages. */
  const handleError = useCallback((event: any) => {
      console.error("Speech recognition error", event.error, event.message);
      let errorMessage: string | null = null;
      
      // Immediately reset state from listening on any error.
      if (appState === 'LISTENING') {
          setAppState('IDLE');
      }

      switch (event.error) {
          case 'no-speech':
              errorMessage = "I didn't hear anything. Could you please try again?";
              break;
          case 'not-allowed':
          case 'service-not-allowed':
              setCriticalError("Microphone access is not allowed. Please enable it in your browser settings and refresh the page.");
              break;
          case 'audio-capture':
              errorMessage = "I'm having trouble with your microphone. Please make sure it's connected and enabled.";
              break;
          case 'network':
              errorMessage = "A network error occurred with the speech service. Please check your internet connection.";
              break;
          default:
              errorMessage = `An error occurred with speech recognition: ${event.error}. Please try again.`;
              break;
      }
      
      if (errorMessage) {
        speakAndDisplay(errorMessage);
      }
  }, [appState, speakAndDisplay]);

  /**
   * Effect hook to manage the lifecycle of speech recognition event listeners.
   * It attaches the listeners when the component mounts and cleans them up on unmount.
   */
  useEffect(() => {
    if (!recognition) return; // Guard against no browser support.

    // Attach event listeners using the memoized callbacks.
    recognition.addEventListener("result", handleResult);
    recognition.addEventListener("end", handleEnd);
    recognition.addEventListener("error", handleError);

    // Cleanup function to remove listeners and cancel any ongoing speech/recognition.
    return () => {
      recognition.removeEventListener("result", handleResult);
      recognition.removeEventListener("end", handleEnd);
      recognition.removeEventListener("error", handleError);
      recognition.abort(); // Forcefully stop recognition
      window.speechSynthesis.cancel();
    };
  }, [handleResult, handleEnd, handleError]); // Re-attaches if handlers ever change.
  
  /**
   * Layout effect to smoothly scroll the transcript to the bottom when new messages are added.
   * `useLayoutEffect` is used to prevent visual flickering by running synchronously after DOM mutations.
   */
  useLayoutEffect(() => {
    const container = transcriptContainerRef.current;
    if (container) {
        container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
        });
    }
  }, [transcript]);

  /**
   * Plays a short audio cue using the Web Audio API to indicate that the
   * assistant has started listening. This provides immediate auditory feedback.
   */
  const playStartListeningSound = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!audioCtx) return;

      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // A5 note, a clear chime

      // Create a short "beep" sound with a quick fade-in and fade-out
      gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.25, audioCtx.currentTime + 0.02); // Quick ramp up
      gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.15); // Fade out

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.start(audioCtx.currentTime);
      oscillator.stop(audioCtx.currentTime + 0.15);
    } catch (error) {
        console.error("Could not play start sound:", error);
    }
  };

  // --- Event Handlers ---
  const handleOrbClick = () => {
    // Prevent interaction if there's a critical error or recognition is not available.
    if (criticalError || !recognition) return;

    if (appState === "IDLE") {
      playStartListeningSound();
      recognition.start();
      setAppState("LISTENING");
      setStatusText("Listening...");
    } else if (appState === "LISTENING") {
      recognition.stop();
      // handleEnd will be called automatically, which resets the state.
    }
  };
  
  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const command = textInput.trim();
    if (!command || isDisabled) return;
    processCommand(command);
    setTextInput("");
  };

  const handleRateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSpeechRate(parseFloat(event.target.value));
  };

  const handleVoiceChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedVoiceURI(event.target.value);
  };

  // --- Render Logic ---
  const orbStateClass = appState.toLowerCase();
  const isDisabled = !!criticalError || appState === "THINKING" || appState === "SPEAKING";

  return (
    <div className="app-container">
        {criticalError && (
            <div className="error-overlay">
                <div className="error-message">
                    <h3>Initialization Error</h3>
                    <p>{criticalError}</p>
                </div>
            </div>
        )}
        <div className="top-section">
            <h1 className="assistant-name">{ASSISTANT_NAME}</h1>
            <div ref={transcriptContainerRef} className="transcript-container">
                <div className="transcript-container-inner">
                {transcript.map((item, index) => (
                    <div key={index} className={`message-wrapper ${item.author}`}>
                      <div className="message">
                          {item.author === "user" ? <UserIcon/> : <AssistantIcon/>}
                          <span>{item.text}</span>
                      </div>
                    </div>
                ))}
                </div>
            </div>
        </div>
        <div className="bottom-section">
            <div className="settings-container">
                <div className="setting-control">
                    <label htmlFor="rate-slider">Speed</label>
                    <div className="setting-control-row">
                        <input
                            id="rate-slider"
                            type="range"
                            min="0.5"
                            max="2"
                            step="0.1"
                            value={speechRate}
                            onChange={handleRateChange}
                            disabled={isDisabled}
                            aria-disabled={isDisabled}
                        />
                        <span>{speechRate.toFixed(1)}x</span>
                    </div>
                </div>
                <div className="setting-control">
                    <label htmlFor="voice-select">Voice</label>
                    <div className="setting-control-row">
                        <select
                            id="voice-select"
                            value={selectedVoiceURI || ''}
                            onChange={handleVoiceChange}
                            disabled={!availableVoices.length || isDisabled}
                            aria-disabled={!availableVoices.length || isDisabled}
                        >
                            {availableVoices.map((voice) => (
                                <option key={voice.voiceURI} value={voice.voiceURI}>
                                    {voice.name} ({voice.lang})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
            
            <form className="input-container" onSubmit={handleTextSubmit}>
                <input
                    type="text"
                    placeholder="Type your command..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    disabled={isDisabled}
                    aria-disabled={isDisabled}
                    aria-label="Text command input"
                />
                <button 
                    type="submit" 
                    className="send-button" 
                    disabled={isDisabled || !textInput.trim()} 
                    aria-label="Send command"
                >
                    <SendIcon />
                </button>
            </form>

            <button
                className={`assistant-orb ${orbStateClass}`}
                onClick={handleOrbClick}
                aria-label={
                appState === "LISTENING"
                    ? "Stop listening"
                    : "Start listening"
                }
                disabled={isDisabled}
                aria-disabled={isDisabled}
            >
                <MicrophoneIcon />
                {appState === "THINKING" && <div className="thinking-spinner"></div>}
            </button>
            <p className="status-text" aria-live="polite">{statusText}</p>
        </div>
    </div>
  );
};

const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<App />);