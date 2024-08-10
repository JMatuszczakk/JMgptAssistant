const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bodyParser = require('body-parser');
const cors = require('cors');
const natural = require('natural');
const speech = require('@google-cloud/speech');
const textToSpeech = require('@google-cloud/text-to-speech');
const { Configuration, OpenAIApi } = require('openai');
const fs = require('fs');
const util = require('util');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.raw({ type: 'audio/wav', limit: '50mb' }));

// Google Cloud clients
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// OpenAI configuration
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Server state
let connectedClients = 0;
let lastProcessedCommand = '';
let conversationHistory = [];

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
    const response = await getGPTResponse(text);
    io.emit('server_response', { command: text, response });
    return response;
}

async function getWeatherResponse() {
    // This is a mock function. In a real application, you'd integrate with a weather API.
    const weatherConditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
    const condition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    const temperature = Math.floor(Math.random() * 30) + 10; // Random temperature between 10 and 40
    return `The weather is currently ${condition} with a temperature of ${temperature}°C.`;
}

function setAlarm(time) {
    // This is a mock function
    return `Alarm set for ${time}.`;
}

function setReminder(text) {
    return `Reminder set: ${text}`;
}

function addTodo(item) {
    return `Added to your to-do list: ${item}`;
}

async function getGPTResponse(text) {
    try {
        // Add user's message to conversation history
        conversationHistory.push({ role: 'user', content: text });

        // Prepare messages for GPT
        const messages = [
            { role: 'system', content: 'You are a helpful assistant for a smart mirror. Provide concise and relevant responses. Use the available functions when appropriate.' },
            ...conversationHistory
        ];

        const functions = [
            {
                name: 'getWeatherResponse',
                description: 'Get the current weather conditions',
                parameters: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'setAlarm',
                description: 'Set an alarm for a specific time',
                parameters: {
                    type: 'object',
                    properties: {
                        time: {
                            type: 'string',
                            description: 'The time to set the alarm for, in HH:MM format',
                        },
                    },
                    required: ['time'],
                },
            },
            {
                name: 'setReminder',
                description: 'Set a reminder with specific text',
                parameters: {
                    type: 'object',
                    properties: {
                        text: {
                            type: 'string',
                            description: 'The text of the reminder',
                        },
                    },
                    required: ['text'],
                },
            },
            {
                name: 'addTodo',
                description: 'Add an item to the to-do list',
                parameters: {
                    type: 'object',
                    properties: {
                        item: {
                            type: 'string',
                            description: 'The item to add to the to-do list',
                        },
                    },
                    required: ['item'],
                },
            },
        ];

        const completion = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo-0613',
            messages: messages,
            functions: functions,
            function_call: 'auto',
        });

        const responseMessage = completion.data.choices[0].message;

        let response;
        if (responseMessage.function_call) {
            const functionName = responseMessage.function_call.name;
            const functionArgs = JSON.parse(responseMessage.function_call.arguments);

            switch (functionName) {
                case 'getWeatherResponse':
                    response = await getWeatherResponse();
                    break;
                case 'setAlarm':
                    response = setAlarm(functionArgs.time);
                    break;
                case 'setReminder':
                    response = setReminder(functionArgs.text);
                    break;
                case 'addTodo':
                    response = addTodo(functionArgs.item);
                    break;
                default:
                    response = "I'm not sure how to handle that function.";
            }
        } else {
            response = responseMessage.content;
        }

        // Add assistant's response to conversation history
        conversationHistory.push({ role: 'assistant', content: response });

        // Limit conversation history to last 10 messages to manage token usage
        if (conversationHistory.length > 10) {
            conversationHistory = conversationHistory.slice(-10);
        }

        return response;
    } catch (error) {
        console.error('Error calling GPT API:', error);
        return "I'm sorry, I couldn't process that request at the moment. Can you try again?";
    }
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