const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const natural = require('natural');
const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const fs = require('fs');
const util = require('util');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));

// Natural Language Processing setup
const tokenizer = new natural.WordTokenizer();
const classifier = new natural.BayesClassifier();

// Train the classifier with some basic intents
classifier.addDocument('what is the weather like', 'weather');
classifier.addDocument('tell me the forecast', 'weather');
classifier.addDocument('what\'s the temperature', 'weather');
classifier.addDocument('set an alarm', 'alarm');
classifier.addDocument('wake me up at', 'alarm');
classifier.addDocument('remind me to', 'reminder');
classifier.addDocument('add to my to-do list', 'todo');
classifier.train();

// Google Cloud clients
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// Server state
let connectedClients = 0;
let lastProcessedCommand = '';

// Routes
app.get('/status', (req, res) => {
    res.json({
        status: 'OK',
        connectedClients,
        lastProcessedCommand
    });
});

app.post('/process-audio', async (req, res) => {
    try {
        const audioBuffer = req.body;
        const audioBytes = audioBuffer.toString('base64');

        const [response] = await speechClient.recognize({
            audio: { content: audioBytes },
            config: {
                encoding: 'LINEAR16',
                sampleRateHertz: 16000,
                languageCode: 'en-US',
            },
        });

        const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');

        const processedResponse = await processCommand(transcription);
        const audioContent = await textToSpeech(processedResponse);

        res.json({
            transcription,
            response: processedResponse,
            audioContent: audioContent.toString('base64')
        });
    } catch (error) {
        console.error('Error processing audio:', error);
        res.status(500).json({ error: 'Error processing audio' });
    }
});

// Helper functions
async function processCommand(text) {
    lastProcessedCommand = text;
    const tokens = tokenizer.tokenize(text.toLowerCase());
    const intent = classifier.classify(tokens.join(' '));

    let response;
    switch (intent) {
        case 'weather':
            response = await getWeatherResponse(tokens);
            break;
        case 'alarm':
            response = setAlarm(tokens);
            break;
        case 'reminder':
            response = setReminder(tokens);
            break;
        case 'todo':
            response = addTodo(tokens);
            break;
        default:
            response = "I'm not sure how to help with that. Can you please rephrase?";
    }

    io.emit('server_response', { command: text, response });
    return response;
}

async function getWeatherResponse(tokens) {
    // This is a mock function. In a real application, you'd integrate with a weather API.
    const weatherConditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
    const condition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    const temperature = Math.floor(Math.random() * 30) + 10; // Random temperature between 10 and 40
    return `The weather is currently ${condition} with a temperature of ${temperature}°C.`;
}

function setAlarm(tokens) {
    // Extract time from tokens and set an alarm
    // This is a mock function
    const time = tokens.find(token => token.match(/\d{1,2}:\d{2}/));
    return time ? `Alarm set for ${time}.` : "I couldn't understand the time. Please try again.";
}

function setReminder(tokens) {
    // Extract reminder text
    const reminderText = tokens.slice(tokens.indexOf('to') + 1).join(' ');
    return `Reminder set: ${reminderText}`;
}

function addTodo(tokens) {
    // Extract todo item
    const todoItem = tokens.slice(tokens.indexOf('list') + 1).join(' ');
    return `Added to your to-do list: ${todoItem}`;
}

async function textToSpeech(text) {
    const request = {
        input: { text: text },
        voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
        audioConfig: { audioEncoding: 'MP3' },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;
}

// Socket.io
io.on('connection', (socket) => {
    console.log('New client connected');
    connectedClients++;

    socket.on('disconnect', () => {
        console.log('Client disconnected');
        connectedClients--;
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});