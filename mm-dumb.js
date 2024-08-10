Module.register("MMM-VoiceAssistant", {
    // Default module config
    defaults: {
        serverUrl: "http://localhost:3000",
        updateInterval: 10000,
        retryDelay: 2500,
        maxRetries: 5,
        wakePhrases: ["Hey Mirror", "OK Mirror"],
        voiceActivationEnabled: true,
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
        this.initializeVoiceRecognition();
        this.scheduleUpdate();
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

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(this.handleStream.bind(this))
                .catch(this.handleError.bind(this));
        } else {
            this.status = "Audio capture not supported";
            this.updateDom();
        }
    },

    // Handle audio stream
    handleStream: function (stream) {
        const mediaRecorder = new MediaRecorder(stream);
        const audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", event => {
            audioChunks.push(event.data);
        });

        mediaRecorder.addEventListener("stop", () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            this.sendAudioToServer(audioBlob);
        });

        // Record for 5 seconds
        mediaRecorder.start();
        setTimeout(() => mediaRecorder.stop(), 5000);
    },

    // Handle errors
    handleError: function (error) {
        console.error('Error accessing microphone:', error);
        this.status = "Error accessing microphone";
        this.updateDom();
    },

    // Send audio to server
    sendAudioToServer: function (audioBlob) {
        this.status = "Processing...";
        this.updateDom();

        fetch(this.config.serverUrl + "/process-audio", {
            method: 'POST',
            body: audioBlob,
            headers: {
                'Content-Type': 'audio/wav'
            }
        })
            .then(response => response.json())
            .then(data => {
                this.voiceResponse = data.response;
                this.status = "Response received";
                this.updateDom();
                this.playAudioResponse(data.audioContent);
            })
            .catch(error => {
                console.error("Error sending audio to server:", error);
                this.status = "Error processing request";
                this.updateDom();
            });
    },

    // Play audio response
    playAudioResponse: function (audioContent) {
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
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