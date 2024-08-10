Module.register("MMM-VoiceAssistant", {
    // Default module config
    defaults: {
        serverUrl: "http://localhost:3000",
        updateInterval: 10000,
        retryDelay: 2500,
        maxRetries: 5,
        wakePhrases: ["Hey Mirror", "OK Mirror"],
        voiceActivationEnabled: true,
        useCustomVoice: false,
        customVoiceName: "en-US-Standard-C",
        debugMode: false
    },

    // Define required scripts
    getScripts: function () {
        return [
            this.file('node_modules/socket.io-client/dist/socket.io.js'),
            "https://cdnjs.cloudflare.com/ajax/libs/annyang/2.6.1/annyang.min.js"
        ];
    },

    // Define required styles
    getStyles: function () {
        return [
            "MMM-VoiceAssistant.css",
        ];
    },

    // Override dom generator
    getDom: function () {
        var wrapper = document.createElement("div");
        wrapper.className = "voice-assistant";

        if (this.voiceResponse) {
            var responseElement = document.createElement("p");
            responseElement.innerHTML = this.voiceResponse;
            wrapper.appendChild(responseElement);
        }

        var statusElement = document.createElement("div");
        statusElement.className = "status";
        statusElement.innerHTML = this.status;
        wrapper.appendChild(statusElement);

        return wrapper;
    },

    // Override start method
    start: function () {
        Log.info("Starting module: " + this.name);
        this.status = "Initializing...";
        this.voiceResponse = "";
        this.retryCount = 0;
        this.sendSocketNotification("CONFIG", this.config);
        this.initializeVoiceRecognition();
        this.scheduleUpdate();
    },

    // Override socket notification handler
    socketNotificationReceived: function (notification, payload) {
        if (notification === "VOICE_RESPONSE") {
            this.voiceResponse = payload;
            this.updateDom();
        }
    },

    // Schedule update interval
    scheduleUpdate: function () {
        var self = this;
        setInterval(function () {
            self.updateStatus();
        }, this.config.updateInterval);
    },

    // Update module status
    updateStatus: function () {
        var self = this;
        fetch(this.config.serverUrl + "/status")
            .then(response => response.json())
            .then(data => {
                self.status = "Connected: " + data.status;
                self.updateDom();
                self.retryCount = 0;
            })
            .catch(error => {
                console.error("Error fetching status:", error);
                self.status = "Connection Error";
                self.updateDom();
                self.retryConnection();
            });
    },

    // Retry connection if failed
    retryConnection: function () {
        var self = this;
        if (self.retryCount < self.config.maxRetries) {
            self.retryCount++;
            setTimeout(function () {
                self.updateStatus();
            }, self.config.retryDelay);
        } else {
            self.status = "Max retries reached. Please check server.";
            self.updateDom();
        }
    },

    // Initialize voice recognition
    initializeVoiceRecognition: function () {
        if (this.config.voiceActivationEnabled && annyang) {
            var commands = {};
            this.config.wakePhrases.forEach(phrase => {
                commands[phrase] = this.startListening.bind(this);
            });

            annyang.addCommands(commands);
            annyang.start({ autoRestart: true, continuous: false });

            if (this.config.debugMode) {
                annyang.debug();
            }
        }
    },

    // Start listening for voice input
    startListening: function () {
        this.status = "Listening...";
        this.updateDom();

        if (annyang) {
            annyang.abort();
            annyang.removeCommands();
            annyang.addCallback('result', this.processVoiceInput.bind(this));
            annyang.start({ autoRestart: false, continuous: false });
        }
    },

    // Process voice input
    processVoiceInput: function (phrases) {
        if (phrases && phrases.length > 0) {
            this.status = "Processing: " + phrases[0];
            this.updateDom();
            this.sendVoiceRequest(phrases[0]);
        } else {
            this.status = "Sorry, I didn't catch that.";
            this.updateDom();
        }

        // Reset voice recognition
        setTimeout(() => {
            this.initializeVoiceRecognition();
        }, 1000);
    },

    // Send voice request to server
    sendVoiceRequest: function (text) {
        var self = this;
        fetch(this.config.serverUrl + "/process", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text }),
        })
            .then(response => response.json())
            .then(data => {
                self.voiceResponse = data.response;
                self.status = "Response received";
                self.updateDom();
                self.speakResponse(data.response);
            })
            .catch(error => {
                console.error("Error sending voice request:", error);
                self.status = "Error processing request";
                self.updateDom();
            });
    },

    // Speak the response using text-to-speech
    speakResponse: function (text) {
        if ('speechSynthesis' in window) {
            var speech = new SpeechSynthesisUtterance(text);

            if (this.config.useCustomVoice) {
                var voices = speechSynthesis.getVoices();
                speech.voice = voices.find(voice => voice.name === this.config.customVoiceName);
            }

            speechSynthesis.speak(speech);
        } else {
            console.warn("Text-to-speech not supported in this browser.");
        }
    },

    // Notify core of module status
    notificationReceived: function (notification, payload, sender) {
        if (notification === "ALL_MODULES_STARTED") {
            this.sendNotification("SHOW_ALERT", {
                type: "notification",
                message: "Voice Assistant is ready.",
                title: "Module Loaded",
                timer: 3000
            });
        }
    }
});