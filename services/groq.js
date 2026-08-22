'use strict';

// Nombre de fichero heredado de Groq — cliente real es DeepSeek (API compatible OpenAI).
const OpenAI = require('openai');

const deepseekClient = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY || 'dummy',
    baseURL: 'https://api.deepseek.com'
});

module.exports = deepseekClient;
